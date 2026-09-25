import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import {
  LanguageServerHost,
  resolveRootDirectory,
  withTimeout,
  type LanguageServerAdapter,
  type LanguageServerHostOptions,
  type LanguageServerSession,
  type LanguageServerSnapshot,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";

const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

const prompt = <T>(value: Promise<T>) => withTimeout(value, 1_000, () => new Error("The snapshot or stop waited for adapter.open"));

const until = async (condition: () => Promise<boolean>): Promise<void> => {
  while (!await condition()) await new Promise((resolve) => setTimeout(resolve, 10));
};

const only = (snapshot: LanguageServerSnapshot) => {
  assert.equal(snapshot.instances.length, 1, JSON.stringify(snapshot));
  return snapshot.instances[0];
};

const fixture = async (
  t: TestContext,
  open: LanguageServerAdapter["open"],
  options: LanguageServerHostOptions = {},
  overrides: Partial<Pick<LanguageServerAdapter, "resolveRoot" | "rootDirectory" | "solutionExtensions">> = {},
) => {
  const scratch = "/private/tmp/ragents-lsp-startup";
  await mkdir(scratch, { recursive: true });
  const directory = await realpath(await mkdtemp(path.join(scratch, "host-")));
  const root = path.join(directory, "first");
  const second = path.join(directory, "second");
  await Promise.all([root, second].map((entry) => mkdir(entry)));
  await writeFile(path.join(root, "index.ts"), "export const value = 1;\n");
  const sandbox = {
    contextFor: async (runId: string): Promise<WorkspaceProcessContext> =>
      ({ runId, cwd: directory, root: directory, home: directory, env: process.env }),
  };
  const sessions: LanguageServerSession[] = [];
  let launches = 0;
  const adapter: LanguageServerAdapter = {
    id: "typescript", label: "Test LSP", languages: { ".ts": "typescript" }, rootDescription: "directory",
    resolveRoot: resolveRootDirectory,
    rootDirectory: (selectedRoot) => selectedRoot,
    ...overrides,
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
  const host = new LanguageServerHost(adapter, (runId) => sandbox.contextFor(runId), { openTimeoutMs: 2_000, diagnosticsTimeoutMs: 1_000, ...options });
  t.after(async () => { await host.shutdown(); await rm(directory, { recursive: true, force: true }); });
  return { host, directory, root, second, adapter, sandbox, sessions, launches: () => launches };
};

test("opening snapshots return immediately and concurrent same-root calls share the real process", { timeout: 5_000 }, async (t) => {
  const entered = deferred();
  const loaded = deferred<string>();
  const run = await fixture(t, async () => { entered.resolve(); return loaded.promise; });
  const first = run.host.open("run", run.root);
  const second = run.host.open("run", run.root);
  await entered.promise;
  const snapshot = only(await prompt(run.host.snapshot("run")));
  assert.equal(snapshot.state, "opening");
  assert.equal(snapshot.root, run.root);
  assert.match(snapshot.summary!, /Test LSP lädt/);
  assert.deepEqual(snapshot.files, []);
  loaded.resolve("Solution and projects loaded");
  assert.ok((await Promise.all([first, second])).every((message) => message.includes("Solution and projects loaded")));
  assert.equal(run.launches(), 1);
  assert.equal(run.sessions.length, 1);
  assert.deepEqual(await run.host.snapshot("run"), {
    instances: [{ state: "ready", root: run.root, summary: "Solution and projects loaded", files: [] }],
  });
});

test("a failed open remains visible and diagnostics never retry it implicitly", { timeout: 5_000 }, async (t) => {
  let fail = true;
  const run = await fixture(t, async () => {
    if (fail) throw new Error("Solution load failed: project reference is missing");
    return "Explicit retry loaded the project";
  });
  await assert.rejects(run.host.open("run", run.root), /project reference is missing/);
  assert.equal(run.sessions[0].exited, true);
  const failed = only(await prompt(run.host.snapshot("run")));
  assert.equal(failed.state, "failed");
  assert.equal(failed.root, run.root);
  assert.equal(failed.summary, "Solution load failed: project reference is missing");
  await assert.rejects(run.host.diagnostics("run", [path.join(run.root, "index.ts")], false), /project reference is missing/);
  assert.match(await run.host.annotate("run", path.join(run.root, "index.ts")) ?? "", /project reference is missing/);
  assert.deepEqual(only(await run.host.snapshot("run")), failed);
  assert.equal(run.launches(), 1);
  fail = false;
  assert.match(await run.host.open("run", run.root), /Explicit retry loaded the project/);
  assert.equal(run.launches(), 2);
  assert.equal(only(await run.host.snapshot("run")).state, "ready");
});

test("a failed root reports its cause in diagnostics without blocking the other roots and closes by its given name", { timeout: 10_000 }, async (t) => {
  const run = await fixture(t, async (_session, selectedRoot) => {
    if (selectedRoot === run.root) throw new Error("Solution load failed: first root is broken");
    return "Second root loaded";
  });
  execFileSync("git", ["init", "-q"], { cwd: run.second });
  await writeFile(path.join(run.second, "changed.ts"), "export const changed = 1;\n");
  await assert.rejects(run.host.open("run", run.root), /first root is broken/);
  assert.match(await run.host.open("run", run.second), /Second root loaded/);
  const report = await run.host.diagnostics("run", undefined, false);
  assert.match(report, /changed\.ts/);
  assert.match(report, /für .*first nicht geöffnet: Solution load failed: first root is broken; typescript_open öffnet die Wurzel erneut/);
  await assert.rejects(run.host.diagnostics("run", undefined, false, run.root), /first root is broken/);
  await run.host.close("run", run.second);
  await assert.rejects(run.host.diagnostics("run", undefined, false), /first root is broken/);

  await assert.rejects(run.host.open("run", "../outside"), /außerhalb des Arbeitsverzeichnisses/);
  assert.ok((await run.host.snapshot("run")).instances.some((instance) => instance.state === "failed" && instance.root === path.resolve(path.dirname(run.root), "../outside")));
  assert.match(await run.host.close("run", "../outside"), /beendet; 1 offene Instanz/);
  assert.match(await run.host.close("run", run.root), /beendet; 0 offene Instanzen/);
  assert.deepEqual(await run.host.snapshot("run"), { instances: [] });
});

test("launch and root-resolution failures retain their cause until stop", { timeout: 5_000 }, async (t) => {
  const run = await fixture(t, async () => "unused");
  const launch = t.mock.method(run.adapter, "launch", async () => { throw new Error("Compiler executable was not configured"); });
  await assert.rejects(run.host.open("run", run.root), /not configured/);
  assert.deepEqual(await run.host.snapshot("run"), {
    instances: [{ state: "failed", root: run.root, summary: "Compiler executable was not configured", files: [] }],
  });
  await run.host.stopSession("run");
  assert.deepEqual(await run.host.snapshot("run"), { instances: [] });
  launch.mock.restore();
  const missing = path.join(run.root, "missing");
  await assert.rejects(run.host.open("run", missing));
  const invalid = only(await run.host.snapshot("run"));
  assert.equal(invalid.state, "failed");
  assert.equal(invalid.root, missing);
  assert.ok(invalid.summary);
  await run.host.stopSession("run");
  assert.deepEqual(await run.host.snapshot("run"), { instances: [] });
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
  const snapshot = only(await prompt(run.host.snapshot("run")));
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
  const snapshot = only(await run.host.snapshot("run"));
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
  assert.deepEqual(await run.host.snapshot("run"), { instances: [] });
  assert.match(await run.host.open("run", run.second), /New start loaded/);
  loaded.resolve("Stale solution success");
  await opening;
  assert.deepEqual(await run.host.snapshot("run"), {
    instances: [{ state: "ready", root: run.second, summary: "New start loaded", files: [] }],
  });
  assert.equal(run.launches(), 2);
});

test("a second root starts beside a loading one and both are closed separately", { timeout: 5_000 }, async (t) => {
  const entered = deferred();
  const loaded = deferred<string>();
  let attempt = 0;
  const run = await fixture(t, async () => {
    if (++attempt === 1) { entered.resolve(); return loaded.promise; }
    return "Second root loaded";
  });
  const first = run.host.open("run", run.root);
  await entered.promise;
  assert.match(await run.host.open("run", run.second), /Second root loaded \(Wurzel .*second\); 2 offene Instanzen von Test LSP/);
  loaded.resolve("First root loaded");
  assert.match(await first, /First root loaded \(Wurzel .*first\); 2 offene Instanzen von Test LSP/);
  assert.equal(run.sessions[0].exited, false);
  assert.equal(run.sessions[1].exited, false);
  assert.deepEqual(await run.host.snapshot("run"), {
    instances: [
      { state: "ready", root: run.root, summary: "First root loaded", files: [] },
      { state: "ready", root: run.second, summary: "Second root loaded", files: [] },
    ],
  });
  assert.match(await run.host.close("run", run.second), /beendet; 1 offene Instanz in diesem Run/);
  assert.equal(run.sessions[1].exited, true);
  assert.deepEqual(await run.host.snapshot("run"), {
    instances: [{ state: "ready", root: run.root, summary: "First root loaded", files: [] }],
  });
  assert.match(await run.host.close("run"), /eine Instanz beendet; keine offene Instanz mehr/);
  assert.equal(run.sessions[0].exited, true);
  assert.deepEqual(await run.host.snapshot("run"), { instances: [] });
  assert.match(await run.host.close("run"), /ist in diesem Run nicht geöffnet/);
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
  assert.equal(only(await prompt(run.host.snapshot("run"))).state, "opening");
  await prompt(run.host.shutdown());
  release.resolve();
  await opening;
  assert.equal(run.sessions.length, 0);
  assert.deepEqual(await run.host.snapshot("run"), { instances: [] });
  await assert.rejects(run.host.open("run", run.root), /Start wurde beendet/);
});

test("stop invalidates an open still resolving its workspace", { timeout: 5_000 }, async (t) => {
  const entered = deferred();
  const release = deferred();
  const run = await fixture(t, async () => "unused");
  const context = run.sandbox.contextFor;
  t.mock.method(run.sandbox, "contextFor", async (runId: string) => {
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
  assert.deepEqual(await run.host.snapshot("run"), { instances: [] });
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
    assert.equal(only(await prompt(run.host.snapshot("run"))).state, "suspended");
    let closed = false;
    const shutdown = run.host.shutdown().then(() => { closed = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(closed, false, "shutdown must join the actual process cleanup");
    release.resolve();
    await shutdown;
    assert.equal(run.sessions[0].exited, true);
    assert.deepEqual(await run.host.snapshot("run"), { instances: [] });
  } finally {
    release.resolve();
  }
});

const solutionAdapter = {
  resolveRoot: async (_workspaceRoot: string, selectedRoot: string) => selectedRoot,
  rootDirectory: (selectedRoot: string) => path.dirname(selectedRoot),
  solutionExtensions: [".sln", ".slnx"],
};

test("solutions come from git without node_modules, bin and obj, name their open state and fall back to the folder without git", { timeout: 10_000 }, async (t) => {
  const run = await fixture(t, async (_session, selectedRoot) => `${path.basename(selectedRoot)} geladen`, {}, solutionAdapter);
  const files = ["src/Demo.sln", "tools/Acme.slnx", "node_modules/pkg/Package.sln", "src/bin/Debug/Copy.sln", "src/obj/Copy.sln", ".hidden/Hidden.sln", "src/Demo.csproj"];
  for (const file of files) {
    await mkdir(path.dirname(path.join(run.directory, file)), { recursive: true });
    await writeFile(path.join(run.directory, file), "");
  }
  assert.deepEqual(await run.host.solutions("run"), {
    source: "directory",
    solutions: [
      { path: "src/Demo.sln", root: path.join(run.directory, "src/Demo.sln"), state: null },
      { path: "tools/Acme.slnx", root: path.join(run.directory, "tools/Acme.slnx"), state: null },
    ],
    opened: false,
  });
  await rm(path.join(run.directory, ".hidden"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: run.directory });
  execFileSync("git", ["add", "src/Demo.sln"], { cwd: run.directory });
  await writeFile(path.join(run.directory, ".gitignore"), "ignored/\n");
  await mkdir(path.join(run.directory, "ignored"));
  await writeFile(path.join(run.directory, "ignored/Ignored.sln"), "");
  assert.match(await run.host.open("run", "src/Demo.sln"), /Demo\.sln geladen/);
  assert.deepEqual(await run.host.solutions("run"), {
    source: "git",
    solutions: [
      { path: "src/Demo.sln", root: path.join(run.directory, "src/Demo.sln"), state: "ready" },
      { path: "tools/Acme.slnx", root: path.join(run.directory, "tools/Acme.slnx"), state: null },
    ],
    opened: true,
  });
});

test("an open with ifNoneOpen loads nothing while another open resolves or an instance exists", { timeout: 5_000 }, async (t) => {
  const entered = deferred();
  const release = deferred();
  const run = await fixture(t, async () => "geladen");
  const context = run.sandbox.contextFor;
  const blocking = t.mock.method(run.sandbox, "contextFor", async (runId: string) => {
    entered.resolve();
    await release.promise;
    return context(runId);
  });
  const first = run.host.open("run", run.root);
  await entered.promise;
  assert.match(await run.host.open("run", run.second, true), /lädt .*second nicht: in diesem Run ist schon eine Instanz offen oder im Aufbau/);
  release.resolve();
  await first;
  blocking.mock.restore();
  assert.match(await run.host.open("run", run.second, true), /nicht: in diesem Run ist schon eine Instanz offen/);
  assert.equal(run.launches(), 1);
  await run.host.close("run");
  assert.match(await run.host.open("run", run.second, true), /geladen \(Wurzel .*second\)/);
  assert.equal(run.launches(), 2);
});

test("switching loads the chosen root without waiting, closes every other instance, keeps a loaded one and null closes all", { timeout: 5_000 }, async (t) => {
  const loaded = deferred<string>();
  const run = await fixture(t, async (_session, selectedRoot) => selectedRoot === run.second ? loaded.promise : "Erste geladen");
  await run.host.open("run", run.root);
  assert.match(await prompt(run.host.switchTo("run", run.second)), /lädt .*second; eine andere Instanz beendet/);
  assert.equal(run.sessions[0].exited, true);
  assert.deepEqual((await run.host.snapshot("run")).instances.map((instance) => [instance.root, instance.state]), [[run.second, "opening"]]);
  loaded.resolve("Zweite geladen");
  await until(async () => only(await run.host.snapshot("run")).state === "ready");
  assert.match(await run.host.switchTo("run", run.second), /behält .*second$/);
  assert.equal(run.launches(), 2);
  assert.match(await run.host.switchTo("run", null), /eine Instanz beendet/);
  assert.deepEqual(await run.host.snapshot("run"), { instances: [] });
});
