import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { implement, type HttpRouteContribution } from "@ragents/engine";
import { DomainError } from "../../packages/ragents/src/runtime/domain-error.ts";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";
import type { RunView } from "../../packages/ragents/src/domain/model.ts";
import { hostRecordFile, readHostRecord, writeHostRecord } from "../../apps/server/src/host-record.ts";
import { callerDirectory } from "../../apps/server/src/profile-target.ts";
import { startRpcServer } from "../../apps/server/tests/rpc-fixture.ts";
import { WORKSPACE_BINDING_OPTION_ID } from "../../plugins/ragents.workspace/contract.ts";
import { noteHost } from "../remote/connect.ts";
import { advance, execute, INITIAL_FOLLOW_STATE, parseArguments, type TurnOutcome } from "./agent-cli.ts";
import { journalFile } from "./journal.ts";

const health: HttpRouteContribution = {
  id: "test.health",
  isApiPath: (pathname) => pathname === "/health",
  matches: (_request, url) => url.pathname === "/health",
  handle: ({ response }) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, pid: process.pid }));
    return Promise.resolve();
  },
};

interface Selection {
  readonly runId: string;
  readonly optionId: string;
  readonly value: unknown;
}

/** Ein Server, der auf jede Nachricht einen fertigen Turn ins Journal schreibt - wie der echte, nur ohne Modell. */
const harness = async (t: TestContext, outcome: TurnOutcome, binding = true, refusals = 0) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-agent-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const selections: Selection[] = [];
  const stopped: string[] = [];
  const interrupted: { runId: string; actorId: string }[] = [];
  const entries: string[] = [];
  const messages: { runId: string; text: string }[] = [];
  let refused = 0;
  const turn = (runId: string, text: string): void => {
    const file = journalFile(directory, runId);
    mkdirSync(path.dirname(file), { recursive: true });
    const line = (occurredAt: string, events: readonly unknown[]): string =>
      `${JSON.stringify({ runId, command: { actorId: "agent_coordinator" }, occurredAt, events })}\n`;
    const index = messages.length;
    appendFileSync(file, line("2026-09-21T10:00:00.000Z", [
      { sequence: index * 10 + 1, type: "actor.input.enqueued", payload: { inputId: `input-${index}`, actorId: "agent_coordinator", content: text } },
      { sequence: index * 10 + 2, type: "turn.started", payload: { turnId: `turn-${index}`, inputId: `input-${index}` } },
      { sequence: index * 10 + 3, type: "tool.call.started", payload: { turnId: `turn-${index}`, toolCallId: "call-1", name: "read", input: { path: "src/broken.ts" } } },
    ]));
    appendFileSync(file, line("2026-09-21T10:00:02.500Z", [
      { sequence: index * 10 + 4, type: "tool.call.completed", payload: { turnId: `turn-${index}`, toolCallId: "call-1", name: "read", output: "const a = 1;" } },
      { sequence: index * 10 + 5, type: "model.output.completed", payload: { turnId: `turn-${index}`, text: "Erledigt." } },
      outcome === "interrupted"
        ? { sequence: index * 10 + 6, type: "turn.interrupted", payload: { turnId: `turn-${index}`, reason: "Vom Bediener gestoppt" } }
        : { sequence: index * 10 + 6, type: "turn.finished", payload: { turnId: `turn-${index}`, ...(outcome === "failed" ? { outcome: "failed", reason: "Modellfehler" } : { outcome: "completed" }) } },
    ]));
    messages.push({ runId, text });
  };
  const server = await startRpcServer(t, {
    routes: [health],
    methods: [
      implement(coreContracts.startOptions.list, () => binding
        ? [{ id: WORKSPACE_BINDING_OPTION_ID, owner: "ragents.workspace", value: null, presentation: null, selectable: true, locked: false }]
        : []),
      implement(coreContracts.startOptions.select, ({ runId, optionId, value }) => {
        selections.push({ runId, optionId, value });
        return { id: optionId, owner: "test", value, presentation: null, selectable: true, locked: false };
      }),
      implement(coreContracts.chat.start, ({ entry }) => {
        entries.push(entry);
        return null;
      }),
      implement(coreContracts.chat.send, ({ runId, text }) => {
        if (refused < refusals) {
          refused += 1;
          throw new DomainError("actor-chat-unsupported", "@implement-task ist ein TypeScript-Actor und kein Chatpartner.", 400);
        }
        turn(runId, text ?? "");
        return null;
      }),
      implement(coreContracts.chat.stop, ({ runId }) => {
        stopped.push(runId);
        return null;
      }),
      implement(runContracts.view, ({ runId }) => ({ id: runId, primaryActorId: "agent_coordinator" }) as RunView),
      implement(runContracts.interruptTurn, ({ runId, actorId }) => {
        interrupted.push({ runId, actorId });
        return { id: runId, primaryActorId: "agent_coordinator" } as RunView;
      }),
    ],
  });
  const port = Number(new URL(server.url).port);
  const previous = { port: process.env.PORT, data: process.env.DATA_DIR, url: process.env.RAGENTS_URL, cwd: process.env.RAGENTS_CWD };
  process.env.PORT = String(port);
  process.env.DATA_DIR = directory;
  process.env.RAGENTS_CWD = path.dirname(directory);
  delete process.env.RAGENTS_URL;
  t.after(() => {
    process.env.PORT = previous.port;
    process.env.DATA_DIR = previous.data;
    if (previous.cwd === undefined) delete process.env.RAGENTS_CWD;
    else process.env.RAGENTS_CWD = previous.cwd;
    if (previous.url !== undefined) process.env.RAGENTS_URL = previous.url;
  });
  writeHostRecord(directory, { profile: "developer", url: server.url, pid: process.pid, log: path.join(directory, "host.log"), startedAt: new Date().toISOString() });
  const profileFile = path.join(directory, "ragents.config.pruef.ts");
  writeFileSync(profileFile, `export const config = { host: { PORT: ${port}, PRODUCT_PROFILE: "pruef" } };\n`);
  return { directory, profileFile, selections, stopped, interrupted, entries, messages, lines: [] as string[] };
};

