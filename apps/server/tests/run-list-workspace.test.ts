import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createAccessContext, Journal, LiveBus, Orchestration, SessionMetadataContributionRegistry, type AccessContext } from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";

// The run list shows foreign runs that only their owner operates, without any contribution reaching their workspace.

const directory = await mkdtemp(path.join(tmpdir(), "ragents-run-list-workspace-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
const { RunSessionProvider } = await import("../src/provider.ts");
after(() => rm(directory, { recursive: true, force: true }));

const BOUND = "run-bound";
const OPEN = "run-open";
const BRANCH = "test.branch";
const BINDING = "test.binding";

const user = (id: string, rights: readonly string[]): AccessContext =>
  createAccessContext({ enabled: true, user: { id, label: id, rights: [...rights] } });

const alice = user("alice", ["runs.read", "runs.write"]);
const admin = user("admin", ["runs.read", "runs.read.all"]);

type Listed = { id: string; workspaceAccessible: boolean; metadata?: Record<string, unknown>; metadataUnavailable?: Record<string, string> };

const fixture = () => {
  const services = testServices();
  const journal = new Journal(":memory:", services);
  const runtime = new Orchestration(journal, services);
  for (const runId of [BOUND, OPEN]) {
    runtime.createRun({ commandId: `create-${runId}` }, { runId, title: runId, ownerHandle: "owner", ownerDisplayName: "Owner" });
  }
  const executor: string[] = [];
  const metadata = new SessionMetadataContributionRegistry();
  metadata.register(BRANCH, [{ id: BRANCH, requiresWorkspace: true, describe: ({ runId }) => { executor.push(runId); return { branch: "main" }; } }]);
  metadata.register(BINDING, [{ id: BINDING, describe: ({ runId }) => ({ runId }) }]);
  const provider = Object.create(RunSessionProvider.prototype) as InstanceType<typeof RunSessionProvider>;
  Object.assign(provider, {
    engine: { journal, runtime, live: new LiveBus(), scheduler: { isRunning: () => false } } as unknown as Engine,
    sessions: new Map(),
    deleteRequested: new Set(), deleted: new Set(),
    plugins: { optionalService: () => undefined, service: () => ({ coordinator: { runTitle: "New" } }), sessionMetadata: metadata },
  });
  const methods = coreMethods(coreSources({ list: (scope) => provider.list(scope) }, {
    runOwner: (runId) => (runId === BOUND || runId === OPEN ? "alice" : undefined),
    runOwnerOnly: (runId) => runId === BOUND,
  }));
  const method = methods.find((candidate) => candidate.contract.id === coreContracts.runs.list.id)!;
  const list = async (access: AccessContext): Promise<Map<string, Listed>> => {
    const listed = await method.execute({} as never, methodContext(access)) as Listed[];
    return new Map(listed.map((entry) => [entry.id, entry]));
  };
  return { executor, journal, list, provider };
};

test("an admin sees the foreign run that only its owner operates, and no contribution reaches its workspace", async (t) => {
  const { executor, journal, list } = fixture();
  t.after(() => journal.close());

  const seen = await list(admin);
  assert.deepEqual([...seen.keys()].sort(), [BOUND, OPEN], "runs.read.all sees both runs");
  assert.deepEqual(executor, [OPEN], "only the ordinary run asks its workspace");
  const bound = seen.get(BOUND)!;
  assert.equal(bound.workspaceAccessible, false);
  assert.deepEqual(bound.metadata, { [BINDING]: { runId: BOUND } }, "a contribution without a workspace stays");
  assert.deepEqual(bound.metadataUnavailable, { [BRANCH]: "The workspace of this run is not reachable for this access." });
  assert.equal(seen.get(OPEN)!.workspaceAccessible, true);
  assert.deepEqual(seen.get(OPEN)!.metadata?.[BRANCH], { branch: "main" });

  executor.length = 0;
  const own = await list(alice);
  assert.deepEqual(executor.sort(), [BOUND, OPEN], "the owner gets the contribution for both runs");
  assert.equal(own.get(BOUND)!.workspaceAccessible, true);
  assert.deepEqual(own.get(BOUND)!.metadata?.[BRANCH], { branch: "main" });
});

test("without a caller the list reaches no workspace that only its owner operates", async (t) => {
  const { executor, journal, provider } = fixture();
  t.after(() => journal.close());
  Object.assign(provider, { runOwnerOnly: (runId: string) => runId === BOUND });
  const listed = await provider.list() as Listed[];
  assert.deepEqual(listed.map((entry) => entry.id).sort(), [BOUND, OPEN]);
  assert.deepEqual(executor, [OPEN]);
  assert.equal(listed.find((entry) => entry.id === BOUND)!.workspaceAccessible, false);
});
