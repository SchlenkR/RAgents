import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { isRunPanelHostMessage, type RunPanelHostMessage, type RunPanelTheme, type HostRunPanelMessage } from "../../web/src/run-panel/host-contract";
import { isPanelActionMessage, type PanelActionMessage, type PanelState } from "../../web/src/panel/contract";
import { frameHtml, panelHtml } from "./webview-html";

export interface FrameSettings {
  serverUrl: string;
  theme: RunPanelTheme;
  accessToken: string | undefined;
}

export interface WebviewBridge {
  /** Adresse, Darstellung und Token einer Umgebung; nur eine verbundene Sitzung liefert sie. */
  frame(target: string): FrameSettings | undefined;
  /** Was das Panel zeigt: der Run einer Umgebung, sonst die Panelseite. */
  selection(): { target: string; runId: string | undefined } | undefined;
  panel(): PanelState;
  handle(target: string, message: RunPanelHostMessage): void;
  panelAction(message: PanelActionMessage): void;
}

const PANEL_TITLE = "RAgents";

/** Was das Panel nach dem Zeichnen zeigt; ein behaltenes iframe braucht seine Befehle als Nachricht. */
export type PanelRendering = "page" | "frame-kept" | "frame-created";

const nonce = () => randomBytes(16).toString("base64");

const relay = (webview: vscode.Webview, bridge: WebviewBridge, target: () => string | undefined): vscode.Disposable =>
  webview.onDidReceiveMessage((message: unknown) => {
    if (isPanelActionMessage(message)) { bridge.panelAction(message); return; }
    if (!isRunPanelHostMessage(message)) return;
    const name = target();
    if (name !== undefined) bridge.handle(name, message);
  });

/** Das RAgents-Panel in der zweiten Seitenleiste: die Übersicht aller Umgebungen oder das Run-Panel des gewählten Runs. */
export class PanelView implements vscode.WebviewViewProvider {
  #view: vscode.WebviewView | undefined;
  #showsPage = false;
  #frameKey: string | undefined;

  constructor(private readonly bridge: WebviewBridge, private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist/webview")] };
    const subscription = relay(view.webview, this.bridge, () => this.bridge.selection()?.target);
    view.onDidDispose(() => {
      subscription.dispose();
      if (this.#view === view) this.#view = undefined;
    });
    this.#showsPage = false;
    this.#frameKey = undefined;
    this.render();
  }

  /** Zeichnet die Panelseite neu oder baut das iframe auf; ein gleich bleibendes iframe behält seinen Zustand. */
  render(): PanelRendering {
    const view = this.#view;
    if (!view) return "page";
    const selection = this.bridge.selection();
    const frame = selection ? this.bridge.frame(selection.target) : undefined;
    if (!selection || !frame) {
      this.#renderPage(view);
      return "page";
    }
    const key = `${selection.target}|${frame.serverUrl}|${frame.theme}|${frame.accessToken ?? ""}`;
    if (!this.#showsPage && this.#frameKey === key) return "frame-kept";
    this.#showsPage = false;
    this.#frameKey = key;
    view.webview.html = frameHtml({
      serverUrl: frame.serverUrl,
      query: { run: selection.runId, host: "vscode", environment: selection.target, theme: frame.theme, access: frame.accessToken },
      nonce: nonce(),
      title: PANEL_TITLE,
    });
    return "frame-created";
  }

  #renderPage(view: vscode.WebviewView): void {
    const state = this.bridge.panel();
    if (this.#showsPage) {
      void view.webview.postMessage({ type: "ragents.panel.state", state });
      return;
    }
    this.#showsPage = true;
    this.#frameKey = undefined;
    const webview = view.webview;
    const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist/webview", name)).toString();
    webview.html = panelHtml({ nonce: nonce(), title: PANEL_TITLE, state, scriptUri: asset("panel.js"), styleUri: asset("panel.css"), cspSource: webview.cspSource });
  }

  post(message: HostRunPanelMessage): void {
    void this.#view?.webview.postMessage(message);
  }

  /** Das Abzeichen an der Ansicht zählt, worauf die Runs gerade warten; ohne offene Eingabe steht keins da. */
  badge(value: number, tooltip: string): void {
    if (this.#view) this.#view.badge = value > 0 ? { value, tooltip } : undefined;
  }

  /** Ohne aufgebaute Ansicht zeigt show nichts; dann holt der Befehl der Ansicht sie zuerst in die Seitenleiste. */
  reveal(): void {
    if (this.#view) this.#view.show(true);
    else void vscode.commands.executeCommand("ragents.runPanel.focus");
  }
}

interface OpenPanel {
  panel: vscode.WebviewPanel;
  target: string;
  runId: string;
  elementId: string;
  title: string;
}

/** Eine Mini-App als Editor-Reiter; ein Panel je (Umgebung, Run, Element), erneutes Öffnen holt es nach vorn. */
export class AppPanels {
  readonly #panels = new Map<string, OpenPanel>();

  constructor(private readonly bridge: WebviewBridge, private readonly onPlacementsChanged: (target: string, runId: string) => void) {}

  centerElements(target: string, runId: string): ReadonlySet<string> {
    return new Set([...this.#panels.values()].filter((entry) => entry.target === target && entry.runId === runId).map((entry) => entry.elementId));
  }

  open(target: string, runId: string, elementId: string, title: string, runTitle: string | undefined): void {
    const key = `${target}:${runId}:${elementId}`;
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
    const entry: OpenPanel = { panel, target, runId, elementId, title };
    this.#panels.set(key, entry);
    const subscription = relay(panel.webview, this.bridge, () => target);
    panel.onDidDispose(() => {
      subscription.dispose();
      this.#panels.delete(key);
      this.onPlacementsChanged(target, runId);
    });
    this.#render(entry);
    this.onPlacementsChanged(target, runId);
  }

  close(target: string, runId: string, elementId: string): void {
    this.#panels.get(`${target}:${runId}:${elementId}`)?.panel.dispose();
  }

  /** Schließt alle Reiter einer Umgebung; eine beendete Sitzung lässt keine Mini-App stehen. */
  closeTarget(target: string): void {
    for (const entry of [...this.#panels.values()]) if (entry.target === target) entry.panel.dispose();
  }

  render(): void {
    for (const entry of this.#panels.values()) this.#render(entry);
  }

  post(message: HostRunPanelMessage): void {
    for (const entry of this.#panels.values()) void entry.panel.webview.postMessage(message);
  }

  dispose(): void {
    for (const entry of [...this.#panels.values()]) entry.panel.dispose();
  }

  #render(entry: OpenPanel): void {
    const frame = this.bridge.frame(entry.target);
    if (!frame) return;
    entry.panel.webview.html = frameHtml({
      serverUrl: frame.serverUrl,
      query: { layout: "app", run: entry.runId, element: entry.elementId, host: "vscode", environment: entry.target, theme: frame.theme, access: frame.accessToken },
      nonce: nonce(),
      title: entry.title,
    });
  }
}
