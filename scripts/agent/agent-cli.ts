// The hook resolves @ragents/* also for a profile file outside the host; in the package there is no node_modules there.
import "../../apps/server/src/host-resolution.ts";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { hostRecordFile, readHostRecord, removeHostRecord, writeHostRecord } from "../../apps/server/src/host-record.ts";
import { hostRoot } from "../../apps/server/src/host-version.ts";
import { callerDirectory, selectProfileTarget, type ProfileTarget } from "../../apps/server/src/profile-target.ts";
import { RpcClient } from "../../apps/web/src/rpc/client.ts";
import type { RunView, Turn, TurnToolCall } from "../../packages/ragents/src/domain/model.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";
import { RpcError } from "../../packages/ragents/src/rpc/protocol.ts";
import { WORKSPACE_BINDING_OPTION_ID, WORKSPACE_CLIENT_ID_PATTERN, type WorkspaceBindingPresentation } from "../../plugins/ragents.workspace/contract.ts";
import { interruptPrimaryTurn, stopWholeRun } from "./turn-control.ts";
import { journalLines, readJournal, RUN_ID_PATTERN, type JournalEvent } from "./journal.ts";

const DEFAULT_PROFILE = "developer";
const HOST_START_TIMEOUT_MS = 120_000;
const HOST_STOP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 400;
const HEALTH_TIMEOUT_MS = 2_000;
const CHAT_READY_TIMEOUT_MS = 60_000;

/** Default profile of the agent commands; RAGENTS_PROFILE applies to all commands of the same shell. */
export const defaultProfile = (): string => process.env.RAGENTS_PROFILE ?? DEFAULT_PROFILE;

export const usage = (): string => `Usage: ragents <command> [arguments]

  run [<folder>] "<task>" [--profile <p>] [--entry <template>] [--workstation <id>] [--json]
      Starts the profile's host if none is running, creates a run with a path binding to the
      folder, sends the task and waits until the turn ends. A single value is always the task:
      without <folder>, run chooses no binding; the default of the profile or of the template
      applies. If the template fixes the binding, a <folder> is an error. With --workstation the
      folder is on the workstation with this id that is registered with the host
      (pnpm workspace-client <server-url> <folder> --id <id>) instead of on the server; without
      it, run aborts, and without <folder> there is no --workstation.
  send <run> "<text>" [--profile <p>] [--json]
      Follow-up task in the same run, same waiting.
  journal <run> [--profile <p>] [--json] [--tools]
      Read the run's history compactly: from the profile's data folder, with RAGENTS_URL from the
      server (there with the permission runs.inspect).
  stop <run> [--profile <p>]      interrupt the running turn of the primary actor; the run
                                  stays active and accepts the next task
  stop <run> --run [--profile <p>]
      Emergency stop: cancel all turns and stop all actors of the run
  stop --host [--profile <p>]     stop the remembered host
  plugin build <folder...> [--out <o>] [--watch] [--no-typecheck]
      Build plugin source folders into bundles; details with plugin --help.

<p> is a profile name next to the host or the path to a ragents.config.<profile>.ts anywhere;
without --profile, RAGENTS_PROFILE applies, otherwise ${DEFAULT_PROFILE}. Exit code:
0 done, 2 cancelled, 1 failed or connection problem. The last line on stdout
is "run: <id>". run and send follow the turn through the server (channel ragents.run and
ragents.runs.view), also on another machine; the server shows tool lines only with
runs.inspect, --json returns the same steps as JSON. If the connection breaks, the
command ends with 1 and the cause. The address comes from <data folder>/host.json, otherwise from RAGENTS_URL, otherwise from
host.PORT of the profile; RAGENTS_TOKEN is sent as a bearer token if the profile requires
sign-in. A host started this way does not build the UI - an agent does not need it; ragents
start <profile> starts it with the UI.`;

