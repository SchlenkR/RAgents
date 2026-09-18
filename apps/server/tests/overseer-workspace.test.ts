import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { PluginContext, ToolScope } from "@aicontainer/ragents";
import { WorkspaceSandboxHost } from "../src/plugin-support/workspace-sandbox-host.ts";
import { sanitizedEnv } from "../src/plugin-support/sandbox-tools.ts";
import type { SessionWorkspace } from "../src/ragents/workspace-runtime.ts";

const isolated = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-global-workspace-")));
  const cwd = path.join(directory, "workspace");
  const journals = path.join(directory, "journals");
  await mkdir(cwd);
  await mkdir(journals);
  await writeFile(path.join(journals, "journal.jsonl"), '{"test":"shared history"}\n');
  const workspace: SessionWorkspace = { cwd, hostSandbox: { home: cwd, readOnlyDirectories: [journals] },
    extraEnv: { RAGENTS_JOURNAL_DIR: journals }, currentRoot: async () => cwd, ensureWritable: async () => cwd,
    runOperation: (operation) => operation() };
  const forbidden = async (): Promise<never> => { throw new Error("Product workspace must not be prepared for global chat"); };
  const host = new WorkspaceSandboxHost({ contributorName: "test.workspace", workspaceFor: async () => workspace,
    identFor: forbidden, homeFor: forbidden, filesFor: forbidden, skillPaths: forbidden });
  const tools = await host.workspaceTools().tools({ runId: "overseer" } as PluginContext);
  const invoke = async (name: string, params: unknown) => {
    const tool = tools.find((entry) => entry.name === name);
    assert.ok(tool, name);
    return tool.run({ signal: new AbortController().signal } as ToolScope, `test-${name}`, params as never);
  };
  return { directory, cwd, journals, workspace, host, tools, invoke, close: async () => { await host.shutdownAll(); await rm(directory, { recursive: true, force: true }); } };
};

test("global coordinator uses common tools with actual journal reads and private writes", async () => {
  const f = await isolated();
  try {
    assert.deepEqual(f.tools.map((tool) => tool.name), ["read", "edit", "write", "bash"]);
    assert.ok(f.tools.every((tool) => tool.nativeTool === true));
    assert.ok(f.host.workspaceTools().descriptors.every((tool) => tool.nativeTool === true));
    const context = await f.host.processContextFor("overseer");
    assert.equal(context.cwd, f.cwd);
    assert.equal(context.uid, undefined);
    assert.equal(context.home, f.cwd);
    for (const file of ["$RAGENTS_JOURNAL_DIR/journal.jsonl", "${RAGENTS_JOURNAL_DIR}/journal.jsonl"]) {
      assert.match(String(await f.invoke("read", { path: file })), /shared history/);
    }
    await f.invoke("write", { path: "setup.ts", content: "const message = 'ready';" });
    await f.invoke("edit", { path: "setup.ts", edits: [{ oldText: "ready", newText: "configured" }] });
    assert.match(await readFile(path.join(f.cwd, "setup.ts"), "utf8"), /configured/);
    await assert.rejects(f.invoke("write", { path: "$RAGENTS_JOURNAL_DIR/journal.jsonl", content: "tampered" }), /außerhalb/);
    await assert.rejects(f.invoke("edit", { path: path.join(f.journals, "journal.jsonl"), edits: [{ oldText: "shared history", newText: "tampered" }] }), /außerhalb/);
    await symlink(f.journals, path.join(f.cwd, "journal-link"));
    await assert.rejects(f.invoke("write", { path: "journal-link/journal.jsonl", content: "tampered" }), /außerhalb/);
    assert.match(String(await f.invoke("bash", { command: 'rg "shared history" "$RAGENTS_JOURNAL_DIR"', timeout: 5 })), /shared history/);
    assert.equal(await readFile(path.join(f.journals, "journal.jsonl"), "utf8"), '{"test":"shared history"}\n');
    await f.host.shutdown("overseer");
    assert.equal((await f.host.workspaceTools().tools({ runId: "overseer" } as PluginContext)).length, 4);
  } finally { await f.close(); }
});

test("global shell reaches authenticated HTTP without credentials in ordinary run environments", async () => {
  const f = await isolated();
  const token = "test-only-global-access";
  let authorized = false;
  const server = createServer((request, response) => {
    authorized = request.headers.authorization === `Bearer ${token}`;
    response.writeHead(authorized ? 200 : 401, { "Content-Type": "text/plain" });
    response.end(authorized ? "accepted" : "denied");
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    f.workspace.extraEnv = { ...f.workspace.extraEnv, RAGENTS_API_BASE_URL: `http://127.0.0.1:${address.port}`, RAGENTS_API_TOKEN: token };
    const response = String(await f.invoke("bash", { command: 'curl --fail --silent --show-error --header "Authorization: Bearer $RAGENTS_API_TOKEN" "$RAGENTS_API_BASE_URL"', timeout: 5 }));
    assert.equal(authorized, true);
    assert.match(response, /accepted/);
    assert.ok(!response.includes(token));
    const normal = sanitizedEnv({ ACCESS_TOKEN: token, RAGENTS_API_TOKEN: token, RAGENTS_JOURNAL_DIR: f.journals }, { runId: "normal", workspace: { cwd: f.cwd } });
    assert.equal(normal.ACCESS_TOKEN, undefined);
    assert.equal(normal.RAGENTS_API_TOKEN, undefined);
    assert.equal(normal.RAGENTS_JOURNAL_DIR, undefined);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await f.close();
  }
});
