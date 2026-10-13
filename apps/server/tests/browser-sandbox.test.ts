import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readlink, realpath, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { COMMAND_OPERATIONS, executorMachine, type CommandResult } from "@ragents/workspace-executor";
import { BROWSER_OPERATIONS, type BrowserSnapshot, type BrowserStep } from "../../../plugins/ragents.browser/executor/contract.ts";
import { browserModule } from "../../../plugins/ragents.browser/executor/module.ts";
import { assertBrowserSocketPath, hostPlaywright } from "../../../plugins/ragents.browser/executor/playwright.ts";
import { hostRoot } from "../src/host-version.ts";
import { ServerProcessSandbox } from "../src/plugin-support/process-sandbox.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";

const linuxBrowserSkip = (() => {
  if (process.platform !== "linux") return "Linux browser sandbox check requires bubblewrap; this machine uses a different platform";
  try { execFileSync("bwrap", ["--version"], { stdio: "ignore" }); }
  catch { return "Linux browser sandbox check requires bubblewrap, which is unavailable"; }
  return process.env.RAGENTS_BROWSER_TESTS === "1" ? false : "Set RAGENTS_BROWSER_TESTS=1 to run real Chromium with bubblewrap";
})();

test("Linux run browsers navigate with a long data path and keep launch storage private and temporary", { skip: linuxBrowserSkip, timeout: 90000 }, async (t) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-browser-sandbox-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = path.join(directory, "home", "user", ".local", "share", "ragents", "example-profile");
  const storage = (runId: string): string => path.join(data, "sessions", runId);
  const sandbox = new ServerProcessSandbox({ network: [], serverAddress: undefined, dataDirectory: data, disableSetting: 'PROCESS_SANDBOX: "off"' });
  const machine = executorMachine("/unused");
  const host = new WorkspaceSandboxHost({
    contributorName: "acme.workspace", contributions: [{ modules: [browserModule(machine)] }],
    workspaceFor: async (runId) => {
      const cwd = path.join(storage(runId), "workspace");
      await mkdir(cwd, { recursive: true });
      return { cwd, currentRoot: async () => cwd, runOperation: (work) => work() };
    },
    homeFor: async (runId) => {
      const home = path.join(storage(runId), "home");
      await mkdir(home, { recursive: true });
      return { home };
    },
    identFor: async () => undefined, skillPaths: async () => [], storageRootFor: storage,
    processSandbox: sandbox, restrictedFor: () => true,
  });
  t.after(async () => { await host.shutdownAll(); await sandbox.stop(); });
  const preview = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><title>Acme preview</title><h1>Ready</h1>");
  });
  await new Promise<void>((resolve) => preview.listen(0, "127.0.0.1", resolve));
  t.after(() => { preview.closeAllConnections(); return new Promise<void>((resolve) => preview.close(() => resolve())); });
  const address = preview.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  host.registerBrowserOrigins(() => [origin]);
  const launches: { temporary: string; profile: string }[] = [];
  const playwright = await hostPlaywright(machine, hostRoot());
  const persistent = playwright.chromium.launchPersistentContext.bind(playwright.chromium);
  t.mock.method(playwright.chromium, "launchPersistentContext", async (profile: string, options: Parameters<typeof persistent>[1]) => {
    assert.ok(options?.env?.TMPDIR);
    launches.push({ temporary: options.env.TMPDIR, profile });
    return persistent(profile, options);
  });
  await sandbox.start();
  const runs = ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"];
  for (const run of runs) {
    const context = await host.serverProcessContextFor(run);
    assert.ok(context.sandbox);
    assert.throws(() => assertBrowserSocketPath(path.join(context.env!.TMPDIR!, "org.chromium.Chromium.XXXXXX", "SingletonSocket")), /Unix socket limit/);
    const probe = await host.execute(run, COMMAND_OPERATIONS.run, {
      program: process.execPath, args: ["-e", "require('node:fs').writeFileSync(require('node:path').join(process.env.TMPDIR, 'probe'), 'private');"], timeoutMs: 10000,
    }) as CommandResult;
    assert.equal(probe.exitCode, 0, probe.stderr);
    const opened = await host.execute(run, BROWSER_OPERATIONS.navigate, { url: origin, viewport: { width: 800, height: 600 } }) as BrowserStep<BrowserSnapshot>;
    assert.equal(opened.result.title, "Acme preview");
    assert.match(opened.result.snapshot, /Ready/);
  }
  assert.equal(launches.length, 2);
  assert.notEqual(launches[0]!.temporary, launches[1]!.temporary);
  for (const launch of launches) {
    assert.equal(path.dirname(launch.temporary), "/tmp");
    assert.equal((await stat(launch.temporary)).mode & 0o777, 0o700);
    const socket = await readlink(path.join(launch.profile, "SingletonSocket"));
    assertBrowserSocketPath(socket);
    assert.ok(socket.startsWith(launch.temporary + "/"));
  }
  for (const run of runs) {
    const hidden = await host.execute(run, COMMAND_OPERATIONS.run, {
      program: process.execPath,
      args: ["-e", `if (${JSON.stringify(launches.map((launch) => launch.temporary))}.some((entry) => require('node:fs').existsSync(entry))) throw new Error('Another launch is visible');`],
      timeoutMs: 10000,
    }) as CommandResult;
    assert.equal(hidden.exitCode, 0, hidden.stderr);
  }
  await host.shutdown(runs[0]!);
  await assert.rejects(access(launches[0]!.temporary), /ENOENT/);
  await access(launches[1]!.temporary);
  assert.equal((await host.execute(runs[1]!, BROWSER_OPERATIONS.snapshot, {}) as BrowserStep<BrowserSnapshot>).result.title, "Acme preview");
  await host.shutdown(runs[1]!);
  await assert.rejects(access(launches[1]!.temporary), /ENOENT/);
});