export type AgentCommand =
  | { readonly kind: "run"; readonly profile: string; readonly folder: string | undefined; readonly text: string; readonly entry: string | undefined; readonly json: boolean; readonly workstation?: string }
  | { readonly kind: "send"; readonly profile: string; readonly runId: string; readonly text: string; readonly json: boolean }
  | { readonly kind: "journal"; readonly profile: string; readonly runId: string; readonly json: boolean; readonly tools: boolean }
  | { readonly kind: "stop"; readonly profile: string; readonly runId: string }
  | { readonly kind: "stop-run"; readonly profile: string; readonly runId: string }
  | { readonly kind: "stop-host"; readonly profile: string };

interface Flags {
  readonly profile: string;
  readonly entry: string | undefined;
  readonly workstation: string | undefined;
  readonly json: boolean;
  readonly tools: boolean;
  readonly host: boolean;
  readonly run: boolean;
  readonly positional: readonly string[];
}

const VALUE_FLAGS = new Set(["--profile", "--entry", "--workstation"]);

const scan = (argv: readonly string[], allowed: readonly string[]): Flags => {
  const positional: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      positional.push(argument);
      continue;
    }
    if (!allowed.includes(argument)) throw new Error(`Unknown argument: ${argument}\n\n${usage()}`);
    if (!VALUE_FLAGS.has(argument)) {
      switches.add(argument);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} needs a value.`);
    values.set(argument, value);
    index += 1;
  }
  return {
    profile: values.get("--profile") ?? defaultProfile(),
    entry: values.get("--entry"),
    workstation: values.get("--workstation"),
    json: switches.has("--json"),
    tools: switches.has("--tools"),
    host: switches.has("--host"),
    run: switches.has("--run"),
    positional,
  };
};

export const parseArguments = (argv: readonly string[]): AgentCommand => {
  const [command, ...rest] = argv;
  if (command === "run") {
    const flags = scan(rest, ["--profile", "--entry", "--workstation", "--json"]);
    if (flags.positional.length > 2) throw new Error(`run takes at most two values, not ${flags.positional.length}.`);
    const [folder, text] = flags.positional.length === 2 ? flags.positional : [undefined, flags.positional[0]];
    if (!text) throw new Error(`run needs "<task>", optionally preceded by <folder>.\n\n${usage()}`);
    if (folder === "") throw new Error("run needs a non-empty <folder> or only the task.");
    if (flags.workstation !== undefined && folder === undefined) throw new Error("--workstation needs <folder>, the path on the workstation.");
    if (flags.workstation !== undefined && !WORKSPACE_CLIENT_ID_PATTERN.test(flags.workstation)) {
      throw new Error(`Invalid workstation id: ${flags.workstation} (8 to 64 characters from letters, digits, _ and -).`);
    }
    return { kind: "run", profile: flags.profile, folder, text, entry: flags.entry, json: flags.json,
      ...(flags.workstation ? { workstation: flags.workstation } : {}) };
  }
  if (command === "send") {
    const flags = scan(rest, ["--profile", "--json"]);
    const [runId, text, ...extra] = flags.positional;
    if (!runId || !text) throw new Error(`send needs <run> and "<text>".\n\n${usage()}`);
    if (extra.length > 0) throw new Error(`send takes exactly two values, not ${flags.positional.length}.`);
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Invalid run id: ${runId}`);
    return { kind: "send", profile: flags.profile, runId, text, json: flags.json };
  }
  if (command === "journal") {
    const flags = scan(rest, ["--profile", "--json", "--tools"]);
    const [runId, ...extra] = flags.positional;
    if (!runId) throw new Error(`journal needs <run>.\n\n${usage()}`);
    if (extra.length > 0) throw new Error(`journal takes exactly one value, not ${flags.positional.length}.`);
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Invalid run id: ${runId}`);
    return { kind: "journal", profile: flags.profile, runId, json: flags.json, tools: flags.tools };
  }
  if (command === "stop") {
    const flags = scan(rest, ["--profile", "--host", "--run"]);
    if (flags.host && flags.run) throw new Error("stop takes either --host or --run.");
    if (flags.host) {
      if (flags.positional.length > 0) throw new Error("stop --host takes no run id.");
      return { kind: "stop-host", profile: flags.profile };
    }
    const [runId, ...extra] = flags.positional;
    if (!runId) throw new Error(`stop needs <run> or --host.\n\n${usage()}`);
    if (extra.length > 0) throw new Error(`stop takes exactly one value, not ${flags.positional.length}.`);
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Invalid run id: ${runId}`);
    return { kind: flags.run ? "stop-run" : "stop", profile: flags.profile, runId };
  }
  throw new Error(command ? `Unknown command: ${command}\n\n${usage()}` : usage());
};

