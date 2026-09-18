import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { LanguageServerHost, type LanguageServerAdapter, type LanguageServerHostOptions } from "../src/plugin-support/language-server/host.ts";
import { resolveRootDirectory } from "../src/plugin-support/language-server/roots.ts";
import { withTimeout, type LanguageServerSession } from "../src/plugin-support/language-server/session.ts";
import type { SandboxServices } from "../src/plugin-support/workspace-sandbox-host.ts";

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

const prompt = <T>(value: Promise<T>) => withTimeout(value, 1_000, () => new Error("The status or stop waited for adapter.open"));

const fixture = async (t: TestContext, open: LanguageServerAdapter["open"], options: LanguageServerHostOptions = {}) => {
  const scratch = "/private/tmp/ragents-lsp-startup";
  await mkdir(scratch, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(scratch, "host-")));
  const root = path.join(directory, "first");
  const second = path.join(directory, "second");
  await Promise.all([root, second].map((entry) => mkdir(entry)));
  await writeFile(path.join(root, "index.ts"), "export const value = 1;\n");
  const sandbox: SandboxServices = {
    processContextFor: async (runId) => ({ runId, cwd: directory, root: directory, home: directory, env: process.env }),
    registerEditAnnotator: () => {}, registerWorkspaceRoot: () => {}, shutdown: async () => {},
  };
  const sessions: LanguageServerSession[] = [];
  let launches = 0;
  const adapter: LanguageServerAdapter = {
    id: "typescript", label: "Test LSP", languages: { ".ts": "typescript" }, rootDescription: "directory",
    resolveRoot: resolveRootDirectory,
    launch: async (_context, selectedRoot) => {
      launches++;
      return {
        label: "Test LSP", command: process.execPath,
        args: ["--input-type=module", "-e", `
          import { createRequire } from "node:module";
          const { createMessageConnection } = createRequire(${JSON.stringify(import.meta.url)})("vscode-jsonrpc/node");
          const connection = createMessageConnection(process.stdin, process.stdout);
          connection.onRequest("initialize", () => ({ capabilities: { diagnosticProvider: {} } }));
          connection.onRequest("textDocument/diagnostic", () => ({ kind: "full", items: [] }));
          connection.onRequest("shutdown", () => null);
          connection.onNotification("exit", () => process.exit(0));
          connection.listen();
        `],
        cwd: directory, env: process.env, rootUri: pathToFileURL(selectedRoot).href, languages: { ".ts": "typescript" },
      };
    },
    open: async (session, selectedRoot, timeoutMs) => {
      sessions.push(session);
      return open(session, selectedRoot, timeoutMs);
    },
  };
  const host = new LanguageServerHost(adapter, sandbox, { openTimeoutMs: 2_000, diagnosticsTimeoutMs: 1_000, ...options });
  t.after(async () => { await host.shutdown(); await rm(directory, { recursive: true, force: true }); });
  return { host, root, second, adapter, sandbox, sessions, launches: () => launches };
};

test("opening snapshots return immediately and concurrent same-root calls share the real process", { timeout: 5_000 }, async (t) => {
  const entered = deferred();
  const loaded = deferred<string>();
  const run = await fixture(t, async () => { entered.resolve(); return loaded.promise; });
  const first = run.host.open("run", run.root);
  const second = run.host.open("run", run.root);
  await entered.promise;
  const snapshot = await prompt(run.host.snapshot("run"));
  assert.equal(snapshot.state, "opening");
  assert.equal(snapshot.root, run.root);
  assert.match(snapshot.summary!, /Test LSP lädt/);
  assert.deepEqual(snapshot.files, []);
  assert.match(await prompt(run.host.status("run")), /lädt/);
  loaded.resolve("Solution and projects loaded");
  assert.ok((await Promise.all([first, second])).every((message) => message.includes("Solution and projects loaded")));
  assert.equal(run.launches(), 1);
  assert.equal(run.sessions.length, 1);
  assert.deepEqual(await run.host.snapshot("run"), { state: "ready", root: run.root, summary: "Solution and projects loaded", files: [] });
});