const collect = (lines: string[]) => (line: string): void => { lines.push(line); };

test("run bindet den Ordner per path, wartet auf das Turn-Ende und nennt den Run", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  assert.equal(callerDirectory(), path.dirname(context.directory), "ein relativer Ordner gilt ab dem Aufrufer, nicht ab apps/server");
  const relative = path.basename(context.directory);
  const code = await execute({ kind: "run", profile: "developer", folder: relative, text: "Behebe den Typfehler", entry: undefined, json: false }, collect(context.lines));
  assert.equal(code, 0);
  assert.equal(context.selections.length, 1);
  assert.equal(context.selections[0]!.optionId, WORKSPACE_BINDING_OPTION_ID);
  assert.deepEqual(context.selections[0]!.value, { machine: "server", folder: { path: context.directory } });
  assert.equal(context.messages[0]!.text, "Behebe den Typfehler");
  assert.deepEqual(context.lines.slice(0, 3), ["> read {\"path\":\"src/broken.ts\"}", "< read 2.5s ok", "Erledigt."]);
  assert.match(context.lines.at(-1)!, /^run: [0-9a-f-]{36}$/);
});

test("ein abgebrochener Turn endet mit 2, ein gescheiterter mit 1", { timeout: 20_000 }, async (t) => {
  const interrupted = await harness(t, "interrupted");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: interrupted.directory, text: "Baue", entry: undefined, json: false }, collect(interrupted.lines)), 2);
  assert.equal(interrupted.lines.some((line) => line.startsWith("! Turn abgebrochen")), true);
});

test("ein gescheiterter Turn endet mit 1", { timeout: 20_000 }, async (t) => {
  const failed = await harness(t, "failed");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: failed.directory, text: "Baue", entry: undefined, json: false }, collect(failed.lines)), 1);
  assert.equal(failed.lines.some((line) => line.startsWith("! Turn fehlgeschlagen")), true);
});

test("send arbeitet im selben Run weiter und liest nur den neuen Turn", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Erster Auftrag", entry: undefined, json: false }, collect(context.lines)), 0);
  const runId = context.messages[0]!.runId;
  const followUp: string[] = [];
  assert.equal(await execute({ kind: "send", profile: "developer", runId, text: "Zweiter Auftrag", json: true }, collect(followUp)), 0);
  assert.deepEqual(context.messages.map((entry) => entry.runId), [runId, runId]);
  const events = followUp.slice(0, -1).map((line) => JSON.parse(line) as { sequence: number; type: string });
  assert.deepEqual(events.map((event) => event.sequence), [11, 12, 13, 14, 15, 16]);
  assert.equal(followUp.at(-1), `run: ${runId}`);
});