export const loadProfile = (selection: string, root = hostRoot()): Promise<ProfileTarget> => selectProfileTarget(selection, root);

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const healthy = async (baseUrl: string): Promise<boolean> => {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
};

const note = (line: string): void => { process.stderr.write(`${line}\n`); };

const tail = (file: string, lines: number): string =>
  (statSync(file, { throwIfNoEntry: false })?.isFile() ? readFileSync(file, "utf8") : "").split("\n").slice(-lines).join("\n");

/** The remembered host, otherwise RAGENTS_URL, otherwise the address from host.PORT of the profile. */
export const addressOf = async (target: ProfileTarget): Promise<string> => {
  const noted = readHostRecord(target.dataDirectory);
  if (noted && await healthy(noted.url)) return noted.url;
  return process.env.RAGENTS_URL ?? target.baseUrl;
};

const startHost = async (target: ProfileTarget): Promise<void> => {
  mkdirSync(target.dataDirectory, { recursive: true });
  const log = path.join(target.dataDirectory, "host.log");
  const handle = openSync(log, "a");
  const child = spawn(process.execPath, ["--import", "tsx", path.join(hostRoot(), "apps/server/src/main.ts")], {
    cwd: path.join(hostRoot(), "apps/server"),
    detached: true,
    stdio: ["ignore", handle, handle],
    env: {
      ...process.env,
      PRODUCT_PROFILE: target.profile,
      PRODUCT_PROFILE_FILE: target.profileFile,
      PORT: String(target.port),
      DATA_DIR: target.dataDirectory,
    },
  });
  child.unref();
  closeSync(handle);
  if (!child.pid) throw new Error(`The host ${target.profile} could not be started; the log is in ${log}.`);
  note(`== Host ${target.profile} starting on ${target.baseUrl} (log ${log})`);
  const deadline = Date.now() + HOST_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await healthy(target.baseUrl)) {
      writeHostRecord(target.dataDirectory, {
        profile: target.profile,
        url: target.baseUrl,
        pid: child.pid,
        log,
        startedAt: new Date().toISOString(),
      });
      note(`== Host ready at ${target.baseUrl} (PID ${child.pid})`);
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) break;
    await delay(500);
  }
  throw new Error(`The host ${target.profile} does not respond at ${target.baseUrl}. End of ${log}:\n${tail(log, 20)}`);
};

const ensureHost = async (target: ProfileTarget): Promise<string> => {
  const address = await addressOf(target);
  if (await healthy(address)) return address;
  if (process.env.RAGENTS_URL) throw new Error(`No RAgents server responds at ${process.env.RAGENTS_URL} (RAGENTS_URL).`);
  await startHost(target);
  return target.baseUrl;
};

const client = (baseUrl: string): RpcClient => {
  const token = process.env.RAGENTS_TOKEN;
  return new RpcClient({
    baseUrl,
    fetch: (input, init) => fetch(input, {
      ...init,
      headers: {
        ...init?.headers as Record<string, string> | undefined,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }),
  });
};

export const LOGIN_REQUIRED = "The profile requires sign-in; set RAGENTS_TOKEN to your user's personal token "
  + "(in the profile `token: env(...)`).";

/** A 401 is not worth a server error message, but a hint to the profile's personal token. */
export const withLoginHint = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (error instanceof RpcError && error.status === 401) throw new Error(`${LOGIN_REQUIRED} ${error.message}`);
    throw error;
  }
};

/** A template first sets up the run and determines its chat partner in doing so; until then the server rejects the message. */
const sendWhenChatReady = async (rpc: RpcClient, runId: string, text: string): Promise<void> => {
  const deadline = Date.now() + CHAT_READY_TIMEOUT_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rpc.call(coreContracts.chat.send, { runId, text });
      return;
    } catch (error) {
      if (!(error instanceof RpcError) || error.domainCode !== "actor-chat-unsupported" || Date.now() >= deadline) throw error;
      if (attempt === 0) note("== The template is setting up the run; the task waits for its chat partner.");
      await delay(POLL_INTERVAL_MS);
    }
  }
};

