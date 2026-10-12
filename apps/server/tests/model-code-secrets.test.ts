import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { claimTurn, ToolRegistry, TurnToolset, type JsonValue, type NativeTypeScriptRequest } from "@ragents/engine";
import { COMMAND_OPERATIONS, LanguageServerSession, safeProcessEnvironment, type CommandResult } from "@ragents/workspace-executor";
import { excludeProcessEnvironment } from "@ragents/workspace-executor/src/safe-environment.ts";
import { scriptProgram } from "../../../packages/ragents/tests/native-executor.ts";
import { catalog, postTo, setupRun } from "../../../packages/ragents/tests/support.ts";
import { NodeTypeScriptExecutor } from "../src/plugin-support/native-typescript-executor.ts";
import { ServerProcessSandbox } from "../src/plugin-support/process-sandbox.ts";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";
import { createTypeScriptToolContributor } from "../src/ragents/typescript-tools.ts";

const supported = process.platform === "darwin" || process.platform === "linux";
const noCalls = async (): Promise<never> => { throw new Error("No function is configured."); };
const shellWord = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

const fixture = async (t: TestContext, protectedRun: boolean) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-code-secrets-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const secret = `example-secret-${randomUUID()}`;
  const foreign = path.join(root, "runs", "bob", "journal.jsonl");
  const workspace = path.join(root, "sessions", "alice", "workspace with 'quotes'");
  await Promise.all([path.dirname(foreign), workspace].map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(foreign, "another user's run");
  const server = spawn(process.execPath, ["-e", "process.stdout.write('ready'); setInterval(() => {}, 1000);"], {
    env: { ...safeProcessEnvironment(process.env), EXAMPLE_SERVER_SECRET: secret }, stdio: ["ignore", "pipe", "pipe"],
  });
  await once(server.stdout!, "data");
  const serverPid = server.pid!;
  t.after(async () => { const ended = once(server, "close"); server.kill(); await ended; });
  const saved = { EXAMPLE_SERVER_SECRET: process.env.EXAMPLE_SERVER_SECRET, LC_CTYPE: process.env.LC_CTYPE, JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS };
  process.env.EXAMPLE_SERVER_SECRET = secret;
  process.env.LC_CTYPE = secret;
  process.env.JAVA_TOOL_OPTIONS = secret;
  excludeProcessEnvironment({ EXAMPLE_SERVER_SECRET: secret });
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const sandbox = protectedRun ? new ServerProcessSandbox({
    network: [], serverAddress: undefined, dataDirectory: root, disableSetting: 'PROCESS_SANDBOX: "off"',
  }) : undefined;
  await sandbox?.start();
  t.after(() => sandbox?.stop());
  const host = new WorkspaceSandboxHost({
    contributorName: "test.workspace", contributions: [],
    workspaceFor: async () => ({ cwd: workspace, currentRoot: async () => workspace, runOperation: (operation) => operation() }),
    identFor: async () => undefined, homeFor: async () => ({ home: workspace }), skillPaths: async () => [],
    storageRootFor: () => path.join(root, "sessions", "alice"), ...(sandbox ? { processSandbox: sandbox } : {}),
  });
  t.after(() => host.shutdownAll());
  const native = new NodeTypeScriptExecutor({
    directoryFor: () => path.join(root, "sessions", "alice", "native"),
    serverProcessContextFor: (runId) => host.serverProcessContextFor(runId),
    isolatedProcessContextFor: (runId, directories, readable) => host.isolatedProcessContextFor(runId, directories, readable),
  });
  t.after(() => native.shutdown());
  const macProbe = path.join(workspace, "process-probe");
  if (process.platform === "darwin") {
    const source = path.join(workspace, "process-probe.c");
    await writeFile(source, `#include <sys/sysctl.h>
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/syscall.h>
int main(void) {
  int mib[] = { CTL_KERN, KERN_PROCARGS2, ${serverPid} };
  char args[1048576];
  size_t size = sizeof(args);
  int read = sysctl(mib, 3, args, &size, NULL, 0) == 0;
  int found = 0;
  for (size_t i = 0; read && i + strlen("${secret}") <= size; i++) {
    if (memcmp(args + i, "${secret}", strlen("${secret}")) == 0) found = 1;
  }
  mach_port_t task;
  int memory = 0;
  if (task_for_pid(mach_task_self(), ${serverPid}, &task) == KERN_SUCCESS) {
    mach_vm_address_t address = 0;
    mach_vm_size_t regionSize;
    vm_region_basic_info_data_64_t info;
    mach_msg_type_number_t count;
    mach_port_t object;
    while (1) {
      count = VM_REGION_BASIC_INFO_COUNT_64;
      if (mach_vm_region(task, &address, &regionSize, VM_REGION_BASIC_INFO_64, (vm_region_info_t)&info, &count, &object) != KERN_SUCCESS) break;
      if ((info.protection & VM_PROT_READ) && regionSize <= 16777216) {
        char *data = malloc(regionSize);
        mach_vm_size_t copied;
        if (mach_vm_read_overwrite(task, address, regionSize, (mach_vm_address_t)data, &copied) == KERN_SUCCESS) {
          for (size_t i = 0; i + strlen("${secret}") <= copied; i++) {
            if (memcmp(data + i, "${secret}", strlen("${secret}")) == 0) memory = 1;
          }
        }
        free(data);
      }
      if (memory || address + regionSize <= address) break;
      address += regionSize;
    }
  }
  size = sizeof(args);
  int raw = syscall(SYS_sysctl, mib, 3, args, &size, NULL, 0) == 0;
  int named = sysctlbyname("kern.procargs2.${serverPid}", args, &size, NULL, 0) == 0;
  printf("{\\"args\\":%s,\\"memory\\":%s}", (found || raw || named) ? "true" : "false", memory ? "true" : "false");
  return 0;
}
`);
    execFileSync("/usr/bin/clang", [source, "-o", macProbe, "-Wno-deprecated-declarations"], { env: safeProcessEnvironment(process.env) });
  }
  const attack = `const fs = await import("node:fs/promises");
const cp = await import("node:child_process");
const secret = ${JSON.stringify(secret)};
const readable = async (file: string) => fs.readFile(file, "utf8").then(text => text.includes(secret), () => false);
const proc = await Promise.all(["/proc/1/environ", "/proc/${serverPid}/environ", "/proc/${serverPid}/root/proc/${serverPid}/environ"].map(readable));
let processList = false;
try { processList = cp.execFileSync("/bin/ps", ["eww", "-p", "${serverPid}"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes(secret); } catch {}
let memory = false;
let args = false;
if (process.platform === "darwin") {
  try { const probe = JSON.parse(cp.execFileSync(${JSON.stringify(macProbe)}, { encoding: "utf8" })); memory = probe.memory; args = probe.args; } catch {}
} else {
  memory = await fs.open("/proc/${serverPid}/mem", "r").then(async file => { await file.close(); return true; }, () => false);
}
const foreign = await fs.readFile(${JSON.stringify(foreign)}, "utf8").then(() => true, () => false);
return { environment: Object.values(process.env).some(value => value?.includes(secret)), proc, processList, memory, args, foreign, uid: process.getuid!() };`;
  return { root, workspace, secret, serverPid, host, native, attack, macProbe };
};

