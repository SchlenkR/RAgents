import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { implement, implementChannel, type HttpRouteContribution, type JournalEvent } from "@ragents/engine";
import { DomainError } from "../../packages/ragents/src/runtime/domain-error.ts";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";
import type { RunSharing, RunView } from "../../packages/ragents/src/domain/model.ts";
import type { PublicStartEntry } from "../../packages/ragents/src/plugin-types.ts";
import { hostRecordFile, readHostRecord, writeHostRecord } from "../../apps/server/src/host-record.ts";
import { callerDirectory } from "../../apps/server/src/profile-target.ts";
import { startRpcServer } from "../../apps/server/tests/rpc-fixture.ts";
import { WORKSPACE_BINDING_OPTION_ID, type WorkspaceBindingPresentation, type WorkspaceClientInfo } from "../../plugins/ragents.workspace/contract.ts";
import { noteHost } from "../remote/connect.ts";
import { commands as facadeCommands } from "../package/ragents.mjs";
import { execute, parseArguments, parseShareSpec, progressOf, usage, type TurnOutcome } from "./agent-cli.ts";
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

/** The journal lines of a finished turn as the server writes them; needed only for journal. */
const journalRecords = (runId: string, text: string): readonly unknown[] => [
  { runId, command: { actorId: PRIMARY }, occurredAt: "2026-09-21T10:00:00.000Z", events: [
    { sequence: 1, type: "actor.input.enqueued", payload: { inputId: "input-0", actorId: PRIMARY, content: text } },
    { sequence: 2, type: "turn.started", payload: { turnId: "turn-0", inputId: "input-0" } },
    { sequence: 3, type: "tool.call.started", payload: { turnId: "turn-0", toolCallId: "call-1", name: "read", input: { path: "src/broken.ts" } } },
  ] },
  { runId, command: { actorId: PRIMARY }, occurredAt: "2026-09-21T10:00:02.500Z", events: [
    { sequence: 4, type: "tool.call.completed", payload: { turnId: "turn-0", toolCallId: "call-1", name: "read", output: "const a = 1;" } },
    { sequence: 5, type: "model.output.completed", payload: { turnId: "turn-0", text: "Done." } },
    { sequence: 6, type: "turn.finished", payload: { turnId: "turn-0", outcome: "completed" } },
  ] },
];

interface HarnessOptions {
  readonly binding?: boolean;
  readonly refusals?: number;
  readonly clients?: WorkspaceClientInfo[];
  readonly startEntries?: PublicStartEntry[];
  /** The turn stops after the first tool call until the test does something. */
  readonly hold?: boolean;
}

