import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { implement, implementChannel, type HttpRouteContribution, type JournalEvent } from "@ragents/engine";
import { DomainError } from "../../packages/ragents/src/runtime/domain-error.ts";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";
import type { RunView } from "../../packages/ragents/src/domain/model.ts";
import type { PublicStartEntry } from "../../packages/ragents/src/plugin-types.ts";
import { hostRecordFile, readHostRecord, writeHostRecord } from "../../apps/server/src/host-record.ts";
import { callerDirectory } from "../../apps/server/src/profile-target.ts";
import { startRpcServer } from "../../apps/server/tests/rpc-fixture.ts";
import { WORKSPACE_BINDING_OPTION_ID, type WorkspaceBindingPresentation, type WorkspaceClientInfo } from "../../plugins/ragents.workspace/contract.ts";
import { noteHost } from "../remote/connect.ts";
import { execute, parseArguments, progressOf, type TurnOutcome } from "./agent-cli.ts";
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

const OWNER = "owner";
const PRIMARY = "agent_coordinator";

/** Die Journalzeilen eines fertigen Turns, wie sie der Server schreibt; nur für journal gebraucht. */
const journalRecords = (runId: string, text: string): readonly unknown[] => [
  { runId, command: { actorId: PRIMARY }, occurredAt: "2026-09-21T10:00:00.000Z", events: [
    { sequence: 1, type: "actor.input.enqueued", payload: { inputId: "input-0", actorId: PRIMARY, content: text } },
    { sequence: 2, type: "turn.started", payload: { turnId: "turn-0", inputId: "input-0" } },
    { sequence: 3, type: "tool.call.started", payload: { turnId: "turn-0", toolCallId: "call-1", name: "read", input: { path: "src/broken.ts" } } },
  ] },
  { runId, command: { actorId: PRIMARY }, occurredAt: "2026-09-21T10:00:02.500Z", events: [
    { sequence: 4, type: "tool.call.completed", payload: { turnId: "turn-0", toolCallId: "call-1", name: "read", output: "const a = 1;" } },
    { sequence: 5, type: "model.output.completed", payload: { turnId: "turn-0", text: "Erledigt." } },
    { sequence: 6, type: "turn.finished", payload: { turnId: "turn-0", outcome: "completed" } },
  ] },
];

interface HarnessOptions {
  readonly binding?: boolean;
  readonly refusals?: number;
  readonly clients?: WorkspaceClientInfo[];
  readonly startEntries?: PublicStartEntry[];
  /** Der Turn bleibt nach dem ersten Werkzeugaufruf stehen, bis der Test etwas tut. */
  readonly hold?: boolean;
}