type AttackResult = { environment: boolean; proc: boolean[]; processList: boolean; memory: boolean; args: boolean; foreign: boolean; uid: number };

const checkAttack = (result: AttackResult, protectedRun: boolean): void => {
  assert.equal(result.environment, false);
  assert.equal(result.uid, process.getuid!());
  assert.equal(result.foreign, !protectedRun);
  if (protectedRun) {
    assert.deepEqual(result.proc, [false, false, false]);
    assert.equal(result.processList, false);
    assert.equal(result.args, false);
    assert.equal(result.memory, false);
  } else {
    if (process.platform === "linux") assert.equal(result.proc[1], true);
    if (process.platform === "darwin") assert.equal(result.args, true);
    assert.equal(result.processList, true);
  }
};

for (const protectedRun of [false, true]) {
  test(`a real typescript_eval and actor backend probe secrets and another user's run (sandbox ${protectedRun})`, { skip: !supported, timeout: 60_000 }, async (t) => {
    const f = await fixture(t, protectedRun);
    const setup = setupRun({ toolNames: ["typescript_eval"], exactTools: true });
    setup.services.nativeTypeScriptExecutor = f.native;
    t.after(() => setup.journal.close());
    const contextFor = (runId: string) => f.host.serverProcessContextFor(runId);
    const registry = new ToolRegistry().register(createTypeScriptToolContributor({ serverProcessContextFor: contextFor, execute: f.host.execute.bind(f.host) }));
    const queued = postTo(setup.runtime, setup.view, setup.agent.id, "attack-input", "Read the server secret.");
    const input = queued.inputs.find((entry) => entry.actorId === setup.agent.id && entry.lifecycle.kind === "pending")!;
    const turn = claimTurn(setup.runtime, setup.view.id, setup.agent.id, input.id, "attack-turn");
    const toolset = await TurnToolset.create({ runtime: setup.runtime, turn, catalog, registry });
    const snippet = await toolset.invoke("attack", "typescript_eval", { code: f.attack });
    checkAttack((snippet.output as { result: JsonValue }).result as unknown as AttackResult, protectedRun);
    for (const isolated of protectedRun ? [false, true] : [false]) {
      const request: NativeTypeScriptRequest = {
        program: scriptProgram(`export const handle = async () => { ${f.attack} };`), input: {},
        instanceId: `actor-${isolated}`, cwd: f.workspace, ...(isolated ? { isolated: true } : {}),
        context: { runId: "alice", invocationId: "attack", invocationKind: "input", principal: { id: "actor", kind: "script" }, capabilities: [] },
      };
      checkAttack((await f.native.execute(request, { call: noCalls, log: () => undefined })).result as unknown as AttackResult, protectedRun);
    }
  });

  test(`workspace processes receive the clean environment (sandbox ${protectedRun})`, { skip: !supported, timeout: 60_000 }, async (t) => {
    const f = await fixture(t, protectedRun);
    const script = path.join(f.workspace, "environment.cjs");
    await writeFile(script, "process.stdout.write(JSON.stringify(process.env));");
    const command = `${shellWord(await realpath(process.execPath))} ${shellWord(script)}`;
    const foreground = await f.host.execute("alice", "bash", { command });
    assert.doesNotMatch(JSON.stringify(foreground), new RegExp(f.secret));
    const output = path.join(f.workspace, "background.json");
    await f.host.execute("alice", "bash", { command: `${command} > ${shellWord(output)}`, run_in_background: true, startedBy: "actor" });
    const deadline = Date.now() + 10_000;
    for (;;) {
      const content = await readFile(output, "utf8").catch(() => "");
      if (content.endsWith("}")) { assert.doesNotMatch(content, new RegExp(f.secret)); break; }
      assert.ok(Date.now() < deadline, "The background command did not write its environment.");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const result = await f.host.execute("alice", COMMAND_OPERATIONS.run, { program: await realpath(process.execPath), args: [script], timeoutMs: 10_000 }) as CommandResult;
    assert.equal(result.exitCode, 0);
    assert.doesNotMatch(result.stdout, new RegExp(f.secret));
    const context = await f.host.serverProcessContextFor("alice");
    assert.equal(context.env.LC_CTYPE, undefined);
    assert.equal(context.env.EXAMPLE_SERVER_SECRET, undefined);
    assert.ok(context.env.PATH);
    assert.ok(context.env.HOME);
    const domainTest = path.join(f.workspace, "environment.test.mjs");
    await writeFile(domainTest, `import assert from "node:assert/strict";
import test from "node:test";
test("actor domain test environment", () => assert.ok(!Object.values(process.env).includes(${JSON.stringify(f.secret)})));`);
    const tests = await f.host.execute("alice", COMMAND_OPERATIONS.run, { program: await realpath(process.execPath), args: ["--test", domainTest], timeoutMs: 10_000 }) as CommandResult;
    assert.equal(tests.exitCode, 0, tests.stdout + tests.stderr);
    const lspOutput = path.join(f.workspace, "lsp-environment.json");
    const lsp = ["--input-type=module", "-e", `
      import { createRequire } from "node:module";
      import { writeFileSync } from "node:fs";
      writeFileSync(${JSON.stringify(lspOutput)}, JSON.stringify(process.env));
      const { createMessageConnection } = createRequire(${JSON.stringify(import.meta.url)})("vscode-jsonrpc/node");
      const connection = createMessageConnection(process.stdin, process.stdout);
      connection.onRequest("initialize", () => ({ capabilities: {} }));
      connection.onRequest("shutdown", () => null);
      connection.onNotification("exit", () => process.exit(0));
      connection.listen();
    `];
    const launch = await context.sandbox?.wrap({ command: await realpath(process.execPath), args: lsp });
    const languageServer = await LanguageServerSession.start({
      label: "Environment probe", command: launch?.command ?? process.execPath,
      args: launch ? [...launch.args] : lsp,
      cwd: context.cwd, env: context.env, rootUri: "file:///workspace", languages: {},
    }, 5_000);
    try { assert.doesNotMatch(await readFile(lspOutput, "utf8"), new RegExp(f.secret)); }
    finally { await languageServer.shutdown(); }
  });
}
