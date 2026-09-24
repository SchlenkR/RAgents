import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import type { RunPanelHostMessage } from "../../../web/src/run-panel/host-contract";
import { coreContracts } from "../../../server/src/api/contracts";
import { runContracts } from "../../../../packages/ragents/src/http/contracts";
import type { JournalEvent } from "../../../../packages/ragents/src/domain/events";
import { WORKSPACE_BINDING_OPTION_ID, workspaceContracts } from "../../../../plugins/ragents.workspace/contract";
import { actorProgramViews } from "../../../../plugins/ragents.actor-programs/web/program-state";
import { panelState } from "../../src/overview-model";
import type { TargetSession } from "../../src/sessions";
import type { RAgentsApi } from "../../src/extension";

/** Eine verbundene Sitzung samt ihren Teilen; fehlt einer, ist der Test an dieser Stelle zu Ende. */
const parts = (api: RAgentsApi, name: string) => {
  const session: TargetSession | undefined = api.session(name);
  if (!session?.store || !session.client || !session.workspaceClient) throw new Error(`Die Umgebung ${name} ist nicht verbunden`);
  return { session, store: session.store, client: session.client, workspaceClient: session.workspaceClient };
};

const waitFor = async (condition: () => boolean, timeoutMs: number, label: string): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Zeitüberschreitung: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const waitUntil = async <T>(attempt: () => Promise<T | undefined>, timeoutMs: number, label: string, intervalMs: number): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await attempt();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Zeitüberschreitung: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

/** Der Ausgabekanal ist von außen nicht lesbar; der Test schneidet seine Zeilen beim Anlegen des Kanals mit. */
const channelLines: string[] = [];
// Liegt die Erweiterung woanders als der Testläufer (Lauf gegen eine .vsix), bekommt sie eine eigene vscode-API und der Mitschnitt greift nicht.
let channelCaptured = false;
const createOutputChannel = vscode.window.createOutputChannel;
(vscode.window as unknown as { createOutputChannel: unknown }).createOutputChannel = (...args: unknown[]) => {
  const channel = (createOutputChannel as unknown as (...rest: unknown[]) => vscode.OutputChannel)(...args);
  if (args[0] !== "RAgents") return channel;
  channelCaptured = true;
  const appendLine = channel.appendLine.bind(channel);
  Object.defineProperty(channel, "appendLine", { value: (line: string) => { channelLines.push(line); appendLine(line); } });
  return channel;
};

interface ProcessRow {
  pid: number;
  ppid: number;
  command: string;
}

const processRows = (): ProcessRow[] => execFileSync("/bin/ps", ["-Ao", "pid,ppid,command"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  .split("\n")
  .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
  .filter((match): match is RegExpExecArray => match !== null)
  .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), command: match[3]! }));

const ancestorsOf = (rows: readonly ProcessRow[], pid: number): number[] => {
  const chain: number[] = [];
  let current = rows.find((row) => row.pid === pid)?.ppid;
  while (current !== undefined && current > 1 && !chain.includes(current)) {
    chain.push(current);
    current = rows.find((row) => row.pid === current)?.ppid;
  }
  return chain;
};

const matching = (rows: readonly ProcessRow[], needle: string): ProcessRow[] => rows.filter((row) => row.command.includes(needle));

/** Nur Prozesse dieser Testinstanz: Nachfahren des Extension-Hosts, in dem der Test läuft; ein anderer RAgents daneben zählt nicht. */
const ownMatching = (rows: readonly ProcessRow[], needle: string): ProcessRow[] =>
  matching(rows, needle).filter((row) => ancestorsOf(rows, row.pid).includes(process.pid));

/** Die PIDs, die noch laufen; einmal gefundene Prozesse zählen auch, wenn sie inzwischen einen anderen Elternprozess haben. */
const stillRunning = (pids: readonly number[]): number[] => {
  const rows = processRows();
  return pids.filter((pid) => rows.some((row) => row.pid === pid));
};

/** Ob die Umgebung des Prozesses den Marker dieses Runs trägt; macOS zeigt sie mit ps -E, nur für Programme außerhalb des Systems. */
const carriesRun = (pid: number, runId: string): boolean => {
  try {
    return execFileSync("/bin/ps", ["-E", "-ww", "-o", "command=", "-p", String(pid)], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
      .includes(` RAGENTS_RUN_ID=${runId}`);
  } catch (cause) {
    if ((cause as { status?: unknown }).status === 1) return false;
    throw cause;
  }
};

const filesUnder = (directory: string): string[] => existsSync(directory)
  ? readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  })
  : [];

const payloadOf = (event: JournalEvent): Record<string, unknown> => (event as { payload?: Record<string, unknown> }).payload ?? {};

const named = (events: readonly JournalEvent[], type: string): Array<{ event: JournalEvent; payload: Record<string, unknown> }> =>
  events.filter((event) => event.type === type).map((event) => ({ event, payload: payloadOf(event) }));

const toolNames = (events: readonly JournalEvent[], type: string): string[] => named(events, type).map((entry) => String(entry.payload.name));

const TASK = "Lies README.md, ändere in src/greeter.ts die Grußzeile auf 'Hallo aus VS Code',"
  + " lauf einmal ls -1 src, dann typescript_open mit root \".\" und danach typescript_diagnostics ohne paths,"
  + " dann document_write mit einem kurzen Bericht.";

