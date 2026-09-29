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
import type { ConnectionSession } from "../../src/sessions";
import type { RAgentsApi } from "../../src/extension";

/** A connected session with its parts; if one is missing, the test ends at this point. */
const parts = (api: RAgentsApi, name: string) => {
  const session: ConnectionSession | undefined = api.session(name);
  if (!session?.store || !session.client || !session.workspaceClient) throw new Error(`The server ${name} is not connected`);
  return { session, store: session.store, client: session.client, workspaceClient: session.workspaceClient };
};

const waitFor = async (condition: () => boolean, timeoutMs: number, label: string): Promise<void> => {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

const waitUntil = async <T>(attempt: () => Promise<T | undefined>, timeoutMs: number, label: string, intervalMs: number): Promise<T> => {
  const started = Date.now();
  for (;;) {
    const value = await attempt();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`Timeout: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

/** The output channel cannot be read from outside; the test records its lines when the channel is created. */
const channelLines: string[] = [];
// If the extension lives elsewhere than the test runner (a test against a .vsix), it gets its own vscode API and the recording does not apply.
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

/** Only processes of this test instance: descendants of the extension host the test runs in; another RAgents next to it does not count. */
const ownMatching = (rows: readonly ProcessRow[], needle: string): ProcessRow[] =>
  matching(rows, needle).filter((row) => ancestorsOf(rows, row.pid).includes(process.pid));

/** The PIDs that are still running; processes found once also count if they have a different parent process by now. */
const stillRunning = (pids: readonly number[]): number[] => {
  const rows = processRows();
  return pids.filter((pid) => rows.some((row) => row.pid === pid));
};

/** Whether the environment of the process carries the marker of this run; macOS shows it with ps -E, only for programs outside the system. */
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

const TASK = "Read README.md, change the greeting line in src/greeter.ts to 'Hello from VS Code',"
  + " run ls -1 src once, then typescript_open with root \".\" and afterwards typescript_diagnostics without paths,"
  + " then document_write with a short report.";

const SLEEP_TASK = "Make exactly one tool call: bash with the command sleep 120. Nothing else.";

const SHORT_TASK = "Read README.md and run ls -1 src once. Then answer with one sentence.";

const GREETING = "Hello from VS Code";

const EXPECTED_TOOLS = ["read", "edit", "bash", "typescript_open", "typescript_diagnostics", "document_write"];

/** document_write belongs to ragents.documents and stays in the server; only these tools run in the workspace. */
const EXECUTOR_TOOLS = EXPECTED_TOOLS.filter((tool) => tool !== "document_write");

/** The second path: the extension as a workspace with client binding, from registration to disconnect. */
const checkWorkspaceBinding = async (api: RAgentsApi, connection: string, requested: string, report: Record<string, unknown>): Promise<void> => {
  const { store, client, workspaceClient } = parts(api, connection);
  const rpc = client.rpc;
  const origin = client.origin;
  const dataDirectory = process.env.DATA_DIR ?? path.join(process.env.HOME ?? "", ".local/share/ragents/developer");
  const journal = (runId: string): Promise<JournalEvent[]> => rpc.call(runContracts.events, { runId }).catch(() => [] as JournalEvent[]);
  const checks: Record<string, unknown> = {};
  report.workspace = checks;

  await waitFor(() => store.status.kind === "connected", 60_000, "the connection is up");
  checks.status = store.status;

  const folder = path.resolve(requested);
  await waitFor(() => workspaceClient.status.kind === "registered" && workspaceClient.folders.some((entry) => path.resolve(entry) === folder),
    60_000, `the workspace registers ${folder}`);
  const registered = await rpc.call(workspaceContracts.clients.list, {});
  checks.clientId = workspaceClient.id;
  checks.clients = registered;
  const mine = registered.filter((entry) => entry.id === workspaceClient.id);
  if (registered.length !== 1 || mine.length !== 1) throw new Error(`Expected exactly one registered workspace, registered are ${registered.length}`);
  if (!mine[0]!.folders.some((entry) => path.resolve(entry) === folder)) throw new Error(`The registered workspace does not offer ${folder}`);

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
  }, 300_000, "the first turn is done", 2000);
  checks.firstTurn = {
    events: finished.length,
    completed: toolNames(finished, "tool.call.completed"),
    failed: named(finished, "tool.call.failed").map((entry) => ({ name: entry.payload.name, error: String(entry.payload.error).slice(0, 200) })),
    answer: named(finished, "model.output.completed").map((entry) => String(entry.payload.text).slice(0, 400)),
  };

  const completed = new Set(toolNames(finished, "tool.call.completed"));
  const missing = EXPECTED_TOOLS.filter((tool) => !completed.has(tool));
  checks.missingTools = missing;
  if (missing.length > 0) throw new Error(`These tools are missing as tool.call.completed: ${missing.join(", ")}`);

  const greeter = readFileSync(greeterFile, "utf8");
  checks.greeter = { before: before.split("\n")[0], after: greeter.split("\n")[0] };
  if (!greeter.includes(GREETING)) throw new Error(`The greeting line in ${greeterFile} does not carry ${GREETING}`);

  const serverFiles = [...filesUnder(path.join(dataDirectory, "sessions", runId)), ...filesUnder(path.join(dataDirectory, "runs", runId))];
  const strays = serverFiles.filter((file) => path.basename(file) === "greeter.ts");
  checks.serverRunFiles = { root: dataDirectory, count: serverFiles.length, strays };
  if (strays.length > 0) throw new Error(`The server folder of the run carries project files: ${strays.join(", ")}`);

  const diagnosticsStart = named(finished, "tool.call.started")
    .filter((entry) => entry.payload.name === "typescript_diagnostics")
    .find((entry) => (entry.payload.input as Record<string, unknown> | undefined)?.paths === undefined);
  if (!diagnosticsStart) throw new Error("There is no call of typescript_diagnostics without paths");
  const diagnostics = named(finished, "tool.call.completed").find((entry) => entry.payload.toolCallId === diagnosticsStart.payload.toolCallId);
  const diagnosticsText = String(diagnostics?.payload.output ?? "");
  checks.diagnostics = { sequence: diagnosticsStart.event.sequence, output: diagnosticsText.slice(0, 600) };
  // Without paths, the tool checks the files changed according to Git; after this task, that is src/greeter.ts.
  if (!/greeter\.ts/.test(diagnosticsText)) throw new Error("typescript_diagnostics without paths does not report the changed src/greeter.ts");

  const prefix = `== ${runId.slice(0, 8)} `;
  const logged = channelLines.filter((line) => line.startsWith(prefix));
  const unlogged = EXECUTOR_TOOLS.filter((tool) => !logged.some((line) => line.startsWith(`${prefix}${tool} `)));
  checks.outputChannel = channelCaptured
    ? { lines: logged.length, missing: unlogged, sample: logged.slice(0, 12) }
    : { captured: false, reason: "The extension runs from its own vscode API; its output channel cannot be recorded from here" };
  if (channelCaptured) {
    if (logged.length === 0) throw new Error("The RAgents output channel has no line for this run");
    if (unlogged.length > 0) throw new Error(`The RAgents output channel does not name these tools: ${unlogged.join(", ")}`);
  }

  const rows = processRows();
  const servers = ownMatching(rows, "typescript-language-server");
  checks.extensionHostPid = process.pid;
  checks.languageServers = servers.map((row) => ({ pid: row.pid, ppid: row.ppid, ancestors: ancestorsOf(rows, row.pid), command: row.command.slice(0, 200) }));
  if (servers.length === 0) throw new Error(`No typescript-language-server runs at extension host ${process.pid}`);
  const foreign = matching(rows, "typescript-language-server")
    .filter((row) => !servers.some((own) => own.pid === row.pid) && carriesRun(row.pid, runId));
  if (foreign.length > 0) throw new Error(`These language servers of the run do not hang off extension host ${process.pid}: ${foreign.map((row) => row.pid).join(", ")}`);

  void rpc.call(coreContracts.chat.send, { runId, text: SLEEP_TASK }).catch((cause: unknown) => sendErrors.push(String(cause)));
  const sleeping = await waitUntil(async () => {
    const running = ownMatching(processRows(), "sleep 120").map((row) => row.pid);
    return running.length > 0 ? running : undefined;
  }, 240_000, "the command sleep 120 is running", 500);
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
  }, 120_000, "the cancelled bash call ends with the interruption of its turn", 1000);
  await waitFor(() => stillRunning(sleeping).length === 0, 30_000, "the process sleep 120 is gone");
  checks.abort = {
    stopCall: { outcome: stopOutcome, durationMs: stopDurationMs },
    sleepPids: sleeping,
    sequence: stopped.started.event.sequence,
    interrupted: { sequence: stopped.interrupted.event.sequence, reason: String(stopped.interrupted.payload.reason).slice(0, 300) },
  };

  await api.disconnect(connection);
  await waitFor(() => api.session(connection)?.status.kind === "stopped", 30_000, "the disconnect ends the session");
  const response = await fetch(`${origin}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: workspaceContracts.clients.list.id, params: {} }),
  });
  const remaining = await response.json() as { result?: Array<{ id: string }> };
  const left = remaining.result ?? [];
  checks.clientsAfterDisconnect = left;
  if (left.some((entry) => entry.id === workspaceClient.id)) throw new Error("After the disconnect, the workspace is still in the list");
  await waitFor(() => stillRunning(servers.map((row) => row.pid)).length === 0, 60_000, "the language servers have ended");
  checks.languageServersAfterDisconnect = 0;
  checks.channel = channelLines.filter((line) => line.startsWith(prefix));
  if (stopOutcome !== "ok") throw new Error(`ragents.chat.stop over the session connection failed after ${stopDurationMs} ms: ${stopOutcome}`);
};

