import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { DomainError, Journal, Orchestration, type SessionLifecycleContribution } from "@ragents/engine";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { compositionEnvironment, showcaseFixture } from "./fixtures/profile-composition/profiles.ts";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreSources, dispatchMethod } from "./rpc-fixture.ts";

const directory = await mkdtemp(path.join(tmpdir(), "ragents-run-deletion-"));
for (const [key, value] of Object.entries({ ...compositionEnvironment, DATA_DIR: directory, PROCESS_SANDBOX: "off",
  MCP_SERVERS: "{}", ACP_AGENTS: JSON.stringify({ fixture: { command: "fixture-agent" } }) })) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
const { RunSessionProvider } = await import("../src/provider.ts");
const { loadPlugins } = await import("../src/profile/plugin-discovery.ts");
const { composeProfile } = await import("../src/profile/compose.ts");
const { layout } = await import("../src/layout.ts");
const { runOwnerAccessToken } = await import("../src/ragents/host-services.ts");
const pluginIds = [...showcaseFixture.plugins, "ragents.mcp", "ragents.acp"];
const loaded = await loadPlugins(pluginIds);
after(() => rm(directory, { recursive: true, force: true }));

const hooks: SessionLifecycleContribution[] = [];
const stopped: string[] = [];
const deleted: string[] = [];
const failures = new Map<string, Error>();
const ownerLookups = new Map<string, unknown>();
const createProvider = () => new RunSessionProvider((bridges) => {
  hooks.length = 0;
  stopped.length = 0;
  deleted.length = 0;
  const modules = new Map([...loaded.modules].map(([id, module]) => [id, {
    ...module,
    create: (host: Parameters<typeof module.create>[0]) => {
      const plugin = module.create(host);
      return { ...plugin, register: (registration: Parameters<typeof plugin.register>[0]) => {
        plugin.register(new Proxy(registration, { get: (target, key) => key === "lifecycle"
          ? (...contributions: SessionLifecycleContribution[]) => { hooks.push(...contributions); target.lifecycle(...contributions); }
          : Reflect.get(target, key) }));
        if (id === "ragents.product") registration.lifecycle({
          id: "test.deletion",
          stopSession: ({ runId }) => { stopped.push(runId); },
          deleteSession: ({ runId }) => {
            deleted.push(runId);
            if (ownerLookups.has(runId)) ownerLookups.set(runId, host.service(runOwnerAccessToken)(runId));
            const failure = failures.get(runId);
            if (failure) throw failure;
          },
        });
      } };
    },
  }]));
  return composeProfile({ product: showcaseFixture.product, pluginIds, modules, web: loaded.web, executor: loaded.executor }, bridges);
}, undefined);

const writeRun = async (runId: string, locked = false): Promise<string> => {
  await mkdir(layout.runsDir, { recursive: true });
  const services = { ...testServices(), newId: () => randomUUID() };
  const journal = new Journal(layout.runsDir, services);
  try {
    new Orchestration(journal, services).createRun({ commandId: `create-${runId}` }, {
      runId, title: "Example run", ownerHandle: "owner", ownerDisplayName: "Owner",
    });
  } finally { journal.close(); }
  const file = path.join(layout.runsDir, runId, "journal.jsonl");
  const source = await readFile(file, "utf8");
  const content = locked ? JSON.stringify({ ...JSON.parse(source), formatVersion: 3 }) + "\n" : source;
  await writeFile(file, content);
  return content;
};

const requestDeletion = (provider: InstanceType<typeof RunSessionProvider>, runId: string) => {
  provider.plugins.methods.register("test.rpc", coreMethods(coreSources({ delete: (id) => provider.delete(id) })));
  return dispatchMethod(provider.plugins.methods, coreContracts.runs.delete.id, { runId });
};

test("a rejected journal can be deleted through the run row's RPC", async (t) => {
  const runId = "locked-run";
  const source = await writeRun(runId, true);
  const journalFile = path.join(layout.runsDir, runId, "journal.jsonl");
  const pluginFile = path.join(layout.sessionDir(runId), "plugins", "example", "data.json");
  const chatFile = path.join(layout.sessionDir(runId), "chat", "agent", "old.jsonl");
  for (const file of [pluginFile, chatFile]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "example\n");
  }
  const provider = createProvider();
  t.after(() => provider.shutdown());
  await provider.init();
  assert.match((await provider.list()).find((run) => run.id === runId)?.locked ?? "", /format/);
  await assert.rejects(provider.get(runId), { code: "journal-unavailable" });
  const rejected: string[] = [];
  for (const hook of hooks.filter((entry) => entry.stopSession)) {
    try { await hook.stopSession!({ runId, signal: new AbortController().signal }); }
    catch (error) {
      assert.ok(error instanceof DomainError && error.code === "journal-unavailable");
      rejected.push(hook.id);
    }
  }
  assert.deepEqual(rejected.sort(), ["ragents.acp.connections", "ragents.browser.lifecycle", "ragents.processes.lifecycle", "ragents.workspace.lifecycle"]);
  assert.equal(await requestDeletion(provider, runId), null);
  await provider.deletion(runId);
  assert.deepEqual(stopped, []);
  assert.deepEqual(deleted, [runId]);
  assert.equal((await provider.list()).some((run) => run.id === runId), false);
  assert.equal(existsSync(journalFile), false);
  assert.equal(await readFile(path.join(layout.archiveSessionDir(runId), "run", "journal.jsonl"), "utf8"), source);
  assert.equal(await readFile(path.join(layout.archiveSessionDir(runId), "chat", "agent", "old.jsonl"), "utf8"), "example\n");
  assert.equal(existsSync(pluginFile), false);
  assert.equal(existsSync(layout.deleteIntentFile(runId)), false);
  await assert.rejects(provider.get(runId), { code: "run-deleted" });
});