test("stop unterbricht nur den Turn des Primary-Actors, --run hält den ganzen Run an, journal liest den Verlauf", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Auftrag", entry: undefined, json: false }, collect(context.lines)), 0);
  const runId = context.messages[0]!.runId;
  assert.equal(await execute({ kind: "stop", profile: "developer", runId }), 0);
  assert.deepEqual(context.interrupted, [{ runId, actorId: "agent_coordinator" }]);
  assert.deepEqual(context.stopped, [], "stop ohne --run darf den Run nicht anhalten");
  assert.equal(await execute({ kind: "stop-run", profile: "developer", runId }), 0);
  assert.deepEqual(context.stopped, [runId]);
  assert.equal(context.interrupted.length, 1);
  const journal: string[] = [];
  assert.equal(await execute({ kind: "journal", profile: "developer", runId, json: false, tools: true }, collect(journal)), 0);
  assert.deepEqual(journal, ["[3] started agent_coordina read: {\"path\":\"src/broken.ts\"}", "-- letzte Sequenz: 6"]);
});

test("stop --host beendet den gemerkten Host und räumt den Vermerk weg", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  writeHostRecord(context.directory, { profile: "developer", url: "http://localhost:1", pid: 2147483646, log: "log", startedAt: "2026-09-21T10:00:00.000Z" });
  assert.equal(readHostRecord(context.directory)?.pid, 2147483646);
  assert.equal(await execute({ kind: "stop-host", profile: "developer" }), 0);
  assert.equal(readHostRecord(context.directory), undefined);
  await assert.rejects(execute({ kind: "stop-host", profile: "developer" }), new RegExp(hostRecordFile(context.directory).replaceAll(".", "\\.")));
});

test("stop --host beendet keinen Prozess, den der Host unter der gemerkten Adresse nicht als seinen nennt", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  const foreign = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  t.after(() => { foreign.kill("SIGKILL"); });
  const url = `http://localhost:${process.env.PORT}`;
  writeHostRecord(context.directory, { profile: "developer", url, pid: foreign.pid!, log: "log", startedAt: "2026-09-21T10:00:00.000Z" });
  await assert.rejects(execute({ kind: "stop-host", profile: "developer" }), new RegExp(`ein anderer Host \\(PID ${process.pid}\\); die gemerkte PID ${foreign.pid} .* wird nicht beendet`));
  assert.equal(foreign.exitCode, null);
  assert.equal(foreign.signalCode, null);
  assert.doesNotThrow(() => process.kill(foreign.pid!, 0));
  assert.equal(readHostRecord(context.directory), undefined);
});

test("run nimmt das Profil als Pfad zu einer eigenen Profildatei", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  const relative = path.relative(callerDirectory(), context.profileFile);
  assert.equal(await execute({ kind: "run", profile: relative, folder: context.directory, text: "Auftrag am Pfad", entry: undefined, json: false }, collect(context.lines)), 0);
  assert.equal(context.messages[0]!.text, "Auftrag am Pfad");
  assert.equal(readHostRecord(context.directory)?.profile, "developer", "der Datenordner des Profils trägt den Vermerk des Hosts");
  await assert.rejects(execute({ kind: "run", profile: path.join(context.directory, "ragents.config.fehlt.ts"), folder: context.directory, text: "x", entry: undefined, json: false }),
    /Die Profildatei fehlt/);
  await assert.rejects(execute({ kind: "run", profile: "gibtesnicht", folder: context.directory, text: "x", entry: undefined, json: false }),
    /Die Profildatei fehlt.*ragents\.config\.gibtesnicht\.ts/);
});

test("stop --host beendet auch den Host, den ragents start gemerkt hat", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  noteHost("pruef", context.directory, 4739)!(2147483646);
  const noted = readHostRecord(context.directory)!;
  assert.equal(noted.url, "http://localhost:4739");
  assert.equal(noted.log, path.join(context.directory, "logs", "server.log"));
  assert.equal(await execute({ kind: "stop-host", profile: context.profileFile }), 0);
  assert.equal(readHostRecord(context.directory), undefined);
});

test("ein Profil ohne die Ordnerbindung startet den Run trotzdem", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed", false);
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Auftrag ohne Bindung", entry: undefined, json: false }, collect(context.lines)), 0);
  assert.deepEqual(context.selections, []);
  assert.equal(context.messages[0]!.text, "Auftrag ohne Bindung");
});

test("eine Vorlage darf ihren Chatpartner erst einrichten; der Auftrag wartet darauf", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed", false, 2);
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Auftrag an der Vorlage", entry: "workshop.tickets.implement-task", json: false }, collect(context.lines)), 0);
  assert.deepEqual(context.entries, ["workshop.tickets.implement-task"]);
  assert.equal(context.messages[0]!.text, "Auftrag an der Vorlage");
});