/** A server that advances a turn in the run view for every message and reports it in the channel ragents.run, without a journal file. */
const harness = async (t: TestContext, outcome: TurnOutcome, options: HarnessOptions = {}) => {
  const { binding = true, refusals = 0, clients = [], startEntries = [] } = options;
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-agent-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const selections: Selection[] = [];
  const stopped: string[] = [];
  const interrupted: { runId: string; actorId: string }[] = [];
  const paused: { runId: string; reason: string | undefined }[] = [];
  const resumed: string[] = [];
  const entries: string[] = [];
  const messages: { runId: string; text: string }[] = [];
  const shares: { runId: string; sharing: RunSharing; before: number }[] = [];
  const sharings = new Map<string, RunSharing>();
  const views = new Map<string, RunView>();
  const watchers = new Map<string, Set<() => void>>();
  let reachRunning = (): void => undefined;
  const running = new Promise<void>((resolve) => { reachRunning = resolve; });
  let refused = 0;
  const update = (runId: string, change: (view: RunView) => RunView): void => {
    const current = views.get(runId) ?? { id: runId, ownerId: OWNER, primaryActorId: PRIMARY, inputs: [], turns: [], actions: [] } as unknown as RunView;
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
        reason: outcome === "failed" ? "Model error" : outcome === "interrupted" ? "Stopped by the operator" : null,
        toolCalls: [{ ...call, status: "completed", finishedAt: "2026-09-21T10:00:02.500Z" }],
        outputs: [{ text: "Done.", sequence: index * 10 + 5, occurredAt: "2026-09-21T10:00:02.600Z" }],
      }) })), 10);
    }, 10);
    messages.push({ runId, text });
  };
  const server = await startRpcServer(t, {
    routes: [health],
    methods: [
      implement(coreContracts.startOptions.list, () => binding
        ? [{ id: WORKSPACE_BINDING_OPTION_ID, owner: "ragents.workspace", value: null, selectable: true, locked: false,
          presentation: { kind: "workspace-binding", clients, fresh: { server: "New folder", client: null }, serverFolders: true } satisfies WorkspaceBindingPresentation }]
        : []),
      implement(coreContracts.plugins.bootstrap, () => ({ product: { id: "check", title: "Check" }, plugins: [], startEntries })),
      implement(coreContracts.startOptions.select, ({ runId, optionId, value }) => {
        selections.push({ runId, optionId, value });
        return { id: optionId, owner: "test", value, presentation: null, selectable: true, locked: false };
      }),
      implement(coreContracts.chat.start, ({ entry }) => {
        entries.push(entry);
        return null;
      }),
      implement(coreContracts.runs.scripts, () => [
        { id: "demo.review", title: "Review", description: "Reviews the run", available: true },
        { id: "demo.setup", title: "Setup", description: "Sets up a run", available: false, reason: "It starts only a new run." },
      ]),
      implement(coreContracts.runs.startScript, ({ entry, input }) => {
        entries.push(`${entry}:${JSON.stringify(input)}`);
        if (entry === "demo.setup") throw new DomainError("run-started", "The run is already running.", 409);
        return { actorId: "script-1", handle: "review", count: 2 };
      }),
      implement(coreContracts.chat.send, ({ runId, text }) => {
        if (refused < refusals) {
          refused += 1;
          throw new DomainError("actor-chat-unsupported", "@implement-task is a TypeScript actor and not a chat partner.", 400);
        }
        turn(runId, text ?? "");
        return null;
      }),
      implement(coreContracts.chat.stop, ({ runId }) => {
        stopped.push(runId);
        return null;
      }),
      implement(coreContracts.runs.share, ({ runId, sharing }) => {
        const unknown = sharing.users.find((user) => user.userId === "zoe");
        if (unknown) throw new DomainError("share-user-unknown", "zoe is not a user of this profile; users to share with: bob, carol.", 400);
        shares.push({ runId, sharing, before: messages.length });
        sharings.set(runId, sharing);
        return sharingResult(sharings.get(runId)!);
      }),
      implement(coreContracts.runs.sharing, ({ runId }) => sharingResult(sharings.get(runId) ?? { everyone: null, users: [] })),
      implement(runContracts.view, ({ runId }) => views.get(runId) ?? null),
      implement(runContracts.events, ({ runId }) => journalRecords(runId, messages[0]?.text ?? "").flatMap((record) => {
        const { occurredAt, events } = record as { occurredAt: string; events: { sequence: number; type: string; payload: unknown }[] };
        return events.map((event) => ({ ...event, runId, actorId: PRIMARY, occurredAt }));
      }) as JournalEvent[]),
      implement(runContracts.interruptTurn, ({ runId, actorId }) => {
        interrupted.push({ runId, actorId });
        return views.get(runId)!;
      }),
      implement(runContracts.pause, ({ runId, reason }) => {
        paused.push({ runId, reason });
        update(runId, (view) => ({ ...view, pause: { pausedAt: "2026-09-21T10:00:04.000Z", reason: reason ?? "Paused by the operator", userId: null } }));
        return views.get(runId)!;
      }),
      implement(runContracts.resume, ({ runId }) => {
        resumed.push(runId);
        update(runId, (view) => ({ ...view, pause: null }));
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
  const profileFile = path.join(directory, "ragents.config.check.ts");
  writeFileSync(profileFile, `export const config = { host: { PORT: ${port}, PRODUCT_PROFILE: "check" } };\n`);
  return { directory, profileFile, server, running, selections, stopped, interrupted, paused, resumed, entries, messages, shares, lines: [] as string[] };
};

const collect = (lines: string[]) => (line: string): void => { lines.push(line); };

const LABELS: Readonly<Record<string, string>> = { bob: "Bob", carol: "Carol" };

const sharingResult = (sharing: RunSharing) => ({
  sharing: { everyone: sharing.everyone, users: sharing.users.map((user) => ({ ...user, label: LABELS[user.userId] ?? user.userId })) },
  users: [{ id: "bob", label: "Bob" }, { id: "carol", label: "Carol" }],
});

test("run binds the folder via path, waits for the end of the turn and names the run", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  assert.equal(callerDirectory(), path.dirname(context.directory), "a relative folder is resolved from the caller, not from apps/server");
  const relative = path.basename(context.directory);
  const code = await execute({ kind: "run", profile: "developer", folder: relative, text: "Fix the type error", entry: undefined, json: false }, collect(context.lines));
  assert.equal(code, 0);
  assert.equal(context.selections.length, 1);
  assert.equal(context.selections[0]!.optionId, WORKSPACE_BINDING_OPTION_ID);
  assert.deepEqual(context.selections[0]!.value, { machine: "server", folder: { path: context.directory } });
  assert.equal(context.messages[0]!.text, "Fix the type error");
  assert.deepEqual(context.lines.slice(0, 3), ["> read", "< read 2.5s ok", "Done."]);
  assert.match(context.lines.at(-1)!, /^run: [0-9a-f-]{36}$/);
  assert.equal(existsSync(path.join(context.directory, "runs")), false, "the turn came through the server, not from a journal file");
});

test("run and send follow a server with another data folder through RAGENTS_URL, journal reads there", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  const url = readHostRecord(context.directory)!.url;
  const elsewhere = await mkdtemp(path.join(tmpdir(), "ragents-agent-cli-local-"));
  t.after(() => rm(elsewhere, { recursive: true, force: true }));
  process.env.DATA_DIR = elsewhere;
  process.env.RAGENTS_URL = url;
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Build", entry: undefined, json: false }, collect(context.lines)), 0);
  const runId = context.messages[0]!.runId;
  assert.deepEqual(context.lines, ["> read", "< read 2.5s ok", "Done.", `run: ${runId}`]);
  const followUp: string[] = [];
  assert.equal(await execute({ kind: "send", profile: "developer", runId, text: "Continue", json: false }, collect(followUp)), 0);
  assert.deepEqual(followUp, ["> read", "< read 2.5s ok", "Done.", `run: ${runId}`]);
  const journal: string[] = [];
  assert.equal(await execute({ kind: "journal", profile: "developer", runId, json: false, tools: true }, collect(journal)), 0);
  assert.deepEqual(journal, ["[3] started agent_coordina read: {\"path\":\"src/broken.ts\"}", "-- last sequence: 6"]);
  assert.equal(existsSync(path.join(elsewhere, "runs")), false);
});

test("if the connection breaks, run ends with the cause instead of waiting", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed", { hold: true });
  const pending = execute({ kind: "run", profile: "developer", folder: context.directory, text: "Build", entry: undefined, json: false }, collect(context.lines));
  await context.running;
  context.server.transport.close();
  await assert.rejects(pending, /The turn in [0-9a-f-]{36} can no longer be followed through http:\/\/127\.0\.0\.1:\d+ and may still be running there: \S/);
  assert.equal(context.lines.includes("run: " + context.messages[0]!.runId), false);
});

test("run --workstation binds the folder on the registered workstation, an unknown one aborts with the cause", { timeout: 20_000 }, async (t) => {
  const workstation: WorkspaceClientInfo = { id: "laptop-0001", label: "Laptop", hostname: "laptop", platform: "linux", folders: ["/home/user/project"], runsDirectory: "/home/user/runs", ripgrep: true };
  const context = await harness(t, "completed", { clients: [workstation] });
  const run = { kind: "run", profile: "developer", folder: "/home/user/project", text: "Build", entry: undefined, json: false } as const;
  assert.equal(await execute({ ...run, workstation: "laptop-0001" }, collect(context.lines)), 0);
  assert.deepEqual(context.selections[0]!.value, { machine: { client: "laptop-0001", label: "Laptop" }, folder: { path: "/home/user/project" } });
  await assert.rejects(execute({ ...run, workstation: "desktop-0002" }),
    /No workstation with the id desktop-0002 is registered with the host; registered: laptop-0001 \(Laptop\)/);
  assert.equal(context.selections.length, 1);
  assert.equal(context.messages.length, 1, "without a workstation no task goes out");
  const unbound = await harness(t, "completed", { binding: false });
  await assert.rejects(execute({ ...run, workstation: "laptop-0001" }), /without a folder binding there is no workstation/);
  assert.deepEqual(unbound.messages, []);
});

test("a cancelled turn ends with 2, a failed one with 1", { timeout: 20_000 }, async (t) => {
  const interrupted = await harness(t, "interrupted");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: interrupted.directory, text: "Build", entry: undefined, json: false }, collect(interrupted.lines)), 2);
  assert.equal(interrupted.lines.some((line) => line.startsWith("! Turn cancelled")), true);
});

