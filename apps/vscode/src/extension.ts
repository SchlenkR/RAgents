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
import { connectedTargets, newRunChoices, panelState, pendingActions, preselectable, resolveTarget, targetView, type NewRunChoice } from "./overview-model";
import type { ServerClient } from "./server-client";
import { TargetSession, type LaunchedTarget, type SessionServices, type TargetSnapshot } from "./sessions";
import { hostEnvironmentSecretKey, isEnvironmentName, missingHostEnvironmentSecrets, parseHostEnvironment, parseThemeSetting, provideMissingSecret, resolveTheme, withHostEnvironmentSecrets, withRelaySession } from "./settings";
import { environmentState, kindLabel } from "../../web/src/panel/target-state";
import { environmentStateWord } from "../../web/src/ui/state-vocabulary";
import type { PanelAction, PanelActionMessage, PanelPage, PanelState } from "../../web/src/panel/contract";
import { profileDistributionContracts, type ClientProfileDescription } from "../../../plugins/ragents.profile-distribution/contract";
import { AppPanels, PanelView, type FrameSettings, type PanelRendering } from "./webviews";
import { windowClientId } from "./workspace-identity";
import { WorkspaceClient } from "../../../plugins/ragents.workspace/client/workspace-client";

const HOST_PATH_KEY = "ragents.lastHostPath";
const DEACTIVATE_TIMEOUT_MS = 4_000;
const OTHER_NAME = "Anderer Name ...";

/** Was deactivate abwartet: VS Code ruft es vor dem Entsorgen der subscriptions und nur beim geordneten Ende. */
let stopSessions: (() => Promise<void>) | undefined;

