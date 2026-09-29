import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { isRunPanelHostMessage, type RunPanelHostMessage, type RunPanelTheme, type HostRunPanelMessage } from "../../web/src/run-panel/host-contract";
import { isPanelActionMessage, type PanelActionMessage, type PanelState } from "../../web/src/panel/contract";
import { errorHtml, frameHtml, panelHtml } from "./webview-html";

export interface FrameSettings {
  serverUrl: string;
  theme: RunPanelTheme;
  accessToken: string | undefined;
}

export interface WebviewBridge {
  zoom(): number;
  /** Address, appearance, and token of a server; only a connected session provides them. */
  frame(connection: string): FrameSettings | undefined;
  /** What the panel shows: the run of a server, otherwise the panel page. */
  selection(): { connection: string; runId: string | undefined } | undefined;
  panel(): PanelState;
  handle(connection: string, message: RunPanelHostMessage): void;
  panelAction(message: PanelActionMessage): void;
}

const PANEL_TITLE = "RAgents";

/** What the panel shows after rendering; a kept iframe needs its commands as a message. */
export type PanelRendering = "page" | "frame-kept" | "frame-created" | "error";

const nonce = () => randomBytes(16).toString("base64");

const zoomOf = (bridge: WebviewBridge): { zoom: number } | { error: string } => {
  try { return { zoom: bridge.zoom() }; } catch (cause) { return { error: cause instanceof Error ? cause.message : String(cause) }; }
};

const relay = (webview: vscode.Webview, bridge: WebviewBridge, connection: () => string | undefined): vscode.Disposable =>
  webview.onDidReceiveMessage((message: unknown) => {
    if (isPanelActionMessage(message)) { bridge.panelAction(message); return; }
    if (!isRunPanelHostMessage(message)) return;
    const name = connection();
    if (name !== undefined) bridge.handle(name, message);
  });

/** The RAgents panel in the secondary sidebar: the overview of all servers or the run panel of the selected run. */
export class PanelView implements vscode.WebviewViewProvider {
  #view: vscode.WebviewView | undefined;
  #showsPage = false;
  #showsError = false;
  #frameKey: string | undefined;

