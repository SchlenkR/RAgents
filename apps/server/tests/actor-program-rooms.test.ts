import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { claimTurn, OperationContributionRegistry, ToolRegistry, type JsonValue } from "@ragents/engine";
import { allGrants, setupRun } from "../../../packages/ragents/tests/support.ts";
import { actorProgramContracts, resolveActorView, type ActorProgramDefinition } from "../src/plugin-support/actor-programs/contract.ts";
import { agentCapabilityBinding } from "../../../plugins/ragents.actor-programs/server/capability-resolver.ts";
import { createProjectDiagnostics } from "../../../plugins/ragents.actor-programs/server/project-diagnostics.ts";
import { createActorProgramToolContributors } from "../../../plugins/ragents.actor-programs/server/tool-contributor.ts";
import { invocationResult, runtimeFor, writeAppFiles } from "./actor-runtime-fixture.ts";

/** A run with a main room agent worker and the rooms review and review-2, each with a TypeScript actor reviewer. */
const roomsFixture = async (t: TestContext, operations = new OperationContributionRegistry()) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-actor-program-rooms-"));
  const setup = setupRun({ grants: allGrants() });
  const runtime = runtimeFor(setup, directory, operations);
  const runId = setup.view.id;
  const owner = setup.view.ownerId;
  t.after(async () => {
    await runtime.shutdown();
    await setup.services.nativeTypeScriptExecutor!.shutdown();
    setup.journal.close();
    await rm(directory, { recursive: true, force: true });
  });
  const actor = (handle: string, room: string | null) => {
    const found = setup.runtime.view(runId).actors.find((entry) => entry.handle === handle && (entry.room ?? null) === room);
    assert.ok(found, `${room}.${handle}`);
    return found;
  };
  const create = (handle: string, room: { kind: "open"; name: string; origin: null } | { kind: "existing"; name: string }) => {
    setup.runtime.createScriptActor({ actorId: owner, commandId: `create-${room.name}-${handle}` }, runId, { handle, displayName: handle, grants: allGrants(), toolNames: null, room });
    return actor(handle, room.name);
  };
  create("reviewer", { kind: "open", name: "review", origin: null });
  create("reviewer", { kind: "open", name: "review-2", origin: null });
  let commands = 0;
  const turns = new Map<string, string>();
  /** A command of this actor inside a running turn, as a program function issues it. */
  const as = (actorId: string) => {
    const running = turns.get(actorId) ?? (() => {
      const queued = setup.runtime.enqueueInput({ actorId: owner, commandId: `input-${actorId}` }, runId, { actorId, content: "Set up." });
      const input = queued.inputs.findLast((entry) => entry.actorId === actorId)!;
      const turnId = claimTurn(setup.runtime, runId, actorId, input.id, `turn-${actorId}`).turnId;
      turns.set(actorId, turnId);
      return turnId;
    })();
    return { actorId, commandId: `activate-${++commands}`, turnId: running };
  };
  return { directory, setup, runtime, runId, owner, actor, create, as };
};

const toolPackage = (tool: string, targets?: readonly string[], capabilities: readonly string[] = []) => ({
  "package.json": JSON.stringify({ name: "list", private: true, type: "module", ragents: { title: "List", backend: "src/server.ts" } }),
  "src/server.ts": `import {Type} from "typebox"; import {defineActor} from "@ragents/server";
export default defineActor({state: Type.Object({}), functions: {append: {label: "Append", input: Type.Object({}), output: Type.String(), capabilities: ${JSON.stringify(capabilities)},
  tool: {name: "${tool}"${targets ? `, targets: ${JSON.stringify(targets)}` : ""}}}}}, {functions: {
  append: async (_input, context) => ${capabilities.length > 0 ? `await context.functions.native_ping({value: "ping"})` : '"ok"'},
}});`,
});

