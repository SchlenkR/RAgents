import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { createAccessContext, Journal, OperationContributionRegistry, Orchestration, ScriptDriver, ToolRegistry, TurnScheduler, type AccessContext, type CapabilityGrant, type RunFunction } from "@ragents/engine";
import { toolDescriptorFrom } from "../src/plugin-support/agent-tool.ts";
import { allGrants, catalog, setupRun, testServices } from "../../../packages/ragents/tests/support.ts";
import { programPermissionFunctions } from "../../../plugins/ragents.actor-programs/server/permissions.ts";
import type { ActorProgramRuntime } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import type { ProgramTriggerOptions } from "../../../plugins/ragents.actor-programs/server/triggers.ts";
import { runtimeFor, writeAppFiles } from "./actor-runtime-fixture.ts";

export const openAccess = createAccessContext({ enabled: false, user: null });

export const until = async (condition: () => boolean, label = "The program did not settle."): Promise<void> => {
  const deadline = Date.now() + 20000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(label);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

/** A program whose onInput body sees `input`, `trigger` and `context`. */
export const programFiles = (body: string, ragents: Record<string, unknown> = {}, capabilities: readonly string[] = [], imports = "") => ({
  "package.json": JSON.stringify({ name: "source", private: true, type: "module", ragents: { title: "Check", backend: "src/server.ts", ...ragents } }),
  "src/server.ts": `import { Type } from "typebox";
import { defineActor } from "@ragents/server";
${imports}
export default defineActor({
  state: Type.Object({ count: Type.Optional(Type.Integer()), pid: Type.Optional(Type.Integer()), key: Type.Optional(Type.String()), reasons: Type.Optional(Type.Array(Type.String())) }),
  functions: {}, input: { capabilities: ${JSON.stringify(capabilities)} },
}, { functions: {}, onInput: async (input, context) => {
  const trigger = input.trigger;
  ${body}
} });`,
});
export const count = 'const state = context.state.read(); context.state.replace({ count: (state.count ?? 0) + 1, pid: process.pid, reasons: [...state.reasons ?? [], trigger?.reason ?? "message"], ...trigger ? { key: trigger.key } : {} }); context.log(trigger?.reason ?? "message");';

export interface TriggerFixtureOptions {
  readonly tools?: () => readonly RunFunction[];
  readonly grants?: CapabilityGrant[];
  readonly operations?: OperationContributionRegistry;
  readonly watch?: ProgramTriggerOptions["watch"];
  /** Keeps the journal in a folder, so that reopen reads it back like a server restart. */
  readonly persistent?: boolean;
}

/** A run whose journal lives in a folder; IDs stay unique across reopening it. */
const persistentRun = (journalDirectory: string): ReturnType<typeof setupRun> => {
  const services = { ...testServices(), newId: (kind: string) => `${kind}-${randomUUID()}` };
  const journal = new Journal(journalDirectory, services);
  const runtime = new Orchestration(journal, services);
  const view = runtime.createRun({ commandId: "create-run" }, { title: "Scheduler", ownerHandle: "owner", ownerDisplayName: "Owner" });
  return { services, journal, runtime, view, agent: view.actors.find((actor) => actor.kind === "human")! } as unknown as ReturnType<typeof setupRun>;
};

export const triggerFixture = async (t: TestContext, options: TriggerFixtureOptions = {}) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-program-triggers-"));
  const journalDirectory = path.join(directory, "journal");
  const setup = options.persistent ? persistentRun(journalDirectory) : setupRun({ grants: options.grants ?? allGrants() });
  let time = Date.parse("2026-08-16T12:00:00.000Z");
  setup.services.now = () => new Date(time).toISOString();
  let wake: (() => void) | undefined;
  let ownerAccess: AccessContext = openAccess;
  let programs: ActorProgramRuntime;
  let scheduler: TurnScheduler;
  const directoryFor = (runId: string) => path.join(directory, runId);
  const helpers = programPermissionFunctions({
    permissionsOf: (runId, actorId) => {
      const program = programs.programsOf(setup.runtime.view(runId)).find((entry) => entry.actorId === actorId);
      return program ? program.permissions ?? {} : undefined;
    },
    ownerAccess: () => ownerAccess,
  });
  const contributed = () => [...helpers.tools({} as never) as RunFunction[], ...options.tools?.() ?? []];
  const triggers: Parameters<typeof runtimeFor>[8] = {
    prepareRun: async () => undefined,
    interrupt: async (runId, actorId, reason) => {
      await scheduler.interruptTurn(runId, actorId, { context: { actorId: setup.runtime.state(runId).ownerId, commandId: `interrupt:${randomUUID()}` }, reason });
      if (scheduler.isRunning(runId, actorId)) throw new Error("The interrupted turn is still cleaning up.");
    },
    ...options.watch ? { watch: options.watch } : {},
    now: () => time,
    wake: (callback) => { wake = callback; return () => { if (wake === callback) wake = undefined; }; },
  };
  const create = () => runtimeFor(setup, directory, options.operations, undefined, undefined, contributed, undefined, directoryFor, triggers, () => ownerAccess);
  programs = create();
  const registry = new ToolRegistry();
  registry.register({ name: "test.programs", descriptors: contributed().map((fn) => toolDescriptorFrom(fn, fn.available)), tools: contributed });
  const schedulerFor = () => new TurnScheduler(setup.runtime, setup.journal, { catalog, registry, drivers: { script: new ScriptDriver({ runtime: setup.runtime }) } });
  scheduler = schedulerFor();
  await programs.triggers.ready();
  const runId = setup.view.id;
  const ownerContext = (target = runId) => ({ actorId: setup.runtime.state(target).ownerId, commandId: `test:${randomUUID()}` });
  const stopPrograms = async () => {
    await programs.shutdown();
    await setup.services.nativeTypeScriptExecutor!.shutdown();
  };
  t.after(async () => {
    await stopPrograms();
    await scheduler.stop();
    setup.journal.close();
    await rm(directory, { recursive: true, force: true });
  });
  const actorOf = (name: string, target = runId) => {
    const program = programs.programs(target).find((entry) => entry.name === name);
    assert.ok(program, `The program ${name} is active.`);
    return program.actorId;
  };
  const fixture = {
    directory, setup, runId, directoryFor, ownerContext, interrupt: triggers.interrupt,
    get scheduler() { return scheduler; },
    get programs() { return programs; },
    get time() { return time; },
    setOwnerAccess: (value: AccessContext) => { ownerAccess = value; },
    advance: (milliseconds: number) => { time += milliseconds; const callback = wake; wake = undefined; callback?.(); },
    /** A server restart of the programs: shutdown, then a new runtime that reads the same journal. */
    restart: async () => { await stopPrograms(); programs = create(); await programs.triggers.ready(); },
    /** A whole server restart: programs, scheduler and journal stop, and a new journal reads the folder back. */
    reopen: async () => {
      await stopPrograms();
      await scheduler.stop();
      setup.journal.close();
      setup.journal = new Journal(journalDirectory, setup.services);
      setup.runtime = new Orchestration(setup.journal, setup.services);
      programs = create();
      scheduler = schedulerFor();
      await programs.triggers.ready();
    },
    write: (name: string, files: Record<string, string>, target = runId) => writeAppFiles(directoryFor(target), name, files),
    activate: async (name: string, files: Record<string, string>, target = runId) => {
      await writeAppFiles(directoryFor(target), name, files);
      return programs.activate(ownerContext(target), target, name);
    },
    actorOf,
    progress: (name: string, target = runId) => programs.triggers.progress(target, actorOf(name, target)),
    status: (name: string, target = runId, logLimit?: number) => programs.triggers.status(target, actorOf(name, target), logLimit),
    trigger: (name: string, target = runId) => programs.triggers.trigger(target, actorOf(name, target)),
    pause: (name: string, paused: boolean, target = runId) => programs.triggers.pause(target, actorOf(name, target), paused),
    state: (name: string, target = runId) => programs.data(target, actorOf(name, target)).values as { count?: number; pid?: number; key?: string; reasons?: string[] },
    inputs: (target = runId) => setup.runtime.view(target).inputs.filter((input) => input.content.startsWith("Trigger: ")).length,
    settled: async (name: string, outcome = "completed", target = runId) => {
      await until(() => { const progress = programs.triggers.progress(target, actorOf(name, target)); return progress.lastResult !== null && !["queued", "running"].includes(progress.status); });
      assert.equal(programs.triggers.progress(target, actorOf(name, target)).lastResult?.outcome, outcome, JSON.stringify(await programs.triggers.status(target, actorOf(name, target))));
    },
  };
  return fixture;
};
