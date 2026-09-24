// Der Hook löst @ragents/* auch für eine Profildatei außerhalb des Hosts auf; im Paket gibt es dort kein node_modules.
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
import { RpcError } from "../../packages/ragents/src/rpc/protocol.ts";
import { WORKSPACE_BINDING_OPTION_ID } from "../../plugins/ragents.workspace/contract.ts";
import { interruptPrimaryTurn, stopWholeRun } from "./turn-control.ts";
import { JournalReader, journalLines, readJournal, RUN_ID_PATTERN, type JournalEvent } from "./journal.ts";

const DEFAULT_PROFILE = "developer";
const HOST_START_TIMEOUT_MS = 120_000;
const HOST_STOP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 400;
const HEALTH_TIMEOUT_MS = 2_000;
const CHAT_READY_TIMEOUT_MS = 60_000;

/** Vorgabeprofil der Agentenbefehle; RAGENTS_PROFILE gilt für alle Befehle derselben Shell. */
export const defaultProfile = (): string => process.env.RAGENTS_PROFILE ?? DEFAULT_PROFILE;

export const usage = (): string => `Verwendung: ragents <befehl> [argumente]

  run <ordner> "<auftrag>" [--profile <p>] [--entry <einstieg>] [--json]
      Startet den Host des Profils, falls keiner läuft, legt einen Run mit Bindung path auf den
      Ordner an, schickt den Auftrag und wartet, bis der Turn endet.
  send <run> "<text>" [--profile <p>] [--json]
      Folgeauftrag im selben Run, gleiches Warten.
  journal <run> [--profile <p>] [--json] [--tools]
      Den Verlauf des Runs kompakt lesen.
  stop <run> [--profile <p>]      den laufenden Turn des Primary-Actors unterbrechen; der Run
                                  bleibt aktiv und nimmt den nächsten Auftrag an
  stop <run> --run [--profile <p>]
      Not-Aus: alle Turns abbrechen und alle Actors des Runs stoppen
  stop --host [--profile <p>]     den gemerkten Host beenden
  plugin build <ordner...> [--out <o>] [--watch] [--no-typecheck]
      Plugin-Quellordner zu Bundles bauen; Einzelheiten mit plugin --help.

<p> ist ein Profilname neben dem Host oder der Pfad zu einer ragents.config.<profil>.ts an
beliebiger Stelle; ohne --profile gilt RAGENTS_PROFILE, sonst ${DEFAULT_PROFILE}. Exit-Code:
0 fertig, 2 abgebrochen, 1 fehlgeschlagen oder Verbindungsproblem. Die letzte Zeile auf stdout
ist "run: <id>". Die Adresse kommt aus <Datenordner>/host.json, sonst aus RAGENTS_URL, sonst aus
host.PORT des Profils; RAGENTS_TOKEN geht als Bearer-Token mit, falls das Profil eine Anmeldung
verlangt. Der so gestartete Host baut die Oberfläche nicht - ein Agent braucht sie nicht; mit
Oberfläche startet ragents start <profil>.`;

export type AgentCommand =
  | { readonly kind: "run"; readonly profile: string; readonly folder: string; readonly text: string; readonly entry: string | undefined; readonly json: boolean }
  | { readonly kind: "send"; readonly profile: string; readonly runId: string; readonly text: string; readonly json: boolean }
  | { readonly kind: "journal"; readonly profile: string; readonly runId: string; readonly json: boolean; readonly tools: boolean }
  | { readonly kind: "stop"; readonly profile: string; readonly runId: string }
  | { readonly kind: "stop-run"; readonly profile: string; readonly runId: string }
  | { readonly kind: "stop-host"; readonly profile: string };

interface Flags {
  readonly profile: string;
  readonly entry: string | undefined;
  readonly json: boolean;
  readonly tools: boolean;
  readonly host: boolean;
  readonly run: boolean;
  readonly positional: readonly string[];
}