test("a failed turn ends with 1", { timeout: 20_000 }, async (t) => {
  const failed = await harness(t, "failed");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: failed.directory, text: "Build", entry: undefined, json: false }, collect(failed.lines)), 1);
  assert.equal(failed.lines.some((line) => line.startsWith("! Turn failed")), true);
});

test("send continues in the same run and reads only the new turn", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "First task", entry: undefined, json: false }, collect(context.lines)), 0);
  const runId = context.messages[0]!.runId;
  const followUp: string[] = [];
  assert.equal(await execute({ kind: "send", profile: "developer", runId, text: "Second task", json: true }, collect(followUp)), 0);
  assert.deepEqual(context.messages.map((entry) => entry.runId), [runId, runId]);
  const steps = followUp.slice(0, -1).map((line) => JSON.parse(line) as { kind: string; output?: { sequence: number }; status?: string });
  assert.deepEqual(steps.map((step) => step.kind), ["tool", "tool-end", "output", "turn"]);
  assert.equal(steps[2]!.output!.sequence, 15, "only the new turn, not the first");
  assert.equal(steps[3]!.status, "completed");
  assert.equal(followUp.at(-1), `run: ${runId}`);
});

test("stop pauses the run, resume continues it, --turn interrupts only the turn of the primary actor, --run stops the whole run, journal reads the history", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Task", entry: undefined, json: false }, collect(context.lines)), 0);
  const runId = context.messages[0]!.runId;
  assert.equal(await execute({ kind: "resume", profile: "developer", runId }), 0);
  assert.deepEqual(context.resumed, [], "a run that is not paused needs no resume");
  assert.equal(await execute({ kind: "pause", profile: "developer", runId }), 0);
  assert.deepEqual(context.paused, [{ runId, reason: "Paused with ragents stop" }]);
  assert.deepEqual([context.interrupted, context.stopped], [[], []], "stop neither interrupts a single turn nor stops the run");
  assert.equal(await execute({ kind: "resume", profile: "developer", runId }), 0);
  assert.deepEqual(context.resumed, [runId]);
  assert.equal(await execute({ kind: "stop-turn", profile: "developer", runId }), 0);
  assert.deepEqual(context.interrupted, [{ runId, actorId: "agent_coordinator" }]);
  assert.deepEqual(context.stopped, [], "stop --turn must not stop the run");
  assert.equal(await execute({ kind: "stop-run", profile: "developer", runId }), 0);
  assert.deepEqual(context.stopped, [runId]);
  assert.deepEqual([context.interrupted.length, context.paused.length], [1, 1]);
  const file = journalFile(context.directory, runId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, journalRecords(runId, "Task").map((record) => `${JSON.stringify(record)}\n`).join(""));
  const journal: string[] = [];
  assert.equal(await execute({ kind: "journal", profile: "developer", runId, json: false, tools: true }, collect(journal)), 0);
  assert.deepEqual(journal, ["[3] started agent_coordina read: {\"path\":\"src/broken.ts\"}", "-- last sequence: 6"]);
});

