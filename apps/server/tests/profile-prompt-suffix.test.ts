import assert from "node:assert/strict";
import test from "node:test";
import { AgentLoopDriver, type TurnRequest } from "@ragents/engine";
import { noUsage } from "../../../packages/ragents/tests/support.ts";
import { coordinatorRunId } from "../../../plugins/ragents.overseer/server/coordinator.ts";
import { startProductProfile } from "./fixtures/profile-agent-context.ts";

test("a profile template replaces the general prompt suffix and can render it empty", async (t) => {
  const toolNames = ["ask_user", "bash", "event_query", "read", "typescript_api", "typescript_eval"];
  const { provider, engine } = await startProductProfile(t, toolNames,
    '{{#if (available "ask_user")}}Product closing instruction.{{/if}}');
  const requests: TurnRequest<"agent">[] = [];
  t.mock.method(AgentLoopDriver.prototype, "runTurn", async (request: TurnRequest<"agent">) => {
    requests.push(request);
    assert.equal((await request.refreshTools!()).systemPrompt, request.systemPrompt);
    return { failure: null, usage: noUsage() };
  });

  await (await provider.get("profile-suffix")).send("Follow the product instructions.");
  await engine.scheduler.waitForIdle();
  const global = coordinatorRunId(null);
  await (await provider.get(global)).send("Inspect the run.");
  await engine.scheduler.waitForIdle();

  assert.deepEqual(engine.runtime.view("profile-suffix").turns.map((turn) => turn.status), ["completed"]);
  assert.deepEqual(engine.runtime.view(global).turns.map((turn) => turn.status), ["completed"]);
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.ok(request.functionNames.includes("bash") && request.functionNames.includes("typescript_eval"));
    assert.doesNotMatch(request.systemPrompt, /# Working environment|## Run access|## Shell platform|# Working directory|General rules:|Everything you write in the model text|TypeScript functions of this actor/);
  }
  const coordinator = requests[0]!;
  assert.ok(coordinator.functionNames.includes("event_query"));
  assert.match(coordinator.systemPrompt, /^Product instructions\. Shell enabled\./);
  assert.match(coordinator.systemPrompt, /# Asking the user/);
  assert.match(coordinator.systemPrompt, /Product closing instruction\.$/);
  assert.doesNotMatch(requests[1]!.systemPrompt, /Product closing instruction/);
  assert.doesNotMatch(engine.systemPromptFor(global), /Product closing instruction/);
});