const SLEEP_TASK = "Führe genau einen Werkzeugaufruf aus: bash mit dem Befehl sleep 120. Sonst nichts.";

const SHORT_TASK = "Lies README.md und lauf einmal ls -1 src. Antworte danach mit einem Satz.";

const GREETING = "Hallo aus VS Code";

const EXPECTED_TOOLS = ["read", "edit", "bash", "typescript_open", "typescript_diagnostics", "document_write"];

/** document_write gehört ragents.documents und bleibt im Server; nur diese Werkzeuge laufen im Arbeitsplatz. */
const EXECUTOR_TOOLS = EXPECTED_TOOLS.filter((tool) => tool !== "document_write");

/** Der zweite Pfad: die Erweiterung als Arbeitsplatz mit Bindung client, vom Anmelden bis zum Trennen. */
const checkWorkspaceBinding = async (api: RAgentsApi, target: string, requested: string, report: Record<string, unknown>): Promise<void> => {
  const { store, client, workspaceClient } = parts(api, target);
  const rpc = client.rpc;
  const origin = client.origin;
  const dataDirectory = process.env.DATA_DIR ?? path.join(process.env.HOME ?? "", ".local/share/ragents/developer");
  const journal = (runId: string): Promise<JournalEvent[]> => rpc.call(runContracts.events, { runId }).catch(() => [] as JournalEvent[]);
  const checks: Record<string, unknown> = {};
  report.workspace = checks;

  await waitFor(() => store.status.kind === "connected", 60_000, "die Verbindung steht");
  checks.status = store.status;

  const folder = path.resolve(requested);
  await waitFor(() => workspaceClient.status.kind === "registered" && workspaceClient.folders.some((entry) => path.resolve(entry) === folder),
    60_000, `der Arbeitsplatz meldet ${folder} an`);
  const registered = await rpc.call(workspaceContracts.clients.list, {});
  checks.clientId = workspaceClient.id;
  checks.clients = registered;
  const mine = registered.filter((entry) => entry.id === workspaceClient.id);
  if (registered.length !== 1 || mine.length !== 1) throw new Error(`Erwartet war genau ein angemeldeter Arbeitsplatz, angemeldet sind ${registered.length}`);
  if (!mine[0]!.folders.some((entry) => path.resolve(entry) === folder)) throw new Error(`Der angemeldete Arbeitsplatz bietet ${folder} nicht an`);

  const binding = workspaceClient.binding(workspaceClient.folders.find((entry) => path.resolve(entry) === folder)!);
  const runId = crypto.randomUUID();
  const sendErrors: string[] = [];
  checks.binding = binding;
  checks.runId = runId;
  checks.sendErrors = sendErrors;
  await rpc.call(coreContracts.startOptions.select, { runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: binding });
  void rpc.call(coreContracts.chat.send, { runId, text: TASK }).catch((cause: unknown) => sendErrors.push(String(cause)));

  const greeterFile = path.join(folder, "src/greeter.ts");
  const before = readFileSync(greeterFile, "utf8");
  const finished = await waitUntil(async () => {
    const events = await journal(runId);
    const turnId = named(events, "turn.started")[0]?.payload.turnId;
    if (turnId === undefined) return undefined;
    const done = [...named(events, "turn.finished"), ...named(events, "turn.interrupted")].some((entry) => entry.payload.turnId === turnId);
    return done ? events : undefined;
  }, 300_000, "der erste Turn ist fertig", 2000);
  checks.firstTurn = {
    events: finished.length,
    completed: toolNames(finished, "tool.call.completed"),
    failed: named(finished, "tool.call.failed").map((entry) => ({ name: entry.payload.name, error: String(entry.payload.error).slice(0, 200) })),
    answer: named(finished, "model.output.completed").map((entry) => String(entry.payload.text).slice(0, 400)),
  };

  const completed = new Set(toolNames(finished, "tool.call.completed"));
  const missing = EXPECTED_TOOLS.filter((tool) => !completed.has(tool));
  checks.missingTools = missing;
  if (missing.length > 0) throw new Error(`Diese Werkzeuge fehlen als tool.call.completed: ${missing.join(", ")}`);

  const greeter = readFileSync(greeterFile, "utf8");
  checks.greeter = { before: before.split("\n")[0], after: greeter.split("\n")[0] };
  if (!greeter.includes(GREETING)) throw new Error(`Die Grußzeile in ${greeterFile} trägt ${GREETING} nicht`);

  const serverFiles = [...filesUnder(path.join(dataDirectory, "sessions", runId)), ...filesUnder(path.join(dataDirectory, "runs", runId))];
  const strays = serverFiles.filter((file) => path.basename(file) === "greeter.ts");
  checks.serverRunFiles = { root: dataDirectory, count: serverFiles.length, strays };
  if (strays.length > 0) throw new Error(`Der Serverordner des Runs trägt Projektdateien: ${strays.join(", ")}`);

  const diagnosticsStart = named(finished, "tool.call.started")
    .filter((entry) => entry.payload.name === "typescript_diagnostics")
    .find((entry) => (entry.payload.input as Record<string, unknown> | undefined)?.paths === undefined);
  if (!diagnosticsStart) throw new Error("Es gibt keinen Aufruf von typescript_diagnostics ohne paths");
  const diagnostics = named(finished, "tool.call.completed").find((entry) => entry.payload.toolCallId === diagnosticsStart.payload.toolCallId);
  const diagnosticsText = String(diagnostics?.payload.output ?? "");
  checks.diagnostics = { sequence: diagnosticsStart.event.sequence, output: diagnosticsText.slice(0, 600) };
  // Ohne paths prüft das Werkzeug die laut Git geänderten Dateien; nach dieser Aufgabe ist das src/greeter.ts.
  if (!/greeter\.ts/.test(diagnosticsText)) throw new Error("typescript_diagnostics ohne paths meldet die geänderte src/greeter.ts nicht");

  const prefix = `== ${runId.slice(0, 8)} `;
  const logged = channelLines.filter((line) => line.startsWith(prefix));
  const unlogged = EXECUTOR_TOOLS.filter((tool) => !logged.some((line) => line.startsWith(`${prefix}${tool} `)));
  checks.outputChannel = channelCaptured
    ? { lines: logged.length, missing: unlogged, sample: logged.slice(0, 12) }
    : { captured: false, reason: "Die Erweiterung läuft aus einer eigenen vscode-API; ihr Ausgabekanal ist von hier nicht mitzuschneiden" };
  if (channelCaptured) {
    if (logged.length === 0) throw new Error("Der Ausgabekanal RAgents trägt keine Zeile zu diesem Run");
    if (unlogged.length > 0) throw new Error(`Der Ausgabekanal RAgents nennt diese Werkzeuge nicht: ${unlogged.join(", ")}`);
  }

  const rows = processRows();
  const servers = ownMatching(rows, "typescript-language-server");
  checks.extensionHostPid = process.pid;
  checks.languageServers = servers.map((row) => ({ pid: row.pid, ppid: row.ppid, ancestors: ancestorsOf(rows, row.pid), command: row.command.slice(0, 200) }));
  if (servers.length === 0) throw new Error(`Am Extension-Host ${process.pid} läuft kein typescript-language-server`);
  const foreign = matching(rows, "typescript-language-server")
    .filter((row) => !servers.some((own) => own.pid === row.pid) && carriesRun(row.pid, runId));
  if (foreign.length > 0) throw new Error(`Diese Sprachserver des Runs hängen nicht am Extension-Host ${process.pid}: ${foreign.map((row) => row.pid).join(", ")}`);

  void rpc.call(coreContracts.chat.send, { runId, text: SLEEP_TASK }).catch((cause: unknown) => sendErrors.push(String(cause)));
  const sleeping = await waitUntil(async () => {
    const running = ownMatching(processRows(), "sleep 120").map((row) => row.pid);
    return running.length > 0 ? running : undefined;
  }, 240_000, "der Befehl sleep 120 läuft", 500);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const stopStarted = Date.now();
  const stopOutcome = await rpc.call(coreContracts.chat.stop, { runId })
    .then(() => "ok", (cause: unknown) => cause instanceof Error ? cause.message : String(cause));
  const stopDurationMs = Date.now() - stopStarted;
  checks.stopCall = { outcome: stopOutcome, durationMs: stopDurationMs };
  const stopped = await waitUntil(async () => {
    const events = await journal(runId);
    checks.lastEvents = events.slice(-12).map((event) => event.type);
    const started = named(events, "tool.call.started").findLast((entry) => entry.payload.name === "bash");
    const interrupted = started && named(events, "turn.interrupted").find((entry) => entry.event.sequence > started.event.sequence);
    return started && interrupted ? { started, interrupted, events } : undefined;
  }, 120_000, "der abgebrochene bash-Aufruf endet mit der Unterbrechung seines Turns", 1000);
  await waitFor(() => stillRunning(sleeping).length === 0, 30_000, "der Prozess sleep 120 ist weg");
  checks.abort = {
    stopCall: { outcome: stopOutcome, durationMs: stopDurationMs },
    sleepPids: sleeping,
    sequence: stopped.started.event.sequence,
    interrupted: { sequence: stopped.interrupted.event.sequence, reason: String(stopped.interrupted.payload.reason).slice(0, 300) },
  };

  await api.disconnect(target);
  await waitFor(() => api.session(target)?.status.kind === "stopped", 30_000, "das Trennen beendet die Sitzung");
  const response = await fetch(`${origin}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: workspaceContracts.clients.list.id, params: {} }),
  });
  const remaining = await response.json() as { result?: Array<{ id: string }> };
  const left = remaining.result ?? [];
  checks.clientsAfterDisconnect = left;
  if (left.some((entry) => entry.id === workspaceClient.id)) throw new Error("Nach dem Trennen steht der Arbeitsplatz noch in der Liste");
  await waitFor(() => stillRunning(servers.map((row) => row.pid)).length === 0, 60_000, "die Sprachserver sind beendet");
  checks.languageServersAfterDisconnect = 0;
  checks.channel = channelLines.filter((line) => line.startsWith(prefix));
  if (stopOutcome !== "ok") throw new Error(`ragents.chat.stop über die Verbindung der Sitzung scheiterte nach ${stopDurationMs} ms: ${stopOutcome}`);
};

/** Die Kachel, die der Kachel-Klick der Übersicht nimmt: ein Run-Script ohne Leitfaden startet ohne Modellantwort. */
const TILE_ENTRY = "ragents.reference.moderated-round";

/** Der dritte Pfad: zwei Umgebungen gleichzeitig, ein Kachel-Klick, ein neuer Run auf der zweiten und ein Trennen, das nur eine trifft. */
const checkTwoTargets = async (api: RAgentsApi, first: string, second: string, requested: string,
  seen: ReadonlyArray<{ target: string; message: RunPanelHostMessage }>, report: Record<string, unknown>): Promise<void> => {
  const checks: Record<string, unknown> = {};
  report.twoTargets = checks;
  const folder = path.resolve(requested);

  await waitFor(() => api.targets().length === 2 && api.targets().every((target) => target.status.kind === "connected"),
    120_000, "beide Umgebungen sind verbunden");
  // Das Client-Profil je Umgebung bringt Produkt und Startvorlagen; das Entwicklerprofil selbst bringt keine Vorlagen mit.
  await waitFor(() => [first, second].every((name) => parts(api, name).store.product !== undefined), 60_000, "beide Umgebungen haben ihr Profil geladen");
  checks.products = Object.fromEntries([first, second].map((name) => [name, { product: parts(api, name).store.product, entries: parts(api, name).store.startEntries.length }]));
  const overview = panelState({ theme: "dark", page: "start", targets: api.targets(), profileSuggestions: [], missingSecrets: [], problem: undefined, pickedProfileFile: undefined, runsEnvironment: undefined });
  checks.overview = overview.targets.map((target) => ({
    name: target.name, kind: target.kind, state: target.state.kind, runs: target.runs.length, entries: target.entries.length, canCreate: target.canCreate,
  }));
  if (overview.targets.length !== 2) throw new Error(`Die Übersicht zeigt ${overview.targets.length} Umgebungen statt zwei`);
  for (const target of overview.targets) {
    if (target.state.kind !== "connected") throw new Error(`Die Umgebung ${target.name} steht als ${target.state.kind} in der Übersicht`);
    if (!target.canCreate) throw new Error(`Die Umgebung ${target.name} erlaubt keine neuen Runs`);
  }

  // Der Arbeitsplatz dieses Fensters meldet sich bei beiden Servern mit derselben Kennung an.
  const registrations: Record<string, unknown> = {};
  checks.workspaceClients = registrations;
  for (const name of [first, second]) {
    const { client, workspaceClient } = parts(api, name);
    await waitFor(() => workspaceClient.status.kind === "registered" && workspaceClient.folders.some((entry) => path.resolve(entry) === folder),
      60_000, `der Arbeitsplatz meldet sich bei ${name} an`);
    const registered = await client.rpc.call(workspaceContracts.clients.list, {});
    registrations[name] = { id: workspaceClient.id, clients: registered.map((entry) => ({ id: entry.id, folders: entry.folders })) };
    if (!registered.some((entry) => entry.id === workspaceClient.id)) throw new Error(`Der Arbeitsplatz steht bei ${name} nicht in der Registry`);
  }

  // Ein Klick auf eine Kachel der Übersicht: die Erweiterung legt den Run auf seiner Umgebung an, das Run-Panel startet ihn und meldet ihn zurück.
  const tileTarget = [second, first].find((name) => parts(api, name).store.startEntries.length > 0);
  if (tileTarget === undefined) {
    // Das Entwicklerprofil bringt keine Vorlagen mit; die Kachel prüft der Lauf gegen eine Umgebung, die welche hat.
    checks.tile = { skipped: "Keine der beiden Umgebungen bietet eine Startvorlage an" };
  } else {
    const tiles = parts(api, tileTarget).store.startEntries;
    const tile = tiles.find((entry) => entry.id === TILE_ENTRY) ?? tiles.find((entry) => entry.action === "script") ?? tiles[0]!;
    checks.tile = { target: tileTarget, available: tiles.length, chosen: tile.id, category: tile.category };
    const before = seen.length;
    await api.panelAction({ action: "newRun", name: tileTarget, entryId: tile.id });
    const started = await waitUntil(async () => seen.slice(before)
      .find((entry) => entry.target === tileTarget && entry.message.type === "runChanged" && entry.message.runId !== null),
    180_000, "das Run-Panel meldet den Run der Kachel", 500);
    const tileRunId = (started.message as Extract<RunPanelHostMessage, { type: "runChanged" }>).runId!;
    await waitFor(() => api.targets().find((target) => target.connection.name === tileTarget)?.runs.some((run) => run.id === tileRunId) === true,
      120_000, "der Run der Kachel steht in der Übersicht");
    const tileEvents = await parts(api, tileTarget).client.rpc.call(runContracts.events, { runId: tileRunId }).catch(() => [] as JournalEvent[]);
    checks.tileRun = {
      runId: tileRunId,
      events: tileEvents.length,
      actors: named(tileEvents, "actor.spawned").map((entry) => String(entry.payload.handle ?? entry.payload.actorId)),
      title: api.targets().find((target) => target.connection.name === tileTarget)?.runs.find((run) => run.id === tileRunId)?.title,
    };
    if (tileEvents.length === 0) throw new Error("Der Run der Kachel hat kein Journal");

    // Das Plus einer Umgebung legt einen leeren Run an: dasselbe newRun ohne entryId, der Auftrag entsteht im Chat.
    const beforePlus = seen.length;
    await api.panelAction({ action: "newRun", name: tileTarget });
    const plus = await waitUntil(async () => seen.slice(beforePlus)
      .find((entry) => entry.target === tileTarget && entry.message.type === "runChanged"
        && entry.message.runId !== null && entry.message.runId !== tileRunId),
    120_000, "das Plus der Umgebung öffnet einen leeren Run", 500);
    checks.newChat = { target: tileTarget, runId: (plus.message as Extract<RunPanelHostMessage, { type: "runChanged" }>).runId };

    // Der Zurück-Pfeil des Run-Panels führt immer auf die Start-Seite; die Hülle schaltet dafür die Seite um.
    api.selectRun(tileTarget, tileRunId);
    checks.pageWithRun = api.panel().page;
    if (api.panel().page !== "run") throw new Error(`Mit geöffnetem Run steht die Seite auf ${api.panel().page} statt auf run`);
    await vscode.commands.executeCommand("ragents.showStart");
    checks.pageAfterBack = api.panel().page;
    if (api.panel().page !== "start") throw new Error(`Der Weg zurück führt auf ${api.panel().page} statt auf start`);

    // Die Seite Runs löscht die Auswahl über den Host; die Liste zeigt danach nur noch, was übrig ist.
    await api.panelAction({ action: "deleteRuns", name: tileTarget, runIds: [tileRunId] });
    await waitFor(() => api.targets().find((target) => target.connection.name === tileTarget)?.runs.some((run) => run.id === tileRunId) === false,
      60_000, "der gelöschte Run ist aus der Liste verschwunden");
    checks.deletedRun = { runId: tileRunId, left: api.targets().find((target) => target.connection.name === tileTarget)?.runs.length };
  }

  // Ein neuer Run auf der zweiten Umgebung mit Bindung client: read und bash laufen hier, nicht auf dem Server.
  const { client: secondClient } = parts(api, second);
  const secondWorkspace = parts(api, second).workspaceClient;
  const binding = secondWorkspace.binding(secondWorkspace.folders.find((entry) => path.resolve(entry) === folder)!);
  const runId = crypto.randomUUID();
  const sendErrors: string[] = [];
  checks.runId = runId;
  checks.binding = binding;
  checks.sendErrors = sendErrors;
  await secondClient.rpc.call(coreContracts.startOptions.select, { runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: binding });
  void secondClient.rpc.call(coreContracts.chat.send, { runId, text: SHORT_TASK }).catch((cause: unknown) => sendErrors.push(String(cause)));
  const finished = await waitUntil(async () => {
    const events = await secondClient.rpc.call(runContracts.events, { runId }).catch(() => [] as JournalEvent[]);
    const turnId = named(events, "turn.started")[0]?.payload.turnId;
    if (turnId === undefined) return undefined;
    const done = [...named(events, "turn.finished"), ...named(events, "turn.interrupted")].some((entry) => entry.payload.turnId === turnId);
    return done ? events : undefined;
  }, 300_000, "der Run auf dem zweiten Ziel ist fertig", 2000);
  const completed = new Set(toolNames(finished, "tool.call.completed"));
  checks.turn = {
    events: finished.length,
    completed: [...completed],
    failed: named(finished, "tool.call.failed").map((entry) => ({ name: entry.payload.name, error: String(entry.payload.error).slice(0, 200) })),
  };
  const missing = ["read", "bash"].filter((tool) => !completed.has(tool));
  if (missing.length > 0) throw new Error(`Auf der zweiten Umgebung fehlen diese Werkzeuge: ${missing.join(", ")}`);
  const logged = channelLines.filter((line) => line.startsWith(`== ${runId.slice(0, 8)} `));
  checks.outputChannel = channelCaptured ? logged.slice(0, 8) : { captured: false };
  if (channelCaptured && !logged.some((line) => line.includes(" bash "))) throw new Error("Der Ausgabekanal nennt den bash-Aufruf des Arbeitsplatzes nicht");
  await waitFor(() => api.targets().find((target) => target.connection.name === second)?.runs.some((run) => run.id === runId) === true,
    60_000, "der neue Run steht in der Übersicht der zweiten Umgebung");

  // Trennen der ersten Umgebung lässt die zweite unberührt.
  await api.disconnect(first);
  await waitFor(() => api.session(first)?.status.kind === "stopped", 30_000, "die erste Umgebung ist getrennt");
  const afterFirst = await parts(api, second).client.rpc.call(workspaceContracts.clients.list, {});
  checks.afterDisconnect = {
    first: api.session(first)?.status,
    second: api.session(second)?.status,
    clientsAtSecond: afterFirst.map((entry) => entry.id),
    overview: api.targets().map((target) => ({ name: target.connection.name, state: target.status.kind, runs: target.runs.length })),
  };
  if (api.session(second)?.status.kind !== "connected") throw new Error("Das Trennen der ersten Umgebung hat auch die zweite getroffen");
  if (!afterFirst.some((entry) => entry.id === secondWorkspace.id)) throw new Error("Der Arbeitsplatz ist bei der zweiten Umgebung verschwunden");
};

/** Der vierte Pfad: die Einstellungsseite, mit denselben Aktionen, die das Webview schickt. */
const checkSettings = async (api: RAgentsApi, serverUrl: string, profileFile: string, report: Record<string, unknown>): Promise<void> => {
  const checks: Record<string, unknown> = {};
  report.settings = checks;
  const view = (name: string) => api.panel().targets.find((target) => target.name === name);
  const names = () => api.panel().targets.map((target) => target.name);

  checks.start = { page: api.panel().page, targets: names(), connections: api.connections() };
  if (api.panel().targets.length !== 0) throw new Error(`Der Lauf beginnt mit ${api.panel().targets.length} Umgebungen statt ohne`);
  if (api.panel().page !== "start") throw new Error(`Die Erweiterung beginnt auf ${api.panel().page} statt auf der Start-Seite`);
  for (const page of ["runs", "environments", "start"] as const) {
    await api.panelAction({ action: "page", page });
    if (api.panel().page !== page) throw new Error(`Die Aktion page führt nicht auf ${page}`);
  }

  await api.panelAction({ action: "page", page: "environments" });
  checks.page = api.panel().page;
  if (api.panel().page !== "environments") throw new Error("Die Aktion page führt nicht auf die Seite Umgebungen");
  const focusable = await vscode.commands.getCommands(true);
  checks.revealCommand = focusable.includes("ragents.runPanel.focus");
  if (!checks.revealCommand) throw new Error("Den Befehl ragents.runPanel.focus gibt es nicht; das Panel lässt sich nicht von selbst öffnen");
  await vscode.commands.executeCommand("ragents.runPanel.focus");

  await api.panelAction({ action: "addServer", name: "selbsttest", url: serverUrl });
  await waitFor(() => view("selbsttest") !== undefined, 15_000, "der neue Server steht in der Übersicht");
  checks.addServer = { connections: api.connections(), targets: names(), problem: api.panel().problem };
  if (api.panel().problem !== undefined) throw new Error(`Der neue Server meldet ${String(api.panel().problem)}`);
  await waitFor(() => view("selbsttest")?.state.kind === "connected", 60_000, "der neue Server ist verbunden");
  checks.serverConnected = view("selbsttest");

  await api.panelAction({ action: "addServer", name: "selbsttest", url: serverUrl });
  checks.duplicateName = { problem: api.panel().problem, targets: names(), connections: api.connections().length };
  if (api.panel().problem === undefined) throw new Error("Ein doppelter Name kommt ohne Meldung durch");
  if (api.connections().length !== 1) throw new Error("Der doppelte Name steht trotz Meldung in der Einstellung");

  await api.panelAction({ action: "addServer", name: "ohne-schema", url: "localhost:4715" });
  checks.badUrl = { problem: api.panel().problem, targets: names() };
  if (view("ohne-schema") !== undefined) throw new Error("Eine Adresse ohne http kommt als Ziel durch");

  // Ein lokales Profil startet die Erweiterung von selbst; "nicht gestartet" gibt es nicht mehr.
  await api.panelAction({ action: "addProfile", name: "profil", profileFile });
  await waitFor(() => view("profil") !== undefined, 15_000, "das neue Profil steht in der Übersicht");
  checks.addProfile = { connections: api.connections(), state: view("profil")?.state.kind, problem: api.panel().problem };
  if (view("profil")?.state.kind === "stopped") throw new Error("Das neue Profil steht als nicht gestartet statt still zu starten");
  await api.panelAction({ action: "stopProfile", name: "profil" });
  await waitFor(() => view("profil")?.state.kind === "stopped", 60_000, "der stille Start des Profils ist wieder beendet");

  // Bearbeiten ersetzt die Umgebung an ihrer Stelle; die Anmeldedaten hängen an der Adresse und überleben das Umbenennen.
  await api.panelAction({ action: "updateServer", name: "selbsttest", newName: "selbsttest-neu", url: serverUrl });
  await waitFor(() => view("selbsttest-neu") !== undefined && view("selbsttest") === undefined, 15_000, "die umbenannte Umgebung steht in der Übersicht");
  checks.updateServer = { connections: api.connections(), targets: names(), problem: api.panel().problem };
  if (api.panel().problem !== undefined) throw new Error(`Das Bearbeiten meldet ${String(api.panel().problem)}`);
  await api.panelAction({ action: "updateServer", name: "selbsttest-neu", newName: "selbsttest", url: serverUrl });
  await waitFor(() => view("selbsttest") !== undefined, 15_000, "der alte Name ist zurück");

  await api.panelAction({ action: "updateProfile", name: "profil", newName: "profil", profileFile: path.join(path.dirname(profileFile), "ragents.config.gibtesauchnicht.ts") });
  checks.updateProfileMissing = { problem: api.panel().problem, view: view("profil") };
  if (api.panel().problem === undefined) throw new Error("Eine Profildatei, die es nicht gibt, kommt beim Bearbeiten ohne Meldung durch");
  if (view("profil")?.address !== path.resolve(profileFile)) throw new Error(`Das abgelehnte Bearbeiten hat die Umgebung auf ${String(view("profil")?.address)} geändert`);

  checks.profileSuggestions = api.panel().profileSuggestions;
  if (!Array.isArray(api.panel().profileSuggestions)) throw new Error("Die Vorschlagsliste der Profile fehlt im Zustand der Seite");

  await api.panelAction({ action: "addProfile", name: "falsch-benannt", profileFile: path.join(path.dirname(profileFile), "beliebig.ts") });
  checks.badProfileName = { problem: api.panel().problem, present: view("falsch-benannt") !== undefined };
  if (view("falsch-benannt") !== undefined || api.panel().problem === undefined) throw new Error("Eine falsch benannte Profildatei kommt ohne Meldung durch");

  const missing = path.join(path.dirname(profileFile), "ragents.config.gibtesnicht.ts");
  await api.panelAction({ action: "addProfile", name: "fehlende-datei", profileFile: missing });
  checks.missingProfileFile = { problem: api.panel().problem, present: view("fehlende-datei") !== undefined };
  if (view("fehlende-datei") !== undefined) throw new Error("Eine Profildatei, die es nicht gibt, kommt als Ziel durch");
  if (api.panel().problem === undefined) throw new Error("Eine Profildatei, die es nicht gibt, bleibt ohne Meldung in der Seite");

  // Ein relativer Pfad löst sich gegen das Arbeitsverzeichnis des Extension-Hosts auf; die Meldung nennt deshalb den vollen Pfad.
  await api.panelAction({ action: "addProfile", name: "relativ", profileFile: "ragents.config.developer.ts" });
  checks.relativeProfileFile = { cwd: process.cwd(), problem: api.panel().problem, view: view("relativ") };
  if (view("relativ") !== undefined) await api.panelAction({ action: "remove", name: "relativ" });
  else if (!/^Die Profildatei \//.test(String(api.panel().problem))) throw new Error(`Die Meldung nennt den aufgelösten Pfad nicht: ${String(api.panel().problem)}`);

  // Ohne Checkout holt die Erweiterung den Host als Paket und startet das lokale Profil daraus; die .tgz kommt aus RAGENTS_HOST_PACKAGE_SPEC.
  if (process.env.RAGENTS_HOST_PACKAGE_SPEC) {
    await api.panelAction({ action: "startProfile", name: "profil" });
    await waitFor(() => ["connected", "failed"].includes(view("profil")?.state.kind ?? ""), 900_000, "das lokale Profil kommt aus dem geholten Host-Paket hoch");
    const started = view("profil")?.state;
    checks.startFromPackage = { state: started, host: channelLines.filter((line) => line.includes("Host-Paket") || line.includes("Host läuft")) };
    if (started?.kind !== "failed" && started?.kind !== "connected") throw new Error(`Das lokale Profil steht als ${String(started?.kind)}`);
    if (started.kind === "failed") throw new Error(`Das lokale Profil aus dem Paket ist gescheitert: ${started.message}`);
    await api.panelAction({ action: "stopProfile", name: "profil" });
    await waitFor(() => view("profil")?.state.kind === "stopped", 60_000, "das lokale Profil ist wieder gestoppt");
  } else {
    checks.startFromPackage = { skipped: "Ohne RAGENTS_HOST_PACKAGE_SPEC würde die Erweiterung das veröffentlichte Paket holen" };
  }

  // Der Dateidialog gehört VS Code; nur wenn die Erweiterung dieselbe vscode-API hat wie der Testläufer, lässt er sich hier belegen.
  if (channelCaptured) {
    const original = vscode.window.showOpenDialog;
    (vscode.window as unknown as { showOpenDialog: unknown }).showOpenDialog = () => Promise.resolve([vscode.Uri.file(profileFile)]);
    try {
      await api.panelAction({ action: "pickProfile" });
    } finally {
      (vscode.window as unknown as { showOpenDialog: unknown }).showOpenDialog = original;
    }
    checks.pickProfile = { picked: api.panel().pickedProfileFile };
    if (api.panel().pickedProfileFile !== profileFile) throw new Error(`Der Dateidialog gibt ${String(api.panel().pickedProfileFile)} statt ${profileFile} in das Formular`);
  } else {
    checks.pickProfile = { captured: false, reason: "Die Erweiterung läuft aus einer eigenen vscode-API; ihr Dateidialog ist von hier nicht zu belegen" };
  }

  // Ein Server ohne Benutzer nimmt keine Anmeldedaten an; der Grund gehört in die Zeile der Umgebung.
  await api.panelAction({ action: "login", name: "selbsttest", user: "niemand", password: "egal" });
  checks.login = { problem: view("selbsttest")?.problem, state: view("selbsttest")?.state.kind, savedLogin: view("selbsttest")?.savedLogin ?? false };
  if (view("selbsttest")?.problem === undefined) throw new Error("Die Anmeldung gegen einen Server ohne Benutzer bleibt ohne Meldung in der Seite");
  await api.panelAction({ action: "logout", name: "selbsttest" });
  checks.afterLogout = { problem: view("selbsttest")?.problem, savedLogin: view("selbsttest")?.savedLogin ?? false, state: view("selbsttest")?.state.kind };
  if (view("selbsttest")?.savedLogin === true) throw new Error("Nach dem Löschen stehen die Anmeldedaten noch gespeichert");

  await api.panelAction({ action: "settingsFile" });
  checks.settingsFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? "kein Editor";
  if (!/settings\.json$/.test(String(checks.settingsFile))) throw new Error(`Die Einstellung öffnet ${String(checks.settingsFile)} statt der settings.json`);

  for (const name of ["profil", "selbsttest"]) {
    await api.panelAction({ action: "remove", name });
    await waitFor(() => view(name) === undefined, 15_000, `die Umgebung ${name} ist entfernt`);
  }
  checks.afterRemove = { targets: names(), connections: api.connections() };
  if (api.connections().length !== 0) throw new Error(`Nach dem Entfernen stehen noch ${api.connections().length} Umgebungen in ragents.connections`);
};

/** Läuft im Extension-Host eines echten VS Code gegen einen laufenden Server; tests/host/launch.mjs startet ihn. */
export async function run(): Promise<void> {
  const report: Record<string, unknown> = {};
  const output = process.env.RAGENTS_HOST_TEST_OUTPUT;
  try {
    const extension = vscode.extensions.getExtension<RAgentsApi>("purestate.ragents-vscode");
    if (!extension) throw new Error("Die Erweiterung purestate.ragents-vscode ist nicht geladen.");
    report.alreadyActive = extension.isActive;
    const api = await extension.activate();
    const seen: Array<{ target: string; message: RunPanelHostMessage }> = [];
    api.messages((entry) => seen.push(entry));
    if (process.env.RAGENTS_HOST_TEST_SETTINGS) {
      // Vierter Testpfad: die Einstellungsseite legt Umgebungen an, meldet Fehler und entfernt wieder.
      await checkSettings(api, process.env.RAGENTS_HOST_TEST_SERVER ?? "http://localhost:4710", process.env.RAGENTS_HOST_TEST_PROFILE ?? "", report);
      report.ok = true;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2));
      return;
    }
    const primary = "test";
    const secondary = process.env.RAGENTS_HOST_TEST_SECOND ? "zweit" : undefined;
    // Jede konfigurierte Umgebung verbindet sich beim Aktivieren von selbst.
    const configured = secondary ? [primary, secondary] : [primary];
    await waitFor(() => api.targets().length === configured.length, 30_000, "die Umgebungen stehen");
    for (const name of configured) await waitFor(() => api.session(name)?.client !== undefined, 60_000, `die Sitzung von ${name} steht`);
    report.targets = api.targets().map((target) => ({ name: target.connection.name, kind: target.connection.kind, url: target.url }));
    const workspace = process.env.RAGENTS_HOST_TEST_WORKSPACE;
    if (workspace && secondary) {
      // Dritter Testpfad: zwei Umgebungen gleichzeitig, Kachel-Klick, ein neuer Run auf der zweiten, ein Trennen, das nur eine trifft.
      await checkTwoTargets(api, primary, secondary, workspace, seen, report);
      report.ok = true;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2));
      return;
    }
    const token = process.env.RAGENTS_HOST_TEST_TOKEN;
    if (token) {
      await waitFor(() => api.session(primary)?.status.kind === "login-required", 15_000, "Server verlangt einen Zugangstoken");
      report.tokenGate = api.session(primary)?.status;
      await api.applyToken(primary, token);
    }
    const login = process.env.RAGENTS_HOST_TEST_LOGIN;
    if (login) {
      await waitFor(() => api.session(primary)?.status.kind === "login-required", 15_000, "Server verlangt eine Anmeldung");
      report.loginRequired = api.session(primary)?.status;
      const [id, password] = login.split(":", 2);
      await api.loginWith(primary, id ?? "", password ?? "");
      report.user = parts(api, primary).store.user;
    }
    if (workspace) {
      // Zweiter Testpfad: der Arbeitsbereich des Fensters wird als Arbeitsplatz angeboten und ein Run mit Bindung client geprüft.
      await checkWorkspaceBinding(api, primary, workspace, report);
      report.ok = true;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2));
      return;
    }
    await vscode.commands.executeCommand("workbench.view.extension.ragents-run-panel");
    await vscode.commands.executeCommand("ragents.runPanel.focus");
    const { store, client } = parts(api, primary);
    await waitFor(() => store.status.kind === "connected", 240_000, "Verbindung");
    report.status = store.status;
    const runs = await Promise.all(store.runs.map(async (run) => ({ run,
      apps: actorProgramViews(await client.rpc.call(runContracts.view, { runId: run.id })).filter((entry) => entry.app.visible !== false) })));
    report.runs = runs.map(({ run, apps }) => ({ id: run.id, title: run.title, state: run.state, apps: apps.map((app) => app.id), pendingActions: run.pendingActions }));
    report.entries = store.startEntries.map((entry) => entry.id);
    if (store.runs.length === 0) {
      // Ein frisch gestarteter Host hat noch keine Runs; Verbindung, Übersicht und Trennen sind dann die Prüfung.
      await api.disconnect(primary);
      await waitFor(() => api.session(primary)?.status.kind === "stopped", 15_000, "Trennen beendet die Sitzung");
      report.disconnected = true;
      report.messages = seen;
      report.ok = true;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2));
      return;
    }
    const { run, apps } = runs.find((entry) => entry.apps.length > 0) ?? runs[0]!;
    api.selectRun(primary, run.id);
    await waitFor(() => seen.some((entry) => entry.target === primary && entry.message.type === "ready"), 30_000, "Panel meldet ready");
    await waitFor(() => seen.some((entry) => entry.message.type === "runChanged" && entry.message.runId === run.id), 15_000, "Panel übernimmt den Run");
    const app = apps[0];
    if (app) {
      await vscode.commands.executeCommand("ragents.openAppInCenter", primary, run.id, app.id, app.title);
      await waitFor(() => seen.filter((entry) => entry.message.type === "ready").length >= 2, 30_000, "Mini-App in der Mitte meldet ready");
      report.centerApp = app.id;
    }
    report.messages = seen;
    report.ok = true;
  } catch (cause) {
    report.ok = false;
    report.error = cause instanceof Error ? cause.message : String(cause);
  }
  if (output) writeFileSync(output, JSON.stringify(report, null, 2));
  if (report.ok !== true) throw new Error(String(report.error));
}