const VALUE_FLAGS = new Set(["--profile", "--entry"]);

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
    if (!allowed.includes(argument)) throw new Error(`Unbekanntes Argument: ${argument}\n\n${usage()}`);
    if (!VALUE_FLAGS.has(argument)) {
      switches.add(argument);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} braucht einen Wert.`);
    values.set(argument, value);
    index += 1;
  }
  return {
    profile: values.get("--profile") ?? defaultProfile(),
    entry: values.get("--entry"),
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
    const flags = scan(rest, ["--profile", "--entry", "--json"]);
    const [folder, text, ...extra] = flags.positional;
    if (!folder || !text) throw new Error(`run braucht <ordner> und "<auftrag>".\n\n${usage()}`);
    if (extra.length > 0) throw new Error(`run nimmt genau zwei Werte, nicht ${flags.positional.length}.`);
    return { kind: "run", profile: flags.profile, folder, text, entry: flags.entry, json: flags.json };
  }
  if (command === "send") {
    const flags = scan(rest, ["--profile", "--json"]);
    const [runId, text, ...extra] = flags.positional;
    if (!runId || !text) throw new Error(`send braucht <run> und "<text>".\n\n${usage()}`);
    if (extra.length > 0) throw new Error(`send nimmt genau zwei Werte, nicht ${flags.positional.length}.`);
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Ungültige Run-Id: ${runId}`);
    return { kind: "send", profile: flags.profile, runId, text, json: flags.json };
  }
  if (command === "journal") {
    const flags = scan(rest, ["--profile", "--json", "--tools"]);
    const [runId, ...extra] = flags.positional;
    if (!runId) throw new Error(`journal braucht <run>.\n\n${usage()}`);
    if (extra.length > 0) throw new Error(`journal nimmt genau einen Wert, nicht ${flags.positional.length}.`);
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Ungültige Run-Id: ${runId}`);
    return { kind: "journal", profile: flags.profile, runId, json: flags.json, tools: flags.tools };
  }
  if (command === "stop") {
    const flags = scan(rest, ["--profile", "--host", "--run"]);
    if (flags.host && flags.run) throw new Error("stop nimmt entweder --host oder --run.");
    if (flags.host) {
      if (flags.positional.length > 0) throw new Error("stop --host nimmt keine Run-Id.");
      return { kind: "stop-host", profile: flags.profile };
    }
    const [runId, ...extra] = flags.positional;
    if (!runId) throw new Error(`stop braucht <run> oder --host.\n\n${usage()}`);
    if (extra.length > 0) throw new Error(`stop nimmt genau einen Wert, nicht ${flags.positional.length}.`);
    if (!RUN_ID_PATTERN.test(runId)) throw new Error(`Ungültige Run-Id: ${runId}`);
    return { kind: flags.run ? "stop-run" : "stop", profile: flags.profile, runId };
  }
  throw new Error(command ? `Unbekannter Befehl: ${command}\n\n${usage()}` : usage());
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

/** Der gemerkte Host, sonst RAGENTS_URL, sonst die Adresse aus host.PORT des Profils. */
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
  if (!child.pid) throw new Error(`Der Host ${target.profile} ließ sich nicht starten; das Log steht in ${log}.`);
  note(`== Host ${target.profile} startet auf ${target.baseUrl} (Log ${log})`);
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
      note(`== Host bereit unter ${target.baseUrl} (PID ${child.pid})`);
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) break;
    await delay(500);
  }
  throw new Error(`Der Host ${target.profile} antwortet nicht unter ${target.baseUrl}. Ende von ${log}:\n${tail(log, 20)}`);
};

const ensureHost = async (target: ProfileTarget): Promise<string> => {
  const address = await addressOf(target);
  if (await healthy(address)) return address;
  if (process.env.RAGENTS_URL) throw new Error(`Unter ${process.env.RAGENTS_URL} (RAGENTS_URL) antwortet kein RAgents-Server.`);
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

export const LOGIN_REQUIRED = "Das Profil verlangt eine Anmeldung; setze RAGENTS_TOKEN auf den persönlichen Token deines Benutzers "
  + "(im Profil `token: env(...)`).";

/** Ein 401 ist keine Fehlermeldung des Servers wert, sondern der Hinweis auf den persönlichen Token des Profils. */
export const withLoginHint = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (error instanceof RpcError && error.status === 401) throw new Error(`${LOGIN_REQUIRED} ${error.message}`);
    throw error;
  }
};

/** Ein Einstieg richtet den Run erst ein und bestimmt dabei seinen Chatpartner; bis dahin lehnt der Server die Nachricht ab. */
const sendWhenChatReady = async (rpc: RpcClient, runId: string, text: string): Promise<void> => {
  const deadline = Date.now() + CHAT_READY_TIMEOUT_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rpc.call(coreContracts.chat.send, { runId, text });
      return;
    } catch (error) {
      if (!(error instanceof RpcError) || error.domainCode !== "actor-chat-unsupported" || Date.now() >= deadline) throw error;
      if (attempt === 0) note("== Der Einstieg richtet den Run ein; der Auftrag wartet auf seinen Chatpartner.");
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

export interface FollowState {
  readonly inputId: string | undefined;
  readonly turnId: string | undefined;
  readonly outcome: TurnOutcome | undefined;
  readonly reason: string | undefined;
}

export const INITIAL_FOLLOW_STATE: FollowState = { inputId: undefined, turnId: undefined, outcome: undefined, reason: undefined };

/** Verfolgt genau den Turn, den der eigene Text ausgelöst hat: Eingabe, Turn, Ende. */
export const advance = (state: FollowState, event: JournalEvent, text: string): FollowState => {
  const payload = event.payload;
  if (state.inputId === undefined) {
    if (event.type === "actor.input.enqueued" && payload.content === text) return { ...state, inputId: String(payload.inputId) };
    return state;
  }
  if (state.turnId === undefined) {
    if (event.type === "turn.started" && payload.inputId === state.inputId) return { ...state, turnId: String(payload.turnId) };
    return state;
  }
  if (payload.turnId !== state.turnId) return state;
  if (event.type === "turn.finished") {
    return payload.outcome === "failed"
      ? { ...state, outcome: "failed", reason: String(payload.reason ?? "") }
      : { ...state, outcome: "completed", reason: undefined };
  }
  if (event.type === "turn.interrupted") return { ...state, outcome: "interrupted", reason: String(payload.reason ?? "") };
  return state;
};

export const streamLines = (event: JournalEvent, started: Map<string, JournalEvent>): readonly string[] => {
  const payload = event.payload;
  const callId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
  if (event.type === "tool.call.started") {
    started.set(callId, event);
    return [`> ${String(payload.name ?? "")} ${shorten(payload.input, 200)}`];
  }
  if (event.type === "tool.call.completed" || event.type === "tool.call.failed") {
    const begin = started.get(callId);
    started.delete(callId);
    const duration = seconds(begin?.occurredAt, event.occurredAt);
    return event.type === "tool.call.completed"
      ? [`< ${String(payload.name ?? "")} ${duration}s ok`]
      : [`< ${String(payload.name ?? "")} ${duration}s Fehler: ${shorten(payload.error, 300)}`];
  }
  if (event.type === "model.output.completed") {
    const answer = typeof payload.text === "string" ? payload.text.trim() : "";
    return answer ? [answer] : [];
  }
  if (event.type === "turn.interrupted") return [`! Turn abgebrochen: ${shorten(payload.reason, 300)}`];
  if (event.type === "turn.finished" && payload.outcome === "failed") return [`! Turn fehlgeschlagen: ${shorten(payload.reason, 300)}`];
  return [];
};

interface FollowOptions {
  readonly reader: JournalReader;
  readonly baseUrl: string;
  readonly text: string;
  readonly json: boolean;
  readonly write: (line: string) => void;
}

const follow = async (options: FollowOptions): Promise<TurnOutcome> => {
  const started = new Map<string, JournalEvent>();
  let state = INITIAL_FOLLOW_STATE;
  let unhealthy = 0;
  let checkedAt = Date.now();
  for (;;) {
    for (const event of options.reader.next()) {
      if (options.json) options.write(JSON.stringify(event));
      else for (const line of streamLines(event, started)) options.write(line);
      state = advance(state, event, options.text);
      if (state.outcome) {
        if (state.reason && !options.json) note(`== ${state.reason}`);
        return state.outcome;
      }
    }
    await delay(POLL_INTERVAL_MS);
    if (Date.now() - checkedAt < 5_000) continue;
    checkedAt = Date.now();
    unhealthy = await healthy(options.baseUrl) ? 0 : unhealthy + 1;
    if (unhealthy >= 2) throw new Error(`Der Host unter ${options.baseUrl} antwortet nicht mehr; der Run läuft ohne ihn nicht weiter.`);
  }
};

export type LineWriter = (line: string) => void;

const toStdout: LineWriter = (line) => { process.stdout.write(`${line}\n`); };

const runCommand = async (command: Extract<AgentCommand, { kind: "run" }>, write: LineWriter): Promise<number> => {
  const folder = path.resolve(callerDirectory(), command.folder);
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Kein Verzeichnis: ${folder}`);
  const target = await loadProfile(command.profile);
  const baseUrl = await ensureHost(target);
  const rpc = client(baseUrl);
  const runId = randomUUID();
  const options = await withLoginHint(() => rpc.call(coreContracts.startOptions.list, { runId }));
  if (options.some((option) => option.id === WORKSPACE_BINDING_OPTION_ID)) {
    await withLoginHint(() => rpc.call(coreContracts.startOptions.select, { runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: { kind: "path", path: folder } }));
    note(`== Run ${runId} auf ${folder} (${baseUrl})`);
  } else {
    note(`== Run ${runId} (${baseUrl}); das Profil ${target.profile} kennt ${WORKSPACE_BINDING_OPTION_ID} nicht und legt seinen Arbeitsbereich selbst an, ${folder} bleibt ungebunden.`);
  }
  const reader = new JournalReader(target.dataDirectory, runId);
  if (command.entry) await withLoginHint(() => rpc.call(coreContracts.chat.start, { runId, entry: command.entry }));
  await withLoginHint(() => command.entry
    ? sendWhenChatReady(rpc, runId, command.text)
    : rpc.call(coreContracts.chat.send, { runId, text: command.text }).then(() => undefined));
  const outcome = await follow({ reader, baseUrl, text: command.text.trim(), json: command.json, write });
  write(`run: ${runId}`);
  return EXIT_CODES[outcome];
};

