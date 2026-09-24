import { hostname } from "node:os";
import * as vscode from "vscode";
import { defaultDataDirectory } from "../../server/src/data-directory";
import { coreContracts } from "../../server/src/api/contracts";
import type { RunPanelHostMessage, RunPanelTheme, HostRunPanelMessage } from "../../web/src/run-panel/host-contract";
import { WORKSPACE_BINDING_OPTION_ID } from "../../../plugins/ragents.workspace/contract";
import { prepareProfile } from "../../../scripts/remote/connect";
import { ensureHostLinks } from "../../../scripts/package/host-links.mjs";
import { connectionSecretKey, connectionSetting, connectionsLocation, describeConnection, isProfileFile, parseConnections, profileFilesIn, profileNameOf, resolveHostPath, type Connection, type ConnectionsLocation } from "./connections";
import { DOCUMENT_SCHEME, journalUri, RunDocuments } from "./documents";
import { ensureHostPackage, hostCommand, inheritedEnvironment, packagedHostVersion, provisionTools, startHost, type RunningHost } from "./host-process";
import { connectedCount, connectionView, newRunChoices, panelState, pendingActions, preselectable, resolveConnection, type NewRunChoice } from "./overview-model";
import type { ServerClient } from "./server-client";
import { ConnectionSession, type ConnectionSnapshot, type LaunchedConnection, type SessionServices } from "./sessions";
import { hostEnvironmentSecretKey, isEnvironmentName, missingHostEnvironmentSecrets, parseHostEnvironment, parseThemeSetting, provideMissingSecret, resolveTheme, withHostEnvironmentSecrets, withRelaySession } from "./settings";
import { connectionState, kindLabel } from "../../web/src/panel/connection-state";
import { connectionStateWord } from "../../web/src/ui/state-vocabulary";
import type { PanelAction, PanelActionMessage, PanelPage, PanelState } from "../../web/src/panel/contract";
import { profileDistributionContracts, type ClientProfileDescription } from "../../../plugins/ragents.profile-distribution/contract";
import { AppPanels, PanelView, type FrameSettings, type PanelRendering } from "./webviews";
import { windowClientId } from "./workspace-identity";
import { WorkspaceClient, workstationRunsDirectory } from "../../../plugins/ragents.workspace/client/workspace-client";

const HOST_PATH_KEY = "ragents.lastHostPath";
const DEACTIVATE_TIMEOUT_MS = 4_000;
const OTHER_NAME = "Anderer Name ...";

/** Was deactivate abwartet: VS Code ruft es vor dem Entsorgen der subscriptions und nur beim geordneten Ende. */
let stopSessions: (() => Promise<void>) | undefined;