test("startup finishes an intent for a rejected journal and starts another run", async (t) => {
  const runId = "pending-locked-run";
  const source = await writeRun(runId, true);
  await writeRun("healthy-run");
  await mkdir(layout.deleteIntentsDir, { recursive: true });
  await writeFile(layout.deleteIntentFile(runId), JSON.stringify({ version: 1, runId }));
  const provider = createProvider();
  t.after(() => provider.shutdown());
  await provider.init();
  assert.deepEqual(stopped, []);
  assert.deepEqual(deleted, [runId]);
  assert.equal(existsSync(layout.deleteIntentFile(runId)), false);
  assert.equal(await readFile(path.join(layout.archiveSessionDir(runId), "run", "journal.jsonl"), "utf8"), source);
  assert.ok(await provider.get("healthy-run"));
});

test("a failed delete hook stays visible and retryable through startup and shutdown", async () => {
  const runId = "failed-locked-run";
  const source = await writeRun(runId, true);
  failures.set(runId, new Error("Example cleanup failed"));
  await writeFile(layout.deleteIntentFile(runId), JSON.stringify({ version: 1, runId }));
  const provider = createProvider();
  try {
    await provider.init();
    const listed = (await provider.list()).find((run) => run.id === runId);
    assert.match(listed?.locked ?? "", /Example cleanup failed/);
    assert.equal(listed?.workspaceAccessible, false);
    assert.equal(listed?.operable, false);
    await assert.rejects(provider.get(runId), { code: "run-delete-failed" });
    assert.ok(await provider.get("healthy-run"));
    assert.equal(await readFile(path.join(layout.runsDir, runId, "journal.jsonl"), "utf8"), source);
    assert.equal(existsSync(layout.deleteIntentFile(runId)), true);
    await provider.shutdown();
    assert.equal(existsSync(layout.deleteIntentFile(runId)), true);
    assert.equal(await readFile(path.join(layout.runsDir, runId, "journal.jsonl"), "utf8"), source);
  } finally { await provider.shutdown(); failures.delete(runId); }
  const restarted = createProvider();
  try {
    await restarted.init();
    assert.equal(existsSync(layout.deleteIntentFile(runId)), false);
    assert.equal((await restarted.list()).some((run) => run.id === runId), false);
    assert.equal(await readFile(path.join(layout.archiveSessionDir(runId), "run", "journal.jsonl"), "utf8"), source);
  } finally { await restarted.shutdown(); }
});

test("a failed deletion of a loaded run locks only that run and can be retried", async () => {
  const runId = "failed-loaded-run";
  const source = await writeRun(runId);
  failures.set(runId, new Error("Example storage failed"));
  await writeFile(layout.deleteIntentFile(runId), JSON.stringify({ version: 1, runId }));
  const provider = createProvider();
  try {
    await provider.init();
    assert.match((await provider.list()).find((run) => run.id === runId)?.locked ?? "", /Example storage failed/);
    assert.ok(await provider.get("healthy-run"));
    assert.equal(existsSync(layout.deleteIntentFile(runId)), true);
    failures.delete(runId);
    assert.equal(await requestDeletion(provider, runId), null);
    await provider.deletion(runId);
    assert.equal(existsSync(layout.deleteIntentFile(runId)), false);
    assert.equal(await readFile(path.join(layout.archiveSessionDir(runId), "run", "journal.jsonl"), "utf8"), source);
  } finally { failures.delete(runId); await provider.shutdown(); }
});

test("a delete hook can still look up the owner's access of the run it deletes", async (t) => {
  const runId = "owner-lookup-run";
  await writeRun(runId);
  ownerLookups.set(runId, undefined);
  const provider = createProvider();
  t.after(async () => { ownerLookups.delete(runId); await provider.shutdown(); });
  await provider.init();
  assert.equal(await requestDeletion(provider, runId), null);
  await provider.deletion(runId);
  assert.deepEqual(deleted, [runId]);
  assert.ok(ownerLookups.get(runId));
  assert.equal(existsSync(layout.deleteIntentFile(runId)), false);
  assert.equal((await provider.list()).some((run) => run.id === runId), false);
  await assert.rejects(provider.get(runId), { code: "run-deleted" });
});

test("an invalid delete marker locks its run without blocking startup or shutdown", async () => {
  const runId = "invalid-marker-run";
  const source = await writeRun(runId);
  const marker = "{invalid JSON}\n";
  await writeFile(layout.deleteIntentFile(runId), marker);
  const provider = createProvider();
  try {
    await provider.init();
    assert.match((await provider.list()).find((run) => run.id === runId)?.locked ?? "", /contains no valid JSON/);
    await assert.rejects(provider.get(runId), { code: "run-delete-failed" });
    assert.ok(await provider.get("healthy-run"));
    await provider.shutdown();
    assert.equal(await readFile(layout.deleteIntentFile(runId), "utf8"), marker);
    assert.equal(await readFile(path.join(layout.runsDir, runId, "journal.jsonl"), "utf8"), source);
  } finally { await provider.shutdown(); }
});
