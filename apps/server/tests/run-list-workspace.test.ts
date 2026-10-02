import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createAccessContext, DomainError, Journal, LiveBus, Orchestration, SessionMetadataContributionRegistry, type AccessContext } from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { coreSources, methodContext } from "./rpc-fixture.ts";
import { workspaceListDetail } from "../../../plugins/ragents.workspace/server/binding.ts";
import { withCurrentLabel } from "../../../plugins/ragents.workspace/contract.ts";

// The run list shows foreign runs that only their owner operates, without any contribution reaching their workspace.

const directory = await mkdtemp(path.join(tmpdir(), "ragents-run-list-workspace-"));
process.env.DATA_DIR = directory;
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "test";
process.env.PRODUCT_TITLE = "Test";
const { RunSessionProvider } = await import("../src/provider.ts");
const { RunReadMarkers } = await import("../src/run-read-markers.ts");
after(() => rm(directory, { recursive: true, force: true }));

const BOUND = "run-bound";
const OPEN = "run-open";
const BRANCH = "test.branch";
const BINDING = "test.binding";

const user = (id: string, rights: readonly string[]): AccessContext =>
  createAccessContext({ enabled: true, user: { id, label: id, rights: [...rights] } });

const alice = user("alice", ["runs.read", "runs.write"]);
const bob = user("bob", ["runs.read", "runs.write"]);
const admin = user("admin", ["runs.read", "runs.read.all"]);

type Listed = {
  id: string; revision?: number; state: string; pendingActions: number; workspaceAccessible: boolean; seenRevision?: number;
  metadata?: Record<string, unknown>; metadataUnavailable?: Record<string, string>; listDetails?: unknown[];
};

let markerFiles = 0;

const fixture = async (register?: (metadata: SessionMetadataContributionRegistry) => void) => {
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
  register?.(metadata);
  const provider = Object.create(RunSessionProvider.prototype) as InstanceType<typeof RunSessionProvider>;
  Object.assign(provider, {
    engine: { journal, runtime, live: new LiveBus(), scheduler: { isRunning: () => false } } as unknown as Engine,
    sessions: new Map(),
    deleteRequested: new Set(), deleted: new Set(), globalResetsRequested: new Set(),
    plugins: { optionalService: () => undefined, service: () => ({ coordinator: { runTitle: "New" } }), sessionMetadata: metadata },
    readMarkers: await RunReadMarkers.load(path.join(directory, `run-read-markers-${markerFiles += 1}.json`)),
    listListeners: new Set(), readMarkerNotices: new Map(),
  });
  const methods = coreMethods(coreSources({ list: (scope) => provider.list(scope), markViewed: (runId, revision, userId) => provider.markViewed(runId, revision, userId) }, {
    runOwner: (runId) => (runId === BOUND || runId === OPEN ? "alice" : undefined),
    runOwnerOnly: (runId) => runId === BOUND,
  }));
  const method = (contract: { id: string }) => methods.find((candidate) => candidate.contract.id === contract.id)!;
  const list = async (access: AccessContext): Promise<Map<string, Listed>> => {
    const listed = await method(coreContracts.runs.list).execute({} as never, methodContext(access)) as Listed[];
    return new Map(listed.map((entry) => [entry.id, entry]));
  };
  const markViewed = (access: AccessContext, runId: string, revision: number) =>
    method(coreContracts.runs.markViewed).execute({ runId, revision } as never, methodContext(access));
  return { executor, journal, list, markViewed, provider, runtime };
};

test("an admin sees the foreign run that only its owner operates, and no contribution reaches its workspace", async (t) => {
  const { executor, journal, list } = await fixture();
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
  const { executor, journal, provider } = await fixture();
  t.after(() => journal.close());
  Object.assign(provider, { runOwnerOnly: (runId: string) => runId === BOUND });
  const listed = await provider.list() as Listed[];
  assert.deepEqual(listed.map((entry) => entry.id).sort(), [BOUND, OPEN]);
  assert.deepEqual(executor, [OPEN]);
  assert.equal(listed.find((entry) => entry.id === BOUND)!.workspaceAccessible, false);
});