/** Ein Server, der auf jede Nachricht einen Turn in der Run-Ansicht fortschreibt und im Kanal ragents.run meldet, ohne Journaldatei. */
const harness = async (t: TestContext, outcome: TurnOutcome, options: HarnessOptions = {}) => {
  const { binding = true, refusals = 0, clients = [], startEntries = [] } = options;
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-agent-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const selections: Selection[] = [];
  const stopped: string[] = [];
  const interrupted: { runId: string; actorId: string }[] = [];
  const entries: string[] = [];
  const messages: { runId: string; text: string }[] = [];
  const views = new Map<string, RunView>();
  const watchers = new Map<string, Set<() => void>>();
  let reachRunning = (): void => undefined;
  const running = new Promise<void>((resolve) => { reachRunning = resolve; });
  let refused = 0;
  const update = (runId: string, change: (view: RunView) => RunView): void => {
    const current = views.get(runId) ?? { id: runId, ownerId: OWNER, primaryActorId: PRIMARY, inputs: [], turns: [] } as unknown as RunView;
    views.set(runId, change(current));
    for (const notify of watchers.get(runId) ?? []) notify();
  };
  const turn = (runId: string, text: string): void => {
    const index = messages.length;
    const inputId = `input-${index}`;
    const turnId = `turn-${index}`;
    const call = { id: `call-${index}`, name: "read", status: "running", startedAt: "2026-09-21T10:00:00.000Z", finishedAt: null } as const;
    const base = { id: turnId, actorId: PRIMARY, inputId, startedAt: "2026-09-21T10:00:00.000Z", finishedAt: null, reason: null, usage: {}, outputs: [] };
    update(runId, (view) => ({ ...view, inputs: [...view.inputs, { id: inputId, actorId: PRIMARY, content: text, artifactIds: [], enqueuedBy: OWNER,
      enqueuedAt: "2026-09-21T10:00:00.000Z", sequence: index * 10 + 1, lifecycle: { kind: "pending" }, subscriptionId: null, sourceEventIds: [] }] }));
    const claimed = (view: RunView): RunView["inputs"] => view.inputs.map((input) => input.id === inputId
      ? { ...input, lifecycle: { kind: "claimed", turnId, steered: false } } : input);
    setTimeout(() => {
      update(runId, (view) => ({ ...view, inputs: claimed(view), turns: [...view.turns, { ...base, status: "running", toolCalls: [call] }] as RunView["turns"] }));
      reachRunning();
      if (options.hold) return;
      setTimeout(() => update(runId, (view) => ({ ...view, turns: view.turns.map((entry) => entry.id !== turnId ? entry : {
        ...entry,
        status: outcome,
        finishedAt: "2026-09-21T10:00:03.000Z",
        reason: outcome === "failed" ? "Modellfehler" : outcome === "interrupted" ? "Vom Bediener gestoppt" : null,
        toolCalls: [{ ...call, status: "completed", finishedAt: "2026-09-21T10:00:02.500Z" }],
        outputs: [{ text: "Erledigt.", sequence: index * 10 + 5, occurredAt: "2026-09-21T10:00:02.600Z" }],
      }) })), 10);
    }, 10);
    messages.push({ runId, text });
  };
  const server = await startRpcServer(t, {
    routes: [health],
    methods: [
      implement(coreContracts.startOptions.list, () => binding
        ? [{ id: WORKSPACE_BINDING_OPTION_ID, owner: "ragents.workspace", value: null, selectable: true, locked: false,
          presentation: { kind: "workspace-binding", clients, fresh: { server: "Neuer Ordner", client: null }, serverFolders: true } satisfies WorkspaceBindingPresentation }]
        : []),
      implement(coreContracts.plugins.bootstrap, () => ({ product: { id: "pruef", title: "Prüfung" }, plugins: [], startEntries })),
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
      implement(runContracts.view, ({ runId }) => views.get(runId) ?? null),
      implement(runContracts.events, ({ runId }) => journalRecords(runId, messages[0]?.text ?? "").flatMap((record) => {
        const { occurredAt, events } = record as { occurredAt: string; events: { sequence: number; type: string; payload: unknown }[] };
        return events.map((event) => ({ ...event, runId, actorId: PRIMARY, occurredAt }));
      }) as JournalEvent[]),
      implement(runContracts.interruptTurn, ({ runId, actorId }) => {
        interrupted.push({ runId, actorId });
        return views.get(runId)!;
      }),
    ],
    channels: [
      implementChannel(coreContracts.channels.run, ({ runId }, emit) => {
        emit({ kind: "ready" });
        const notify = () => emit({ kind: "run" });
        const set = watchers.get(runId) ?? new Set();
        set.add(notify);
        watchers.set(runId, set);
        return () => { set.delete(notify); };
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
    if (previous.url === undefined) delete process.env.RAGENTS_URL;
    else process.env.RAGENTS_URL = previous.url;
  });
  writeHostRecord(directory, { profile: "developer", url: server.url, pid: process.pid, log: path.join(directory, "host.log"), startedAt: new Date().toISOString() });
  const profileFile = path.join(directory, "ragents.config.pruef.ts");
  writeFileSync(profileFile, `export const config = { host: { PORT: ${port}, PRODUCT_PROFILE: "pruef" } };\n`);
  return { directory, profileFile, server, running, selections, stopped, interrupted, entries, messages, lines: [] as string[] };
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
  assert.deepEqual(context.lines.slice(0, 3), ["> read", "< read 2.5s ok", "Erledigt."]);
  assert.match(context.lines.at(-1)!, /^run: [0-9a-f-]{36}$/);
  assert.equal(existsSync(path.join(context.directory, "runs")), false, "der Turn kam über den Server, nicht aus einer Journaldatei");
});

test("run und send folgen einem Server mit anderem Datenordner über RAGENTS_URL, journal liest dort", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  const url = readHostRecord(context.directory)!.url;
  const elsewhere = await mkdtemp(path.join(tmpdir(), "ragents-agent-cli-local-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  process.env.DATA_DIR = elsewhere;
  process.env.RAGENTS_URL = url;
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Baue", entry: undefined, json: false }, collect(context.lines)), 0);
  const runId = context.messages[0]!.runId;
  assert.deepEqual(context.lines, ["> read", "< read 2.5s ok", "Erledigt.", `run: ${runId}`]);
  const followUp: string[] = [];
  assert.equal(await execute({ kind: "send", profile: "developer", runId, text: "Weiter", json: false }, collect(followUp)), 0);
  assert.deepEqual(followUp, ["> read", "< read 2.5s ok", "Erledigt.", `run: ${runId}`]);
  const journal: string[] = [];
  assert.equal(await execute({ kind: "journal", profile: "developer", runId, json: false, tools: true }, collect(journal)), 0);
  assert.deepEqual(journal, ["[3] started agent_coordina read: {\"path\":\"src/broken.ts\"}", "-- letzte Sequenz: 6"]);
  assert.equal(existsSync(path.join(elsewhere, "runs")), false);
});

test("reißt die Verbindung ab, endet run mit Ursache statt zu warten", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed", { hold: true });
  const pending = execute({ kind: "run", profile: "developer", folder: context.directory, text: "Baue", entry: undefined, json: false }, collect(context.lines));
  await context.running;
  context.server.transport.close();
  await assert.rejects(pending, /Der Turn in [0-9a-f-]{36} lässt sich über http:\/\/127\.0\.0\.1:\d+ nicht weiter verfolgen und läuft dort womöglich weiter: \S/);
  assert.equal(context.lines.includes("run: " + context.messages[0]!.runId), false);
});

test("run --workstation bindet den Ordner auf dem angemeldeten Arbeitsplatz, ein unbekannter bricht mit Ursache ab", { timeout: 20_000 }, async (t) => {
  const workstation: WorkspaceClientInfo = { id: "laptop-0001", label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/user/project"], runsDirectory: "/home/user/runs" };
  const context = await harness(t, "completed", { clients: [workstation] });
  const run = { kind: "run", profile: "developer", folder: "/home/user/project", text: "Baue", entry: undefined, json: false } as const;
  assert.equal(await execute({ ...run, workstation: "laptop-0001" }, collect(context.lines)), 0);
  assert.deepEqual(context.selections[0]!.value, { machine: { client: "laptop-0001", label: "Laptop" }, folder: { path: "/home/user/project" } });
  await assert.rejects(execute({ ...run, workstation: "desktop-0002" }),
    /kein Arbeitsplatz mit der Kennung desktop-0002 angemeldet; angemeldet: laptop-0001 \(Laptop\)/);
  assert.equal(context.selections.length, 1);
  assert.equal(context.messages.length, 1, "ohne Arbeitsplatz geht kein Auftrag hinaus");
  const unbound = await harness(t, "completed", { binding: false });
  await assert.rejects(execute({ ...run, workstation: "laptop-0001" }), /ohne Ordnerbindung gibt es keinen Arbeitsplatz/);
  assert.deepEqual(unbound.messages, []);
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
  const steps = followUp.slice(0, -1).map((line) => JSON.parse(line) as { kind: string; output?: { sequence: number }; status?: string });
  assert.deepEqual(steps.map((step) => step.kind), ["tool", "tool-end", "output", "turn"]);
  assert.equal(steps[2]!.output!.sequence, 15, "nur der neue Turn, nicht der erste");
  assert.equal(steps[3]!.status, "completed");
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
  const file = journalFile(context.directory, runId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, journalRecords(runId, "Auftrag").map((record) => `${JSON.stringify(record)}\n`).join(""));
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
  const context = await harness(t, "completed", { binding: false });
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Auftrag ohne Bindung", entry: undefined, json: false }, collect(context.lines)), 0);
  assert.deepEqual(context.selections, []);
  assert.equal(context.messages[0]!.text, "Auftrag ohne Bindung");
});

test("run ohne Ordner wählt keine Bindung; Profil oder Vorlage bestimmen sie", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: undefined, text: "Auftrag ohne Ordner", entry: undefined, json: false }, collect(context.lines)), 0);
  assert.deepEqual(context.selections, []);
  assert.equal(context.messages[0]!.text, "Auftrag ohne Ordner");
  assert.match(context.lines.at(-1)!, /^run: [0-9a-f-]{36}$/);
});

