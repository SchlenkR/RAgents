import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { JsonValue } from "@ragents/engine";
import { createProjectDiagnostics } from "../../../plugins/ragents.actor-programs/server/project-diagnostics.ts";

const connect = (diagnostics: ReturnType<typeof createProjectDiagnostics>, entries: JsonValue[] = [], agentId = "agent-1") => ({
  entries,
  beforeModel: async (signal?: AbortSignal): Promise<string | undefined> => diagnostics.contribution.beforeModelCall!(
    { runId: "run-1", agentId, audience: "coordinator", workspace: "/unused" },
    { signal, modelReadsImages: false, kept: entries.at(-1), keep: (value) => { entries.push(value); } },
  ),
});

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
    const agent = connect(diagnostics);
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
    assert.equal(await connect(restored, agent.entries).beforeModel(), undefined);
    assert.equal(checked.length, 2);
    assert.match(restored.latest("run-1", "agent-1"), /counter: 0 Fehler/);
    const secondAgent = connect(restored, [], "agent-2");
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
    const agent = connect(diagnostics);
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
  const consulted: string[] = [];
  const diagnostics = createProjectDiagnostics({
    workspaceFor: (runId) => { consulted.push(runId); return "/unused"; },
    check: async () => undefined,
    applies: (_runId, agentId) => agentId === "coordinator",
  });
  await connect(diagnostics, [], "coordinator").beforeModel();
  assert.equal(await connect(diagnostics, [], "rule-review-1-comments").beforeModel(), undefined);
  assert.deepEqual(consulted, ["run-1"]);
});
