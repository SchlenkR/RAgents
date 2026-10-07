import { hostname } from "node:os";
import * as vscode from "vscode";
import { defaultDataDirectory } from "../../server/src/data-directory";
import { coreContracts } from "../../server/src/api/contracts";
import type { RunPanelHostMessage, RunPanelTheme, HostRunPanelMessage, RunService } from "../../web/src/run-panel/host-contract";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract";
import { prepareProfile } from "../../../scripts/remote/connect";
import { ensureHostLinks } from "../../../scripts/package/host-links.mjs";
import { connectionSecretKey, connectionSetting, connectionsLocation, describeConnection, isProfileFile, parseConnections, profileFilesIn, profileNameOf, extensionCheckout, type Connection, type ConnectionsLocation } from "./connections";
import { DOCUMENT_SCHEME, journalUri, RunDocuments } from "./documents";
import { bundledBash, bundledRipgrep, ensureHostPackage, hostCommand, inheritedEnvironment, matchingHostVersion, packagedHostVersion, provisionTools, startHost, type RunningHost } from "./host-process";
import { connectedCount, connectionView, newRunChoices, panelState, pendingActions, preselectable, resolveConnection, type NewRunChoice } from "./overview-model";
import type { ServerClient } from "./server-client";
import { ServiceTunnels, serviceOnThisMachine } from "./service-tunnels";
import { ConnectionSession, type ConnectionSnapshot, type LaunchedConnection, type SessionServices } from "./sessions";
import { hostEnvironmentSecretKey, isEnvironmentName, missingHostEnvironmentSecrets, parseHostEnvironment, parseThemeSetting, parseZoomSetting, provideMissingSecret, resolveTheme, withHostEnvironmentSecrets, withRelaySession } from "./settings";
import { connectionState, kindLabel } from "../../web/src/panel/connection-state";
import { connectionStateWord } from "../../web/src/ui/state-vocabulary";
import type { PanelAction, PanelActionMessage, PanelPage, PanelSharing, PanelState } from "../../web/src/panel/contract";
import { openSharing, saveSharing, type SharingClient, type SharingStore } from "../../web/src/run-sharing";
import { profileDistributionContracts, type ClientProfileDescription } from "../../../plugins/ragents.profile-distribution/contract";
import { AppPanels, PanelView, type FrameSettings, type PanelRendering } from "./webviews";
import { windowClientId } from "./workspace-identity";
import { WorkspaceClient, workstationRunsDirectory } from "../../../plugins/ragents.workspace/client/workspace-client";

const HOST_PATH_KEY = "ragents.lastHostPath";
const ENVIRONMENT_KEY = "ragents.activeEnvironment";
const DEACTIVATE_TIMEOUT_MS = 4_000;
const OTHER_NAME = "Other name ...";

/** What deactivate waits for: VS Code calls it before disposing the subscriptions and only on an orderly shutdown. */
let stopSessions: (() => Promise<void>) | undefined;

/** What activate returns: the access for host tests and other extensions. */
export interface RAgentsApi {
  sessions: () => readonly ConnectionSession[];
  session: (name: string) => ConnectionSession | undefined;
  snapshots: () => readonly ConnectionSnapshot[];
  connections: () => readonly Connection[];
  connect: (name: string) => Promise<void>;
  disconnect: (name: string) => Promise<void>;
  messages: vscode.Event<{ connection: string; message: RunPanelHostMessage }>;
  selectRun: (connection: string, runId: string | undefined) => void;
  selectEnvironment: (connection: string) => Promise<void>;
  activeEnvironment: () => string | undefined;
  newRun: (connection: string, entryId?: string) => Promise<void>;
  applyToken: (connection: string, token: string | undefined) => Promise<void>;
  loginWith: (connection: string, id: string, password: string) => Promise<void>;
  /** What the panel page shows and what it sends; the host test takes the same path as the webview. */
  panel: () => PanelState;
  panelAction: (action: PanelAction) => Promise<void>;
}

const editorTheme = (): RunPanelTheme => {
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast ? "dark" : "light";
};

const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const workspaceFolders = (): string[] => (vscode.workspace.workspaceFolders ?? [])
  .filter((folder) => folder.uri.scheme === "file")
  .map((folder) => folder.uri.fsPath);

const configuredConnections = (): Connection[] => parseConnections(vscode.workspace.getConfiguration("ragents").get("connections"));

const configuredZoom = () => parseZoomSetting(vscode.workspace.getConfiguration("ragents").get("zoom", 100));

const configuredTheme = () => parseThemeSetting(vscode.workspace.getConfiguration("ragents").get("theme"));

const sameConnection = (left: Connection, right: Connection): boolean =>
  left.kind === right.kind && (left.kind === "server"
    ? left.url === (right as Extract<Connection, { kind: "server" }>).url
    : left.profileFile === (right as Extract<Connection, { kind: "profile" }>).profileFile);