test("a failed open remains visible and diagnostics never retry it implicitly", { timeout: 5_000 }, async (t) => {
  let fail = true;
  const run = await fixture(t, async () => {
    if (fail) throw new Error("Solution load failed: project reference is missing");
    return "Explicit retry loaded the project";
  });
  await assert.rejects(run.host.open("run", run.root), /project reference is missing/);
  assert.equal(run.sessions[0].exited, true);
  const failed = await prompt(run.host.snapshot("run"));
  assert.equal(failed.state, "failed");
  assert.equal(failed.root, run.root);
  assert.equal(failed.summary, "Solution load failed: project reference is missing");
  assert.match(await prompt(run.host.status("run")), /project reference is missing/);
  await assert.rejects(run.host.diagnostics("run", [path.join(run.root, "index.ts")], false), /project reference is missing/);
  assert.match(await run.host.annotate("run", path.join(run.root, "index.ts")) ?? "", /project reference is missing/);
  assert.deepEqual(await run.host.snapshot("run"), failed);
  assert.equal(run.launches(), 1);
  fail = false;
  assert.equal(await run.host.open("run", run.root), "Explicit retry loaded the project");
  assert.equal(run.launches(), 2);
  assert.equal((await run.host.snapshot("run")).state, "ready");
});

test("launch and root-resolution failures retain their cause until stop", { timeout: 5_000 }, async (t) => {
  const run = await fixture(t, async () => "unused");
  const launch = t.mock.method(run.adapter, "launch", async () => { throw new Error("Compiler executable was not configured"); });
  await assert.rejects(run.host.open("run", run.root), /not configured/);
  assert.deepEqual(await run.host.snapshot("run"), {
    state: "failed", root: run.root, summary: "Compiler executable was not configured", files: [],
  });
  await run.host.stopSession("run");
  assert.deepEqual(await run.host.snapshot("run"), { state: "closed", root: null, summary: null, files: [] });
  launch.mock.restore();
  const missing = path.join(run.root, "missing");
  await assert.rejects(run.host.open("run", missing));
  const invalid = await run.host.snapshot("run");
  assert.equal(invalid.state, "failed");
  assert.equal(invalid.root, missing);
  assert.ok(invalid.summary);
  await run.host.stopSession("run");
  assert.equal((await run.host.snapshot("run")).state, "closed");
});

test("a protocol initialization failure is retained before the adapter can report ready", { timeout: 5_000 }, async (t) => {
  const run = await fixture(t, async () => "must not run");
  const launch = run.adapter.launch;
  t.mock.method(run.adapter, "launch", async (...args: Parameters<LanguageServerAdapter["launch"]>) => {
    const configuration = await launch(...args);
    configuration.args[2] = configuration.args[2].replace(
      'connection.onRequest("initialize", () => ({ capabilities: { diagnosticProvider: {} } }));',
      'connection.onRequest("initialize", () => { throw new Error("LSP initialization failed"); });',
    );
    return configuration;
  });
  await assert.rejects(run.host.open("run", run.root), /LSP initialization failed/);
  const snapshot = await prompt(run.host.snapshot("run"));
  assert.equal(snapshot.state, "failed");
  assert.equal(snapshot.root, run.root);
  assert.match(snapshot.summary!, /LSP initialization failed/);
  assert.equal(run.sessions.length, 0);
});

test("an adapter cannot report ready after its process already exited", { timeout: 5_000 }, async (t) => {
  const run = await fixture(t, async (session) => {
    await session.shutdown();
    return "Late ready message";
  });
  await assert.rejects(run.host.open("run", run.root), /während des Ladens beendet/);
  const snapshot = await run.host.snapshot("run");
  assert.equal(snapshot.state, "failed");
  assert.doesNotMatch(snapshot.summary!, /Late ready message/);
});