/** Was activate zurückgibt: der Zugriff für Host-Tests und andere Erweiterungen. */
export interface RAgentsApi {
  sessions: () => readonly ConnectionSession[];
  session: (name: string) => ConnectionSession | undefined;
  snapshots: () => readonly ConnectionSnapshot[];
  connections: () => readonly Connection[];
  connect: (name: string) => Promise<void>;
  disconnect: (name: string) => Promise<void>;
  messages: vscode.Event<{ connection: string; message: RunPanelHostMessage }>;
  selectRun: (connection: string, runId: string | undefined) => void;
  newRun: (connection: string, entryId?: string) => Promise<void>;
  applyToken: (connection: string, token: string | undefined) => Promise<void>;
  loginWith: (connection: string, id: string, password: string) => Promise<void>;
  /** Was die Panelseite zeigt und was sie schickt; der Host-Test nimmt denselben Weg wie das Webview. */
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
  /** Trennt alle Sitzungen und stoppt damit jeden eigenen Host; ein zweiter Aufruf wartet auf dasselbe Trennen. */
  const stopAllSessions = (): Promise<void> => stopped ??= (async () => {
    await Promise.all([...sessions.values()].map((session) => session.disconnect()
      .catch((cause) => log(`== Trennen fehlgeschlagen: ${message(cause)}`))));
  })();
  stopSessions = stopAllSessions;
  let selection: { connection: string; runId: string | undefined } | undefined;
  let page: PanelPage = "start";
  let runsConnection: string | undefined;
  let configProblem: string | undefined;
  let pickedProfileFile: string | undefined;
  let missingSecrets: readonly string[] = [];
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
    frame: frameFor,
    selection: () => selection,
    panel: () => panelState({
      theme: resolveTheme(configuredTheme(), editorTheme()),
      page,
      connections: snapshots(),
      profileSuggestions: profileFilesIn(knownHost()),
      missingSecrets,
      problem: configProblem,
      pickedProfileFile,
      runsConnection,
    }),
    handle: (connection: string, incoming: RunPanelHostMessage) => {
      handleRunPanelMessage(connection, incoming);
      messages.fire({ connection, message: incoming });
    },
    panelAction: (incoming: PanelActionMessage) => {
      void runPanelAction(incoming).catch((cause: unknown) => vscode.window.showErrorMessage(`RAgents: ${message(cause)}`));
    },
  };
  const panel = new PanelView(bridge, context.extensionUri);
  const panels = new AppPanels(bridge, (connection, runId) => {
    if (selection?.connection === connection) panel.post({ type: "placements", runId, center: [...panels.centerElements(connection, runId)] });
  });
  const documents = new RunDocuments((connection) => requireClient(connection));
  const statusBar = vscode.window.createStatusBarItem("ragents.connections", vscode.StatusBarAlignment.Left, 50);
  statusBar.command = "ragents.showStart";

  const requireSession = (connection: string): ConnectionSession => {
    const session = sessions.get(connection);
    if (!session) throw new Error(`Der Server ${connection} steht nicht in ragents.connections.`);
    return session;
  };

  const requireClient = (connection: string): ServerClient => {
    const client = requireSession(connection).client;
    if (!client) throw new Error(`Der Server ${connection} ist nicht verbunden.`);
    return client;
  };

  const rerender = () => {
    panel.render();
    panels.render();
  };

  /** Der Zustand eines Servers in einer Zeile; Panel und Statusleiste nennen ihn gleich. */
  const stateOf = (snapshot: ConnectionSnapshot): string => {
    const view = connectionView(snapshot);
    return `${kindLabel(view)}, ${connectionStateWord(connectionState(view))}`;
  };

  const syncContext = () => {
    const current = snapshots();
    void vscode.commands.executeCommand("setContext", "ragents.hasConnections", current.length > 0);
    void vscode.commands.executeCommand("setContext", "ragents.canCreate", current.some((snapshot) => snapshot.status.kind === "connected" && snapshot.canCreate));
    const waiting = pendingActions(current);
    panel.badge(waiting, waiting === 1 ? "1 wartende Eingabe" : `${waiting} wartende Eingaben`);
    const connected = connectedCount(current);
    statusBar.text = `$(plug) RAgents: ${connected} verbunden`;
    statusBar.tooltip = current.length === 0
      ? "Kein Server eingerichtet. Klick: Start"
      : `${current.map((snapshot) => `${snapshot.connection.name}: ${stateOf(snapshot)}`).join("\n")}\nKlick: Start`;
    statusBar.show();
  };

  let watching: (() => void) | undefined;
  const clearSelection = () => {
    if (selection === undefined) return;
    watching?.();
    watching = undefined;
    selection = undefined;
  };

  /** Zeigt den Run im Panel und sagt, was dabei entstanden ist; ein frisch gebautes iframe nimmt noch keine Nachricht an. */
  const selectRun = (connection: string, runId: string | undefined, { focusPanel = false } = {}): PanelRendering => {
    const session = sessions.get(connection);
    if (!session?.store) return "page";
    const changed = selection?.connection !== connection || selection.runId !== runId;
    if (!changed) {
      if (focusPanel) panel.reveal();
      return "frame-kept";
    }
    clearSelection();
    selection = { connection, runId };
    if (runId !== undefined) page = "run";
    if (runId !== undefined) watching = session.store.watch(runId);
    const rendering = panel.render();
    if (rendering === "frame-kept") {
      panel.post({ type: "selectRun", runId: runId ?? null });
      if (runId !== undefined) panel.post({ type: "placements", runId, center: [...panels.centerElements(connection, runId)] });
    }
    syncContext();
    if (focusPanel) panel.reveal();
    return rendering;
  };

  /** Zurück aus dem Run: kein Run gewählt, das Panel zeigt eine seiner drei Seiten; nur der Chip auf Start gibt Runs einen Server mit. */
  const showPage = (next: Exclude<PanelPage, "run">, { focusPanel = true, connection }: { focusPanel?: boolean; connection?: string } = {}) => {
    page = next;
    runsConnection = next === "runs" ? connection : undefined;
    clearSelection();
    panel.render();
    syncContext();
    if (focusPanel) panel.reveal();
  };

  const configuredHostEnvironment = (): string[] => parseHostEnvironment(vscode.workspace.getConfiguration("ragents").get("hostEnvironment"));

  /** Welche Umgebungsvariablen ein gestarteter Host bekommt: das Geerbte, darüber die Sitzung eines verteilten Profils, darüber die Werte aus der SecretStorage. */
  const hostEnvironment = (relay?: { serverUrl: string; token: string }): Promise<NodeJS.ProcessEnv> =>
    withHostEnvironmentSecrets(
      relay ? withRelaySession(inheritedEnvironment(), relay.serverUrl, relay.token) : inheritedEnvironment(),
      configuredHostEnvironment(), context.secrets, log);

  /** Dieselben Namen, aber ohne Wurf: eine fehlerhafte Einstellung steht im Protokoll und gilt der Anzeige als leere Liste. */
  const declaredHostEnvironment = (): string[] => {
    try {
      return configuredHostEnvironment();
    } catch (cause) {
      log(`== Einstellung ragents.hostEnvironment: ${message(cause)}`);
      return [];
    }
  };

  /** Welche Namen aus ragents.hostEnvironment noch ohne Wert sind; die Seite Server zeigt sie, sobald sich Einstellung oder SecretStorage ändern. */
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

  /** Um welche Umgebungsvariable es geht: eine aus ragents.hostEnvironment oder ein eingegebener Name; nie ein Wert. */
  const chooseSecretName = async (title: string): Promise<string | undefined> => {
    const configured = await Promise.all(configuredHostEnvironment().map(async (name) => ({
      label: name,
      description: (await context.secrets.get(hostEnvironmentSecretKey(name))) === undefined ? "kein Wert gespeichert" : "Wert gespeichert",
    })));
    const picked = await vscode.window.showQuickPick([...configured, { label: OTHER_NAME, description: "Namen eingeben" }],
      { title, placeHolder: "Umgebungsvariable" });
    if (picked === undefined) return undefined;
    if (picked.label !== OTHER_NAME) return picked.label;
    const typed = await vscode.window.showInputBox({
      title,
      prompt: "Name der Umgebungsvariablen",
      ignoreFocusOut: true,
      validateInput: (value) => isEnvironmentName(value.trim()) ? undefined : "Erlaubt sind Buchstaben, Ziffern und _, nicht mit einer Ziffer am Anfang.",
    });
    return typed?.trim() || undefined;
  };

  /** Legt den Wert einer Umgebungsvariablen in die SecretStorage; er steht danach nur dort und in keiner Einstellung.
   * Mit einem Server ist es der geführte Weg aus seinem Fehler: Name in die Einstellung, Wert, neuer Versuch. */
  const setSecret = async (given?: string, connection?: string): Promise<void> => {
    const name = given ?? await chooseSecretName("Secret setzen");
    if (name === undefined) return;
    const askValue = () => Promise.resolve(vscode.window.showInputBox({ title: "Secret setzen", prompt: `Wert für ${name}`, password: true, ignoreFocusOut: true }));
    const store = async (value: string): Promise<void> => {
      await context.secrets.store(hostEnvironmentSecretKey(name), value);
      log(`== Wert für ${name} in der SecretStorage gespeichert`);
      await refreshMissingSecrets();
    };
    if (connection !== undefined) {
      await provideMissingSecret(name, {
        names: configuredHostEnvironment,
        writeNames: async (names) => {
          await writeHostEnvironment(names);
          log(`== ${name} in ragents.hostEnvironment eingetragen`);
        },
        askValue,
        store,
        retry: async () => {
          log(`== ${connection} startet nach dem Wert für ${name} erneut`);
          await sessions.get(connection)?.retry();
        },
      });
      return;
    }
    const value = await askValue();
    if (value === undefined) return;
    await store(value);
    if (configuredHostEnvironment().includes(name)) {
      void vscode.window.showInformationMessage(`Der Wert für ${name} steht bereit; er gilt ab dem nächsten Start eines Servers.`);
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `${name} steht nicht in ragents.hostEnvironment; ohne den Eintrag bekommt der Host den Wert nicht.`, "Eintragen");
    if (choice) await writeHostEnvironment([...configuredHostEnvironment(), name]);
  };

  /** Nimmt den Wert einer Umgebungsvariablen aus der SecretStorage; ihr Name bleibt in der Einstellung stehen. */
  const deleteSecret = async (): Promise<void> => {
    const name = await chooseSecretName("Secret löschen");
    if (name === undefined) return;
    await context.secrets.delete(hostEnvironmentSecretKey(name));
    log(`== Wert für ${name} aus der SecretStorage entfernt`);
    await refreshMissingSecrets();
    void vscode.window.showInformationMessage(`Für ${name} ist kein Wert mehr gespeichert.`);
  };

  const configuredHost = (): string | undefined => resolveHostPath(vscode.workspace.getConfiguration("ragents").get("hostPath"), context.extensionPath);

  /** Der Host, den dieser Arbeitsplatz kennt: die Einstellung oder der zuletzt gestartete; ohne beides gibt es keinen. */
  const knownHost = (): string | undefined => {
    try {
      return configuredHost() ?? context.globalState.get<string>(HOST_PATH_KEY);
    } catch (cause) {
      log(`== Einstellung ragents.hostPath: ${message(cause)}`);
      return context.globalState.get<string>(HOST_PATH_KEY);
    }
  };

  /** Der Host: die Einstellung, das Repo der Erweiterung oder das Paket, das die Erweiterung selbst holt. Ein Server nennt
   * die Fassung, die er verlangt; ein lokales Profil bekommt die, die zu dieser Erweiterung gehört. */
  const ensureHost = async (version: string, report: (detail: string) => void): Promise<string> => {
    const configured = configuredHost();
    if (configured) return configured;
    report(`Host-Paket ${version} holen ...`);
    return ensureHostPackage(context.globalStorageUri.fsPath, version, await hostEnvironment(), log);
  };

  /** Startet den lokalen Host aus einer Profildatei; für lokale Profile und für Profile, die ein Server verteilt. */
  const startLocalHost = async (hostPath: string, profileFile: string, dataDirectory: string, environment: NodeJS.ProcessEnv, report: (detail: string) => void): Promise<RunningHost> => {
    ensureHostLinks(hostPath);
    report("Werkzeuge provisionieren ...");
    await provisionTools(hostPath, profileFile, { ...environment, PRODUCT_PROFILE: profileNameOf(profileFile), PRODUCT_PROFILE_FILE: profileFile, DATA_DIR: dataDirectory }, log);
    report("Host starten ...");
    const host = await startHost({
      profile: profileNameOf(profileFile), profileFile, dataDirectory, environment, log, command: hostCommand(hostPath, environment),
    });
    log(`== Host läuft unter ${host.url} (PID ${host.pid}, Profil ${profileFile}, Daten ${dataDirectory})`);
    await context.globalState.update(HOST_PATH_KEY, hostPath);
    return host;
  };

  /** Ein Server bekommt seine Adresse: per Adresse die eigene, als lokales Profil die seines frisch gestarteten Hosts. */
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

  /** Verteilt der Server ein Client-Profil, holt die Erweiterung es und arbeitet für diesen Server gegen einen lokalen Host damit. */
  const adoptDistributedProfile = async (session: ConnectionSession) => {
    const client = session.client;
    const token = client?.accessToken;
    const serverUrl = session.url;
    if (!client || !token || !serverUrl || session.host) return;
    let described: ClientProfileDescription;
    try {
      described = await client.rpc.call(profileDistributionContracts.describe, {});
    } catch (cause) {
      log(`== ${serverUrl} verteilt kein Client-Profil (${message(cause)}); direkt verbunden`);
      return;
    }
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `RAgents: ${session.name}` }, async (progress) => {
      const detail = (text: string) => progress.report({ message: text });
      const environment = { ...await hostEnvironment({ serverUrl, token }), RAGENTS_TOKEN: token };
      const hostPath = await ensureHost(described.packageVersion, detail);
      detail("Profil vom Server holen ...");
      const prepared = await prepareProfile({ serverUrl, token, hostPath });
      log(`== Profil ${prepared.description.profile} vom Server ${serverUrl}, Stand ${prepared.description.version.slice(0, 12)} (${prepared.downloaded ? "geholt" : "im Cache"})`);
      detail("Lokalen Host starten ...");
      const host = await startLocalHost(hostPath, prepared.profileFile, prepared.dataDirectory, environment, detail);
      if (sessions.get(session.name) !== session) { await host.stop(); return; }
      await session.attach({ url: host.url, token: host.token, host });
    });
  };

  const services: SessionServices = {
    workspaceClient: (transport) => new WorkspaceClient(transport, identity(), {
      hostRoot: knownHost,
      onExecuted: ({ runId, operation, durationMs, error }) => log(`== ${runId.slice(0, 8)} ${operation} ${durationMs} ms ${error ?? "ok"}`),
    }),
    secrets: context.secrets,
    launch: launchConnection,
    log,
    probe: (session) => void adoptDistributedProfile(session).catch((cause: unknown) => {
      log(`== Profil von ${session.name} übernehmen fehlgeschlagen: ${message(cause)}`);
      session.reportProblem(cause);
      void vscode.window.showErrorMessage(`RAgents: ${message(cause)}`, "Ausgabe zeigen").then((choice) => { if (choice) output.show(); });
    }),
    onHostExit: (session, code) => {
      void vscode.window.showErrorMessage(`Der lokale RAgents-Host für ${session.name} ist beendet (Code ${code}). Ausgabe im Kanal RAgents.`);
      void closeConnection(session.name);
    },
  };

  const sessionChanged = () => {
    syncContext();
    panel.render();
  };

  const closeConnection = async (name: string) => {
    const session = sessions.get(name);
    if (!session) return;
    if (selection?.connection === name) showPage("start", { focusPanel: false });
    panels.closeConnection(name);
    await session.disconnect();
    sessionChanged();
  };

  /** Die Server folgen der Einstellung: neue kommen dazu, geänderte werden neu aufgebaut, entfernte verschwinden. */
  const syncConnections = async () => {
    let connections: Connection[] = [];
    try {
      connections = configuredConnections();
      configProblem = undefined;
    } catch (cause) {
      configProblem = message(cause);
      log(`Einstellung ragents.connections: ${configProblem}`);
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
    if (selection && !sessions.has(selection.connection)) showPage("start", { focusPanel: false });
    sessionChanged();
    await Promise.all(closing);
    // Alles startet beim Aktivieren: ein Server verbindet sich, ein lokales Profil fährt still hoch, damit seine Vorlagen gleich dastehen.
    for (const session of started) void session.connect();
  };

  const runPanelAction = async (incoming: PanelActionMessage): Promise<void> => {
    switch (incoming.action) {
      case "page": showPage(incoming.page, { focusPanel: false, connection: incoming.connection }); return;
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
      case "newRun": await newRun(incoming.name, incoming.entryId); return;
    }
  };

  const openConnectionsSetting = () => vscode.commands.executeCommand("workbench.action.openSettingsJson", { revealSetting: { key: "ragents.connections" } });

  const pickProfileFile = async () => {
    const host = knownHost();
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      title: "Profildatei wählen",
      filters: { "RAgents-Profil": ["ts"] },
      openLabel: "Übernehmen",
      ...(host === undefined ? {} : { defaultUri: vscode.Uri.file(host) }),
    });
    pickedProfileFile = picked?.[0]?.fsPath;
    panel.render();
  };

  /** Die Server stehen dort, wo die Liste schon steht; ein Schreiben in den falschen Bereich bliebe wirkungslos, weil der engere gewinnt. */
  const connectionsHome = (): ConnectionsLocation =>
    connectionsLocation(vscode.workspace.getConfiguration("ragents").inspect<unknown[]>("connections"));

  const writeConnections = (home: ConnectionsLocation, entries: readonly unknown[]) =>
    vscode.workspace.getConfiguration("ragents").update("connections", entries,
      home.scope === "workspace" ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);

  const reportConfigProblem = (text: string) => {
    configProblem = text;
    panel.render();
  };

  /** Legt einen Server in ragents.connections an; ein fehlerhafter Eintrag bleibt als Meldung in der Seite. */
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
      reportConfigProblem(`Die Profildatei ${added.profileFile} gibt es nicht.`);
      return;
    }
    configProblem = undefined;
    pickedProfileFile = undefined;
    await writeConnections(home, [...home.entries, raw]);
  };

  /** Ändert einen Server an seiner Stelle in ragents.connections; ein Umbenennen behält die Anmeldedaten, weil sie an der Adresse hängen. */
  const updateConnection = async (name: string, raw: Record<string, string>) => {
    const home = connectionsHome();
    const index = home.entries.findIndex((entry) => typeof entry === "object" && entry !== null && String((entry as { name?: unknown }).name ?? "").trim() === name);
    if (index < 0) {
      reportConfigProblem(`Der Server ${name} steht nicht in ragents.connections.`);
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
      reportConfigProblem(`Die Profildatei ${changed.profileFile} gibt es nicht.`);
      return;
    }
    configProblem = undefined;
    pickedProfileFile = undefined;
    await writeConnections(home, home.entries.map((entry, position) => position === index ? raw : entry));
  };

  /** Nimmt einen Server aus ragents.connections und vergisst seine Anmeldedaten; seine Sitzung endet. */
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

  /** Löschen bleibt Sache des Hosts; die Seite Runs zeigt danach nur, was die aufgefrischte Liste noch hergibt. */
  const deleteRuns = async (connection: string, runIds: readonly string[]) => {
    const session = requireSession(connection);
    const client = requireClient(connection);
    if (selection?.connection === connection && selection.runId !== undefined && runIds.includes(selection.runId)) showPage("runs", { focusPanel: false });
    for (const runId of runIds) await client.rpc.call(coreContracts.runs.delete, { runId });
    await session.store?.refresh();
    sessionChanged();
  };

  /** "Neuer Run" belegt den Arbeitsbereich mit einem angebotenen Ordner vor, außer die Vorlage legt ihn fest; bei mehreren Ordnern fragt die Auswahl. */
  const newRun = async (connection: string, entryId?: string) => {
    const session = requireSession(connection);
    if (session.status.kind !== "connected") await session.connect();
    const entry = entryId === undefined ? undefined : session.store?.startEntries.find((candidate) => candidate.id === entryId);
    const workspaceClient = session.workspaceClient;
    const folders = workspaceClient?.status.kind === "registered" && preselectable(entry, WORKSPACE_BINDING_OPTION_ID) ? workspaceClient.folders : [];
    const folder = folders.length > 1
      ? await vscode.window.showQuickPick([...folders], { title: "Ordner für den neuen Run", ignoreFocusOut: true })
      : folders[0];
    if (folders.length > 1 && folder === undefined) return;
    const request: Extract<HostRunPanelMessage, { type: "newRun" }> = {
      type: "newRun",
      ...(folder === undefined || !workspaceClient ? {} : { startOptions: { [WORKSPACE_BINDING_OPTION_ID]: workspaceClient.binding(folder) } }),
      ...(entryId === undefined ? {} : { entryId }),
    };
    if (selectRun(connection, undefined, { focusPanel: true }) === "frame-kept") panel.post(request);
    else pendingNewRun.set(connection, request);
  };

  /** Ein Server und, wenn er welche hat, eine seiner Vorlagen; ohne Auswahl bleibt der freie Auftrag. */
  const chooseNewRun = async () => {
    const groups = newRunChoices(snapshots());
    const flat = groups.flatMap((group) => group.choices);
    if (flat.length === 0) {
      showPage("start");
      void vscode.window.showInformationMessage("RAgents: Kein verbundener Server, der neue Runs erlaubt.");
      return;
    }
    if (flat.length === 1) { await newRun(flat[0]!.connection, flat[0]!.entryId); return; }
    const items: Array<vscode.QuickPickItem & { choice?: NewRunChoice }> = groups.flatMap((group) => [
      { label: group.group, kind: vscode.QuickPickItemKind.Separator },
      ...group.choices.map((choice) => ({ label: choice.title, description: choice.description, detail: choice.detail, choice })),
    ]);
    const picked = await vscode.window.showQuickPick(items, { title: "Neuer Run", matchOnDetail: true, ignoreFocusOut: true });
    if (!picked?.choice) return;
    await newRun(picked.choice.connection, picked.choice.entryId);
  };

  /** Der Server eines Befehls: der Knoten, aus dem er kommt, sonst der gewählte Run, sonst die Frage. */
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

  const handleRunPanelMessage = (connection: string, incoming: RunPanelHostMessage) => {
    const session = sessions.get(connection);
    switch (incoming.type) {
      case "ready": {
        const runId = selection?.connection === connection ? selection.runId : undefined;
        panel.post({ type: "selectRun", runId: runId ?? null });
        if (runId !== undefined) panel.post({ type: "placements", runId, center: [...panels.centerElements(connection, runId)] });
        const request = pendingNewRun.get(connection);
        if (request) {
          pendingNewRun.delete(connection);
          panel.post(request);
        }
        return;
      }
      case "runChanged":
        selectRun(connection, incoming.runId ?? undefined);
        return;
      case "openInCenter":
        panels.open(connection, incoming.runId, incoming.elementId, incoming.title, session?.store?.run(incoming.runId)?.title);
        return;
      case "returnToRunPanel":
        panels.close(connection, incoming.runId, incoming.elementId);
        return;
      case "showStart":
        showPage("start");
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
    }
  };

  context.subscriptions.push(
    documents,
    messages,
    output,
    statusBar,
    { dispose: () => { void stopAllSessions(); } },
    { dispose: () => panels.dispose() },
    vscode.window.registerWebviewViewProvider("ragents.runPanel", panel, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.workspace.registerTextDocumentContentProvider(DOCUMENT_SCHEME, documents),
    // vscode://purestate.ragents-vscode/reload aus dem Task "vscode: install": das Fenster neu laden, damit Erweiterung und Hosts frisch starten.
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        if (uri.path !== "/reload") return;
        log("== Fenster auf Anforderung neu laden");
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
      if (event.affectsConfiguration("ragents.theme")) rerender();
      if (event.affectsConfiguration("ragents.connections")) void syncConnections();
      if (event.affectsConfiguration("ragents.hostPath") && [...sessions.values()].some((session) => session.host)) {
        void vscode.window.showInformationMessage("Der Host hat sich geändert; er gilt ab dem nächsten Start eines Servers.");
      }
      if (event.affectsConfiguration("ragents.hostEnvironment")) {
        void refreshMissingSecrets();
        if ([...sessions.values()].some((session) => session.host)) {
          void vscode.window.showInformationMessage("Die Umgebungsvariablen des Hosts haben sich geändert; sie gelten ab dem nächsten Start eines Servers.");
        }
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void (async () => {
      for (const session of sessions.values()) await session.updateFolders(workspaceFolders());
    })()),
    vscode.commands.registerCommand("ragents.showStart", () => showPage("start")),
    vscode.commands.registerCommand("ragents.showRuns", () => showPage("runs")),
    vscode.commands.registerCommand("ragents.showConnections", () => showPage("connections")),
    vscode.commands.registerCommand("ragents.openConnectionsSetting", () => openConnectionsSetting()),
    context.secrets.onDidChange(() => void refreshMissingSecrets()),
    vscode.commands.registerCommand("ragents.setSecret", (name?: unknown) => setSecret(typeof name === "string" ? name : undefined)),
    vscode.commands.registerCommand("ragents.deleteSecret", () => deleteSecret()),
    vscode.commands.registerCommand("ragents.connect", async (node?: string | { connection: string }) => {
      const given = typeof node === "string" ? node : node?.connection;
      const connection = await chooseConnection(given, "Server verbinden", (entry) => entry.status.kind !== "connected");
      if (connection !== undefined) await requireSession(connection).connect();
    }),
    vscode.commands.registerCommand("ragents.disconnect", async (node?: string | { connection: string }) => {
      const given = typeof node === "string" ? node : node?.connection;
      const connection = await chooseConnection(given, "Server trennen", (entry) => entry.status.kind !== "stopped");
      if (connection !== undefined) await closeConnection(connection);
    }),
    vscode.commands.registerCommand("ragents.refresh", () => void (async () => {
      for (const session of sessions.values()) {
        if (session.status.kind === "connected") await session.store?.refresh();
        else if (session.status.kind !== "stopped") await session.reconnect();
      }
    })()),
    vscode.commands.registerCommand("ragents.login", () => showPage("connections")),
    vscode.commands.registerCommand("ragents.logout", async (node?: string | { connection: string }) => {
      const given = typeof node === "string" ? node : node?.connection;
      const connection = await chooseConnection(given, "Von welchem Server abmelden?", (entry) => entry.user !== undefined);
      if (connection !== undefined) await requireSession(connection).logout();
    }),
    vscode.commands.registerCommand("ragents.newRun", () => void chooseNewRun()),
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
  // Der Arbeitsplatz führt Sprachserver und Browser selbst aus; ihre Werkzeuge kommen beim Start auf diesen Rechner.
  void (async () => {
    try {
      const hostPath = knownHost();
      if (!hostPath) {
        log("== Werkzeuge des Arbeitsplatzes: noch kein Host; sie kommen nach der ersten Verbindung mit einem verteilenden Server");
        return;
      }
      ensureHostLinks(hostPath);
      await provisionTools(hostPath, "--workspace", await hostEnvironment(), log);
    } catch (cause) {
      log(`== Werkzeuge des Arbeitsplatzes: ${message(cause)}`);
    }
  })();
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
    newRun: (connection, entryId) => newRun(connection, entryId),
    applyToken: (connection, token) => requireSession(connection).useToken(token),
    loginWith: (connection, id, password) => requireSession(connection).loginWith(id, password),
    panel: () => bridge.panel(),
    panelAction: (action) => runPanelAction({ ...action, type: "ragents.panel" }),
  };
}

/** Wartet begrenzt auf das Stoppen der eigenen Hosts; was danach noch läuft, beendet der Wächter im Host selbst. */
export async function deactivate(): Promise<void> {
  const stop = stopSessions?.();
  if (!stop) return;
  await Promise.race([stop, new Promise<void>((settle) => setTimeout(settle, DEACTIVATE_TIMEOUT_MS))]);
}