export async function activate(context: vscode.ExtensionContext): Promise<RAgentsApi> {
  const output = vscode.window.createOutputChannel("RAgents");
  const log = (line: string) => output.appendLine(line);
  const sessions = new Map<string, ConnectionSession>();
  let stopped: Promise<void> | undefined;
  /** Disconnects all sessions and thereby stops every own host; a second call waits for the same disconnect. */
  const stopAllSessions = (): Promise<void> => stopped ??= (async () => {
    await Promise.all([...sessions.values()].map((session) => session.disconnect()
      .catch((cause) => log(`== Disconnect failed: ${message(cause)}`))));
  })();
  stopSessions = stopAllSessions;
  let selection: { connection: string; runId: string | undefined } | undefined;
  let page: PanelPage = "start";
  let configProblem: string | undefined;
  let pickedProfileFile: string | undefined;
  let missingSecrets: readonly string[] = [];
  let sharing: PanelSharing | undefined;
  let startNotice: string | undefined;
  const pendingNewRun = new Map<string, Extract<HostRunPanelMessage, { type: "newRun" }>>();
  const identity = () => ({
    id: windowClientId(context.workspaceState),
    label: vscode.workspace.name ? `${hostname()} (${vscode.workspace.name})` : hostname(),
    hostname: hostname(),
    platform: process.platform,
    folders: workspaceFolders(),
    runsDirectory: workstationRunsDirectory(),
  });

  const snapshots = (): ConnectionSnapshot[] => [...sessions.values()].map((session) => session.snapshot());
  const messages = new vscode.EventEmitter<{ connection: string; message: RunPanelHostMessage }>();

  const frameFor = (connection: string): FrameSettings | undefined => {
    const session = sessions.get(connection);
    if (!session?.client || session.status.kind !== "connected") return undefined;
    return { serverUrl: session.client.baseUrl, theme: resolveTheme(configuredTheme(), editorTheme()), accessToken: session.client.accessToken };
  };

  const bridge = {
    zoom: configuredZoom,
    frame: frameFor,
    selection: () => page === "connections" ? undefined : selection,
    panel: () => panelState({
      theme: resolveTheme(configuredTheme(), editorTheme()),
      page: "connections",
      connections: snapshots().filter((snapshot) => page === "connections" || selection === undefined || snapshot.connection.name === selection.connection),
      profileSuggestions: profileFilesIn(knownHost()),
      missingSecrets,
      problem: configProblem,
      pickedProfileFile,
      sharing,
      notice: startNotice,
    }),
    handle: (connection: string, incoming: RunPanelHostMessage, source: "panel" | "app") => {
      if (source === "panel" || incoming.type !== "ready") handleRunPanelMessage(connection, incoming);
      messages.fire({ connection, message: incoming });
    },
    panelAction: (incoming: PanelActionMessage) => {
      void runPanelAction(incoming).catch((cause: unknown) => vscode.window.showErrorMessage(`RAgents: ${message(cause)}`));
    },
  };
  const panel = new PanelView(bridge, context.extensionUri);
  const panels = new AppPanels(bridge);
  const tunnels = new ServiceTunnels({ log });
  const documents = new RunDocuments((connection) => requireClient(connection));
  const statusBar = vscode.window.createStatusBarItem("ragents.connections", vscode.StatusBarAlignment.Left, 50);
  statusBar.command = "ragents.showStart";

  const requireSession = (connection: string): ConnectionSession => {
    const session = sessions.get(connection);
    if (!session) throw new Error(`The server ${connection} is not in ragents.connections.`);
    return session;
  };

  const requireClient = (connection: string): ServerClient => {
    const client = requireSession(connection).client;
    if (!client) throw new Error(`The server ${connection} is not connected.`);
    return client;
  };

  const rerender = () => {
    panel.render();
    panels.render();
  };

  /** The state of a server in one line; panel and status bar name it the same way. */
  const stateOf = (snapshot: ConnectionSnapshot): string => {
    const view = connectionView(snapshot);
    return `${kindLabel(view)}, ${connectionStateWord(connectionState(view))}`;
  };

  const syncContext = () => {
    const current = snapshots();
    const active = current.filter((snapshot) => snapshot.connection.name === selection?.connection);
    void vscode.commands.executeCommand("setContext", "ragents.hasConnections", current.length > 0);
    void vscode.commands.executeCommand("setContext", "ragents.canCreate", active.some((snapshot) => snapshot.status.kind === "connected" && snapshot.canCreate));
    const waiting = pendingActions(active);
    panel.badge(waiting, waiting === 1 ? "1 waiting input" : `${waiting} waiting inputs`);
    const connected = connectedCount(current);
    const notices = current.flatMap((snapshot) => snapshot.versionNotice ? [snapshot.versionNotice] : []);
    const blocking = notices.some((notice) => notice.level === "error");
    statusBar.text = `${notices.length > 0 ? "$(warning)" : "$(plug)"} RAgents: ${connected} connected`;
    statusBar.backgroundColor = notices.length === 0 ? undefined : new vscode.ThemeColor(blocking ? "statusBarItem.errorBackground" : "statusBarItem.warningBackground");
    statusBar.tooltip = current.length === 0
      ? "No server set up. Click: Start"
      : `${current.map((snapshot) => `${snapshot.connection.name}: ${stateOf(snapshot)}${snapshot.versionNotice ? `\n${snapshot.versionNotice.text}` : ""}`).join("\n")}\nClick: Start`;
    statusBar.show();
  };

  let watching: (() => void) | undefined;
  const clearSelection = () => {
    if (selection === undefined) return;
    watching?.();
    watching = undefined;
    selection = undefined;
  };

  /** Shows the run in the panel and says what resulted; a freshly built iframe does not accept messages yet. */
  const selectRun = (connection: string, runId: string | undefined, { focusPanel = false } = {}): PanelRendering => {
    const session = sessions.get(connection);
    if (!session) return "page";
    const changed = selection?.connection !== connection || selection.runId !== runId;
    if (!changed && page !== "connections") {
      const rendering = panel.render();
      if (focusPanel) panel.reveal();
      return rendering;
    }
    clearSelection();
    selection = { connection, runId };
    page = runId === undefined ? "start" : "run";
    startNotice = undefined;
    sharing = undefined;
    void context.workspaceState.update(ENVIRONMENT_KEY, connection);
    if (runId !== undefined) watching = session.store?.watch(runId);
    const rendering = panel.render();
    if (rendering === "frame-kept") {
      panel.post({ type: "selectRun", runId: runId ?? null });
    }
    syncContext();
    if (focusPanel) panel.reveal();
    return rendering;
  };

  /** Server pages stay in the selected environment; connection management is local. */
  const showPage = (next: Exclude<PanelPage, "run">, { focusPanel = true, notice }: { focusPanel?: boolean; notice?: string } = {}) => {
    page = next;
    startNotice = next === "start" ? notice : undefined;
    sharing = undefined;
    if (next !== "connections" && selection) {
      const name = selection.connection;
      clearSelection();
      selection = { connection: name, runId: undefined };
    }
    const rendering = panel.render();
    if (rendering === "frame-kept" && next !== "connections") panel.post({ type: "showPage", page: next, ...(notice === undefined ? {} : { notice }) });
    syncContext();
    if (focusPanel) panel.reveal();
  };

  const selectEnvironment = async (connection: string) => {
    const session = requireSession(connection);
    selectRun(connection, undefined, { focusPanel: true });
    showPage("start");
    if (session.status.kind !== "connected") await session.connect();
  };

  const chooseEnvironment = async () => {
    const items: Array<vscode.QuickPickItem & { connection?: string }> = snapshots().map((snapshot) => ({
      label: snapshot.connection.name,
      description: snapshot.connection.name === selection?.connection ? "Current environment" : stateOf(snapshot),
      detail: describeConnection(snapshot.connection),
      connection: snapshot.connection.name,
      picked: snapshot.connection.name === selection?.connection,
    }));
    items.push({ label: "Manage environments ..." });
    const picked = await vscode.window.showQuickPick(items, { title: "Switch environment", matchOnDetail: true, ignoreFocusOut: true });
    if (!picked) return;
    if (picked.connection === undefined) showPage("connections");
    else await selectEnvironment(picked.connection);
  };

  const configuredHostEnvironment = (): string[] => parseHostEnvironment(vscode.workspace.getConfiguration("ragents").get("hostEnvironment"));

  /** Which environment variables a started host gets: the inherited ones, above them the session of a distributed profile, above that the values from the SecretStorage. */
  const hostEnvironment = (relay?: { serverUrl: string; token: string }): Promise<NodeJS.ProcessEnv> =>
    withHostEnvironmentSecrets(
      relay ? withRelaySession(inheritedEnvironment(), relay.serverUrl, relay.token) : inheritedEnvironment(),
      configuredHostEnvironment(), context.secrets, log);

  /** The same names, but without throwing: a faulty setting goes to the log and counts as an empty list for the display. */
  const declaredHostEnvironment = (): string[] => {
    try {
      return configuredHostEnvironment();
    } catch (cause) {
      log(`== Setting ragents.hostEnvironment: ${message(cause)}`);
      return [];
    }
  };

  /** Which names from ragents.hostEnvironment still have no value; the server page shows them as soon as the setting or the SecretStorage changes. */
  const refreshMissingSecrets = async (): Promise<void> => {
    const names = await missingHostEnvironmentSecrets(declaredHostEnvironment(), context.secrets);
    if (names.length === missingSecrets.length && names.every((name, index) => missingSecrets[index] === name)) return;
    missingSecrets = names;
    panel.render();
  };

  const writeHostEnvironment = (names: readonly string[]) => {
    const configuration = vscode.workspace.getConfiguration("ragents");
    const workspace = Array.isArray(configuration.inspect<unknown[]>("hostEnvironment")?.workspaceValue);
    return configuration.update("hostEnvironment", names, workspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
  };

  /** Which environment variable this is about: one from ragents.hostEnvironment or a typed name; never a value. */
  const chooseSecretName = async (title: string): Promise<string | undefined> => {
    const configured = await Promise.all(configuredHostEnvironment().map(async (name) => ({
      label: name,
      description: (await context.secrets.get(hostEnvironmentSecretKey(name))) === undefined ? "no value stored" : "value stored",
    })));
    const picked = await vscode.window.showQuickPick([...configured, { label: OTHER_NAME, description: "Enter a name" }],
      { title, placeHolder: "Environment variable" });
    if (picked === undefined) return undefined;
    if (picked.label !== OTHER_NAME) return picked.label;
    const typed = await vscode.window.showInputBox({
      title,
      prompt: "Name of the environment variable",
      ignoreFocusOut: true,
      validateInput: (value) => isEnvironmentName(value.trim()) ? undefined : "Letters, digits, and _ are allowed, not starting with a digit.",
    });
    return typed?.trim() || undefined;
  };

  /** Stores the value of an environment variable in the SecretStorage; afterwards it is only there and in no setting.
   * With a server, it is the guided way out of its error: name into the setting, value, new attempt. */
  const setSecret = async (given?: string, connection?: string): Promise<void> => {
    const name = given ?? await chooseSecretName("Set secret");
    if (name === undefined) return;
    const askValue = () => Promise.resolve(vscode.window.showInputBox({ title: "Set secret", prompt: `Value for ${name}`, password: true, ignoreFocusOut: true }));
    const store = async (value: string): Promise<void> => {
      await context.secrets.store(hostEnvironmentSecretKey(name), value);
      log(`== Value for ${name} stored in the SecretStorage`);
      await refreshMissingSecrets();
    };
    if (connection !== undefined) {
      await provideMissingSecret(name, {
        names: configuredHostEnvironment,
        writeNames: async (names) => {
          await writeHostEnvironment(names);
          log(`== ${name} added to ragents.hostEnvironment`);
        },
        askValue,
        store,
        retry: async () => {
          log(`== ${connection} restarts after the value for ${name}`);
          await sessions.get(connection)?.retry();
        },
      });
      return;
    }
    const value = await askValue();
    if (value === undefined) return;
    await store(value);
    if (configuredHostEnvironment().includes(name)) {
      void vscode.window.showInformationMessage(`The value for ${name} is ready; it applies from the next start of a server.`);
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `${name} is not in ragents.hostEnvironment; without the entry, the host does not get the value.`, "Add");
    if (choice) await writeHostEnvironment([...configuredHostEnvironment(), name]);
  };

  /** Removes the value of an environment variable from the SecretStorage; its name stays in the setting. */
  const deleteSecret = async (): Promise<void> => {
    const name = await chooseSecretName("Delete secret");
    if (name === undefined) return;
    await context.secrets.delete(hostEnvironmentSecretKey(name));
    log(`== Value for ${name} removed from the SecretStorage`);
    await refreshMissingSecrets();
    void vscode.window.showInformationMessage(`No value is stored for ${name} anymore.`);
  };

  const checkout = extensionCheckout(context.extensionPath);

  /** The host used for profile suggestions: the extension's checkout or the last local host. */
  const knownHost = (): string | undefined => checkout ?? context.globalState.get<string>(HOST_PATH_KEY);

  /** The extension's checkout or the cached package in the requested version. */
  const ensureHost = async (version: string, report: (detail: string) => void, source?: import("../../../scripts/package/host-package.ts").HostPackageSource): Promise<string> => {
    if (checkout) return checkout;
    report(`Fetching host package ${version} ...`);
    return ensureHostPackage(context.globalStorageUri.fsPath, version, await hostEnvironment(), log, source);
  };

  /** Starts the local host from a profile file; for local profiles and for profiles a server distributes. */
  const startLocalHost = async (hostPath: string, profileFile: string, dataDirectory: string, environment: NodeJS.ProcessEnv, report: (detail: string) => void): Promise<RunningHost> => {
    ensureHostLinks(hostPath);
    report("Provisioning tools ...");
    await provisionTools(hostPath, profileFile, { ...environment, PRODUCT_PROFILE: profileNameOf(profileFile), PRODUCT_PROFILE_FILE: profileFile, DATA_DIR: dataDirectory }, log);
    report("Starting host ...");
    const host = await startHost({
      profile: profileNameOf(profileFile), profileFile, dataDirectory, environment, log, command: hostCommand(hostPath, environment),
      bash: bundledBash(context.extensionPath),
      rg: bundledRipgrep(context.extensionPath),
    });
    log(`== Host running at ${host.url} (PID ${host.pid}, profile ${profileFile}, data ${dataDirectory})`);
    await context.globalState.update(HOST_PATH_KEY, hostPath);
    return host;
  };

  /** A server gets its address: by address its own, as a local profile the one of its freshly started host. */
  const launchConnection = async (connection: Connection, report: (detail: string) => void): Promise<LaunchedConnection> => {
    if (connection.kind === "server") {
      const key = connectionSecretKey(connection)!;
      return { url: connection.url, token: await context.secrets.get(key) ?? undefined, host: undefined };
    }
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `RAgents: ${connection.name}` }, async (progress) => {
      const detail = (text: string) => { progress.report({ message: text }); report(text); };
      const hostPath = await ensureHost(packagedHostVersion(context.extensionPath), detail);
      const host = await startLocalHost(hostPath, connection.profileFile, defaultDataDirectory(profileNameOf(connection.profileFile)), await hostEnvironment(), detail);
      return { url: host.url, token: host.token, host };
    });
  };

  /** If the server distributes a client profile, the extension fetches it and works for this server against a local host with it. */
  const adoptDistributedProfile = async (session: ConnectionSession) => {
    const client = session.client;
    const token = client?.accessToken;
    const serverUrl = session.url;
    if (!client || !token || !serverUrl || session.host) return;
    let described: ClientProfileDescription;
    try {
      described = await client.rpc.call(profileDistributionContracts.describe, {});
    } catch (cause) {
      log(`== ${serverUrl} distributes no client profile (${message(cause)}); connected directly`);
      return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `RAgents: ${session.name}` }, async (progress) => {
      const detail = (text: string) => progress.report({ message: text });
      const environment = { ...await hostEnvironment({ serverUrl, token }), RAGENTS_TOKEN: token };
      const hostPath = await ensureHost(described.packageVersion, detail);
      detail("Fetching profile from server ...");
      const prepared = await prepareProfile({ serverUrl, token, hostPath });
      log(`== Profile ${prepared.description.profile} from server ${serverUrl}, version ${prepared.description.version.slice(0, 12)} (${prepared.downloaded ? "fetched" : "cached"})`);
      detail("Starting local host ...");
      const host = await startLocalHost(hostPath, prepared.profileFile, prepared.dataDirectory, environment, detail);
      if (sessions.get(session.name) !== session) { await host.stop(); return; }
      await session.attach({ url: host.url, token: host.token, host });
    });
  };

  const workstationTools = new Map<string, Promise<void>>();
  const prepareWorkstationHost = async (root: string, report: (detail: string) => void): Promise<string> => {
    report("Provisioning workstation tools ...");
    let preparing = workstationTools.get(root);
    if (!preparing) {
      ensureHostLinks(root);
      preparing = hostEnvironment().then((environment) => provisionTools(root, "--workspace", environment, log))
        .catch((cause: unknown) => log(`== Workspace tools: ${message(cause)}`));
      workstationTools.set(root, preparing);
    }
    await preparing;
    return root;
  };

  const services: SessionServices = {
    version: packagedHostVersion(context.extensionPath),
    workspaceClient: (transport) => new WorkspaceClient(transport, identity(), {
      hostRoot: () => checkout,
      prepareHost: async (report) => {
        const server = await transport.rpc.call(coreContracts.plugins.bootstrap, {});
        if (!server.version) throw new Error("The server reports no RAgents version. Update the server before registering this workstation.");
        const root = matchingHostVersion(await ensureHost(server.version, report, { download: server.hostPackage, fetch: (path, init) => transport.fetch(path, init) }), server.version);
        return prepareWorkstationHost(root, report);
      },
      bash: bundledBash(context.extensionPath),
      rg: bundledRipgrep(context.extensionPath),
      onExecuted: ({ runId, operation, durationMs, error }) => log(`== ${runId.slice(0, 8)} ${operation} ${durationMs} ms ${error ?? "ok"}`),
    }),
    secrets: context.secrets,
    launch: launchConnection,
    log,
    probe: (session) => void adoptDistributedProfile(session).catch((cause: unknown) => {
      log(`== Applying profile from ${session.name} failed: ${message(cause)}`);
      session.reportProblem(cause);
      void vscode.window.showErrorMessage(`RAgents: ${message(cause)}`, "Show output").then((choice) => { if (choice) output.show(); });
    }),
    onHostExit: (session, code) => {
      void vscode.window.showErrorMessage(`The local RAgents host for ${session.name} has ended (code ${code}). Output in the RAgents channel.`);
      void closeConnection(session.name);
    },
  };

  /** A version notice is announced once per server and text as a notification; the pages and the status bar show it as long as it persists. */
  const shownNotices = new Map<string, string>();
  const announceVersionNotices = () => {
    const current = snapshots();
    for (const name of [...shownNotices.keys()]) {
      if (!current.some((snapshot) => snapshot.connection.name === name && snapshot.versionNotice?.text === shownNotices.get(name))) shownNotices.delete(name);
    }
    for (const snapshot of current) {
      const notice = snapshot.versionNotice;
      if (!notice || shownNotices.get(snapshot.connection.name) === notice.text) continue;
      shownNotices.set(snapshot.connection.name, notice.text);
      const text = `RAgents (${snapshot.connection.name}): ${notice.text}`;
      const actions = notice.update === "extension" ? ["Show extension", "Show servers"] : ["Show servers"];
      const shown = notice.level === "error" ? vscode.window.showErrorMessage(text, ...actions) : vscode.window.showWarningMessage(text, ...actions);
      void shown.then((choice) => {
        if (choice === "Show extension") void vscode.commands.executeCommand("extension.open", context.extension.id);
        if (choice === "Show servers") showPage("connections");
      });
    }
  };

  const sessionChanged = () => {
    tunnels.retain((name) => sessions.get(name)?.client?.rpc);
    syncContext();
    panel.render();
    announceVersionNotices();
  };

  const closeConnection = async (name: string) => {
    const session = sessions.get(name);
    if (!session) return;
    if (selection?.connection === name) showPage("start", { focusPanel: false });
    panels.closeConnection(name);
    await session.disconnect();
    sessionChanged();
  };

  /** The servers follow the setting: new ones are added, changed ones are rebuilt, removed ones disappear. */
  const syncConnections = async () => {
    let connections: Connection[] = [];
    try {
      connections = configuredConnections();
      configProblem = undefined;
    } catch (cause) {
      configProblem = message(cause);
      log(`Setting ragents.connections: ${configProblem}`);
    }
    const kept = new Map<string, ConnectionSession>();
    const closing: Array<Promise<void>> = [];
    for (const connection of connections) {
      const existing = sessions.get(connection.name);
      if (existing && sameConnection(existing.connection, connection)) {
        kept.set(connection.name, existing);
        continue;
      }
      const session = new ConnectionSession(connection, services);
      session.onChange(sessionChanged);
      kept.set(connection.name, session);
    }
    for (const [name, session] of sessions) if (kept.get(name) !== session) { panels.closeConnection(name); closing.push(session.disconnect()); }
    const started = [...kept.values()].filter((session) => sessions.get(session.name) !== session);
    sessions.clear();
    for (const [name, session] of kept) sessions.set(name, session);
    if (selection && !sessions.has(selection.connection)) clearSelection();
    if (!selection) {
      const remembered = context.workspaceState.get<string>(ENVIRONMENT_KEY);
      const initial = remembered && sessions.has(remembered) ? remembered : sessions.keys().next().value;
      if (initial !== undefined) {
        selection = { connection: initial, runId: undefined };
        if (page !== "connections") page = "start";
        void context.workspaceState.update(ENVIRONMENT_KEY, initial);
      }
    }
    sessionChanged();
    await Promise.all(closing);
    // Everything starts on activation: a server connects, a local profile starts up silently so its templates are there right away.
    for (const session of started) void session.connect();
  };

  const runPanelAction = async (incoming: PanelActionMessage): Promise<void> => {
    switch (incoming.action) {
      case "page": showPage(incoming.page, { focusPanel: false }); return;
      case "settingsFile": await openConnectionsSetting(); return;
      case "setSecret": await setSecret(incoming.name, incoming.connection); return;
      case "pickProfile": await pickProfileFile(); return;
      case "showOutput": output.show(true); return;
      case "addServer": await addConnection({ name: incoming.name.trim(), url: incoming.url.trim() }); return;
      case "addProfile": await addConnection({ name: incoming.name.trim(), profileFile: incoming.profileFile.trim() }); return;
      case "updateServer": await updateConnection(incoming.name, { name: incoming.newName.trim(), url: incoming.url.trim() }); return;
      case "updateProfile": await updateConnection(incoming.name, { name: incoming.newName.trim(), profileFile: incoming.profileFile.trim() }); return;
      case "remove": await removeConnection(incoming.name); return;
      case "connect": case "startProfile": await requireSession(incoming.name).connect(); return;
      case "retry": await requireSession(incoming.name).retry(); return;
      case "disconnect": case "stopProfile": await closeConnection(incoming.name); return;
      case "logout": {
        const session = requireSession(incoming.name);
        if (session.status.kind === "connected") await session.logout();
        else await session.forgetCredentials();
        return;
      }
      case "login": {
        const session = requireSession(incoming.name);
        if (session.status.kind === "stopped" || session.status.kind === "failed") await session.connect();
        if ("token" in incoming) await session.loginWithToken(incoming.token);
        else await session.loginWith(incoming.user, incoming.password);
        return;
      }
      case "openRun": selectRun(incoming.name, incoming.runId, { focusPanel: true }); return;
      case "deleteRuns": await deleteRuns(incoming.name, incoming.runIds); return;
      // Start marks the tile as starting until the next state; a cancelled or failed start still sends one.
      case "newRun":
        try {
          await newRun(incoming.name, incoming.entryId);
        } finally {
          panel.render();
        }
        return;
      case "openSharing": await openSharing(incoming.name, incoming.runId, sharingClient(incoming.name), sharingStore); return;
      case "share":
        await saveSharing(incoming.name, incoming.runId, incoming.sharing, sharingClient(incoming.name), sharingStore);
        await sessions.get(incoming.name)?.store?.refresh();
        return;
      case "closeSharing": sharingStore.set(undefined); return;
    }
  };

  const openConnectionsSetting = () => vscode.commands.executeCommand("workbench.action.openSettingsJson", { revealSetting: { key: "ragents.connections" } });

  const pickProfileFile = async () => {
    const host = knownHost();
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      title: "Choose profile file",
      filters: { "RAgents profile": ["ts"] },
      openLabel: "Apply",
      ...(host === undefined ? {} : { defaultUri: vscode.Uri.file(host) }),
    });
    pickedProfileFile = picked?.[0]?.fsPath;
    panel.render();
  };

  /** The servers are written where the list already is; writing to the wrong scope would have no effect, because the narrower one wins. */
  const connectionsHome = (): ConnectionsLocation =>
    connectionsLocation(vscode.workspace.getConfiguration("ragents").inspect<unknown[]>("connections"));

  const writeConnections = (home: ConnectionsLocation, entries: readonly unknown[]) =>
    vscode.workspace.getConfiguration("ragents").update("connections", entries,
      home.scope === "workspace" ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);

  const reportConfigProblem = (text: string) => {
    configProblem = text;
    panel.render();
  };

  /** Adds a server to ragents.connections; a faulty entry stays as a message on the page. */
  const addConnection = async (raw: Record<string, string>) => {
    const home = connectionsHome();
    let parsed: Connection[];
    try {
      parsed = parseConnections([...configuredConnections().map(connectionSetting), raw]);
    } catch (cause) {
      reportConfigProblem(message(cause).replace(/^ragents\.connections\[\d+\]\.?/, "").replace(/^: /, "").trim());
      return;
    }
    const added = parsed[parsed.length - 1]!;
    if (added.kind === "profile" && !isProfileFile(added.profileFile)) {
      reportConfigProblem(`The profile file ${added.profileFile} does not exist.`);
      return;
    }
    configProblem = undefined;
    pickedProfileFile = undefined;
    await writeConnections(home, [...home.entries, raw]);
  };

  /** Changes a server in place in ragents.connections; a rename keeps the credentials, because they are tied to the address. */
  const updateConnection = async (name: string, raw: Record<string, string>) => {
    const home = connectionsHome();
    const index = home.entries.findIndex((entry) => typeof entry === "object" && entry !== null && String((entry as { name?: unknown }).name ?? "").trim() === name);
    if (index < 0) {
      reportConfigProblem(`The server ${name} is not in ragents.connections.`);
      return;
    }
    const others = configuredConnections().filter((connection) => connection.name !== name).map(connectionSetting);
    let parsed: Connection[];
    try {
      parsed = parseConnections([...others, raw]);
    } catch (cause) {
      reportConfigProblem(message(cause).replace(/^ragents\.connections\[\d+\]\.?/, "").replace(/^: /, "").trim());
      return;
    }
    const changed = parsed[parsed.length - 1]!;
    if (changed.kind === "profile" && !isProfileFile(changed.profileFile)) {
      reportConfigProblem(`The profile file ${changed.profileFile} does not exist.`);
      return;
    }
    configProblem = undefined;
    pickedProfileFile = undefined;
    await writeConnections(home, home.entries.map((entry, position) => position === index ? raw : entry));
  };

  /** Removes a server from ragents.connections and forgets its credentials; its session ends. */
  const removeConnection = async (name: string) => {
    const session = sessions.get(name);
    if (session) {
      await session.forgetSecrets();
      await closeConnection(name);
    }
    const home = connectionsHome();
    const kept = home.entries.filter((entry) => !(typeof entry === "object" && entry !== null && String((entry as { name?: unknown }).name ?? "").trim() === name));
    await writeConnections(home, kept);
  };

  /** Deleting stays the host's job; the Runs page then shows only what the refreshed list still contains. */
  const deleteRuns = async (connection: string, runIds: readonly string[]) => {
    const session = requireSession(connection);
    const client = requireClient(connection);
    if (selection?.connection === connection && selection.runId !== undefined && runIds.includes(selection.runId)) showPage("runs", { focusPanel: false });
    for (const runId of runIds) await client.rpc.call(coreContracts.runs.delete, { runId });
    await session.store?.refresh();
    sessionChanged();
  };

  /** The sharing panel lives in the panel state; every change redraws the page. */
  const sharingStore: SharingStore = {
    get: () => sharing,
    set: (next) => {
      sharing = next;
      panel.render();
    },
  };

  /** Sharing goes straight to the run's server, like deleting. */
  const sharingClient = (connection: string): SharingClient => ({
    load: (runId) => requireClient(connection).rpc.call(coreContracts.runs.sharing, { runId }),
    save: (runId, next) => requireClient(connection).rpc.call(coreContracts.runs.share, { runId, sharing: next }),
  });

  /** A new run works in a folder of this window; while the workstation registers, a notification shows what it is preparing. */
  const registeredWorkstation = (session: ConnectionSession): Promise<WorkspaceClient> =>
    session.registeredWorkspaceClient(async (registration, workspaceClient) => {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `RAgents: ${session.name}` }, async (progress) => {
        const report = () => {
          const status = workspaceClient.status;
          progress.report({ message: status.kind === "preparing" ? status.detail : "Registering workstation ..." });
        };
        report();
        const release = workspaceClient.onChange(report);
        try {
          await registration;
        } finally {
          release();
        }
      });
    });

  /** "New run" binds the workstation with an offered folder unless the template fixes the workspace; with several folders, a picker asks. */
  const newRun = async (connection: string, entryId?: string) => {
    const session = requireSession(connection);
    if (session.status.kind !== "connected") await session.connect();
    if (session.status.kind !== "connected") throw new Error(`The environment ${connection} is not connected.`);
    const entry = entryId === undefined ? undefined : session.store?.startEntries.find((candidate) => candidate.id === entryId);
    const workstation = preselectable(entry, WORKSPACE_BINDING_OPTION_ID) ? await registeredWorkstation(session) : undefined;
    const folders = workstation?.folders ?? [];
    const folder = folders.length > 1
      ? await vscode.window.showQuickPick([...folders], { title: "Folder for the new run", ignoreFocusOut: true })
      : folders[0];
    if (workstation !== undefined && folder === undefined) { showPage("start", { notice: "Run start cancelled." }); return; }
    const request: Extract<HostRunPanelMessage, { type: "newRun" }> = {
      type: "newRun",
      ...(workstation === undefined || folder === undefined ? {} : { startOptions: { [WORKSPACE_BINDING_OPTION_ID]: workstation.binding(folder) } }),
      ...(entryId === undefined ? {} : { entryId }),
    };
    if (selectRun(connection, undefined, { focusPanel: true }) === "frame-kept") panel.post(request);
    else pendingNewRun.set(connection, request);
  };

  /** A server and, if it has any, one of its templates; without a choice, the free task remains. */
  const chooseNewRun = async () => {
    const groups = newRunChoices(snapshots().filter((snapshot) => snapshot.connection.name === selection?.connection));
    const flat = groups.flatMap((group) => group.choices);
    if (flat.length === 0) {
      showPage("start");
      void vscode.window.showInformationMessage("RAgents: The selected environment does not allow new runs.");
      return;
    }
    if (flat.length === 1) { await newRun(flat[0]!.connection, flat[0]!.entryId); return; }
    const items: Array<vscode.QuickPickItem & { choice?: NewRunChoice }> = groups.flatMap((group) => [
      { label: group.group, kind: vscode.QuickPickItemKind.Separator },
      ...group.choices.map((choice) => ({ label: choice.title, description: choice.description, detail: choice.detail, choice })),
    ]);
    const picked = await vscode.window.showQuickPick(items, { title: "New run", matchOnDetail: true, ignoreFocusOut: true });
    if (!picked?.choice) return;
    await newRun(picked.choice.connection, picked.choice.entryId);
  };

  const reportNewRunFailure = (cause: unknown) => {
    const detail = message(cause);
    void vscode.window.showErrorMessage(`RAgents: ${detail}`);
    showPage("start", { notice: detail });
  };

  /** The server of a command: the node it comes from, otherwise the selected run, otherwise the question. */
  const chooseConnection = async (given: string | undefined, title: string, matches: (snapshot: ConnectionSnapshot) => boolean): Promise<string | undefined> => {
    if (given !== undefined) return given;
    const resolved = resolveConnection(snapshots(), selection?.connection, matches);
    if (resolved.kind === "none") return undefined;
    if (resolved.kind === "connection") return resolved.name;
    const picked = await vscode.window.showQuickPick(
      resolved.candidates.map((snapshot) => ({ label: snapshot.connection.name, description: describeConnection(snapshot.connection) })),
      { title, ignoreFocusOut: true },
    );
    return picked?.label;
  };

  /** A service on this machine opens directly: on this window's workstation or on the extension's own host. Otherwise a local tunnel streams it through the run's server. */
  const openService = async (connection: string, service: RunService): Promise<void> => {
    const session = requireSession(connection);
    if (serviceOnThisMachine(service, { ownHost: session.host !== undefined, workstation: session.workspaceClient?.id })) {
      log(`== Port ${service.port} of run ${service.runId} is on this machine; opened directly`);
      await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${service.port}/`));
      return;
    }
    const localPort = await tunnels.open(connection, requireClient(connection), service);
    await vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${localPort}/`));
  };

  const handleRunPanelMessage = (connection: string, incoming: RunPanelHostMessage) => {
    const session = sessions.get(connection);
    switch (incoming.type) {
      case "ready": {
        const runId = selection?.connection === connection ? selection.runId : undefined;
        if (runId !== undefined) panel.post({ type: "selectRun", runId });
        else panel.post({ type: "showPage", page: page === "runs" ? "runs" : "start", ...(startNotice === undefined ? {} : { notice: startNotice }) });
        const request = pendingNewRun.get(connection);
        if (request) {
          pendingNewRun.delete(connection);
          panel.post(request);
        }
        return;
      }
      case "runChanged":
        if (selection?.connection === connection && selection.runId !== (incoming.runId ?? undefined)) {
          clearSelection();
          selection = { connection, runId: incoming.runId ?? undefined };
          if (incoming.runId !== null) {
            page = "run";
            watching = session?.store?.watch(incoming.runId);
          } else if (page === "run") page = "start";
          syncContext();
        }
        return;
      case "pageChanged":
        if (selection?.connection !== connection) return;
        clearSelection();
        selection = { connection, runId: undefined };
        page = incoming.page;
        startNotice = undefined;
        sharing = undefined;
        syncContext();
        return;
      case "newRun":
        void newRun(connection, incoming.entryId).catch(reportNewRunFailure);
        return;
      case "openInCenter":
        panels.open(connection, incoming.runId, incoming.elementId, incoming.title, session?.store?.run(incoming.runId)?.title);
        return;
      case "showStart":
        showPage("start", { notice: incoming.notice });
        return;
      case "login":
        showPage("connections");
        return;
      case "logout":
        void session?.logout();
        return;
      case "openExternal":
        void vscode.env.openExternal(vscode.Uri.parse(incoming.url));
        return;
      case "openPage":
        void vscode.commands.executeCommand("simpleBrowser.show", incoming.url);
        return;
      case "openService": {
        const { runId, port, workstation, tunnel } = incoming;
        void openService(connection, { runId, port, workstation, tunnel }).catch((cause: unknown) => {
          log(`== Port ${port} of run ${runId} cannot be opened: ${message(cause)}`);
          void vscode.window.showErrorMessage(`RAgents: port ${port} of the run cannot be opened: ${message(cause)}`);
        });
        return;
      }
    }
  };

  context.subscriptions.push(
    documents,
    messages,
    output,
    statusBar,
    { dispose: () => { void stopAllSessions(); } },
    { dispose: () => { void tunnels.dispose(); } },
    { dispose: () => panels.dispose() },
    vscode.window.registerWebviewViewProvider("ragents.runPanel", panel, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider(DOCUMENT_SCHEME, documents),
    // vscode://purestate.ragents-vscode/reload from the task "vscode: install": reload the window so the extension and hosts start fresh.
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        if (uri.path !== "/reload") return;
        log("== Reloading window on request");
        void vscode.commands.executeCommand("workbench.action.reloadWindow");
      },
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      const theme = resolveTheme(configuredTheme(), editorTheme());
      panel.render();
      panel.post({ type: "theme", theme });
      panels.post({ type: "theme", theme });
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("ragents.zoom")) {
        panel.zoomChanged();
        panels.zoomChanged();
      }
      if (event.affectsConfiguration("ragents.theme")) rerender();
      if (event.affectsConfiguration("ragents.connections")) void syncConnections();
      if (event.affectsConfiguration("ragents.hostEnvironment")) {
        void refreshMissingSecrets();
        if ([...sessions.values()].some((session) => session.host)) {
          void vscode.window.showInformationMessage("The host's environment variables have changed; they apply from the next start of a server.");
        }
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void (async () => {
      for (const session of sessions.values()) await session.updateFolders(workspaceFolders());
    })()),
    vscode.commands.registerCommand("ragents.showStart", () => showPage("start")),
    vscode.commands.registerCommand("ragents.showRuns", () => showPage("runs")),
    vscode.commands.registerCommand("ragents.showConnections", () => showPage("connections")),
    vscode.commands.registerCommand("ragents.selectEnvironment", () => chooseEnvironment()),
    vscode.commands.registerCommand("ragents.openConnectionsSetting", () => openConnectionsSetting()),
    context.secrets.onDidChange(() => void refreshMissingSecrets()),
    vscode.commands.registerCommand("ragents.setSecret", (name?: unknown) => setSecret(typeof name === "string" ? name : undefined)),
    vscode.commands.registerCommand("ragents.deleteSecret", () => deleteSecret()),
    vscode.commands.registerCommand("ragents.connect", async (node?: string | { connection: string }) => {
      const given = typeof node === "string" ? node : node?.connection;
      const connection = await chooseConnection(given, "Connect server", (entry) => entry.status.kind !== "connected");
      if (connection !== undefined) await requireSession(connection).connect();
    }),
    vscode.commands.registerCommand("ragents.disconnect", async (node?: string | { connection: string }) => {
      const given = typeof node === "string" ? node : node?.connection;
      const connection = await chooseConnection(given, "Disconnect server", (entry) => entry.status.kind !== "stopped");
      if (connection !== undefined) await closeConnection(connection);
    }),
    vscode.commands.registerCommand("ragents.refresh", () => void (async () => {
      const session = selection && sessions.get(selection.connection);
      if (!session) return;
      if (session.status.kind === "connected") await session.store?.refresh();
      else await session.reconnect();
    })()),
    vscode.commands.registerCommand("ragents.login", () => showPage("connections")),
    vscode.commands.registerCommand("ragents.logout", async (node?: string | { connection: string }) => {
      const given = typeof node === "string" ? node : node?.connection;
      const connection = await chooseConnection(given, "Sign out of which server?", (entry) => entry.user !== undefined);
      if (connection !== undefined) await requireSession(connection).logout();
    }),
    vscode.commands.registerCommand("ragents.newRun", () => chooseNewRun().catch(reportNewRunFailure)),
    vscode.commands.registerCommand("ragents.openAppInCenter", (connection: string, runId: string, elementId: string, title: string) => {
      panels.open(connection, runId, elementId, title, sessions.get(connection)?.store?.run(runId)?.title);
    }),
    vscode.commands.registerCommand("ragents.openJournal", async (connection: string, runId: string) => {
      const uri = journalUri(connection, runId, sessions.get(connection)?.store?.run(runId)?.title ?? runId);
      documents.invalidate(uri);
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    }),
  );

  syncContext();
  await syncConnections();
  await refreshMissingSecrets();
  return {
    sessions: () => [...sessions.values()],
    session: (name) => sessions.get(name),
    snapshots,
    connections: configuredConnections,
    connect: (name) => requireSession(name).connect(),
    disconnect: (name) => closeConnection(name),
    messages: messages.event,
    selectRun: (connection, runId) => selectRun(connection, runId, { focusPanel: true }),
    selectEnvironment,
    activeEnvironment: () => selection?.connection,
    newRun: (connection, entryId) => newRun(connection, entryId),
    applyToken: (connection, token) => requireSession(connection).useToken(token),
    loginWith: (connection, id, password) => requireSession(connection).loginWith(id, password),
    panel: () => bridge.panel(),
    panelAction: (action) => runPanelAction({ ...action, type: "ragents.panel" }),
  };
}

/** Waits a limited time for the own hosts to stop; whatever still runs afterwards is ended by the watchdog in the host itself. */
export async function deactivate(): Promise<void> {
  const stop = stopSessions?.();
  if (!stop) return;
  await Promise.race([stop, new Promise<void>((settle) => setTimeout(settle, DEACTIVATE_TIMEOUT_MS))]);
}