test("RAGENTS_PROFILE ist das Vorgabeprofil aller Agentenbefehle", (t) => {
  const previous = process.env.RAGENTS_PROFILE;
  t.after(() => {
    if (previous === undefined) delete process.env.RAGENTS_PROFILE;
    else process.env.RAGENTS_PROFILE = previous;
  });
  process.env.RAGENTS_PROFILE = "/eigen/ragents.config.workshop.ts";
  assert.deepEqual(parseArguments(["stop", "--host"]), { kind: "stop-host", profile: "/eigen/ragents.config.workshop.ts" });
  assert.deepEqual(parseArguments(["stop", "--host", "--profile", "core"]), { kind: "stop-host", profile: "core" });
});

test("die Fassade zeigt die Verwendung mit --help und help, ohne Argument bleibt es ein Fehler", () => {
  const facade = fileURLToPath(new URL("../package/ragents.mjs", import.meta.url));
  for (const argument of ["--help", "help"]) {
    const shown = spawnSync(process.execPath, [facade, argument], { encoding: "utf8" });
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /^Verwendung: ragents <befehl>/);
  }
  const empty = spawnSync(process.execPath, [facade], { encoding: "utf8" });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /^Verwendung: ragents <befehl>/);
  const unknown = spawnSync(process.execPath, [facade, "tanzen"], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unbekannter Befehl: tanzen/);
});

test("die Kommandozeile nennt Befehl, Ordner, Auftrag und Schalter", () => {
  assert.deepEqual(parseArguments(["run", "/work/projekt", "Baue das"]), {
    kind: "run", profile: "developer", folder: "/work/projekt", text: "Baue das", entry: undefined, json: false,
  });
  assert.deepEqual(parseArguments(["run", "/work", "Baue", "--profile", "core", "--entry", "ragents.reference.word-game", "--json"]), {
    kind: "run", profile: "core", folder: "/work", text: "Baue", entry: "ragents.reference.word-game", json: true,
  });
  assert.deepEqual(parseArguments(["journal", "abc", "--tools"]), { kind: "journal", profile: "developer", runId: "abc", json: false, tools: true });
  assert.deepEqual(parseArguments(["stop", "--host"]), { kind: "stop-host", profile: "developer" });
  assert.deepEqual(parseArguments(["stop", "--host", "--profile", "/eigen/ragents.config.workshop.ts"]), { kind: "stop-host", profile: "/eigen/ragents.config.workshop.ts" });
  assert.deepEqual(parseArguments(["stop", "abc"]), { kind: "stop", profile: "developer", runId: "abc" });
  assert.deepEqual(parseArguments(["stop", "abc", "--run"]), { kind: "stop-run", profile: "developer", runId: "abc" });
  assert.throws(() => parseArguments(["stop", "--host", "--run"]), /entweder --host oder --run/);
  assert.throws(() => parseArguments(["stop", "--run"]), /stop braucht/);
  assert.throws(() => parseArguments([]), /Verwendung/);
  assert.throws(() => parseArguments(["tanzen"]), /Unbekannter Befehl/);
  assert.throws(() => parseArguments(["run", "/work"]), /run braucht/);
  assert.throws(() => parseArguments(["run", "/work", "Baue", "zuviel"]), /genau zwei Werte/);
  assert.throws(() => parseArguments(["run", "/work", "Baue", "--unbekannt"]), /Unbekanntes Argument/);
  assert.throws(() => parseArguments(["run", "/work", "Baue", "--profile"]), /braucht einen Wert/);
  assert.throws(() => parseArguments(["send", "../flucht", "Text"]), /Ungültige Run-Id/);
  assert.throws(() => parseArguments(["stop", "--host", "abc"]), /keine Run-Id/);
});

test("send follows a message that joined a running turn as steering to that turn's end", () => {
  const event = (sequence: number, type: string, payload: Record<string, unknown>) => ({ sequence, type, actorId: "agent_coordinator", occurredAt: "2026-09-24T10:00:00.000Z", payload });
  const events = [
    event(1, "actor.input.enqueued", { inputId: "input-1", actorId: "agent_coordinator", content: "Baue die Seite." }),
    event(2, "turn.started", { turnId: "turn-1", inputId: "input-1" }),
    event(3, "actor.input.enqueued", { inputId: "input-2", actorId: "agent_coordinator", content: "Nimm Blau." }),
    event(4, "turn.input-steered", { turnId: "turn-1", inputId: "input-2" }),
    event(5, "turn.finished", { turnId: "turn-1", outcome: "completed" }),
  ];
  assert.deepEqual(events.reduce((state, entry) => advance(state, entry, "Nimm Blau."), INITIAL_FOLLOW_STATE),
    { inputId: "input-2", turnId: "turn-1", outcome: "completed", reason: undefined });
});
