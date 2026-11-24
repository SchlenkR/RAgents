import assert from "node:assert/strict";
import test from "node:test";
import { AgentLoopDriver, type TurnRequest } from "@ragents/engine";
import { noUsage } from "../../../packages/ragents/tests/support.ts";
import { coordinatorRunId } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import { startProductProfile } from "./fixtures/profile-agent-context.ts";

test("profile tools limit the coordinator, its workers and the global coordinator, including their prompt guidance", async (t) => {
  const toolNames = ["agent_spawn", "ask_user", "read"];
  const excluded = ["bash", "copy", "request_access", "task_output", "task_stop", "typescript_api", "typescript_eval"];
  const { provider, engine } = await startProductProfile(t, toolNames);
  const registered = provider.plugins.tools.describe().map((tool) => tool.name);
  for (const name of excluded) assert.ok(registered.includes(name), `${name} is supplied by an installed plugin or the host`);
  const requests: TurnRequest<"agent">[] = [];
  t.mock.method(AgentLoopDriver.prototype, "runTurn", async (request: TurnRequest<"agent">) => {
    requests.push(request);
    if (request.input.content === "Start a worker.") {
      await assert.rejects(request.invoke("excluded-tool", "typescript_eval", { code: "return 1;" }), /is not available/);
      await request.invoke("spawn", "agent_spawn", {
        name: "reader", description: "Reads a note", profile: "standard",
        tools: ["read", "bash", "typescript_eval"], prompt: "Read a note.",
      });
    }
    const refreshed = await request.refreshTools!();
    assert.deepEqual(refreshed.tools.map((tool) => tool.name), request.tools.map((tool) => tool.name));
    assert.equal(refreshed.systemPrompt, request.systemPrompt);
    return { failure: null, usage: noUsage() };
  });

  await (await provider.get("profile-tools")).send("Start a worker.");
  await engine.scheduler.waitForIdle();
  const global = coordinatorRunId(null);
  await (await provider.get(global)).send("Inspect the run.");
  await engine.scheduler.waitForIdle();

  assert.deepEqual(engine.runtime.view("profile-tools").turns.map((turn) => turn.status), ["completed", "completed"]);
  assert.deepEqual(engine.runtime.view(global).turns.map((turn) => turn.status), ["completed"]);
  assert.deepEqual(requests.map((request) => request.tools.map((tool) => tool.name).sort()), [toolNames, ["read"], ["read"]]);
  for (const request of requests) {
    assert.doesNotMatch(request.systemPrompt,
      /Remote git operations|Shell enabled|Shell platform|run_in_background|Everything you write in the model text|ActorInput|TypeScript functions of this actor/);
    for (const name of excluded) assert.doesNotMatch(request.systemPrompt, new RegExp(`\\b${name}\\b`));
  }
  const coordinator = requests[0]!;
  assert.match(coordinator.systemPrompt, /^Product instructions\./);
  assert.match(coordinator.systemPrompt, /# Asking the user/);
  assert.match(coordinator.systemPrompt, /# Working environment/);
  assert.equal(coordinator.systemPrompt.match(/Isolated access on the server:/g)?.length, 1);
});