test("equal tool names stay possible in separate rooms, but never for one actor, whether by targets or by the room of untargeted tools", async (t) => {
  const f = await roomsFixture(t);
  const worker = f.actor("worker", null);
  const reviewer = f.actor("reviewer", "review");
  const secondReviewer = f.actor("reviewer", "review-2");
  const install = async (key: string, files: Record<string, string>, caller: string) => {
    await writeAppFiles(f.directory, key, files);
    return f.runtime.activate(f.as(caller), f.runId, key.slice(key.indexOf(".") + 1));
  };

  await install("review.list", toolPackage("append_to_list"), reviewer.id);
  await install("review-2.list", toolPackage("append_to_list"), secondReviewer.id);
  await install("review-2.picker", toolPackage("append_to_list", ["@worker"]), secondReviewer.id);
  await assert.rejects(install("review.marker", toolPackage("append_to_list", ["@worker"]), reviewer.id),
    /Tool name append_to_list is already taken: the package review-2\.picker publishes it for an actor this tool reaches too/);
  await assert.rejects(install("review.note", toolPackage("append_to_list", ["@reviewer"]), reviewer.id),
    /the package review\.list publishes it for an actor this tool reaches too/, "an untargeted tool reaches every actor of its package's room");
  await assert.rejects(install("review-2.mirror", toolPackage("append_to_list", ["@review.reviewer"]), secondReviewer.id),
    /the package review\.list publishes it/);
  await assert.rejects(install("review.copy", toolPackage("append_to_list", ["self"]), reviewer.id),
    /the package review\.list publishes it/, "the new actor of a package joins the package's room");
  assert.deepEqual(f.runtime.programs(f.runId).map((program) => program.name).sort(), ["review-2.list", "review-2.picker", "review.list"]);

  const registry = new ToolRegistry();
  registry.register(createActorProgramToolContributors(f.runtime, { latest: () => "" })[1]!);
  const published = async (actorId: string) => {
    const view = f.setup.runtime.view(f.runId);
    const actor = view.actors.find((entry) => entry.id === actorId)!;
    const tools = await registry.resolve({ runId: f.runId, actorId, turnId: null, actor, view, workspace: f.directory });
    return tools.filter((tool) => tool.name === "append_to_list").length;
  };
  assert.deepEqual([await published(worker.id), await published(reviewer.id), await published(secondReviewer.id)], [1, 1, 1]);
});

test("a contract drift reactivates a room's package with the room it was activated from, and the background check reads it from there too", async (t) => {
  const calls: unknown[] = [];
  const operation = { id: "native_ping", label: "Ping", description: "Test operation", schema: Type.Object({ value: Type.String() }), resultSchema: Type.String(), operator: "direct" as const,
    execute: (_context: unknown, input: unknown) => { calls.push(input); return "pong"; } };
  const operations = new OperationContributionRegistry();
  operations.register("test", [operation]);
  const f = await roomsFixture(t, operations);
  const worker = f.actor("worker", null);
  const reviewer = f.actor("reviewer", "review");
  await writeAppFiles(f.directory, "review.list", toolPackage("append_to_list", ["@reviewer"], ["native_ping"]));
  await writeAppFiles(f.directory, "review.board", toolPackage("board_note", ["@reviewer"]));

  await assert.rejects(f.runtime.check(f.runId, "review.board", worker.id), /Actor @reviewer is unknown/, "an activation from the main room reads the names from there");
  assert.deepEqual(f.runtime.diagnosisContext(f.runId, "review.board"), { actorId: null, targetRoom: "review" });
  const unactivated = await f.runtime.diagnose(f.runId, "review.board", worker.id);
  assert.deepEqual(unactivated.definition.functions[0]!.tool?.targets, [reviewer.id], "a package nobody activated yet is read from its own room");

  await f.runtime.activate(f.as(reviewer.id), f.runId, "list");
  const before = f.runtime.programs(f.runId).find((program) => program.name === "review.list")!;
  assert.equal(before.targetRoom, "review");
  assert.deepEqual(before.functions[0]!.tool?.targets, [reviewer.id]);
  assert.deepEqual(f.runtime.diagnosisContext(f.runId, "review.list"), { actorId: before.actorId, targetRoom: "review" });
  assert.deepEqual((await f.runtime.diagnose(f.runId, "review.list", worker.id)).definition.functions[0]!.tool?.targets, [reviewer.id]);

  const diagnostics = createProjectDiagnostics({
    workspaceFor: (runId) => f.runtime.workspaceDirectory(runId),
    check: (runId, name, recipientId, signal) => f.runtime.diagnose(runId, name, recipientId, signal),
    context: (runId, name) => f.runtime.diagnosisContext(runId, name),
  });
  const kept: JsonValue[] = [];
  const report = await diagnostics.contribution.beforeModelCall!({ runId: f.runId, agentId: worker.id, audience: "coordinator", workspace: f.directory },
    { signal: undefined, modelReadsImages: false, kept: undefined, keep: (value) => { kept.push(value); } });
  assert.match(report ?? "", /0 errors in 2 projects/, "a main room recipient gets no false error for the room's packages");

  operation.schema = Type.Object({ value: Type.String(), verbose: Type.Optional(Type.Boolean()) }) as never;
  const started = f.runtime.startFunctionInvocation(f.runId, "review.list", before.revision, "append", "drift-call", {});
  const result = await invocationResult(f.runtime, f.runId, "review.list", started.id);
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.deepEqual(calls, [{ value: "ping" }]);
  const after = f.runtime.programs(f.runId).find((program) => program.name === "review.list")!;
  assert.notEqual(after.functions[0]!.capabilityContractHash, before.functions[0]!.capabilityContractHash, "the package was reactivated");
  assert.equal(after.targetRoom, "review");
  assert.deepEqual(after.functions[0]!.tool?.targets, [reviewer.id]);
});