/** Was activate zurückgibt: der Zugriff für Host-Tests und andere Erweiterungen. */
export interface RAgentsApi {
  sessions: () => readonly TargetSession[];
  session: (name: string) => TargetSession | undefined;
  targets: () => readonly TargetSnapshot[];
  connections: () => readonly Connection[];
  connect: (name: string) => Promise<void>;
  disconnect: (name: string) => Promise<void>;
  messages: vscode.Event<{ target: string; message: RunPanelHostMessage }>;
  selectRun: (target: string, runId: string | undefined) => void;
  newRun: (target: string, entryId?: string) => Promise<void>;
  applyToken: (target: string, token: string | undefined) => Promise<void>;
  loginWith: (target: string, id: string, password: string) => Promise<void>;
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
  const sessions = new Map<string, TargetSession>();
  let stopped: Promise<void> | undefined;
  /** Trennt alle Sitzungen und stoppt damit jeden eigenen Host; ein zweiter Aufruf wartet auf denselben Lauf. */
  const stopAllSessions = (): Promise<void> => stopped ??= (async () => {
    await Promise.all([...sessions.values()].map((session) => session.disconnect()
      .catch((cause) => log(`== Trennen fehlgeschlagen: ${message(cause)}`))));
  })();
  stopSessions = stopAllSessions;
  let selection: { target: string; runId: string | undefined } | undefined;
  let page: PanelPage = "start";
  let runsEnvironment: string | undefined;
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
  });

  const snapshots = (): TargetSnapshot[] => [...sessions.values()].map((session) => session.snapshot());
  const messages = new vscode.EventEmitter<{ target: string; message: RunPanelHostMessage }>();

  const frameFor = (target: string): FrameSettings | undefined => {
    const session = sessions.get(target);
    if (!session?.client || session.status.kind !== "connected") return undefined;
    return { serverUrl: session.client.baseUrl, theme: resolveTheme(configuredTheme(), editorTheme()), accessToken: session.client.accessToken };
  };

  const bridge = {
    frame: frameFor,
    selection: () => selection,
    panel: () => panelState({
      theme: resolveTheme(configuredTheme(), editorTheme()),
      page,
      targets: snapshots(),
      profileSuggestions: profileFilesIn(knownHost()),
      missingSecrets,
      problem: configProblem,
      pickedProfileFile,
      runsEnvironment,
    }),
    handle: (target: string, incoming: RunPanelHostMessage) => {
      handleRunPanelMessage(target, incoming);
      messages.fire({ target, message: incoming });
    },
    panelAction: (incoming: PanelActionMessage) => {
      void runPanelAction(incoming).catch((cause: unknown) => vscode.window.showErrorMessage(`RAgents: ${message(cause)}`));
    },
  };
  const panel = new PanelView(bridge, context.extensionUri);
  const panels = new AppPanels(bridge, (target, runId) => {
    if (selection?.target === target) panel.post({ type: "placements", runId, center: [...panels.centerElements(target, runId)] });
  });
  const documents = new RunDocuments((target) => requireClient(target));
  const statusBar = vscode.window.createStatusBarItem("ragents.targets", vscode.StatusBarAlignment.Left, 50);
  statusBar.command = "ragents.showStart";

  const requireSession = (target: string): TargetSession => {
    const session = sessions.get(target);
    if (!session) throw new Error(`Die Umgebung ${target} steht nicht in ragents.connections.`);
    return session;
  };

  const requireClient = (target: string): ServerClient => {
    const client = requireSession(target).client;
    if (!client) throw new Error(`Die Umgebung ${target} ist nicht verbunden.`);
    return client;
  };

  const rerender = () => {
    panel.render();
    panels.render();
  };

  /** Der Zustand einer Umgebung in einer Zeile; Panel und Statusleiste nennen ihn gleich. */
  const stateOf = (target: TargetSnapshot): string => {
    const view = targetView(target);
    return `${kindLabel(view)}, ${environmentStateWord(environmentState(view))}`;
  };

  const syncContext = () => {
    const targets = snapshots();
    void vscode.commands.executeCommand("setContext", "ragents.hasTargets", targets.length > 0);
    void vscode.commands.executeCommand("setContext", "ragents.canCreate", targets.some((target) => target.status.kind === "connected" && target.canCreate));
    const waiting = pendingActions(targets);
    panel.badge(waiting, waiting === 1 ? "1 wartende Eingabe" : `${waiting} wartende Eingaben`);
    const connected = connectedTargets(targets);
    statusBar.text = `$(plug) RAgents: ${connected} verbunden`;
    statusBar.tooltip = targets.length === 0
      ? "Keine Umgebung eingerichtet. Klick: Start"
      : `${targets.map((target) => `${target.connection.name}: ${stateOf(target)}`).join("\n")}\nKlick: Start`;
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
  const selectRun = (target: string, runId: string | undefined, { focusPanel = false } = {}): PanelRendering => {
    const session = sessions.get(target);
    if (!session?.store) return "page";
    const changed = selection?.target !== target || selection.runId !== runId;
    if (!changed) {
      if (focusPanel) panel.reveal();
      return "frame-kept";
    }
    clearSelection();
    selection = { target, runId };
    if (runId !== undefined) page = "run";
    if (runId !== undefined) watching = session.store.watch(runId);
    const rendering = panel.render();
    if (rendering === "frame-kept") {
      panel.post({ type: "selectRun", runId: runId ?? null });
      if (runId !== undefined) panel.post({ type: "placements", runId, center: [...panels.centerElements(target, runId)] });
    }
    syncContext();
    if (focusPanel) panel.reveal();
    return rendering;
  };

  /** Zurück aus dem Run: kein Run gewählt, das Panel zeigt eine seiner drei Seiten; nur der Chip auf Start gibt Runs eine Umgebung mit. */
  const showPage = (next: Exclude<PanelPage, "run">, { focusPanel = true, environment }: { focusPanel?: boolean; environment?: string } = {}) => {
    page = next;
    runsEnvironment = next === "runs" ? environment : undefined;
    clearSelection();
    panel.render();
    syncContext();
    if (focusPanel) panel.reveal();
  };

  const configuredHostEnvironment = (): string[] => parseHostEnvironment(vscode.workspace.getConfiguration("ragents").get("hostEnvironment"));

  /** Was ein gestarteter Host an Umgebung bekommt: das Geerbte, darüber die Sitzung eines verteilten Profils, darüber die Werte aus der SecretStorage. */
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

  /** Welche Namen aus ragents.hostEnvironment noch ohne Wert sind; die Seite Umgebungen zeigt sie, sobald sich Einstellung oder SecretStorage ändern. */
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
   * Mit einer Umgebung ist es der geführte Weg aus ihrem Fehler: Name in die Einstellung, Wert, neuer Versuch. */
  const setSecret = async (given?: string, environment?: string): Promise<void> => {
    const name = given ?? await chooseSecretName("Secret setzen");
    if (name === undefined) return;
    const askValue = () => Promise.resolve(vscode.window.showInputBox({ title: "Secret setzen", prompt: `Wert für ${name}`, password: true, ignoreFocusOut: true }));
    const store = async (value: string): Promise<void> => {
      await context.secrets.store(hostEnvironmentSecretKey(name), value);
      log(`== Wert für ${name} in der SecretStorage gespeichert`);
      await refreshMissingSecrets();
    };
    if (environment !== undefined) {
      await provideMissingSecret(name, {
        names: configuredHostEnvironment,
        writeNames: async (names) => {
          await writeHostEnvironment(names);
          log(`== ${name} in ragents.hostEnvironment eingetragen`);
        },
        askValue,
        store,
        retry: async () => {
          log(`== ${environment} startet nach dem Wert für ${name} erneut`);
          await sessions.get(environment)?.retry();
        },
      });
      return;
    }
    const value = await askValue();
    if (value === undefined) return;
    await store(value);
    if (configuredHostEnvironment().includes(name)) {
      void vscode.window.showInformationMessage(`Der Wert für ${name} steht bereit; er gilt ab dem nächsten Start einer Umgebung.`);
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

  /** Eine Umgebung bekommt ihre Adresse: ein Server seine eigene, ein lokales Profil die seines frisch gestarteten Hosts. */
  const launchTarget = async (connection: Connection, report: (detail: string) => void): Promise<LaunchedTarget> => {
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

  /** Verteilt der Server ein Client-Profil, holt die Erweiterung es und arbeitet für diese Umgebung gegen einen lokalen Host damit. */
  const adoptDistributedProfile = async (session: TargetSession) => {
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
    launch: launchTarget,
    log,
    probe: (session) => void adoptDistributedProfile(session).catch((cause: unknown) => {
      log(`== Profil von ${session.name} übernehmen fehlgeschlagen: ${message(cause)}`);
      session.reportProblem(cause);
      void vscode.window.showErrorMessage(`RAgents: ${message(cause)}`, "Ausgabe zeigen").then((choice) => { if (choice) output.show(); });
    }),
    onHostExit: (session, code) => {
      void vscode.window.showErrorMessage(`Der lokale RAgents-Host für ${session.name} ist beendet (Code ${code}). Ausgabe im Kanal RAgents.`);
      void closeTarget(session.name);
    },
  };

  const sessionChanged = () => {
    syncContext();
    panel.render();
  };

  const closeTarget = async (name: string) => {
    const session = sessions.get(name);
    if (!session) return;
    if (selection?.target === name) showPage("start", { focusPanel: false });
    panels.closeTarget(name);
    await session.disconnect();
    sessionChanged();
  };

  /** Die Umgebungen folgen der Einstellung: neue kommen dazu, geänderte werden neu aufgebaut, entfernte verschwinden. */
  const syncTargets = async () => {
    let connections: Connection[] = [];
    try {
      connections = configuredConnections();
      configProblem = undefined;
    } catch (cause) {
      configProblem = message(cause);
      log(`Einstellung ragents.connections: ${configProblem}`);
    }
    const kept = new Map<string, TargetSession>();
    const closing: Array<Promise<void>> = [];
    for (const connection of connections) {
      const existing = sessions.get(connection.name);
      if (existing && sameConnection(existing.connection, connection)) {
        kept.set(connection.name, existing);
        continue;
      }
      const session = new TargetSession(connection, services);
      session.onChange(sessionChanged);
      kept.set(connection.name, session);
    }
    for (const [name, session] of sessions) if (kept.get(name) !== session) { panels.closeTarget(name); closing.push(session.disconnect()); }
    const started = [...kept.values()].filter((session) => sessions.get(session.name) !== session);
    sessions.clear();
    for (const [name, session] of kept) sessions.set(name, session);
    if (selection && !sessions.has(selection.target)) showPage("start", { focusPanel: false });
    sessionChanged();
    await Promise.all(closing);
    // Alles startet beim Aktivieren: ein Server verbindet sich, ein lokales Profil fährt still hoch, damit seine Vorlagen gleich dastehen.
    for (const session of started) void session.connect();
  };

  const runPanelAction = async (incoming: PanelActionMessage): Promise<void> => {
    switch (incoming.action) {
      case "page": showPage(incoming.page, { focusPanel: false, environment: incoming.environment }); return;
      case "settingsFile": await openConnectionsSetting(); return;
      case "setSecret": await setSecret(incoming.name, incoming.environment); return;
      case "pickProfile": await pickProfileFile(); return;
      case "showOutput": output.show(true); return;
      case "addServer": await addConnection({ name: incoming.name.trim(), url: incoming.url.trim() }); return;
      case "addProfile": await addConnection({ name: incoming.name.trim(), profileFile: incoming.profileFile.trim() }); return;
      case "updateServer": await updateConnection(incoming.name, { name: incoming.newName.trim(), url: incoming.url.trim() }); return;
      case "updateProfile": await updateConnection(incoming.name, { name: incoming.newName.trim(), profileFile: incoming.profileFile.trim() }); return;
      case "remove": await removeConnection(incoming.name); return;
      case "connect": case "startProfile": await requireSession(incoming.name).connect(); return;
      case "retry": await requireSession(incoming.name).retry(); return;
      case "disconnect": case "stopProfile": await closeTarget(incoming.name); return;
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

  /** Die Umgebungen stehen dort, wo die Liste schon steht; ein Schreiben in den falschen Bereich bliebe wirkungslos, weil der engere gewinnt. */
  const connectionsHome = (): ConnectionsLocation =>
    connectionsLocation(vscode.workspace.getConfiguration("ragents").inspect<unknown[]>("connections"));

  const writeConnections = (home: ConnectionsLocation, entries: readonly unknown[]) =>
    vscode.workspace.getConfiguration("ragents").update("connections", entries,
      home.scope === "workspace" ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);

  const reportConfigProblem = (text: string) => {
    configProblem = text;
    panel.render();
  };

  /** Legt eine Umgebung in ragents.connections an; ein fehlerhafter Eintrag bleibt als Meldung in der Seite. */
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

  /** Ändert eine Umgebung an ihrer Stelle in ragents.connections; ein Umbenennen behält die Anmeldedaten, weil sie an der Adresse hängen. */
  const updateConnection = async (name: string, raw: Record<string, string>) => {
    const home = connectionsHome();
    const index = home.entries.findIndex((entry) => typeof entry === "object" && entry !== null && String((entry as { name?: unknown }).name ?? "").trim() === name);
    if (index < 0) {
      reportConfigProblem(`Die Umgebung ${name} steht nicht in ragents.connections.`);
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

  /** Nimmt eine Umgebung aus ragents.connections und vergisst ihre Anmeldedaten; ihre Sitzung endet. */
  const removeConnection = async (name: string) => {
    const session = sessions.get(name);
    if (session) {
      await session.forgetSecrets();
      await closeTarget(name);
    }
    const home = connectionsHome();
    const kept = home.entries.filter((entry) => !(typeof entry === "object" && entry !== null && String((entry as { name?: unknown }).name ?? "").trim() === name));
    await writeConnections(home, kept);
  };

  /** Löschen bleibt Sache des Hosts; die Seite Runs zeigt danach nur, was die aufgefrischte Liste noch hergibt. */
  const deleteRuns = async (target: string, runIds: readonly string[]) => {
    const session = requireSession(target);
    const client = requireClient(target);
    if (selection?.target === target && selection.runId !== undefined && runIds.includes(selection.runId)) showPage("runs", { focusPanel: false });
    for (const runId of runIds) await client.rpc.call(coreContracts.sessions.delete, { runId });
    await session.store?.refresh();
    sessionChanged();
  };

  /** "Neuer Run" belegt den Arbeitsbereich mit einem angebotenen Ordner vor, außer die Vorlage legt ihn fest; bei mehreren Ordnern fragt die Auswahl. */
  const newRun = async (target: string, entryId?: string) => {
    const session = requireSession(target);
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
    if (selectRun(target, undefined, { focusPanel: true }) === "frame-kept") panel.post(request);
    else pendingNewRun.set(target, request);
  };

  /** Eine Umgebung und, wenn sie welche hat, eine ihrer Startvorlagen; ohne Auswahl bleibt der freie Auftrag. */
  const chooseNewRun = async () => {
    const groups = newRunChoices(snapshots());
    const flat = groups.flatMap((group) => group.choices);
    if (flat.length === 0) {
      showPage("start");
      void vscode.window.showInformationMessage("RAgents: Keine verbundene Umgebung, die neue Runs erlaubt.");
      return;
    }
    if (flat.length === 1) { await newRun(flat[0]!.target, flat[0]!.entryId); return; }
    const items: Array<vscode.QuickPickItem & { choice?: NewRunChoice }> = groups.flatMap((group) => [
      { label: group.group, kind: vscode.QuickPickItemKind.Separator },
      ...group.choices.map((choice) => ({ label: choice.title, description: choice.description, detail: choice.detail, choice })),
    ]);
    const picked = await vscode.window.showQuickPick(items, { title: "Neuer Run", matchOnDetail: true, ignoreFocusOut: true });
    if (!picked?.choice) return;
    await newRun(picked.choice.target, picked.choice.entryId);
  };

  /** Die Umgebung eines Befehls: der Knoten, aus dem er kommt, sonst der gewählte Run, sonst die Frage. */
  const chooseTarget = async (given: string | undefined, title: string, matches: (target: TargetSnapshot) => boolean): Promise<string | undefined> => {
    if (given !== undefined) return given;
    const resolved = resolveTarget(snapshots(), selection?.target, matches);
    if (resolved.kind === "none") return undefined;
    if (resolved.kind === "target") return resolved.name;
    const picked = await vscode.window.showQuickPick(
      resolved.candidates.map((target) => ({ label: target.connection.name, description: describeConnection(target.connection) })),
      { title, ignoreFocusOut: true },
    );
    return picked?.label;
  };

  const handleRunPanelMessage = (target: string, incoming: RunPanelHostMessage) => {
    const session = sessions.get(target);
    switch (incoming.type) {
      case "ready": {
        const runId = selection?.target === target ? selection.runId : undefined;
        panel.post({ type: "selectRun", runId: runId ?? null });
        if (runId !== undefined) panel.post({ type: "placements", runId, center: [...panels.centerElements(target, runId)] });
        const request = pendingNewRun.get(target);
        if (request) {
          pendingNewRun.delete(target);
          panel.post(request);
        }
        return;
      }
      case "runChanged":
        selectRun(target, incoming.runId ?? undefined);
        return;
      case "openInCenter":
        panels.open(target, incoming.runId, incoming.elementId, incoming.title, session?.store?.run(incoming.runId)?.title);
        return;
      case "returnToRunPanel":
        panels.close(target, incoming.runId, incoming.elementId);
        return;
      case "showStart":
        showPage("start");
        return;
      case "login":
        showPage("environments");
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
      if (event.affectsConfiguration("ragents.connections")) void syncTargets();
      if (event.affectsConfiguration("ragents.hostPath") && [...sessions.values()].some((session) => session.host)) {
        void vscode.window.showInformationMessage("Der Host hat sich geändert; er gilt ab dem nächsten Start einer Umgebung.");
      }
      if (event.affectsConfiguration("ragents.hostEnvironment")) {
        void refreshMissingSecrets();
        if ([...sessions.values()].some((session) => session.host)) {
          void vscode.window.showInformationMessage("Die Umgebung des Hosts hat sich geändert; sie gilt ab dem nächsten Start einer Umgebung.");
        }
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void (async () => {
      for (const session of sessions.values()) await session.updateFolders(workspaceFolders());
    })()),
    vscode.commands.registerCommand("ragents.showStart", () => showPage("start")),
    vscode.commands.registerCommand("ragents.showRuns", () => showPage("runs")),
    vscode.commands.registerCommand("ragents.environments", () => showPage("environments")),
    vscode.commands.registerCommand("ragents.openConnectionsSetting", () => openConnectionsSetting()),
    context.secrets.onDidChange(() => void refreshMissingSecrets()),
    vscode.commands.registerCommand("ragents.setSecret", (name?: unknown) => setSecret(typeof name === "string" ? name : undefined)),
    vscode.commands.registerCommand("ragents.deleteSecret", () => deleteSecret()),
    vscode.commands.registerCommand("ragents.connect", async (node?: string | { target: string }) => {
      const given = typeof node === "string" ? node : node?.target;
      const target = await chooseTarget(given, "Umgebung verbinden", (entry) => entry.status.kind !== "connected");
      if (target !== undefined) await requireSession(target).connect();
    }),
    vscode.commands.registerCommand("ragents.disconnect", async (node?: string | { target: string }) => {
      const given = typeof node === "string" ? node : node?.target;
      const target = await chooseTarget(given, "Umgebung trennen", (entry) => entry.status.kind !== "stopped");
      if (target !== undefined) await closeTarget(target);
    }),
    vscode.commands.registerCommand("ragents.refresh", () => void (async () => {
      for (const session of sessions.values()) {
        if (session.status.kind === "connected") await session.store?.refresh();
        else if (session.status.kind !== "stopped") await session.reconnect();
      }
    })()),
    vscode.commands.registerCommand("ragents.login", () => showPage("environments")),
    vscode.commands.registerCommand("ragents.logout", async (node?: string | { target: string }) => {
      const given = typeof node === "string" ? node : node?.target;
      const target = await chooseTarget(given, "Von welcher Umgebung abmelden?", (entry) => entry.user !== undefined);
      if (target !== undefined) await requireSession(target).logout();
    }),
    vscode.commands.registerCommand("ragents.newRun", () => void chooseNewRun()),
    vscode.commands.registerCommand("ragents.openAppInCenter", (target: string, runId: string, elementId: string, title: string) => {
      panels.open(target, runId, elementId, title, sessions.get(target)?.store?.run(runId)?.title);
    }),
    vscode.commands.registerCommand("ragents.openJournal", async (target: string, runId: string) => {
      const uri = journalUri(target, runId, sessions.get(target)?.store?.run(runId)?.title ?? runId);
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
  await syncTargets();
  await refreshMissingSecrets();
  return {
    sessions: () => [...sessions.values()],
    session: (name) => sessions.get(name),
    targets: snapshots,
    connections: configuredConnections,
    connect: (name) => requireSession(name).connect(),
    disconnect: (name) => closeTarget(name),
    messages: messages.event,
    selectRun: (target, runId) => selectRun(target, runId, { focusPanel: true }),
    newRun: (target, entryId) => newRun(target, entryId),
    applyToken: (target, token) => requireSession(target).useToken(token),
    loginWith: (target, id, password) => requireSession(target).loginWith(id, password),
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