export type TurnOutcome = "completed" | "interrupted" | "failed";

export const EXIT_CODES: Readonly<Record<TurnOutcome, number>> = { completed: 0, interrupted: 2, failed: 1 };

const shorten = (value: unknown, limit: number): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const collapsed = (text === undefined ? "" : text).replace(/\s+/g, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}...` : collapsed;
};

const seconds = (from: string | undefined, to: string | undefined): string => {
  const start = from ? Date.parse(from) : Number.NaN;
  const end = to ? Date.parse(to) : Number.NaN;
  return Number.isNaN(start) || Number.isNaN(end) ? "?" : ((end - start) / 1000).toFixed(1);
};

/** A step of the own turn: `line` for stdout (missing on a clean end), `data` for --json. */
export interface ProgressEntry {
  readonly key: string;
  readonly at: string;
  readonly line: string | undefined;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface TurnProgress {
  readonly entries: readonly ProgressEntry[];
  readonly outcome: TurnOutcome | undefined;
  readonly reason: string | undefined;
}

const PENDING: TurnProgress = { entries: [], outcome: undefined, reason: undefined };

const TOOL_ENDS: Readonly<Record<Exclude<TurnToolCall["status"], "running">, string>> = { completed: "ok", failed: "error", interrupted: "cancelled" };

const toolEntries = (call: TurnToolCall): ProgressEntry[] => [
  { key: `tool:${call.id}`, at: call.startedAt, line: `> ${call.name}`, data: { kind: "tool", call } },
  ...call.status === "running" ? [] : [{
    key: `tool-end:${call.id}`,
    at: call.finishedAt ?? call.startedAt,
    line: `< ${call.name} ${seconds(call.startedAt, call.finishedAt ?? undefined)}s ${TOOL_ENDS[call.status]}`,
    data: { kind: "tool-end", call },
  }],
];

const endEntry = (turn: Turn): ProgressEntry => ({
  key: `turn:${turn.id}`,
  at: turn.finishedAt ?? turn.startedAt,
  line: turn.status === "failed" ? `! Turn failed: ${shorten(turn.reason, 300)}`
    : turn.status === "interrupted" ? `! Turn cancelled: ${shorten(turn.reason, 300)}` : undefined,
  data: { kind: "turn", id: turn.id, status: turn.status, reason: turn.reason },
});

/** The owner's new input with this text, the turn that started with it or had it fed in, and its steps from it on. */
export const progressOf = (view: RunView | null, known: ReadonlySet<string>, text: string): TurnProgress => {
  const input = view?.inputs.find((entry) => !known.has(entry.id) && entry.enqueuedBy === view.ownerId && entry.subscriptionId === null
    && entry.content.trim() === text.trim());
  if (!input) return PENDING;
  if (input.lifecycle.kind === "discarded") return { entries: [], outcome: "interrupted", reason: input.lifecycle.reason };
  if (input.lifecycle.kind === "pending") return PENDING;
  const turnId = input.lifecycle.turnId;
  const turn = view?.turns.find((entry) => entry.id === turnId);
  if (!turn) return PENDING;
  const entries = [
    ...turn.toolCalls.filter((call) => Date.parse(call.startedAt) >= Date.parse(input.enqueuedAt)).flatMap(toolEntries),
    ...turn.outputs.filter((output) => output.sequence > input.sequence && output.text.trim()).map((output): ProgressEntry =>
      ({ key: `output:${output.sequence}`, at: output.occurredAt, line: output.text.trim(), data: { kind: "output", output } })),
  ].sort((left, right) => Date.parse(left.at) - Date.parse(right.at));
  if (turn.status === "running") return { entries, outcome: undefined, reason: undefined };
  return { entries: [...entries, endEntry(turn)], outcome: turn.status, reason: turn.status === "completed" ? undefined : turn.reason ?? "" };
};

interface RunWatch {
  /** Returns as soon as the channel has reported something since the last call; a broken stream is a hard error. */
  readonly changed: () => Promise<void>;
  readonly close: () => void;
}

/** Like web and VS Code: the channel ragents.run first reports ready, then every journal change; ragents.runs.view returns the state. */
const watchRun = (rpc: RpcClient, runId: string): RunWatch => {
  let dirty = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;
  const signal = (): void => {
    const waiting = wake;
    wake = undefined;
    waiting?.();
  };
  const fail = (message: string): void => {
    failure ??= new Error(message);
    signal();
  };
  const unsubscribe = rpc.subscribe(coreContracts.channels.run, { runId }, () => {
    dirty = true;
    signal();
  }, (message) => fail(`The run's event stream failed: ${message}`));
  const stopStatus = rpc.onStatus((status) => {
    if (status.kind === "unauthorized") fail(LOGIN_REQUIRED);
  });
  return {
    changed: async () => {
      while (!dirty && !failure) await new Promise<void>((resolve) => { wake = resolve; });
      if (failure) throw failure;
      dirty = false;
    },
    close: () => {
      stopStatus();
      unsubscribe();
    },
  };
};

