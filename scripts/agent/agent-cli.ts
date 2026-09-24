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

/** Vorgabeprofil der Agentenbefehle; RAGENTS_PROFILE gilt für alle Befehle derselben Shell. */
export const defaultProfile = (): string => process.env.RAGENTS_PROFILE ?? DEFAULT_PROFILE;

export const usage = (): string => `Verwendung: ragents <befehl> [argumente]

  run <ordner> "<auftrag>" [--profile <p>] [--entry <vorlage>] [--workstation <kennung>] [--json]
      Startet den Host des Profils, falls keiner läuft, legt einen Run mit Bindung path auf den
      Ordner an, schickt den Auftrag und wartet, bis der Turn endet. Mit --workstation liegt der
      Ordner auf dem am Host angemeldeten Arbeitsplatz mit dieser Kennung (pnpm workspace-client
      <server-url> <ordner> --id <kennung>) statt auf dem Server; ohne ihn bricht run ab.
  send <run> "<text>" [--profile <p>] [--json]
      Folgeauftrag im selben Run, gleiches Warten.
  journal <run> [--profile <p>] [--json] [--tools]
      Den Verlauf des Runs kompakt lesen: aus dem Datenordner des Profils, mit RAGENTS_URL vom
      Server (dort mit dem Recht runs.inspect).
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
ist "run: <id>". run und send folgen dem Turn über den Server (Kanal ragents.run und
ragents.runs.view), auch auf einem anderen Rechner; Werkzeugzeilen zeigt der Server nur mit
runs.inspect, --json liefert dieselben Schritte als JSON. Reißt die Verbindung ab, endet der
Befehl mit 1 und der Ursache. Die Adresse kommt aus <Datenordner>/host.json, sonst aus RAGENTS_URL, sonst aus
host.PORT des Profils; RAGENTS_TOKEN geht als Bearer-Token mit, falls das Profil eine Anmeldung
verlangt. Der so gestartete Host baut die Oberfläche nicht - ein Agent braucht sie nicht; mit
Oberfläche startet ragents start <profil>.`;

export type AgentCommand =
  | { readonly kind: "run"; readonly profile: string; readonly folder: string; readonly text: string; readonly entry: string | undefined; readonly json: boolean; readonly workstation?: string }
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
    const [folder, text, ...extra] = flags.positional;
    if (!folder || !text) throw new Error(`run braucht <ordner> und "<auftrag>".\n\n${usage()}`);
    if (extra.length > 0) throw new Error(`run nimmt genau zwei Werte, nicht ${flags.positional.length}.`);
    if (flags.workstation !== undefined && !WORKSPACE_CLIENT_ID_PATTERN.test(flags.workstation)) {
      throw new Error(`Ungültige Arbeitsplatz-Kennung: ${flags.workstation} (8 bis 64 Zeichen aus Buchstaben, Ziffern, _ und -).`);
    }
    return { kind: "run", profile: flags.profile, folder, text, entry: flags.entry, json: flags.json,
      ...(flags.workstation ? { workstation: flags.workstation } : {}) };
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

/** Eine Vorlage richtet den Run erst ein und bestimmt dabei seinen Chatpartner; bis dahin lehnt der Server die Nachricht ab. */
const sendWhenChatReady = async (rpc: RpcClient, runId: string, text: string): Promise<void> => {
  const deadline = Date.now() + CHAT_READY_TIMEOUT_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rpc.call(coreContracts.chat.send, { runId, text });
      return;
    } catch (error) {
      if (!(error instanceof RpcError) || error.domainCode !== "actor-chat-unsupported" || Date.now() >= deadline) throw error;
      if (attempt === 0) note("== Die Vorlage richtet den Run ein; der Auftrag wartet auf seinen Chatpartner.");
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

/** Ein Schritt des eigenen Turns: `line` für stdout (fehlt bei einem sauberen Ende), `data` für --json. */
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

const TOOL_ENDS: Readonly<Record<Exclude<TurnToolCall["status"], "running">, string>> = { completed: "ok", failed: "Fehler", interrupted: "abgebrochen" };

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
  line: turn.status === "failed" ? `! Turn fehlgeschlagen: ${shorten(turn.reason, 300)}`
    : turn.status === "interrupted" ? `! Turn abgebrochen: ${shorten(turn.reason, 300)}` : undefined,
  data: { kind: "turn", id: turn.id, status: turn.status, reason: turn.reason },
});

/** Die neue Eingabe des Owners mit diesem Text, der Turn, der sie begonnen oder eingespeist bekommen hat, und seine Schritte ab ihr. */
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
  /** Kehrt zurück, sobald der Kanal seit dem letzten Aufruf etwas gemeldet hat; ein Abriss des Stroms ist ein harter Fehler. */
  readonly changed: () => Promise<void>;
  readonly close: () => void;
}