test("function RPCs take every actor address the engine resolves, and run the function of a room's actor", async (t) => {
  const f = await roomsFixture(t);
  const ruleReview = f.create("rule_review", { kind: "existing", name: "review" });
  await writeAppFiles(f.directory, "review.rules", toolPackage("rule_note"));
  await f.runtime.activate(f.as(ruleReview.id), f.runId, "rules", undefined, "self");
  const program = f.runtime.programs(f.runId).find((entry) => entry.name === "review.rules")!;
  assert.equal(program.actorHandle, "review.rule_review");
  const input = { runId: f.runId, actorHandle: program.actorHandle, revision: program.revision, functionId: "append", requestId: "room-actor", input: {} };
  for (const actorHandle of ["review.rule_review", "review.9bot", "review.müller", "team.lead", "a".repeat(65)])
    assert.ok(Value.Check(actorProgramContracts.function.input, { ...input, actorHandle }), actorHandle);
  for (const actorHandle of ["", "@review.rule_review", "../review", "review/rule", "review rule"])
    assert.equal(Value.Check(actorProgramContracts.function.input, { ...input, actorHandle }), false, actorHandle);
  assert.ok(Value.Check(actorProgramContracts.functionInvocation.input, { runId: f.runId, actorHandle: "review.müller", invocationId: "call-1" }));
  const started = f.runtime.startFunctionInvocation(f.runId, input.actorHandle, input.revision, input.functionId, input.requestId, input.input);
  const result = await invocationResult(f.runtime, f.runId, program.actorHandle, started.id);
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.equal(f.runtime.invocation(f.runId, "Review.Rule_Review", started.id).id, started.id);

  assert.throws(() => agentCapabilityBinding(ruleReview, [], ["native_ping"], new Set()), /Capability native_ping is not available to @review\.rule_review\./);
});

const definition = (name: string, actorHandle: string): ActorProgramDefinition => ({
  name, title: name, description: "", actorId: `${actorHandle}-id`, actorHandle, revision: "build", installedBy: "owner",
  directory: "/unused", sourceDirectory: "/unused", stateSchema: {}, stylesFile: "frame.css", functions: [],
  views: [{ id: `${name}--main`, key: "main", title: `${name} view`, visible: true, html: "", styles: "", clientFile: "view-main.mjs" }],
});

test("relative view aliases read a package by the package's room and an actor by the actor's room", () => {
  const programs = [definition("board", "review.reviewer"), definition("review.list", "review.list"), definition("notes", "notes")];
  const view = (reference: string, room: string | null) => resolveActorView(programs, reference, room).view.id;

  assert.equal(view("@reviewer/main", "review"), "board--main", "a main room package bound to a room's actor");
  assert.equal(view("@review.reviewer/main", "review"), "board--main");
  assert.equal(view("@review.reviewer/main", null), "board--main");
  assert.equal(view("board/main", "review"), "board--main", "the main room's package from a room");
  assert.equal(view("list/main", "review"), "review.list--main");
  assert.equal(view("@list/main", "review"), "review.list--main");
  assert.equal(view("review.list/main", null), "review.list--main");
  assert.equal(view("@notes/main", "review"), "notes--main");
  assert.throws(() => view("@reviewer/main", null), /not an active actor view/, "from the main room a bare name never reaches into a room");
  assert.throws(() => view("@reviewer/main", "review-2"), /not an active actor view/);
  assert.throws(() => view("missing/main", "review"), /Available: board\/main \(@reviewer\/main\), list\/main \(@list\/main\), notes\/main \(@notes\/main\)/,
    "every suggested alias resolves from the caller's room");
});
