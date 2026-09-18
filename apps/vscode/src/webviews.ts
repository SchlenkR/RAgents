import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { isColumnHostMessage, type ColumnHostMessage, type ColumnTheme, type HostColumnMessage } from "../../web/src/column/host-contract";
import type { ConnectionStatus } from "./store";
import { frameHtml, noticeHtml } from "./webview-html";

export interface FrameSettings {
  serverUrl: string;
  theme: ColumnTheme;
  accessToken: string | undefined;
}

export interface WebviewBridge {
  settings(): FrameSettings;
  selectedRunId(): string | undefined;
  status(): ConnectionStatus;
  handle(message: ColumnHostMessage): void;
}

const COLUMN_TITLE = "RAgents";

/** Ohne Server zeigt die Spalte einen Hinweis; der Server-Fehler steht dabei, damit man sieht, warum. */
const columnNotice = (status: ConnectionStatus, serverUrl: string): { heading: string; lines: string[] } | undefined => {
  if (status.kind === "connecting") return { heading: "Verbindung wird aufgebaut", lines: [`Server: ${serverUrl}`] };
  if (status.kind === "unreachable") return {
    heading: "Kein Server erreichbar",
    lines: [`Unter ${serverUrl} antwortet kein RAgents-Server: ${status.message}`, "Die Erweiterung versucht es alle fünf Sekunden erneut. Server starten oder die Einstellung ragents.serverUrl auf den laufenden Server stellen."],
  };
  return undefined;
};

const nonce = () => randomBytes(16).toString("base64");

const relay = (webview: vscode.Webview, bridge: WebviewBridge): vscode.Disposable =>
  webview.onDidReceiveMessage((message: unknown) => {
    if (isColumnHostMessage(message)) bridge.handle(message);
  });

/** Die Arbeitsspalte in der zweiten Seitenleiste: ein Webview mit iframe auf column.html des Servers. */
export class ColumnView implements vscode.WebviewViewProvider {
  #view: vscode.WebviewView | undefined;
  #showsNotice = false;

  constructor(private readonly bridge: WebviewBridge) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    const subscription = relay(view.webview, this.bridge);
    view.onDidDispose(() => {
      subscription.dispose();
      if (this.#view === view) this.#view = undefined;
    });
    this.render();
  }

  render(): void {
    if (!this.#view) return;
    const { serverUrl, theme, accessToken } = this.bridge.settings();
    const notice = columnNotice(this.bridge.status(), serverUrl);
    this.#showsNotice = notice !== undefined;
    this.#view.webview.html = notice
      ? noticeHtml({ nonce: nonce(), title: COLUMN_TITLE, ...notice })
      : frameHtml({
        serverUrl,
        query: { run: this.bridge.selectedRunId(), host: "vscode", theme, access: accessToken },
        nonce: nonce(),
        title: COLUMN_TITLE,
      });
  }

  /** Wechselt zwischen Hinweis und iframe nur, wenn sich das ändert; das iframe soll seinen Zustand behalten. */
  syncStatus(): void {
    if (!this.#view) return;
    const notice = columnNotice(this.bridge.status(), this.bridge.settings().serverUrl) !== undefined;
    if (notice || this.#showsNotice) this.render();
  }

  post(message: HostColumnMessage): void {
    void this.#view?.webview.postMessage(message);
  }

  reveal(): void {
    this.#view?.show(true);
  }
}

interface OpenPanel {
  panel: vscode.WebviewPanel;
  runId: string;
  elementId: string;
  title: string;
}

/** Eine Mini-App als Editor-Reiter; ein Panel je (Run, Element), erneutes Öffnen holt es nach vorn. */
export class AppPanels {
  readonly #panels = new Map<string, OpenPanel>();

  constructor(private readonly bridge: WebviewBridge, private readonly onPlacementsChanged: (runId: string) => void) {}

  centerElements(runId: string): ReadonlySet<string> {
    return new Set([...this.#panels.values()].filter((entry) => entry.runId === runId).map((entry) => entry.elementId));
  }

  open(runId: string, elementId: string, title: string, runTitle: string | undefined): void {
    const key = `${runId}:${elementId}`;
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
    const entry: OpenPanel = { panel, runId, elementId, title };
    this.#panels.set(key, entry);
    const subscription = relay(panel.webview, this.bridge);
    panel.onDidDispose(() => {
      subscription.dispose();
      this.#panels.delete(key);
      this.onPlacementsChanged(runId);
    });
    this.#render(entry);
    this.onPlacementsChanged(runId);
  }

  close(runId: string, elementId: string): void {
    this.#panels.get(`${runId}:${elementId}`)?.panel.dispose();
  }

  render(): void {
    for (const entry of this.#panels.values()) this.#render(entry);
  }

  post(message: HostColumnMessage): void {
    for (const entry of this.#panels.values()) void entry.panel.webview.postMessage(message);
  }

  dispose(): void {
    for (const entry of [...this.#panels.values()]) entry.panel.dispose();
  }

  #render(entry: OpenPanel): void {
    const { serverUrl, theme, accessToken } = this.bridge.settings();
    entry.panel.webview.html = frameHtml({
      serverUrl,
      query: { layout: "app", run: entry.runId, element: entry.elementId, host: "vscode", theme, access: accessToken },
      nonce: nonce(),
      title: entry.title,
    });
  }
}