test("script lists the run scripts of a run and starts one inside it, errors come back as such", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  const runId = "7b1f0c9e-5d2a-4c8e-9f3b-2a6d8e4c1b70";
  assert.equal(await execute({ kind: "script", profile: "developer", runId, entry: undefined, input: null, json: false }, collect(context.lines)), 0);
  assert.deepEqual(context.lines, ["demo.review  Review", "demo.setup  Setup (not available: It starts only a new run.)"]);
  const started: string[] = [];
  assert.equal(await execute({ kind: "script", profile: "developer", runId, entry: "demo.review", input: { topic: "Launch" }, json: false }, collect(started)), 0);
  assert.deepEqual(started, ["script: @review, start 2", `run: ${runId}`]);
  assert.deepEqual(context.entries, ['demo.review:{"topic":"Launch"}']);
  await assert.rejects(execute({ kind: "script", profile: "developer", runId, entry: "demo.setup", input: null, json: false }, collect([])), /already running/);
});

test("stop --host stops the remembered host and removes the record", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  writeHostRecord(context.directory, { profile: "developer", url: "http://localhost:1", pid: 2147483646, log: "log", startedAt: "2026-09-21T10:00:00.000Z" });
  assert.equal(readHostRecord(context.directory)?.pid, 2147483646);
  assert.equal(await execute({ kind: "stop-host", profile: "developer" }), 0);
  assert.equal(readHostRecord(context.directory), undefined);
  await assert.rejects(execute({ kind: "stop-host", profile: "developer" }), new RegExp(hostRecordFile(context.directory).replaceAll(".", "\\.")));
});

test("stop --host stops no process that the host at the remembered address does not report as its own", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  const foreign = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  t.after(() => { foreign.kill("SIGKILL"); });
  const url = `http://localhost:${process.env.PORT}`;
  writeHostRecord(context.directory, { profile: "developer", url, pid: foreign.pid!, log: "log", startedAt: "2026-09-21T10:00:00.000Z" });
  await assert.rejects(execute({ kind: "stop-host", profile: "developer" }), new RegExp(`another host \\(PID ${process.pid}\\); the remembered PID ${foreign.pid} .* is not stopped`));
  assert.equal(foreign.exitCode, null);
  assert.equal(foreign.signalCode, null);
  assert.doesNotThrow(() => process.kill(foreign.pid!, 0));
  assert.equal(readHostRecord(context.directory), undefined);
});

test("run takes the profile as a path to an own profile file", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  const relative = path.relative(callerDirectory(), context.profileFile);
  assert.equal(await execute({ kind: "run", profile: relative, folder: context.directory, text: "Task at the path", entry: undefined, json: false }, collect(context.lines)), 0);
  assert.equal(context.messages[0]!.text, "Task at the path");
  assert.equal(readHostRecord(context.directory)?.profile, "developer", "the profile's data folder carries the host record");
  await assert.rejects(execute({ kind: "run", profile: path.join(context.directory, "ragents.config.missing.ts"), folder: context.directory, text: "x", entry: undefined, json: false }),
    /The profile file is missing/);
  await assert.rejects(execute({ kind: "run", profile: "doesnotexist", folder: context.directory, text: "x", entry: undefined, json: false }),
    /The profile file is missing.*ragents\.config\.doesnotexist\.ts/);
});

test("stop --host also stops the host that ragents start remembered", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  noteHost("check", context.directory, 4739)!(2147483646);
  const noted = readHostRecord(context.directory)!;
  assert.equal(noted.url, "http://localhost:4739");
  assert.equal(noted.log, path.join(context.directory, "logs", "server.log"));
  assert.equal(await execute({ kind: "stop-host", profile: context.profileFile }), 0);
  assert.equal(readHostRecord(context.directory), undefined);
});

test("a profile without the folder binding still starts the run", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed", { binding: false });
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Task without binding", entry: undefined, json: false }, collect(context.lines)), 0);
  assert.deepEqual(context.selections, []);
  assert.equal(context.messages[0]!.text, "Task without binding");
});