test("stopping during solution load closes the process and rejects late success before a new start", { timeout: 5_000 }, async (t) => {
  const entered = deferred();
  const loaded = deferred<string>();
  let attempt = 0;
  const run = await fixture(t, async () => {
    if (++attempt === 1) { entered.resolve(); return loaded.promise; }
    return "New start loaded";
  });
  const opening = assert.rejects(run.host.open("run", run.root), /Start wurde beendet/);
  await entered.promise;
  await prompt(run.host.stopSession("run"));
  assert.equal(run.sessions[0].exited, true);
  assert.deepEqual(await run.host.snapshot("run"), { state: "closed", root: null, summary: null, files: [] });
  assert.equal(await run.host.open("run", run.second), "New start loaded");
  loaded.resolve("Stale solution success");
  await opening;
  assert.deepEqual(await run.host.snapshot("run"), { state: "ready", root: run.second, summary: "New start loaded", files: [] });
  assert.equal(run.launches(), 2);
});

test("replacing a loading root cancels the previous start and keeps the new root ready", { timeout: 5_000 }, async (t) => {
  const entered = deferred();
  const loaded = deferred<string>();
  let attempt = 0;
  const run = await fixture(t, async () => {
    if (++attempt === 1) { entered.resolve(); return loaded.promise; }
    return "Replacement loaded";
  });
  const replaced = assert.rejects(run.host.open("run", run.root), /Start wurde beendet/);
  await entered.promise;
  assert.equal(await run.host.open("run", run.second), "Replacement loaded");
  await replaced;
  loaded.resolve("Superseded success");
  assert.equal(run.sessions[0].exited, true);
  assert.equal(run.sessions[1].exited, false);
  assert.deepEqual(await run.host.snapshot("run"), { state: "ready", root: run.second, summary: "Replacement loaded", files: [] });
});

test("shutdown during launch prevents any later process or ready state", { timeout: 5_000 }, async (t) => {
  const entered = deferred();
  const release = deferred();
  const run = await fixture(t, async () => "unused");
  const launch = run.adapter.launch;
  t.mock.method(run.adapter, "launch", async (...args: Parameters<LanguageServerAdapter["launch"]>) => {
    entered.resolve();
    await release.promise;
    return launch(...args);
  });
  const opening = assert.rejects(run.host.open("run", run.root), /Start wurde beendet/);
  await entered.promise;
  assert.equal((await prompt(run.host.snapshot("run"))).state, "opening");
  await prompt(run.host.shutdown());
  release.resolve();
  await opening;
  assert.equal(run.sessions.length, 0);
  assert.deepEqual(await run.host.snapshot("run"), { state: "closed", root: null, summary: null, files: [] });
  await assert.rejects(run.host.open("run", run.root), /Start wurde beendet/);
});

test("stop invalidates an open still resolving its workspace", { timeout: 5_000 }, async (t) => {
  const entered = deferred();
  const release = deferred();
  const run = await fixture(t, async () => "unused");
  const context = run.sandbox.processContextFor;
  t.mock.method(run.sandbox, "processContextFor", async (runId: string) => {
    entered.resolve();
    await release.promise;
    return context(runId);
  });
  const opening = assert.rejects(run.host.open("run", run.root), /Start wurde beendet/);
  await entered.promise;
  await run.host.stopSession("run");
  release.resolve();
  await opening;
  assert.equal(run.launches(), 0);
  assert.deepEqual(await run.host.snapshot("run"), { state: "closed", root: null, summary: null, files: [] });
});

test("shutdown joins an idle cleanup already in progress and clears the remembered root", { timeout: 5_000 }, async (t) => {
  const stopping = deferred();
  const release = deferred();
  const run = await fixture(t, async (session) => {
    const shutdown = session.shutdown.bind(session);
    t.mock.method(session, "shutdown", async () => {
      stopping.resolve();
      await release.promise;
      await shutdown();
    });
    return "Ready until idle";
  }, { idleMs: 10 });
  try {
    await run.host.open("run", run.root);
    await stopping.promise;
    assert.equal((await prompt(run.host.snapshot("run"))).state, "suspended");
    let closed = false;
    const shutdown = run.host.shutdown().then(() => { closed = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(closed, false, "shutdown must join the actual process cleanup");
    release.resolve();
    await shutdown;
    assert.equal(run.sessions[0].exited, true);
    assert.deepEqual(await run.host.snapshot("run"), { state: "closed", root: null, summary: null, files: [] });
  } finally {
    release.resolve();
  }
});