/** Wie Web und VS Code: der Kanal ragents.run meldet erst ready, dann jede Journaländerung; den Stand liefert ragents.runs.view. */
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
  }, (message) => fail(`Der Ereignisstrom des Runs fällt aus: ${message}`));
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

/** Abonniert den Run, merkt sich die vorhandenen Eingaben, schickt den Auftrag und folgt ihm über die Run-Ansicht bis zum Turn-Ende. */
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

/** Nach dem Senden läuft der Turn beim Server weiter, was immer hier scheitert; der Fehler sagt das. */
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
    throw new Error(`Der Turn in ${runId} lässt sich über ${options.baseUrl} nicht weiter verfolgen und läuft dort womöglich weiter: `
      + (error instanceof Error ? error.message : String(error)));
  }
};

export type LineWriter = (line: string) => void;

const toStdout: LineWriter = (line) => { process.stdout.write(`${line}\n`); };

/** Der angemeldete Arbeitsplatz mit dieser Kennung, wie die Startoption ihn nennt; fehlt er, bricht run mit Ursache ab. */
const workstationOf = (presentation: unknown, id: string): { client: string; label: string } => {
  const clients = (presentation as WorkspaceBindingPresentation | null)?.clients ?? [];
  const found = clients.find((entry) => entry.id === id);
  if (!found) {
    const registered = clients.map((entry) => `${entry.id} (${entry.label})`).join(", ") || "keiner";
    throw new Error(`Am Host ist kein Arbeitsplatz mit der Kennung ${id} angemeldet; angemeldet: ${registered}. Anmelden mit pnpm workspace-client <server-url> <ordner> --id ${id}.`);
  }
  return { client: found.id, label: found.label };
};

const runCommand = async (command: Extract<AgentCommand, { kind: "run" }>, write: LineWriter): Promise<number> => {
  const folder = command.workstation && path.win32.isAbsolute(command.folder) ? command.folder : path.resolve(callerDirectory(), command.folder);
  if (!command.workstation && !statSync(folder, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`Kein Verzeichnis: ${folder}`);
  const target = await loadProfile(command.profile);
  const baseUrl = await ensureHost(target);
  const rpc = client(baseUrl);
  const runId = randomUUID();
  const options = await withLoginHint(() => rpc.call(coreContracts.startOptions.list, { runId }));
  const binding = options.find((option) => option.id === WORKSPACE_BINDING_OPTION_ID);
  if (command.workstation) {
    if (!binding) throw new Error(`Das Profil ${target.profile} kennt ${WORKSPACE_BINDING_OPTION_ID} nicht; ohne Ordnerbindung gibt es keinen Arbeitsplatz für --workstation.`);
    const machine = workstationOf(binding.presentation, command.workstation);
    await withLoginHint(() => rpc.call(coreContracts.startOptions.select, { runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: { machine, folder: { path: folder } } }));
    note(`== Run ${runId} auf Arbeitsplatz ${machine.label}: ${folder} (${baseUrl})`);
  } else if (binding) {
    await withLoginHint(() => rpc.call(coreContracts.startOptions.select, { runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: { machine: "server", folder: { path: folder } } }));
    note(`== Run ${runId} auf ${folder} (${baseUrl})`);
  } else {
    note(`== Run ${runId} (${baseUrl}); das Profil ${target.profile} kennt ${WORKSPACE_BINDING_OPTION_ID} nicht und legt seinen Arbeitsbereich selbst an, ${folder} bleibt ungebunden.`);
  }
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
  if (!await healthy(baseUrl)) throw new Error(`Unter ${baseUrl} antwortet kein RAgents-Server; starte ihn mit ragents run.`);
  const rpc = client(baseUrl);
  const outcome = await withLoginHint(() => follow({ rpc, baseUrl, runId: command.runId, text: command.text, json: command.json, write,
    send: () => rpc.call(coreContracts.chat.send, { runId: command.runId, text: command.text }).then(() => undefined) }));
  write(`run: ${command.runId}`);
  return EXIT_CODES[outcome];
};

/** Mit RAGENTS_URL liegt das Journal beim Server, nicht im Datenordner des lokalen Profils; ragents.runs.events braucht runs.inspect. */
const serverJournal = async (target: ProfileTarget, runId: string): Promise<readonly JournalEvent[]> => {
  const baseUrl = await addressOf(target);
  try {
    const events = await withLoginHint(() => client(baseUrl).call(runContracts.events, { runId }));
    return events.map((event) => ({ sequence: event.sequence, type: event.type, actorId: event.actorId, occurredAt: event.occurredAt,
      payload: event.payload as Record<string, unknown> }));
  } catch (error) {
    if (error instanceof RpcError && error.status === 403) throw new Error(`Das Journal über ${baseUrl} braucht das Recht runs.inspect: ${error.message}`);
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