test("run without a folder chooses no binding; profile or template determine it", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  assert.equal(await execute({ kind: "run", profile: "developer", folder: undefined, text: "Task without folder", entry: undefined, json: false }, collect(context.lines)), 0);
  assert.deepEqual(context.selections, []);
  assert.equal(context.messages[0]!.text, "Task without folder");
  assert.match(context.lines.at(-1)!, /^run: [0-9a-f-]{36}$/);
});

test("if the template fixes the binding, run with a given folder aborts, without a folder it runs", { timeout: 20_000 }, async (t) => {
  const fresh: PublicStartEntry = { id: "example.fresh", owner: "example", title: "Fresh", description: "Works in a new folder", action: "script",
    coordinator: true, fixedStartOptions: { [WORKSPACE_BINDING_OPTION_ID]: { machine: "server", folder: "fresh" } } };
  const free: PublicStartEntry = { id: "example.free", owner: "example", title: "Free", description: "Takes any folder", action: "script", coordinator: true };
  const context = await harness(t, "completed", { startEntries: [fresh, free] });
  const run = { kind: "run", profile: "developer", folder: context.directory, text: "Build", json: false } as const;
  await assert.rejects(execute({ ...run, entry: "example.fresh" }),
    /The template example\.fresh fixes the folder binding itself \(\{"machine":"server","folder":"fresh"\}\), but the folder .* was given\. Leave out <folder>/);
  await assert.rejects(execute({ ...run, entry: "example.missing" }), /The template example\.missing does not exist in this profile/);
  assert.deepEqual([context.selections.length, context.entries.length, context.messages.length], [0, 0, 0], "before the error nothing goes to the server");
  assert.equal(await execute({ ...run, folder: undefined, entry: "example.fresh" }, collect(context.lines)), 0);
  assert.equal(context.selections.length, 0, "without a folder the template's binding stays");
  assert.deepEqual(context.entries, ["example.fresh"]);
  assert.equal(await execute({ ...run, entry: "example.free" }, collect(context.lines)), 0);
  assert.deepEqual(context.selections.map((selection) => selection.value), [{ machine: "server", folder: { path: context.directory } }]);
  assert.deepEqual(context.entries, ["example.fresh", "example.free"]);
});

test("a template may set up its chat partner first; the task waits for it", { timeout: 20_000 }, async (t) => {
  const implementTask: PublicStartEntry = { id: "workshop.tickets.implement-task", owner: "workshop", title: "Implement", description: "Implements a task",
    action: "script", coordinator: false };
  const context = await harness(t, "completed", { binding: false, refusals: 2, startEntries: [implementTask] });
  assert.equal(await execute({ kind: "run", profile: "developer", folder: context.directory, text: "Task at the template", entry: "workshop.tickets.implement-task", json: false }, collect(context.lines)), 0);
  assert.deepEqual(context.entries, ["workshop.tickets.implement-task"]);
  assert.equal(context.messages[0]!.text, "Task at the template");
});

test("RAGENTS_PROFILE is the default profile of all agent commands", (t) => {
  const previous = process.env.RAGENTS_PROFILE;
  t.after(() => {
    if (previous === undefined) delete process.env.RAGENTS_PROFILE;
    else process.env.RAGENTS_PROFILE = previous;
  });
  process.env.RAGENTS_PROFILE = "/own/ragents.config.workshop.ts";
  assert.deepEqual(parseArguments(["stop", "--host"]), { kind: "stop-host", profile: "/own/ragents.config.workshop.ts" });
  assert.deepEqual(parseArguments(["stop", "--host", "--profile", "core"]), { kind: "stop-host", profile: "core" });
});

test("the facade shows the usage with --help and help, without an argument it stays an error", () => {
  const facade = fileURLToPath(new URL("../package/ragents.mjs", import.meta.url));
  for (const argument of ["--help", "help"]) {
    const shown = spawnSync(process.execPath, [facade, argument], { encoding: "utf8" });
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /^Usage: ragents <command>/);
  }
  const empty = spawnSync(process.execPath, [facade], { encoding: "utf8" });
  assert.equal(empty.status, 1);
  assert.match(empty.stderr, /^Usage: ragents <command>/);
  const unknown = spawnSync(process.execPath, [facade, "dance"], { encoding: "utf8" });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown command: dance/);
});

test("the facade hands every agent command to the agent command line and lists resume", () => {
  for (const command of ["run", "send", "journal", "stop", "resume", "script", "share"]) {
    assert.equal((facadeCommands as Readonly<Record<string, string>>)[command], "scripts/agent/agent-cli.ts", command);
  }
  const facade = fileURLToPath(new URL("../package/ragents.mjs", import.meta.url));
  assert.match(spawnSync(process.execPath, [facade, "--help"], { encoding: "utf8" }).stdout, /\n {2}resume <run> /);
  assert.match(usage(), /\n {2}resume <run> \[--profile <p>\]/);
  assert.match(usage(), /\n {2}stop <run> --turn \[--profile <p>\]/);
});