const sendCommand = async (command: Extract<AgentCommand, { kind: "send" }>, write: LineWriter): Promise<number> => {
  const target = await loadProfile(command.profile);
  const baseUrl = await addressOf(target);
  if (!await healthy(baseUrl)) throw new Error(`Unter ${baseUrl} antwortet kein RAgents-Server; starte ihn mit ragents run.`);
  const rpc = client(baseUrl);
  const reader = new JournalReader(target.dataDirectory, command.runId);
  reader.next();
  await withLoginHint(() => rpc.call(coreContracts.chat.send, { runId: command.runId, text: command.text }));
  const outcome = await follow({ reader, baseUrl, text: command.text.trim(), json: command.json, write });
  write(`run: ${command.runId}`);
  return EXIT_CODES[outcome];
};

const journalCommand = async (command: Extract<AgentCommand, { kind: "journal" }>, write: LineWriter): Promise<number> => {
  const target = await loadProfile(command.profile);
  const events = readJournal(target.dataDirectory, command.runId);
  if (command.json) for (const event of events) write(JSON.stringify(event));
  else for (const line of journalLines(events, command.tools ? "tools" : "chat", 0)) write(line);
  return 0;
};

const stopCommand = async (command: Extract<AgentCommand, { kind: "stop" | "stop-run" }>): Promise<number> => {
  const target = await loadProfile(command.profile);
  const rpc = client(await addressOf(target));
  if (command.kind === "stop-run") {
    await withLoginHint(() => stopWholeRun(rpc, command.runId));
    note(`== Run ${command.runId} angehalten (Not-Aus)`);
    return 0;
  }
  const actorId = await withLoginHint(() => interruptPrimaryTurn(rpc, command.runId));
  note(`== Laufender Turn von ${actorId} in ${command.runId} unterbrochen; der Run bleibt aktiv`);
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

/** Die PID, die der Host unter dieser Adresse selbst nennt; undefined, wenn dort kein Host antwortet. */
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
  if (!noted) throw new Error(`Für das Profil ${command.profile} ist kein Host gemerkt (${hostRecordFile(target.dataDirectory)} fehlt).`);
  if (!alive(noted.pid)) {
    removeHostRecord(target.dataDirectory);
    note(`== Der gemerkte Host (PID ${noted.pid}) läuft nicht mehr; der Vermerk ist weg.`);
    return 0;
  }
  const answering = await hostPidAt(noted.url);
  if (answering !== noted.pid) {
    removeHostRecord(target.dataDirectory);
    const found = answering === undefined ? "kein Host, der seine PID nennt" : `ein anderer Host (PID ${answering})`;
    throw new Error(`Unter ${noted.url} antwortet ${found}; die gemerkte PID ${noted.pid} gehört nicht nachweislich zum Host und wird nicht beendet. Der Vermerk ist weg.`);
  }
  process.kill(noted.pid, "SIGTERM");
  const deadline = Date.now() + HOST_STOP_TIMEOUT_MS;
  while (Date.now() < deadline && alive(noted.pid)) await delay(250);
  if (alive(noted.pid)) {
    process.kill(noted.pid, "SIGKILL");
    await delay(500);
  }
  removeHostRecord(target.dataDirectory);
  note(`== Host ${noted.url} (PID ${noted.pid}) beendet`);
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