interface FollowOptions {
  readonly rpc: RpcClient;
  readonly baseUrl: string;
  readonly runId: string;
  readonly text: string;
  readonly json: boolean;
  readonly write: (line: string) => void;
  readonly send: () => Promise<void>;
}

/** Subscribes to the run, remembers the existing inputs, sends the task and follows it through the run view until the turn ends. */
const follow = async (options: FollowOptions): Promise<TurnOutcome> => {
  const { rpc, runId } = options;
  const watch = watchRun(rpc, runId);
  try {
    await watch.changed();
    const before = await rpc.call(runContracts.view, { runId });
    const known = new Set(before?.inputs.map((input) => input.id));
    await options.send();
    return await followSent(options, watch, known);
  } finally {
    watch.close();
  }
};

/** After sending, the turn keeps running on the server whatever fails here; the error says so. */
const followSent = async (options: FollowOptions, watch: RunWatch, known: ReadonlySet<string>): Promise<TurnOutcome> => {
  const { rpc, runId } = options;
  try {
    const written = new Set<string>();
    for (;;) {
      const progress = progressOf(await rpc.call(runContracts.view, { runId }), known, options.text);
      for (const entry of progress.entries.filter((candidate) => !written.has(candidate.key))) {
        written.add(entry.key);
        if (options.json) options.write(JSON.stringify(entry.data));
        else if (entry.line !== undefined) options.write(entry.line);
      }
      if (progress.outcome) {
        if (progress.reason && !options.json) note(`== ${progress.reason}`);
        return progress.outcome;
      }
      await watch.changed();
    }
  } catch (error) {
    if (error instanceof RpcError && error.status === 401) throw error;
    throw new Error(`The turn in ${runId} can no longer be followed through ${options.baseUrl} and may still be running there: `
      + (error instanceof Error ? error.message : String(error)));
  }
};

export type LineWriter = (line: string) => void;

const toStdout: LineWriter = (line) => { process.stdout.write(`${line}\n`); };

/** The registered workstation with this id, as the start option names it; if it is missing, run aborts with the cause. */
const workstationOf = (presentation: unknown, id: string): { client: string; label: string } => {
  const clients = (presentation as WorkspaceBindingPresentation | null)?.clients ?? [];
  const found = clients.find((entry) => entry.id === id);
  if (!found) {
    const registered = clients.map((entry) => `${entry.id} (${entry.label})`).join(", ") || "none";
    throw new Error(`No workstation with the id ${id} is registered with the host; registered: ${registered}. Register with pnpm workspace-client <server-url> <folder> --id ${id}.`);
  }
  return { client: found.id, label: found.label };
};

/** If the template fixes the folder binding itself, any given folder contradicts it; run silently overrules neither side. */
const assertEntryLeavesBinding = async (rpc: RpcClient, entryId: string, folder: string): Promise<void> => {
  const { startEntries } = await withLoginHint(() => rpc.call(coreContracts.plugins.bootstrap, {}));
  const entry = startEntries.find((candidate) => candidate.id === entryId);
  if (!entry) throw new Error(`The template ${entryId} does not exist in this profile, or it is not enabled for your user.`);
  const fixed = entry.fixedStartOptions?.[WORKSPACE_BINDING_OPTION_ID];
  if (fixed !== undefined) {
    throw new Error(`The template ${entryId} fixes the folder binding itself (${JSON.stringify(fixed)}), but the folder ${folder} was given. `
      + "Leave out <folder> or start without this template.");
  }
};