test("the facade prints the version of its package with --version and -v", () => {
  const facade = fileURLToPath(new URL("../package/ragents.mjs", import.meta.url));
  const expected = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
  for (const argument of ["--version", "-v"]) {
    const shown = spawnSync(process.execPath, [facade, argument], { encoding: "utf8" });
    assert.equal(shown.status, 0, shown.stderr);
    assert.equal(shown.stdout, `${expected}\n`);
  }
});

test("the command line names command, folder, task and switches", () => {
  assert.deepEqual(parseArguments(["run", "/work/project", "Build this"]), {
    kind: "run", profile: "developer", folder: "/work/project", text: "Build this", entry: undefined, json: false,
  });
  assert.deepEqual(parseArguments(["run", "/work", "Build", "--profile", "core", "--entry", "ragents.reference.word-game", "--json"]), {
    kind: "run", profile: "core", folder: "/work", text: "Build", entry: "ragents.reference.word-game", json: true,
  });
  assert.deepEqual(parseArguments(["run", "/work", "Build", "--workstation", "laptop-0001"]), {
    kind: "run", profile: "developer", folder: "/work", text: "Build", entry: undefined, json: false, workstation: "laptop-0001",
  });
  assert.throws(() => parseArguments(["run", "/work", "Build", "--workstation", "short"]), /Invalid workstation id/);
  assert.deepEqual(parseArguments(["run", "Build this", "--entry", "ragents.reference.word-game"]), {
    kind: "run", profile: "developer", folder: undefined, text: "Build this", entry: "ragents.reference.word-game", json: false,
  }, "a single value is always the task, even if it looks like a path");
  assert.equal((parseArguments(["run", "/work"]) as { text: string }).text, "/work");
  assert.throws(() => parseArguments(["run", "Build", "--workstation", "laptop-0001"]), /--workstation needs <folder>/);
  assert.deepEqual(parseArguments(["journal", "abc", "--tools"]), { kind: "journal", profile: "developer", runId: "abc", json: false, tools: true });
  assert.deepEqual(parseArguments(["stop", "--host"]), { kind: "stop-host", profile: "developer" });
  assert.deepEqual(parseArguments(["stop", "--host", "--profile", "/own/ragents.config.workshop.ts"]), { kind: "stop-host", profile: "/own/ragents.config.workshop.ts" });
  assert.deepEqual(parseArguments(["stop", "abc"]), { kind: "pause", profile: "developer", runId: "abc" });
  assert.deepEqual(parseArguments(["stop", "abc", "--turn"]), { kind: "stop-turn", profile: "developer", runId: "abc" });
  assert.deepEqual(parseArguments(["stop", "abc", "--run"]), { kind: "stop-run", profile: "developer", runId: "abc" });
  for (const flags of [["--host", "--run"], ["--host", "--turn"], ["--turn", "--run"]]) {
    assert.throws(() => parseArguments(["stop", "abc", ...flags]), /only one of --turn, --run and --host/);
  }
  assert.throws(() => parseArguments(["stop", "--run"]), /stop needs/);
  assert.throws(() => parseArguments(["stop", "--turn"]), /stop needs/);
  assert.deepEqual(parseArguments(["resume", "abc"]), { kind: "resume", profile: "developer", runId: "abc" });
  assert.deepEqual(parseArguments(["resume", "abc", "--profile", "core"]), { kind: "resume", profile: "core", runId: "abc" });
  assert.throws(() => parseArguments(["resume"]), /resume needs <run>/);
  assert.throws(() => parseArguments(["resume", "abc", "def"]), /resume takes exactly one value/);
  assert.throws(() => parseArguments(["resume", "../escape"]), /Invalid run id/);
  assert.throws(() => parseArguments(["resume", "abc", "--run"]), /Unknown argument/);
  assert.deepEqual(parseArguments(["script", "abc"]), { kind: "script", profile: "developer", runId: "abc", entry: undefined, input: null, json: false });
  assert.deepEqual(parseArguments(["script", "abc", "demo.review", "--input", '{"topic":"Launch"}', "--json"]),
    { kind: "script", profile: "developer", runId: "abc", entry: "demo.review", input: { topic: "Launch" }, json: true });
  assert.throws(() => parseArguments(["script", "abc", "--input", "{}"]), /--input needs <entry>/);
  assert.throws(() => parseArguments(["script", "abc", "demo.review", "--input", "{topic"]), /--input is not JSON/);
  assert.throws(() => parseArguments(["script"]), /script needs <run>/);
  assert.throws(() => parseArguments([]), /Usage/);
  assert.throws(() => parseArguments(["dance"]), /Unknown command/);
  assert.throws(() => parseArguments(["run"]), /run needs "<task>"/);
  assert.throws(() => parseArguments(["run", "/work", ""]), /run needs "<task>"/);
  assert.throws(() => parseArguments(["run", "/work", "Build", "toomuch"]), /at most two values/);
  assert.throws(() => parseArguments(["run", "/work", "Build", "--unknown"]), /Unknown argument/);
  assert.throws(() => parseArguments(["run", "/work", "Build", "--profile"]), /needs a value/);
  assert.throws(() => parseArguments(["send", "../escape", "Text"]), /Invalid run id/);
  assert.throws(() => parseArguments(["stop", "--host", "abc"]), /no run id/);
});