  constructor(private readonly bridge: WebviewBridge, private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist/webview")] };
    const subscription = relay(view.webview, this.bridge, () => this.bridge.selection()?.connection);
    view.onDidDispose(() => {
      subscription.dispose();
      if (this.#view === view) this.#view = undefined;
    });
    this.#showsPage = false;
    this.#frameKey = undefined;
    this.render();
  }

  /** Redraws the panel page or builds the iframe; an unchanged iframe keeps its state. */
  render(): PanelRendering {
    const view = this.#view;
    if (!view) return "page";
    const zoom = zoomOf(this.bridge);
    if ("error" in zoom) {
      this.#showsPage = false;
      this.#frameKey = undefined;
      this.#showsError = true;
      view.webview.html = errorHtml({ nonce: nonce(), title: PANEL_TITLE, message: zoom.error });
      return "error";
    }
    this.#showsError = false;
    const selection = this.bridge.selection();
    const frame = selection ? this.bridge.frame(selection.connection) : undefined;
    if (!selection || !frame) {
      this.#renderPage(view, zoom.zoom);
      return "page";
    }
    const key = `${selection.connection}|${frame.serverUrl}|${frame.theme}|${frame.accessToken ?? ""}`;
    if (!this.#showsPage && this.#frameKey === key) return "frame-kept";
    this.#showsPage = false;
    this.#frameKey = key;
    view.webview.html = frameHtml({
      serverUrl: frame.serverUrl,
      query: { run: selection.runId, host: "vscode", connection: selection.connection, theme: frame.theme, access: frame.accessToken },
      nonce: nonce(),
      title: PANEL_TITLE,
      zoom: zoom.zoom,
    });
    return "frame-created";
  }

  #renderPage(view: vscode.WebviewView, zoom: number): void {
    const state = this.bridge.panel();
    if (this.#showsPage) {
      void view.webview.postMessage({ type: "ragents.panel.state", state });
      return;
    }
    this.#showsPage = true;
    this.#frameKey = undefined;
    const webview = view.webview;
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist/webview", name)).toString();
    webview.html = panelHtml({ nonce: nonce(), title: PANEL_TITLE, state, zoom, scriptUri: asset("panel.js"), styleUri: asset("panel.css"), cspSource: webview.cspSource });
  }

  zoomChanged(): void {
    const zoom = zoomOf(this.bridge);
    if (this.#showsError || "error" in zoom) this.render();
    else void this.#view?.webview.postMessage({ type: "ragents.zoom", zoom: zoom.zoom });
  }

  post(message: HostRunPanelMessage): void {
    void this.#view?.webview.postMessage(message);
  }

  /** The badge on the view counts what the runs are currently waiting for; without an open input, there is none. */
  badge(value: number, tooltip: string): void {
    if (this.#view) this.#view.badge = value > 0 ? { value, tooltip } : undefined;
  }

  /** Without a built view, show displays nothing; then the view's command first brings it into the sidebar. */
  reveal(): void {
    if (this.#view) this.#view.show(true);
    else void vscode.commands.executeCommand("ragents.runPanel.focus");
  }
}

interface OpenPanel {
  panel: vscode.WebviewPanel;
  connection: string;
  runId: string;
  elementId: string;
  title: string;
  showsError: boolean;
}

/** A mini-app as an editor tab; one panel per (server, run, element), opening it again brings it to the front. */
export class AppPanels {
  readonly #panels = new Map<string, OpenPanel>();

  constructor(private readonly bridge: WebviewBridge, private readonly onPlacementsChanged: (connection: string, runId: string) => void) {}

  centerElements(connection: string, runId: string): ReadonlySet<string> {
    return new Set([...this.#panels.values()].filter((entry) => entry.connection === connection && entry.runId === runId).map((entry) => entry.elementId));
  }

  open(connection: string, runId: string, elementId: string, title: string, runTitle: string | undefined): void {
    const key = `${connection}:${runId}:${elementId}`;
    const existing = this.#panels.get(key);
    if (existing) {
      existing.panel.reveal(undefined, false);
      return;
    }
    const panel = vscode.window.createWebviewPanel("ragents.app", runTitle ? `${title} - ${runTitle}` : title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    });
    const entry: OpenPanel = { panel, connection, runId, elementId, title, showsError: false };
    this.#panels.set(key, entry);
    const subscription = relay(panel.webview, this.bridge, () => connection);
    panel.onDidDispose(() => {
      subscription.dispose();
      this.#panels.delete(key);
      this.onPlacementsChanged(connection, runId);
    });
    this.#render(entry);
    this.onPlacementsChanged(connection, runId);
  }

  close(connection: string, runId: string, elementId: string): void {
    this.#panels.get(`${connection}:${runId}:${elementId}`)?.panel.dispose();
  }

  /** Closes all tabs of a server; an ended session leaves no mini-app open. */
  closeConnection(connection: string): void {
    for (const entry of [...this.#panels.values()]) if (entry.connection === connection) entry.panel.dispose();
  }

  render(): void {
    for (const entry of this.#panels.values()) this.#render(entry);
  }

  zoomChanged(): void {
    const zoom = zoomOf(this.bridge);
    for (const entry of this.#panels.values()) {
      if (entry.showsError || "error" in zoom) this.#render(entry);
      else void entry.panel.webview.postMessage({ type: "ragents.zoom", zoom: zoom.zoom });
    }
  }

  post(message: HostRunPanelMessage): void {
    for (const entry of this.#panels.values()) void entry.panel.webview.postMessage(message);
  }

  dispose(): void {
    for (const entry of [...this.#panels.values()]) entry.panel.dispose();
  }

  #render(entry: OpenPanel): void {
    const frame = this.bridge.frame(entry.connection);
    if (!frame) return;
    const zoom = zoomOf(this.bridge);
    entry.showsError = "error" in zoom;
    if ("error" in zoom) {
      entry.panel.webview.html = errorHtml({ nonce: nonce(), title: entry.title, message: zoom.error });
      return;
    }
    entry.panel.webview.html = frameHtml({
      serverUrl: frame.serverUrl,
      query: { layout: "app", run: entry.runId, element: entry.elementId, host: "vscode", connection: entry.connection, theme: frame.theme, access: frame.accessToken },
      nonce: nonce(),
      title: entry.title,
      zoom: zoom.zoom,
    });
  }
}