/** The template the click on Start uses: a run script without a guide starts without a model response. */
const TILE_ENTRY = "ragents.reference.moderated-round";

/** The third path: two servers at the same time, a click on a template, a new run on the second, and a disconnect that affects only one. */
const checkTwoConnections = async (api: RAgentsApi, first: string, second: string, requested: string,
  seen: ReadonlyArray<{ connection: string; message: RunPanelHostMessage }>, report: Record<string, unknown>): Promise<void> => {
  const checks: Record<string, unknown> = {};
  report.twoConnections = checks;
  const folder = path.resolve(requested);

  await waitFor(() => api.snapshots().length === 2 && api.snapshots().every((snapshot) => snapshot.status.kind === "connected"),
    120_000, "both servers are connected");
  // The client profile per server brings product and templates; the developer profile itself brings no templates.
  await waitFor(() => [first, second].every((name) => parts(api, name).store.product !== undefined), 60_000, "both servers have loaded their profile");
  checks.products = Object.fromEntries([first, second].map((name) => [name, { product: parts(api, name).store.product, entries: parts(api, name).store.startEntries.length }]));
  const overview = panelState({ theme: "dark", page: "start", connections: api.snapshots(), profileSuggestions: [], missingSecrets: [], problem: undefined, pickedProfileFile: undefined, runsConnection: undefined });
  checks.overview = overview.connections.map((connection) => ({
    name: connection.name, kind: connection.kind, state: connection.state.kind, runs: connection.runs.length, entries: connection.entries.length, canCreate: connection.canCreate,
  }));
  if (overview.connections.length !== 2) throw new Error(`The overview shows ${overview.connections.length} servers instead of two`);
  for (const connection of overview.connections) {
    if (connection.state.kind !== "connected") throw new Error(`The server ${connection.name} appears as ${connection.state.kind} in the overview`);
    if (!connection.canCreate) throw new Error(`The server ${connection.name} allows no new runs`);
  }

  // The workspace of this window registers with both servers using the same identifier.
  const registrations: Record<string, unknown> = {};
  checks.workspaceClients = registrations;
  for (const name of [first, second]) {
    const { client, workspaceClient } = parts(api, name);
    await waitFor(() => workspaceClient.status.kind === "registered" && workspaceClient.folders.some((entry) => path.resolve(entry) === folder),
      60_000, `the workspace registers with ${name}`);
    const registered = await client.rpc.call(workspaceContracts.clients.list, {});
    registrations[name] = { id: workspaceClient.id, clients: registered.map((entry) => ({ id: entry.id, folders: entry.folders })) };
    if (!registered.some((entry) => entry.id === workspaceClient.id)) throw new Error(`The workspace is not in the registry at ${name}`);
  }

  // A click on a template of the overview: the extension creates the run on its server, the run panel starts it and reports it back.
  const tileConnection = [second, first].find((name) => parts(api, name).store.startEntries.length > 0);
  if (tileConnection === undefined) {
    // The developer profile brings no templates; the test checks the click on a template against a server that has some.
    checks.tile = { skipped: "Neither of the two servers offers a template" };
  } else {
    const tiles = parts(api, tileConnection).store.startEntries;
    const tile = tiles.find((entry) => entry.id === TILE_ENTRY) ?? tiles.find((entry) => entry.action === "script") ?? tiles[0]!;
    checks.tile = { connection: tileConnection, available: tiles.length, chosen: tile.id, category: tile.category };
    const before = seen.length;
    await api.panelAction({ action: "newRun", name: tileConnection, entryId: tile.id });
    const started = await waitUntil(async () => seen.slice(before)
      .find((entry) => entry.connection === tileConnection && entry.message.type === "runChanged" && entry.message.runId !== null),
    180_000, "the run panel reports the run of the template", 500);
    const tileRunId = (started.message as Extract<RunPanelHostMessage, { type: "runChanged" }>).runId!;
    await waitFor(() => api.snapshots().find((snapshot) => snapshot.connection.name === tileConnection)?.runs.some((run) => run.id === tileRunId) === true,
      120_000, "the run of the template is in the overview");
    const tileEvents = await parts(api, tileConnection).client.rpc.call(runContracts.events, { runId: tileRunId }).catch(() => [] as JournalEvent[]);
    checks.tileRun = {
      runId: tileRunId,
      events: tileEvents.length,
      actors: named(tileEvents, "actor.spawned").map((entry) => String(entry.payload.handle ?? entry.payload.actorId)),
      title: api.snapshots().find((snapshot) => snapshot.connection.name === tileConnection)?.runs.find((run) => run.id === tileRunId)?.title,
    };
    if (tileEvents.length === 0) throw new Error("The run of the template has no journal");

    // The plus of a server creates an empty run: the same newRun without entryId, the task is written in the chat.
    const beforePlus = seen.length;
    await api.panelAction({ action: "newRun", name: tileConnection });
    const plus = await waitUntil(async () => seen.slice(beforePlus)
      .find((entry) => entry.connection === tileConnection && entry.message.type === "runChanged"
        && entry.message.runId !== null && entry.message.runId !== tileRunId),
    120_000, "the plus of the server opens an empty run", 500);
    checks.newChat = { connection: tileConnection, runId: (plus.message as Extract<RunPanelHostMessage, { type: "runChanged" }>).runId };

    // The back arrow of the run panel always leads to the Start page; the shell switches the page for it.
    api.selectRun(tileConnection, tileRunId);
    checks.pageWithRun = api.panel().page;
    if (api.panel().page !== "run") throw new Error(`With an open run, the page is ${api.panel().page} instead of run`);
    await vscode.commands.executeCommand("ragents.showStart");
    checks.pageAfterBack = api.panel().page;
    if (api.panel().page !== "start") throw new Error(`The way back leads to ${api.panel().page} instead of start`);

    // The Runs page deletes the selection via the host; the list then shows only what is left.
    await api.panelAction({ action: "deleteRuns", name: tileConnection, runIds: [tileRunId] });
    await waitFor(() => api.snapshots().find((snapshot) => snapshot.connection.name === tileConnection)?.runs.some((run) => run.id === tileRunId) === false,
      60_000, "the deleted run has disappeared from the list");
    checks.deletedRun = { runId: tileRunId, left: api.snapshots().find((snapshot) => snapshot.connection.name === tileConnection)?.runs.length };
  }

  // A new run on the second server with client binding: read and bash run here, not on the server.
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
  }, 300_000, "the run on the second server is done", 2000);
  const completed = new Set(toolNames(finished, "tool.call.completed"));
  checks.turn = {
    events: finished.length,
    completed: [...completed],
    failed: named(finished, "tool.call.failed").map((entry) => ({ name: entry.payload.name, error: String(entry.payload.error).slice(0, 200) })),
  };
  const missing = ["read", "bash"].filter((tool) => !completed.has(tool));
  if (missing.length > 0) throw new Error(`These tools are missing on the second server: ${missing.join(", ")}`);
  const logged = channelLines.filter((line) => line.startsWith(`== ${runId.slice(0, 8)} `));
  checks.outputChannel = channelCaptured ? logged.slice(0, 8) : { captured: false };
  if (channelCaptured && !logged.some((line) => line.includes(" bash "))) throw new Error("The output channel does not name the bash call of the workspace");
  await waitFor(() => api.snapshots().find((snapshot) => snapshot.connection.name === second)?.runs.some((run) => run.id === runId) === true,
    60_000, "the new run is in the overview of the second server");

  // Disconnecting the first server leaves the second untouched.
  await api.disconnect(first);
  await waitFor(() => api.session(first)?.status.kind === "stopped", 30_000, "the first server is disconnected");
  const afterFirst = await parts(api, second).client.rpc.call(workspaceContracts.clients.list, {});
  checks.afterDisconnect = {
    first: api.session(first)?.status,
    second: api.session(second)?.status,
    clientsAtSecond: afterFirst.map((entry) => entry.id),
    overview: api.snapshots().map((snapshot) => ({ name: snapshot.connection.name, state: snapshot.status.kind, runs: snapshot.runs.length })),
  };
  if (api.session(second)?.status.kind !== "connected") throw new Error("Disconnecting the first server also affected the second");
  if (!afterFirst.some((entry) => entry.id === secondWorkspace.id)) throw new Error("The workspace has disappeared from the second server");
};