test("every row carries state, pending actions, and the list lines of the contributions in registration order", async (t) => {
  const { journal, list, runtime } = await fixture((metadata) => {
    metadata.register("test.folder", [{ id: "test.folder", describe: () => ({ path: "/home/user/project" }), listDetail: (value) => ({ label: "Workspace", text: (value as { path: string }).path, icon: "folder" }) }]);
    metadata.register("test.quiet", [{ id: "test.quiet", describe: () => ({ hidden: true }), listDetail: () => undefined }]);
    metadata.register("test.git", [{ id: "test.git", requiresWorkspace: true, describe: () => ({ name: "main" }), listDetail: (value) => ({ label: "Branch", text: (value as { name: string }).name, icon: "branch" }) }]);
    metadata.register("test.broken", [{ id: "test.broken", describe: () => ({}), listDetail: () => ({ label: "Broken", text: "x", icon: "star" }) as never }]);
  });
  t.after(() => journal.close());
  const owner = runtime.state(OPEN).ownerId;
  runtime.proposeAction({ actorId: owner, commandId: "ask-open" }, OPEN, { owner: "ragents.ask", title: "Continue?" });

  const own = await list(alice);
  const open = own.get(OPEN)!;
  assert.equal(open.state, "waiting");
  assert.equal(open.pendingActions, 1);
  assert.deepEqual(open.listDetails, [
    { label: "Workspace", text: "/home/user/project", icon: "folder" },
    { label: "Branch", text: "main", icon: "branch" },
  ], "a contribution without a line adds nothing, the order is the registration order");
  assert.match(open.metadataUnavailable?.["test.broken"] ?? "", /no list line/, "an invalid line costs only its contribution");
  assert.deepEqual(own.get(BOUND)!.state, "idle");
  assert.equal(own.get(BOUND)!.pendingActions, 0);
  const seen = await list(admin);
  assert.deepEqual(seen.get(BOUND)!.listDetails, [{ label: "Workspace", text: "/home/user/project", icon: "folder" }], "a line that needs the workspace stays away from whoever does not reach it");
});

test("read markers belong to the caller: only higher revisions count, other users see none, and a foreign run cannot be marked", async (t) => {
  const { journal, list, markViewed, provider, runtime } = await fixture();
  t.after(() => journal.close());
  const revision = runtime.state(OPEN).revision;
  assert.equal((await list(alice)).get(OPEN)!.seenRevision, undefined, "never viewed");

  const heard: string[] = [];
  provider.subscribeList(() => heard.push("alice"), "alice");
  provider.subscribeList(() => heard.push("admin"), "admin");
  await markViewed(alice, OPEN, revision);
  assert.equal((await list(alice)).get(OPEN)!.seenRevision, revision);
  assert.deepEqual(heard, ["alice"], "only the same user's lists hear of the change");
  await markViewed(alice, OPEN, revision - 1);
  assert.equal((await list(alice)).get(OPEN)!.seenRevision, revision, "a lower revision changes nothing");
  assert.equal((await list(admin)).get(OPEN)!.seenRevision, undefined, "another user gets no read receipt");

  await markViewed(admin, OPEN, revision - 1);
  assert.equal((await list(admin)).get(OPEN)!.seenRevision, revision - 1);
  assert.equal((await list(alice)).get(OPEN)!.seenRevision, revision);

  await assert.rejects(Promise.resolve().then(() => markViewed(bob, OPEN, revision)), (error: unknown) => error instanceof DomainError && error.code === "run-not-found");
  await assert.rejects(Promise.resolve().then(() => markViewed(alice, OPEN, revision + 1)), (error: unknown) => error instanceof DomainError && error.code === "revision-ahead");
});

test("the workspace plugin lists a differing workspace and keeps the new folder on the server quiet", () => {
  assert.equal(workspaceListDetail({ binding: { machine: "server", folder: "fresh" }, summary: "Empty folder per run" }), undefined);
  assert.deepEqual(workspaceListDetail({ binding: { machine: "server", folder: { path: "/home/user/project" } }, summary: "/home/user/project" }),
    { label: "Workspace", text: "/home/user/project", icon: "folder" });
  assert.deepEqual(workspaceListDetail({ binding: { machine: { client: "laptop-01", label: "Notebook" }, folder: { path: "/home/user/runs/run-1", fresh: true } }, summary: "Notebook: /home/user/runs/run-1 (Empty folder per run)" }),
    { label: "Workspace", text: "Notebook: /home/user/runs/run-1 (Empty folder per run)", icon: "folder" }, "a new folder on a workstation differs");
});

test("a workstation shows its current label, the stored one only while it is not registered", () => {
  const binding = { machine: { client: "laptop-01", label: "Old name" }, folder: { path: "/home/user/project" } };
  assert.deepEqual(withCurrentLabel(binding, "Notebook").machine, { client: "laptop-01", label: "Notebook" });
  assert.equal(withCurrentLabel(binding, undefined), binding);
  const server = { machine: "server" as const, folder: "fresh" as const };
  assert.equal(withCurrentLabel(server, "Notebook"), server);
});