test("send follows a message that came into a running turn as steering until its end", () => {
  const input = (id: string, sequence: number, content: string, turnId: string, steered: boolean) => ({ id, actorId: PRIMARY, content, artifactIds: [],
    enqueuedBy: OWNER, enqueuedAt: `2026-09-24T10:00:0${sequence}.000Z`, sequence, lifecycle: { kind: "claimed", turnId, steered }, subscriptionId: null, sourceEventIds: [] });
  const view = (status: string, reason: string | null) => ({
    id: "run-1", ownerId: OWNER, primaryActorId: PRIMARY, actions: [],
    inputs: [input("input-1", 1, "Build the page.", "turn-1", false), input("input-2", 3, "Use blue.", "turn-1", true)],
    turns: [{ id: "turn-1", actorId: PRIMARY, inputId: "input-1", status, startedAt: "2026-09-24T10:00:02.000Z", finishedAt: status === "running" ? null : "2026-09-24T10:00:09.000Z",
      reason, usage: {}, toolCalls: [],
      outputs: [{ text: "Building.", sequence: 2, occurredAt: "2026-09-24T10:00:02.500Z" }, { text: "Blue is set.", sequence: 5, occurredAt: "2026-09-24T10:00:08.000Z" }] }],
  }) as unknown as RunView;
  const known = new Set(["input-1"]);
  assert.deepEqual(progressOf(view("running", null), known, "Use blue.").outcome, undefined);
  const completed = progressOf(view("completed", null), known, " Use blue. ");
  assert.equal(completed.outcome, "completed");
  assert.deepEqual(completed.entries.map((entry) => entry.line), ["Blue is set.", undefined], "what came before the own message does not belong to it");
  const failed = progressOf(view("failed", "Model error"), known, "Use blue.");
  assert.deepEqual([failed.outcome, failed.reason, failed.entries.at(-1)!.line], ["failed", "Model error", "! Turn failed: Model error"]);
  const interrupted = progressOf(view("interrupted", "Stopped by the operator"), known, "Use blue.");
  assert.deepEqual([interrupted.outcome, interrupted.entries.at(-1)!.line], ["interrupted", "! Turn cancelled: Stopped by the operator"]);
  assert.equal(progressOf(view("completed", null), new Set(["input-1", "input-2"]), "Use blue.").outcome, undefined, "an old input with the same text does not count");
});

test("run shows every question the turn posed with header and options and how to answer them, not one of another turn", () => {
  const branch = { question: "Which branch?", header: "Branch", options: [{ label: "main", description: "Stable line" }, { label: "release", description: "" }], multiSelect: false };
  const checks = { question: "Which checks?", header: "Checks", options: [{ label: "lint", description: "" }, { label: "tests", description: "Unit tests" }], multiSelect: true };
  const action = (id: string, proposedAt: string, askedBy = PRIMARY, owner = "ragents.ask") => ({ id, askedBy, owner, title: "Which branch?",
    description: null, parameters: {}, input: null, payload: { questions: id === "multi" ? [branch, checks] : [branch] },
    status: "pending", proposedAt, resolvedAt: null, resolvedBy: null, result: null });
  const view = {
    id: "run-1", ownerId: OWNER, primaryActorId: PRIMARY,
    inputs: [{ id: "input-1", actorId: PRIMARY, content: "Merge it.", artifactIds: [], enqueuedBy: OWNER, enqueuedAt: "2026-09-24T10:00:01.000Z",
      sequence: 1, lifecycle: { kind: "claimed", turnId: "turn-1", steered: false }, subscriptionId: null, sourceEventIds: [] }],
    turns: [{ id: "turn-1", actorId: PRIMARY, inputId: "input-1", status: "completed", startedAt: "2026-09-24T10:00:02.000Z", finishedAt: "2026-09-24T10:00:05.000Z",
      reason: null, usage: {}, outputs: [],
      toolCalls: [{ id: "call-1", name: "ask_user", status: "completed", startedAt: "2026-09-24T10:00:03.000Z", finishedAt: "2026-09-24T10:00:04.000Z" }] }],
    actions: [
      action("earlier", "2026-09-24T10:00:00.500Z"),
      action("question", "2026-09-24T10:00:03.500Z"),
      action("multi", "2026-09-24T10:00:03.600Z"),
      action("foreign", "2026-09-24T10:00:03.700Z", PRIMARY, "demo.review"),
      action("other-asker", "2026-09-24T10:00:03.800Z", "agent_reviewer"),
      action("later", "2026-09-24T10:00:06.000Z"),
    ],
  } as unknown as RunView;
  const progress = progressOf(view, new Set(), "Merge it.");
  assert.equal(progress.outcome, "completed", "the asking turn is finished");
  assert.deepEqual(progress.entries.map((entry) => entry.line), [
    "> ask_user",
    "? [Branch] Which branch? Options: \"main\" (Stable line), \"release\" - answer with: ragents send run-1 \"<answer>\"",
    "? [Branch] Which branch? Options: \"main\" (Stable line), \"release\"\n"
      + "? [Checks] Which checks? Options: \"lint\", \"tests\" (Unit tests) (several allowed) - answer with: ragents send run-1 \"<answers>\"",
    "< ask_user 1.0s ok",
    undefined,
  ]);
  assert.deepEqual(progress.entries[1]!.data, { kind: "question", id: "question", questions: [branch] });
  assert.deepEqual(progress.entries[2]!.data, { kind: "question", id: "multi", questions: [branch, checks] });
});

