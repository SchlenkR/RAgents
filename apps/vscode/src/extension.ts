import * as vscode from "vscode";
import type { ColumnHostMessage, ColumnTheme } from "../../web/src/column/host-contract";
import { artifactUri, DOCUMENT_SCHEME, journalUri, RunDocuments } from "./documents";
import { ExplorerProvider } from "./explorer";
import type { ExplorerState } from "./explorer-model";
import { textArtifact } from "./run-model";
import { ServerClient } from "./server-client";
import { parseServerUrl, parseThemeSetting, resolveTheme, tokenSecretKey, type Settings } from "./settings";
import { RunStore } from "./store";
import { AppPanels, ColumnView } from "./webviews";

const STOP_REASON = "Gestoppt aus VS Code";

/** Was activate zurückgibt: der Zugriff für Host-Tests und andere Erweiterungen. */
export interface RAgentsApi {
  store: RunStore;
  messages: vscode.Event<ColumnHostMessage>;
  selectRun: (runId: string | undefined) => void;
  applyToken: (token: string | undefined) => Promise<void>;
  loginWith: (id: string, password: string) => Promise<void>;
}

const readSettings = (): Settings => {
  const configuration = vscode.workspace.getConfiguration("ragents");
  return { serverUrl: parseServerUrl(configuration.get("serverUrl")), theme: parseThemeSetting(configuration.get("theme")) };
};

const editorTheme = (): ColumnTheme => {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast ? "dark" : "light";
};

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

