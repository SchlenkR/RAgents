import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@aicontainer/agent";
import { createProjectDiagnostics } from "../../../plugins/ragents.actor-programs/server/project-diagnostics.ts";

const connect = async (diagnostics: ReturnType<typeof createProjectDiagnostics>, entries: unknown[] = [], agentId = "agent-1") => {
  let handler: (event: ContextEvent, context: ExtensionContext) => Promise<{ messages?: unknown[] } | void>;
  const api = {
    on: (name: string, callback: typeof handler) => { assert.equal(name, "context"); handler = callback; },
    appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
  } as unknown as ExtensionAPI;
  const extensions = await diagnostics.contribution.resolve!({ runId: "run-1", agentId, audience: "coordinator", workspace: "/unused" });
  const extension = extensions[0]!;
  assert.ok(typeof extension !== "function");
  await extension.factory(api, { signal: new AbortController().signal });
  return {
    entries,
    async beforeModel(signal?: AbortSignal): Promise<string | undefined> {
      const result = await handler({ type: "context", messages: [] }, {
        sessionManager: { getBranch: () => entries }, signal,
      } as unknown as ExtensionContext);
      return (result?.messages?.at(-1) as { content?: string } | undefined)?.content;
    },
  };
};

test("project diagnostics see Bash changes and deletes, persist per agent, and inject only before the next changed request", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "ragents-actor-program-diagnostics-"));
  const directory = path.join(workspace, "programs/counter");
  const checked: string[] = [];
  const options = {
    workspaceFor: () => path.join(workspace, "programs"),
    check: async (_runId: string, programName: string, actorId: string) => {
      checked.push(`${actorId}/${programName}`);
      const source = await readFile(path.join(directory, "src/helper.ts"), "utf8");
      if (source.includes("broken")) throw new Error("src/helper.ts:1:1 TS2322: Type 'string' is not assignable to type 'number'.");
    },
  };
  try {
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(path.join(directory, "src/client.tsx"), "import './helper';");
    await writeFile(path.join(directory, "src/helper.ts"), "broken");
    const diagnostics = createProjectDiagnostics(options);
    const agent = await connect(diagnostics);
    assert.match((await agent.beforeModel())!, /1 Fehler.*1 neu, 0 behoben/);
    assert.match(diagnostics.latest("run-1", "agent-1"), /TS2322/);
    assert.equal(await agent.beforeModel(), undefined);
    assert.equal(checked.length, 1);
    await mkdir(path.join(directory, "node_modules/@ragents/client"), { recursive: true });
    await writeFile(path.join(directory, "node_modules/@ragents/client/index.d.ts"), "generated");
    assert.equal(await agent.beforeModel(), undefined);
    execFileSync("/bin/bash", ["-c", 'printf "fixed" > "$1"', "diagnostics-test", path.join(directory, "src/helper.ts")]);
    assert.match((await agent.beforeModel())!, /0 Fehler.*0 neu, 1 behoben/);
    assert.equal(await agent.beforeModel(), undefined);
    assert.equal(checked.length, 2);
    const restored = createProjectDiagnostics(options);
    assert.equal(await (await connect(restored, agent.entries)).beforeModel(), undefined);
    assert.equal(checked.length, 2);
    assert.match(restored.latest("run-1", "agent-1"), /counter: 0 Fehler/);
    const secondAgent = await connect(restored, [], "agent-2");
    assert.match((await secondAgent.beforeModel())!, /0 Fehler/);
    assert.equal(checked.length, 3);
    execFileSync("/bin/bash", ["-c", 'rm "$1"', "diagnostics-test", path.join(directory, "src/helper.ts")]);
    assert.match((await agent.beforeModel())!, /1 Fehler.*1 neu, 0 behoben/);
    assert.match(diagnostics.latest("run-1", "agent-1"), /ENOENT/);
    assert.equal(await agent.beforeModel(), undefined);
    await rm(directory, { recursive: true });
    assert.match((await agent.beforeModel())!, /0 Fehler in 0 Projekten/);
    assert.equal(await agent.beforeModel(), undefined);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("diagnostic delta stays small while the full last compiler result remains available", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "ragents-actor-program-diagnostic-limit-"));
  try {
    await mkdir(path.join(workspace, "programs/sample"), { recursive: true });
    const diagnostics = createProjectDiagnostics({
      workspaceFor: () => path.join(workspace, "programs"),
      check: async () => { throw new Error(Array.from({ length: 30 }, (_, i) => `src/f${i}.ts:1 TS2322: ${"problem ".repeat(70)}`).join("\n")); },
    });
    const agent = await connect(diagnostics);
    const content = (await agent.beforeModel())!;
    assert.ok(content.length < 2300);
    assert.match(content, /30 Fehler/);
    assert.match(content, /22 weitere Änderungen/);
    assert.match(diagnostics.latest("run-1", "agent-1", "sample"), /src\/f29.ts/);
    assert.equal(await agent.beforeModel(), undefined);
    const signal = AbortSignal.abort(new Error("stopped"));
    await assert.rejects(agent.beforeModel(signal), /stopped/);
  } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("project diagnostics reach only agents that hold actor program tools", async () => {
  const diagnostics = createProjectDiagnostics({ workspaceFor: () => "/unused", check: async () => undefined, applies: (_runId, agentId) => agentId === "coordinator" });
  assert.equal((await diagnostics.contribution.resolve!({ runId: "run-1", agentId: "coordinator", audience: "coordinator", workspace: "/unused" })).length, 1);
  assert.deepEqual(await diagnostics.contribution.resolve!({ runId: "run-1", agentId: "rule-review-1-comments", audience: "agent", workspace: "/unused" }), []);
});