test("run shares the new run with --share and --share-all, share prints or replaces the sharing", () => {
  assert.deepEqual(parseShareSpec("bob"), { userId: "bob", access: "read" });
  assert.deepEqual(parseShareSpec("bob:write"), { userId: "bob", access: "write" });
  assert.deepEqual(parseShareSpec("team:lead:read"), { userId: "team:lead", access: "read" });
  assert.deepEqual(parseShareSpec("a:b"), { userId: "a:b", access: "read" }, "only read and write are levels");
  assert.throws(() => parseShareSpec(":write"), /Invalid share/);
  assert.deepEqual(parseArguments(["run", "/work", "Build", "--share", "bob", "--share", "carol:write", "--share-all", "read"]), {
    kind: "run", profile: "developer", folder: "/work", text: "Build", entry: undefined, json: false,
    sharing: { everyone: "read", users: [{ userId: "bob", access: "read" }, { userId: "carol", access: "write" }] },
  });
  assert.deepEqual((parseArguments(["run", "Build", "--share-all", "write"]) as { sharing: unknown }).sharing, { everyone: "write", users: [] });
  assert.throws(() => parseArguments(["run", "Build", "--share-all", "admin"]), /--share-all takes read or write, not admin/);
  assert.throws(() => parseArguments(["run", "Build", "--share"]), /--share needs a value/);
  assert.deepEqual(parseArguments(["share", "abc"]), { kind: "share", profile: "developer", runId: "abc", sharing: undefined, json: false });
  assert.deepEqual(parseArguments(["share", "abc", "bob:write", "carol", "--all", "read", "--json"]), {
    kind: "share", profile: "developer", runId: "abc", json: true,
    sharing: { everyone: "read", users: [{ userId: "bob", access: "write" }, { userId: "carol", access: "read" }] },
  });
  assert.deepEqual(parseArguments(["share", "abc", "--none"]), { kind: "share", profile: "developer", runId: "abc", sharing: { everyone: null, users: [] }, json: false });
  assert.throws(() => parseArguments(["share", "abc", "bob", "--none"]), /--none takes neither users nor --all/);
  assert.throws(() => parseArguments(["share", "abc", "--all", "everything"]), /--all takes read or write/);
  assert.throws(() => parseArguments(["share"]), /share needs <run>/);
  assert.throws(() => parseArguments(["share", "../escape"]), /Invalid run id/);
});

test("run shares before it sends the task, and a refused share sends nothing", { timeout: 20_000 }, async (t) => {
  const context = await harness(t, "completed");
  const run = { kind: "run", profile: "developer", folder: context.directory, text: "Build", entry: undefined, json: false } as const;
  const sharing: RunSharing = { everyone: "read", users: [{ userId: "bob", access: "write" }] };
  assert.equal(await execute({ ...run, sharing }, collect(context.lines)), 0);
  assert.deepEqual(context.shares.map((entry) => ({ runId: entry.runId, sharing: entry.sharing, before: entry.before })),
    [{ runId: context.messages[0]!.runId, sharing, before: 0 }], "the share reaches the fresh run id before the task");
  assert.equal(context.selections[0]!.runId, context.messages[0]!.runId);
  await assert.rejects(execute({ ...run, sharing: { everyone: null, users: [{ userId: "zoe", access: "read" }] } }), /zoe is not a user of this profile/);
  assert.equal(context.messages.length, 1, "no task went out after the refusal");
});

test("share prints one line per target or the RPC result, and replaces the sharing", { timeout: 20_000 }, async (t) => {
  await harness(t, "completed");
  const printed: string[] = [];
  assert.equal(await execute({ kind: "share", profile: "developer", runId: "run-1", sharing: undefined, json: false }, collect(printed)), 0);
  assert.deepEqual(printed, ["nobody"]);
  const replaced: string[] = [];
  assert.equal(await execute({ kind: "share", profile: "developer", runId: "run-1", json: false,
    sharing: { everyone: "read", users: [{ userId: "bob", access: "write" }] } }, collect(replaced)), 0);
  assert.deepEqual(replaced, ["everyone: read", "bob (Bob): write"]);
  const json: string[] = [];
  assert.equal(await execute({ kind: "share", profile: "developer", runId: "run-1", sharing: undefined, json: true }, collect(json)), 0);
  assert.deepEqual(JSON.parse(json[0]!), {
    sharing: { everyone: "read", users: [{ userId: "bob", access: "write", label: "Bob" }] },
    users: [{ id: "bob", label: "Bob" }, { id: "carol", label: "Carol" }],
  });
});