export async function activate(context: vscode.ExtensionContext): Promise<RAgentsApi> {
  const settings = readSettings();
  const client = new ServerClient(settings.serverUrl, await context.secrets.get(tokenSecretKey(settings.serverUrl)) ?? undefined);
  const store = new RunStore(client);
  const documents = new RunDocuments(() => client);

  const frameSettings = () => ({ serverUrl: settings.serverUrl, theme: resolveTheme(settings.theme, editorTheme()), accessToken: client.accessToken });
  const messages = new vscode.EventEmitter<ColumnHostMessage>();
  const bridge = {
    settings: frameSettings,
    selectedRunId: () => store.selectedRunId,
    status: () => store.status,
    handle: (incoming: ColumnHostMessage) => {
      handleColumnMessage(incoming);
      messages.fire(incoming);
    },
  };
  const column = new ColumnView(bridge);
  const panels = new AppPanels(bridge, (runId) => {
    column.post({ type: "placements", runId, center: [...panels.centerElements(runId)] });
    explorer.refresh();
  });
  const explorerState = (): ExplorerState => ({
    status: store.status,
    streamMessage: store.streamStatus.kind === "retrying" && store.status.kind === "connected" ? store.streamStatus.message : undefined,
    serverUrl: settings.serverUrl,
    runs: store.runs,
    selectedRunId: store.selectedRunId,
    centerElements: (runId) => panels.centerElements(runId),
  });
  const explorer = new ExplorerProvider(explorerState);
  const tree = vscode.window.createTreeView("ragents.explorer", { treeDataProvider: explorer, showCollapseAll: true });

  let watching: (() => void) | undefined;
  const selectRun = (runId: string | undefined, { reveal = true, focusColumn = false } = {}) => {
    if (store.selectedRunId !== runId) {
      watching?.();
      watching = runId === undefined ? undefined : store.watch(runId);
      store.select(runId);
      column.post({ type: "selectRun", runId: runId ?? null });
      if (runId !== undefined) column.post({ type: "placements", runId, center: [...panels.centerElements(runId)] });
    }
    if (reveal && runId !== undefined) {
      const node = explorer.node(`run:${runId}`);
      if (node) void tree.reveal(node, { select: true, focus: false, expand: true }).then(undefined, () => undefined);
    }
    if (focusColumn) column.reveal();
  };

  const rerenderFrames = () => {
    column.render();
    panels.render();
  };

  const applyToken = async (token: string | undefined) => {
    client.useToken(token);
    if (token === undefined) await context.secrets.delete(tokenSecretKey(settings.serverUrl));
    else await context.secrets.store(tokenSecretKey(settings.serverUrl), token);
    rerenderFrames();
    await store.start();
  };

  const loginWith = async (id: string, password: string) => {
    const { token } = await client.login(id, password);
    await applyToken(token);
  };

  const login = async () => {
    const status = store.status;
    if (status.kind === "login-required" && status.tokenGate) {
      const token = await vscode.window.showInputBox({ prompt: `Zugangstoken für ${settings.serverUrl}`, password: true, ignoreFocusOut: true });
      if (!token) return;
      const previous = client.accessToken;
      client.useToken(token);
      try {
        await client.access();
      } catch (cause) {
        client.useToken(previous);
        void vscode.window.showErrorMessage(`Anmeldung fehlgeschlagen: ${message(cause)}`);
        return;
      }
      await applyToken(token);
      return;
    }
    const id = await vscode.window.showInputBox({ prompt: `Benutzer für ${settings.serverUrl}`, ignoreFocusOut: true, value: store.user?.id });
    if (!id?.trim()) return;
    const password = await vscode.window.showInputBox({ prompt: `Passwort für ${id.trim()}`, password: true, ignoreFocusOut: true });
    if (!password) return;
    try {
      await loginWith(id.trim(), password);
    } catch (cause) {
      void vscode.window.showErrorMessage(`Anmeldung fehlgeschlagen: ${message(cause)}`);
    }
  };

  const logout = async () => {
    try {
      await client.logout();
    } catch (cause) {
      void vscode.window.showErrorMessage(`Abmelden fehlgeschlagen: ${message(cause)}`);
      return;
    }
    await applyToken(undefined);
  };

  const handleColumnMessage = (incoming: ColumnHostMessage) => {
    switch (incoming.type) {
      case "ready":
        column.post({ type: "selectRun", runId: store.selectedRunId ?? null });
        if (store.selectedRunId !== undefined) column.post({ type: "placements", runId: store.selectedRunId, center: [...panels.centerElements(store.selectedRunId)] });
        return;
      case "runChanged":
        selectRun(incoming.runId ?? undefined);
        return;
      case "openInCenter":
        panels.open(incoming.runId, incoming.elementId, incoming.title, store.run(incoming.runId)?.title);
        return;
      case "returnToColumn":
        panels.close(incoming.runId, incoming.elementId);
        return;
      case "login":
        void login();
        return;
      case "logout":
        void logout();
        return;
      case "openExternal":
        void vscode.env.openExternal(vscode.Uri.parse(incoming.url));
        return;
      case "openPage":
        void vscode.commands.executeCommand("simpleBrowser.show", incoming.url);
        return;
    }
  };

  const syncContext = () => {
    const status = store.status;
    void vscode.commands.executeCommand("setContext", "ragents.connected", status.kind === "connected");
    void vscode.commands.executeCommand("setContext", "ragents.loginRequired", status.kind === "login-required");
    void vscode.commands.executeCommand("setContext", "ragents.loggedIn", store.user !== null);
    const questions = store.pendingQuestions;
    tree.badge = questions > 0 ? { value: questions, tooltip: questions === 1 ? "1 offene Rückfrage" : `${questions} offene Rückfragen` } : undefined;
  };

  context.subscriptions.push(
    tree,
    explorer,
    documents,
    messages,
    { dispose: () => store.dispose() },
    { dispose: () => panels.dispose() },
    vscode.window.registerWebviewViewProvider("ragents.column", column, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider(DOCUMENT_SCHEME, documents),
    { dispose: store.onChange(() => { explorer.refresh(); syncContext(); column.syncStatus(); }) },
    vscode.window.onDidChangeActiveColorTheme(() => {
      const theme = resolveTheme(settings.theme, editorTheme());
      column.post({ type: "theme", theme });
      panels.post({ type: "theme", theme });
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("ragents")) return;
      void vscode.window.showInformationMessage("Die RAgents-Einstellungen haben sich geändert. Das Fenster muss neu geladen werden.", "Neu laden")
        .then((choice) => { if (choice === "Neu laden") void vscode.commands.executeCommand("workbench.action.reloadWindow"); });
    }),
    vscode.commands.registerCommand("ragents.refresh", () => store.status.kind === "connected" ? store.refresh() : store.start()),
    vscode.commands.registerCommand("ragents.connect", () => store.start()),
    vscode.commands.registerCommand("ragents.login", login),
    vscode.commands.registerCommand("ragents.logout", logout),
    vscode.commands.registerCommand("ragents.newRun", () => {
      selectRun(undefined, { reveal: false, focusColumn: true });
      column.post({ type: "newRun" });
    }),
    vscode.commands.registerCommand("ragents.openRun", (runId: string) => selectRun(runId, { focusColumn: true })),
    vscode.commands.registerCommand("ragents.openRunInBrowser", (node?: { run?: { id: string } }) => {
      void vscode.env.openExternal(vscode.Uri.parse(settings.serverUrl));
      return node;
    }),
    vscode.commands.registerCommand("ragents.stopRun", async (node?: { run?: { id: string; title: string } }) => {
      const run = node?.run ?? (store.selectedRunId !== undefined ? store.run(store.selectedRunId) : undefined);
      if (!run) return;
      const choice = await vscode.window.showWarningMessage(`Run "${run.title}" mit allen Agenten und Abläufen stoppen?`, { modal: true }, "Stoppen");
      if (choice !== "Stoppen") return;
      try {
        await client.stopRun(run.id, STOP_REASON);
      } catch (cause) {
        void vscode.window.showErrorMessage(`Stoppen fehlgeschlagen: ${message(cause)}`);
      }
    }),
    vscode.commands.registerCommand("ragents.openAppInCenter", (runIdOrNode: string | { runId: string; app: { id: string; title: string } }, elementId?: string, title?: string) => {
      const target = typeof runIdOrNode === "string"
        ? { runId: runIdOrNode, elementId: elementId ?? "", title: title ?? elementId ?? "" }
        : { runId: runIdOrNode.runId, elementId: runIdOrNode.app.id, title: runIdOrNode.app.title };
      if (!target.elementId) return;
      panels.open(target.runId, target.elementId, target.title, store.run(target.runId)?.title);
    }),
    vscode.commands.registerCommand("ragents.moveAppToColumn", (node: { runId: string; app: { id: string } }) => {
      panels.close(node.runId, node.app.id);
      selectRun(node.runId, { focusColumn: true });
    }),
    vscode.commands.registerCommand("ragents.openArtifact", async (runId: string, artifactId: string, title: string, mediaType: string) => {
      if (!textArtifact({ id: artifactId, title, mediaType, size: 0 })) {
        void vscode.env.openExternal(vscode.Uri.parse(client.artifactUrl(runId, artifactId)));
        return;
      }
      const uri = artifactUri(runId, artifactId, title);
      documents.invalidate(uri);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    }),
    vscode.commands.registerCommand("ragents.openJournal", async (runId: string) => {
      const uri = journalUri(runId, store.run(runId)?.title ?? runId);
      documents.invalidate(uri);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    }),
  );

  syncContext();
  await store.start();
  return { store, messages: messages.event, selectRun: (runId) => selectRun(runId, { focusColumn: true }), applyToken, loginWith };
}

export function deactivate(): void {}