/** The fourth path: the settings page, with the same actions the webview sends. */
const checkSettings = async (api: RAgentsApi, serverUrl: string, profileFile: string, report: Record<string, unknown>): Promise<void> => {
  const checks: Record<string, unknown> = {};
  report.settings = checks;
  const view = (name: string) => api.panel().connections.find((connection) => connection.name === name);
  const names = () => api.panel().connections.map((connection) => connection.name);

  checks.start = { page: api.panel().page, connections: names(), setting: api.connections() };
  if (api.panel().connections.length !== 0) throw new Error(`The test starts with ${api.panel().connections.length} servers instead of none`);
  if (api.panel().page !== "start") throw new Error(`The extension starts on ${api.panel().page} instead of the Start page`);
  for (const page of ["runs", "connections", "start"] as const) {
    await api.panelAction({ action: "page", page });
    if (api.panel().page !== page) throw new Error(`The page action does not lead to ${page}`);
  }

  await api.panelAction({ action: "page", page: "connections" });
  checks.page = api.panel().page;
  if (api.panel().page !== "connections") throw new Error("The page action does not lead to the server page");
  const focusable = await vscode.commands.getCommands(true);
  checks.revealCommand = focusable.includes("ragents.runPanel.focus");
  if (!checks.revealCommand) throw new Error("The command ragents.runPanel.focus does not exist; the panel cannot be opened on its own");
  await vscode.commands.executeCommand("ragents.runPanel.focus");

  await api.panelAction({ action: "addServer", name: "selftest", url: serverUrl });
  await waitFor(() => view("selftest") !== undefined, 15_000, "the new server is in the overview");
  checks.addServer = { setting: api.connections(), connections: names(), problem: api.panel().problem };
  if (api.panel().problem !== undefined) throw new Error(`The new server reports ${String(api.panel().problem)}`);
  await waitFor(() => view("selftest")?.state.kind === "connected", 60_000, "the new server is connected");
  checks.serverConnected = view("selftest");

  await api.panelAction({ action: "addServer", name: "selftest", url: serverUrl });
  checks.duplicateName = { problem: api.panel().problem, connections: names(), setting: api.connections().length };
  if (api.panel().problem === undefined) throw new Error("A duplicate name gets through without a message");
  if (api.connections().length !== 1) throw new Error("The duplicate name is in the setting despite the message");

  await api.panelAction({ action: "addServer", name: "no-scheme", url: "localhost:4715" });
  checks.badUrl = { problem: api.panel().problem, connections: names() };
  if (view("no-scheme") !== undefined) throw new Error("An address without http gets through as a server");

  // The extension starts a local profile by itself; "not started" no longer exists.
  await api.panelAction({ action: "addProfile", name: "profile", profileFile });
  await waitFor(() => view("profile") !== undefined, 15_000, "the new profile is in the overview");
  checks.addProfile = { connections: api.connections(), state: view("profile")?.state.kind, problem: api.panel().problem };
  if (view("profile")?.state.kind === "stopped") throw new Error("The new profile appears as not started instead of starting silently");
  await api.panelAction({ action: "stopProfile", name: "profile" });
  await waitFor(() => view("profile")?.state.kind === "stopped", 60_000, "the silent start of the profile has ended again");

  // Editing replaces the server in place; the credentials are tied to the address and survive the rename.
  await api.panelAction({ action: "updateServer", name: "selftest", newName: "selftest-new", url: serverUrl });
  await waitFor(() => view("selftest-new") !== undefined && view("selftest") === undefined, 15_000, "the renamed server is in the overview");
  checks.updateServer = { setting: api.connections(), connections: names(), problem: api.panel().problem };
  if (api.panel().problem !== undefined) throw new Error(`Editing reports ${String(api.panel().problem)}`);
  await api.panelAction({ action: "updateServer", name: "selftest-new", newName: "selftest", url: serverUrl });
  await waitFor(() => view("selftest") !== undefined, 15_000, "the old name is back");

  await api.panelAction({ action: "updateProfile", name: "profile", newName: "profile", profileFile: path.join(path.dirname(profileFile), "ragents.config.alsomissing.ts") });
  checks.updateProfileMissing = { problem: api.panel().problem, view: view("profile") };
  if (api.panel().problem === undefined) throw new Error("A profile file that does not exist gets through editing without a message");
  if (view("profile")?.address !== path.resolve(profileFile)) throw new Error(`The rejected edit changed the server to ${String(view("profile")?.address)}`);

  checks.profileSuggestions = api.panel().profileSuggestions;
  if (!Array.isArray(api.panel().profileSuggestions)) throw new Error("The suggestion list of profiles is missing from the page state");

  await api.panelAction({ action: "addProfile", name: "wrongly-named", profileFile: path.join(path.dirname(profileFile), "arbitrary.ts") });
  checks.badProfileName = { problem: api.panel().problem, present: view("wrongly-named") !== undefined };
  if (view("wrongly-named") !== undefined || api.panel().problem === undefined) throw new Error("A wrongly named profile file gets through without a message");

  const missing = path.join(path.dirname(profileFile), "ragents.config.missing.ts");
  await api.panelAction({ action: "addProfile", name: "missing-file", profileFile: missing });
  checks.missingProfileFile = { problem: api.panel().problem, present: view("missing-file") !== undefined };
  if (view("missing-file") !== undefined) throw new Error("A profile file that does not exist gets through as a server");
  if (api.panel().problem === undefined) throw new Error("A profile file that does not exist stays in the page without a message");

  // A relative path resolves against the working directory of the extension host; the message therefore names the full path.
  await api.panelAction({ action: "addProfile", name: "relative", profileFile: "ragents.config.developer.ts" });
  checks.relativeProfileFile = { cwd: process.cwd(), problem: api.panel().problem, view: view("relative") };
  if (view("relative") !== undefined) await api.panelAction({ action: "remove", name: "relative" });
  else if (!/^The profile file \//.test(String(api.panel().problem))) throw new Error(`The message does not name the resolved path: ${String(api.panel().problem)}`);

  // Without a checkout, the extension fetches the host as a package and starts the local profile from it; the .tgz comes from RAGENTS_HOST_PACKAGE_SPEC.
  if (process.env.RAGENTS_HOST_PACKAGE_SPEC) {
    await api.panelAction({ action: "startProfile", name: "profile" });
    await waitFor(() => ["connected", "failed"].includes(view("profile")?.state.kind ?? ""), 900_000, "the local profile comes up from the fetched host package");
    const started = view("profile")?.state;
    checks.startFromPackage = { state: started, host: channelLines.filter((line) => line.includes("host package") || line.includes("Host running")) };
    if (started?.kind !== "failed" && started?.kind !== "connected") throw new Error(`The local profile appears as ${String(started?.kind)}`);
    if (started.kind === "failed") throw new Error(`The local profile from the package failed: ${started.message}`);
    await api.panelAction({ action: "stopProfile", name: "profile" });
    await waitFor(() => view("profile")?.state.kind === "stopped", 60_000, "the local profile is stopped again");
  } else {
    checks.startFromPackage = { skipped: "Without RAGENTS_HOST_PACKAGE_SPEC, the extension would fetch the published package" };
  }

  // The file dialog belongs to VS Code; only if the extension has the same vscode API as the test runner can it be stubbed here.
  if (channelCaptured) {
    const original = vscode.window.showOpenDialog;
    (vscode.window as unknown as { showOpenDialog: unknown }).showOpenDialog = () => Promise.resolve([vscode.Uri.file(profileFile)]);
    try {
      await api.panelAction({ action: "pickProfile" });
    } finally {
      (vscode.window as unknown as { showOpenDialog: unknown }).showOpenDialog = original;
    }
    checks.pickProfile = { picked: api.panel().pickedProfileFile };
    if (api.panel().pickedProfileFile !== profileFile) throw new Error(`The file dialog puts ${String(api.panel().pickedProfileFile)} instead of ${profileFile} into the form`);
  } else {
    checks.pickProfile = { captured: false, reason: "The extension runs from its own vscode API; its file dialog cannot be stubbed from here" };
  }

  // A server without users accepts no credentials; the reason belongs in the line of the server.
  await api.panelAction({ action: "login", name: "selftest", user: "nobody", password: "whatever" });
  checks.login = { problem: view("selftest")?.problem, state: view("selftest")?.state.kind, savedLogin: view("selftest")?.savedLogin ?? false };
  if (view("selftest")?.problem === undefined) throw new Error("Signing in to a server without users stays without a message in the page");
  await api.panelAction({ action: "logout", name: "selftest" });
  checks.afterLogout = { problem: view("selftest")?.problem, savedLogin: view("selftest")?.savedLogin ?? false, state: view("selftest")?.state.kind };
  if (view("selftest")?.savedLogin === true) throw new Error("After deleting, the credentials are still stored");

  await api.panelAction({ action: "settingsFile" });
  checks.settingsFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? "no editor";
  if (!/settings\.json$/.test(String(checks.settingsFile))) throw new Error(`The setting opens ${String(checks.settingsFile)} instead of settings.json`);

  for (const name of ["profile", "selftest"]) {
    await api.panelAction({ action: "remove", name });
    await waitFor(() => view(name) === undefined, 15_000, `the server ${name} is removed`);
  }
  checks.afterRemove = { connections: names(), setting: api.connections() };
  if (api.connections().length !== 0) throw new Error(`After removing, ${api.connections().length} servers are still in ragents.connections`);
};

/** Runs in the extension host of a real VS Code against a running server; tests/host/launch.mjs starts it. */
export async function run(): Promise<void> {
  const report: Record<string, unknown> = {};
  const output = process.env.RAGENTS_HOST_TEST_OUTPUT;
  try {
    const extension = vscode.extensions.getExtension<RAgentsApi>("purestate.ragents-vscode");
    if (!extension) throw new Error("The extension purestate.ragents-vscode is not loaded.");
    report.alreadyActive = extension.isActive;
    const api = await extension.activate();
    const seen: Array<{ connection: string; message: RunPanelHostMessage }> = [];
    api.messages((entry) => seen.push(entry));
    if (process.env.RAGENTS_HOST_TEST_SETTINGS) {
      // Fourth test path: the server page adds servers, reports errors, and removes them again.
      await checkSettings(api, process.env.RAGENTS_HOST_TEST_SERVER ?? "http://localhost:4710", process.env.RAGENTS_HOST_TEST_PROFILE ?? "", report);
      report.ok = true;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2));
      return;
    }
    const primary = "test";
    const secondary = process.env.RAGENTS_HOST_TEST_SECOND ? "second" : undefined;
    // Every configured server connects by itself on activation.
    const configured = secondary ? [primary, secondary] : [primary];
    await waitFor(() => api.snapshots().length === configured.length, 30_000, "the servers are up");
    for (const name of configured) await waitFor(() => api.session(name)?.client !== undefined, 60_000, `the session of ${name} is up`);
    report.connections = api.snapshots().map((snapshot) => ({ name: snapshot.connection.name, kind: snapshot.connection.kind, url: snapshot.url }));
    const workspace = process.env.RAGENTS_HOST_TEST_WORKSPACE;
    if (workspace && secondary) {
      // Third test path: two servers at the same time, click on a template, a new run on the second, a disconnect that affects only one.
      await checkTwoConnections(api, primary, secondary, workspace, seen, report);
      report.ok = true;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2));
      return;
    }
    const token = process.env.RAGENTS_HOST_TEST_TOKEN;
    if (token) {
      await waitFor(() => api.session(primary)?.status.kind === "login-required", 15_000, "server requires an access token");
      report.tokenGate = api.session(primary)?.status;
      await api.applyToken(primary, token);
    }
    const login = process.env.RAGENTS_HOST_TEST_LOGIN;
    if (login) {
      await waitFor(() => api.session(primary)?.status.kind === "login-required", 15_000, "server requires sign-in");
      report.loginRequired = api.session(primary)?.status;
      const [id, password] = login.split(":", 2);
      await api.loginWith(primary, id ?? "", password ?? "");
      report.user = parts(api, primary).store.user;
    }
    if (workspace) {
      // Second test path: the workspace folder of the window is offered as a workspace and a run with client binding is checked.
      await checkWorkspaceBinding(api, primary, workspace, report);
      report.ok = true;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2));
      return;
    }
    await vscode.commands.executeCommand("workbench.view.extension.ragents-run-panel");
    await vscode.commands.executeCommand("ragents.runPanel.focus");
    const { store, client } = parts(api, primary);
    await waitFor(() => store.status.kind === "connected", 240_000, "connection");
    report.status = store.status;
    const runs = await Promise.all(store.runs.map(async (run) => ({ run,
      apps: actorProgramViews(await client.rpc.call(runContracts.view, { runId: run.id })).filter((entry) => entry.app.visible !== false) })));
    report.runs = runs.map(({ run, apps }) => ({ id: run.id, title: run.title, state: run.state, apps: apps.map((app) => app.id), pendingActions: run.pendingActions }));
    report.entries = store.startEntries.map((entry) => entry.id);
    if (store.runs.length === 0) {
      // A freshly started host has no runs yet; connection, overview, and disconnect are then the check.
      await api.disconnect(primary);
      await waitFor(() => api.session(primary)?.status.kind === "stopped", 15_000, "disconnect ends the session");
      report.disconnected = true;
      report.messages = seen;
      report.ok = true;
      if (output) writeFileSync(output, JSON.stringify(report, null, 2));
      return;
    }
    const { run, apps } = runs.find((entry) => entry.apps.length > 0) ?? runs[0]!;
    api.selectRun(primary, run.id);
    await waitFor(() => seen.some((entry) => entry.connection === primary && entry.message.type === "ready"), 30_000, "panel reports ready");
    await waitFor(() => seen.some((entry) => entry.message.type === "runChanged" && entry.message.runId === run.id), 15_000, "panel takes over the run");
    const app = apps[0];
    if (app) {
      await vscode.commands.executeCommand("ragents.openAppInCenter", primary, run.id, app.id, app.title);
      await waitFor(() => seen.filter((entry) => entry.message.type === "ready").length >= 2, 30_000, "mini-app in the center reports ready");
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