const bindFolder = async (rpc: RpcClient, runId: string, folder: string, command: Extract<AgentCommand, { kind: "run" }>, profile: string, baseUrl: string): Promise<void> => {
  if (command.entry) await assertEntryLeavesBinding(rpc, command.entry, folder);
  const options = await withLoginHint(() => rpc.call(coreContracts.startOptions.list, { runId }));
  const binding = options.find((option) => option.id === WORKSPACE_BINDING_OPTION_ID);
  if (command.workstation) {
    if (!binding) throw new Error(`The profile ${profile} does not know ${WORKSPACE_BINDING_OPTION_ID}; without a folder binding there is no workstation for --workstation.`);
    const machine = workstationOf(binding.presentation, command.workstation);
    await withLoginHint(() => rpc.call(coreContracts.startOptions.select, { runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: { machine, folder: { path: folder } } }));
    note(`== Run ${runId} on workstation ${machine.label}: ${folder} (${baseUrl})`);
  } else if (binding) {
    await withLoginHint(() => rpc.call(coreContracts.startOptions.select, { runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: { machine: "server", folder: { path: folder } } }));
    note(`== Run ${runId} on ${folder} (${baseUrl})`);
  } else {
    note(`== Run ${runId} (${baseUrl}); the profile ${profile} does not know ${WORKSPACE_BINDING_OPTION_ID} and creates its workspace itself, ${folder} stays unbound.`);
  }
};