test("legt die Vorlage die Bindung fest, bricht run mit genanntem Ordner ab, ohne Ordner läuft er", { timeout: 20_000 }, async (t) => {
  const fresh: PublicStartEntry = { id: "example.fresh", owner: "example", title: "Frisch", description: "Arbeitet in einem neuen Ordner", action: "script",
    coordinator: true, fixedStartOptions: { [WORKSPACE_BINDING_OPTION_ID]: { machine: "server", folder: "fresh" } } };
  const free: PublicStartEntry = { id: "example.free", owner: "example", title: "Frei", description: "Nimmt jeden Ordner", action: "script", coordinator: true };
  const context = await harness(t, "completed", { startEntries: [fresh, free] });
  const run = { kind: "run", profile: "developer", folder: context.directory, text: "Baue", json: false } as const;
  await assert.rejects(execute({ ...run, entry: "example.fresh" }),
    /Die Vorlage example\.fresh legt die Ordnerbindung selbst fest \(\{"machine":"server","folder":"fresh"\}\), genannt ist aber der Ordner .*Lass <ordner> weg/);
  await assert.rejects(execute({ ...run, entry: "example.fehlt" }), /Die Vorlage example\.fehlt gibt es in diesem Profil nicht/);
  assert.deepEqual([context.selections.length, context.entries.length, context.messages.length], [0, 0, 0], "vor dem Fehler geht nichts an den Server");
  assert.equal(await execute({ ...run, folder: undefined, entry: "example.fresh" }, collect(context.lines)), 0);
  assert.equal(context.selections.length, 0, "ohne Ordner bleibt die Bindung der Vorlage");
  assert.deepEqual(context.entries, ["example.fresh"]);
  assert.equal(await execute({ ...run, entry: "example.free" }, collect(context.lines)), 0);
  assert.deepEqual(context.selections.map((selection) => selection.value), [{ machine: "server", folder: { path: context.directory } }]);
  assert.deepEqual(context.entries, ["example.fresh", "example.free"]);
});

test("eine Vorlage darf ihren Chatpartner erst einrichten; der Auftrag wartet darauf", { timeout: 20_000 }, async (t) => {
  const implementTask: PublicStartEntry = { id: "workshop.tickets.implement-task", owner: "workshop", title: "Umsetzen", description: "Setzt einen Auftrag um",
    action: "script", coordinator: false };
  const context = await harness(t, "completed", { binding: false, refusals: 2, startEntries: [implementTask] });
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
  assert.deepEqual(parseArguments(["run", "/work", "Baue", "--workstation", "laptop-0001"]), {
    kind: "run", profile: "developer", folder: "/work", text: "Baue", entry: undefined, json: false, workstation: "laptop-0001",
  });
  assert.throws(() => parseArguments(["run", "/work", "Baue", "--workstation", "kurz"]), /Ungültige Arbeitsplatz-Kennung/);
  assert.deepEqual(parseArguments(["run", "Baue das", "--entry", "ragents.reference.word-game"]), {
    kind: "run", profile: "developer", folder: undefined, text: "Baue das", entry: "ragents.reference.word-game", json: false,
  }, "ein einzelner Wert ist immer der Auftrag, auch wenn er wie ein Pfad aussieht");
  assert.equal((parseArguments(["run", "/work"]) as { text: string }).text, "/work");
  assert.throws(() => parseArguments(["run", "Baue", "--workstation", "laptop-0001"]), /--workstation braucht <ordner>/);
  assert.deepEqual(parseArguments(["journal", "abc", "--tools"]), { kind: "journal", profile: "developer", runId: "abc", json: false, tools: true });
  assert.deepEqual(parseArguments(["stop", "--host"]), { kind: "stop-host", profile: "developer" });
  assert.deepEqual(parseArguments(["stop", "--host", "--profile", "/eigen/ragents.config.workshop.ts"]), { kind: "stop-host", profile: "/eigen/ragents.config.workshop.ts" });
  assert.deepEqual(parseArguments(["stop", "abc"]), { kind: "stop", profile: "developer", runId: "abc" });
  assert.deepEqual(parseArguments(["stop", "abc", "--run"]), { kind: "stop-run", profile: "developer", runId: "abc" });
  assert.throws(() => parseArguments(["stop", "--host", "--run"]), /entweder --host oder --run/);
  assert.throws(() => parseArguments(["stop", "--run"]), /stop braucht/);
  assert.throws(() => parseArguments([]), /Verwendung/);
  assert.throws(() => parseArguments(["tanzen"]), /Unbekannter Befehl/);
  assert.throws(() => parseArguments(["run"]), /run braucht "<auftrag>"/);
  assert.throws(() => parseArguments(["run", "/work", ""]), /run braucht "<auftrag>"/);
  assert.throws(() => parseArguments(["run", "/work", "Baue", "zuviel"]), /höchstens zwei Werte/);
  assert.throws(() => parseArguments(["run", "/work", "Baue", "--unbekannt"]), /Unbekanntes Argument/);
  assert.throws(() => parseArguments(["run", "/work", "Baue", "--profile"]), /braucht einen Wert/);
  assert.throws(() => parseArguments(["send", "../flucht", "Text"]), /Ungültige Run-Id/);
  assert.throws(() => parseArguments(["stop", "--host", "abc"]), /keine Run-Id/);
});