const runCommand = async (command: Extract<AgentCommand, { kind: "run" }>, write: LineWriter): Promise<number> => {
  const folder = command.folder === undefined || (command.workstation && path.win32.isAbsolute(command.folder))
    ? command.folder : path.resolve(callerDirectory(), command.folder);
  if (folder !== undefined && !command.workstation && !statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Not a directory: ${folder}`);
  const target = await loadProfile(command.profile);
  const baseUrl = await ensureHost(target);
  const rpc = client(baseUrl);
  const runId = randomUUID();
  if (folder !== undefined) await bindFolder(rpc, runId, folder, command, target.profile, baseUrl);
  else note(`== Run ${runId} (${baseUrl}) without a folder; the binding comes from ${command.entry ? `the template ${command.entry} or ` : ""}the default of the profile ${target.profile}.`);
  if (command.entry) await withLoginHint(() => rpc.call(coreContracts.chat.start, { runId, entry: command.entry }));
  const outcome = await withLoginHint(() => follow({ rpc, baseUrl, runId, text: command.text, json: command.json, write,
    send: () => command.entry
      ? sendWhenChatReady(rpc, runId, command.text)
      : rpc.call(coreContracts.chat.send, { runId, text: command.text }).then(() => undefined) }));
  write(`run: ${runId}`);
  return EXIT_CODES[outcome];
};

const sendCommand = async (command: Extract<AgentCommand, { kind: "send" }>, write: LineWriter): Promise<number> => {
  const target = await loadProfile(command.profile);
  const baseUrl = await addressOf(target);
  if (!await healthy(baseUrl)) throw new Error(`No RAgents server responds at ${baseUrl}; start it with ragents run.`);
  const rpc = client(baseUrl);
  const outcome = await withLoginHint(() => follow({ rpc, baseUrl, runId: command.runId, text: command.text, json: command.json, write,
    send: () => rpc.call(coreContracts.chat.send, { runId: command.runId, text: command.text }).then(() => undefined) }));
  write(`run: ${command.runId}`);
  return EXIT_CODES[outcome];
};

/** With RAGENTS_URL the journal is on the server, not in the data folder of the local profile; ragents.runs.events needs runs.inspect. */
const serverJournal = async (target: ProfileTarget, runId: string): Promise<readonly JournalEvent[]> => {
  const baseUrl = await addressOf(target);
  try {
    const events = await withLoginHint(() => client(baseUrl).call(runContracts.events, { runId }));
    return events.map((event) => ({ sequence: event.sequence, type: event.type, actorId: event.actorId, occurredAt: event.occurredAt,
      payload: event.payload as Record<string, unknown> }));
  } catch (error) {
    if (error instanceof RpcError && error.status === 403) throw new Error(`The journal through ${baseUrl} needs the permission runs.inspect: ${error.message}`);
    throw error;
  }
};

const journalCommand = async (command: Extract<AgentCommand, { kind: "journal" }>, write: LineWriter): Promise<number> => {
  const target = await loadProfile(command.profile);
  const events = process.env.RAGENTS_URL ? await serverJournal(target, command.runId) : readJournal(target.dataDirectory, command.runId);
  if (command.json) for (const event of events) write(JSON.stringify(event));
  else for (const line of journalLines(events, command.tools ? "tools" : "chat", 0)) write(line);
  return 0;
};

const stopCommand = async (command: Extract<AgentCommand, { kind: "stop" | "stop-run" }>): Promise<number> => {
  const target = await loadProfile(command.profile);
  const rpc = client(await addressOf(target));
  if (command.kind === "stop-run") {
    await withLoginHint(() => stopWholeRun(rpc, command.runId));
    note(`== Run ${command.runId} stopped (emergency stop)`);
    return 0;
  }
  const actorId = await withLoginHint(() => interruptPrimaryTurn(rpc, command.runId));
  note(`== Running turn of ${actorId} in ${command.runId} interrupted; the run stays active`);
  return 0;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** The PID the host at this address reports itself; undefined if no host responds there. */
const hostPidAt = async (baseUrl: string): Promise<number | undefined> => {
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    const body = response.ok ? await response.json() as { pid?: unknown } : undefined;
    return typeof body?.pid === "number" ? body.pid : undefined;
  } catch {
    return undefined;
  }
};

const stopHostCommand = async (command: Extract<AgentCommand, { kind: "stop-host" }>): Promise<number> => {
  const target = await loadProfile(command.profile);
  const noted = readHostRecord(target.dataDirectory);
  if (!noted) throw new Error(`No host is remembered for the profile ${command.profile} (${hostRecordFile(target.dataDirectory)} is missing).`);
  if (!alive(noted.pid)) {
    removeHostRecord(target.dataDirectory);
    note(`== The remembered host (PID ${noted.pid}) is no longer running; the record is removed.`);
    return 0;
  }
  const answering = await hostPidAt(noted.url);
  if (answering !== noted.pid) {
    removeHostRecord(target.dataDirectory);
    const found = answering === undefined ? "no host that reports its PID" : `another host (PID ${answering})`;
    throw new Error(`Found at ${noted.url}: ${found}; the remembered PID ${noted.pid} does not provably belong to the host and is not stopped. The record is removed.`);
  }
  process.kill(noted.pid, "SIGTERM");
  const deadline = Date.now() + HOST_STOP_TIMEOUT_MS;
  while (Date.now() < deadline && alive(noted.pid)) await delay(250);
  if (alive(noted.pid)) {
    process.kill(noted.pid, "SIGKILL");
    await delay(500);
  }
  removeHostRecord(target.dataDirectory);
  note(`== Host ${noted.url} (PID ${noted.pid}) stopped`);
  return 0;
};

export const execute = async (command: AgentCommand, write: LineWriter = toStdout): Promise<number> => {
  if (command.kind === "run") return runCommand(command, write);
  if (command.kind === "send") return sendCommand(command, write);
  if (command.kind === "journal") return journalCommand(command, write);
  if (command.kind === "stop" || command.kind === "stop-run") return stopCommand(command);
  return stopHostCommand(command);
};

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2);
  if (argv[0] === "--help" || argv[0] === "help") {
    console.log(usage());
    return 0;
  }
  if (argv.length === 0) {
    console.error(usage());
    return 1;
  }
  if (argv[0] === "plugin") return (await import("../plugin/plugin-cli.ts")).main(argv.slice(1));
  return execute(parseArguments(argv));
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().then((code) => process.exit(code), (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