test("send folgt einer Nachricht, die als Steering in einen laufenden Turn kam, bis zu dessen Ende", () => {
  const input = (id: string, sequence: number, content: string, turnId: string, steered: boolean) => ({ id, actorId: PRIMARY, content, artifactIds: [],
    enqueuedBy: OWNER, enqueuedAt: `2026-09-24T10:00:0${sequence}.000Z`, sequence, lifecycle: { kind: "claimed", turnId, steered }, subscriptionId: null, sourceEventIds: [] });
  const view = (status: string, reason: string | null) => ({
    id: "run-1", ownerId: OWNER, primaryActorId: PRIMARY,
    inputs: [input("input-1", 1, "Baue die Seite.", "turn-1", false), input("input-2", 3, "Nimm Blau.", "turn-1", true)],
    turns: [{ id: "turn-1", actorId: PRIMARY, inputId: "input-1", status, startedAt: "2026-09-24T10:00:02.000Z", finishedAt: status === "running" ? null : "2026-09-24T10:00:09.000Z",
      reason, usage: {}, toolCalls: [],
      outputs: [{ text: "Ich baue.", sequence: 2, occurredAt: "2026-09-24T10:00:02.500Z" }, { text: "Blau ist gesetzt.", sequence: 5, occurredAt: "2026-09-24T10:00:08.000Z" }] }],
  }) as unknown as RunView;
  const known = new Set(["input-1"]);
  assert.deepEqual(progressOf(view("running", null), known, "Nimm Blau.").outcome, undefined);
  const completed = progressOf(view("completed", null), known, " Nimm Blau. ");
  assert.equal(completed.outcome, "completed");
  assert.deepEqual(completed.entries.map((entry) => entry.line), ["Blau ist gesetzt.", undefined], "was vor der eigenen Nachricht kam, gehört nicht dazu");
  const failed = progressOf(view("failed", "Modellfehler"), known, "Nimm Blau.");
  assert.deepEqual([failed.outcome, failed.reason, failed.entries.at(-1)!.line], ["failed", "Modellfehler", "! Turn fehlgeschlagen: Modellfehler"]);
  const interrupted = progressOf(view("interrupted", "Vom Bediener gestoppt"), known, "Nimm Blau.");
  assert.deepEqual([interrupted.outcome, interrupted.entries.at(-1)!.line], ["interrupted", "! Turn abgebrochen: Vom Bediener gestoppt"]);
  assert.equal(progressOf(view("completed", null), new Set(["input-1", "input-2"]), "Nimm Blau.").outcome, undefined, "eine alte Eingabe mit gleichem Text zählt nicht");
});
