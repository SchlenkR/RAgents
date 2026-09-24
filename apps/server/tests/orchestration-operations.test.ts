import assert from "node:assert/strict";
import test from "node:test";

import { OperationContributionRegistry, type OperationContribution } from "@ragents/engine";
import { allGrants, setupRun } from "../../../packages/ragents/tests/support.ts";
import { enqueueAndClaim } from "./runtime-fixture.ts";
import { runtimeProviderToken } from "../src/ragents/host-services.js";
import { plugin } from "../../../plugins/ragents.orchestration/server/index.ts";

const operationsOf = (runtimeProvider: () => unknown): OperationContributionRegistry => {
  const registry = new OperationContributionRegistry();
  const host = {
    operations: (...contributions: OperationContribution[]) => registry.register("ragents.orchestration", contributions),
    script: () => {},
    functions: () => {},
    prompts: () => {},
    service: (token: unknown) => {
      assert.equal(token, runtimeProviderToken);
      return runtimeProvider;
    },
  };
  plugin.create().register(host as never);
  return registry;
};

test("an app action under owner identity delivers raw text to an agent via actor_input", async () => {
  const setup = setupRun();
  const operations = operationsOf(() => setup.runtime);

  const descriptor = operations.operation("actor_input");
  assert.ok(descriptor);
  assert.equal(descriptor.operator, "direct");

  const events = await operations.invoke("actor_input", {
    runId: setup.view.id,
    invocationId: "invocation-1",
    principal: { kind: "operator", actorId: setup.view.ownerId },
    signal: new AbortController().signal,
  }, { actor: "@worker", content: "Hallo Agent, ganz roh." });

  const enqueued = (events as Array<{ type: string; payload: { actorId?: string; content?: string } }>)
    .find((event) => event.type === "actor.input.enqueued");
  assert.ok(enqueued);
  assert.equal(enqueued.payload.actorId, setup.agent.id);

  const input = setup.runtime.view(setup.view.id).inputs.find((entry) => entry.actorId === setup.agent.id);
  assert.ok(input);
  assert.equal(input.content, "Hallo Agent, ganz roh.");
  assert.equal(input.enqueuedBy, setup.view.ownerId);
});

test("the agent identity path of actor_input still carries the agent as source", async () => {
  const setup = setupRun({ grants: allGrants() });
  const operations = operationsOf(() => setup.runtime);
  const view = setup.runtime.spawnAgent({ actorId: setup.view.ownerId, commandId: "spawn-empfaenger" }, setup.view.id, {
    handle: "empfaenger",
    displayName: "Empfänger",
    prompt: "Nimm Notizen entgegen.",
    execution: setup.agent.execution,
    grants: [],
    toolNames: null,
  });
  const receiver = view.actors.find((entry) => entry.handle === "empfaenger");
  assert.ok(receiver);
  const turn = enqueueAndClaim(setup.runtime, view, setup.agent.id, "input-1", "Leite weiter.", "claim-1");

  await operations.invoke("actor_input", {
    runId: setup.view.id,
    invocationId: "invocation-2",
    principal: { kind: "agent", actorId: setup.agent.id, turnId: turn.turnId },
    signal: new AbortController().signal,
  }, { actor: "@empfaenger", content: "Bericht" });

  const input = setup.runtime.view(setup.view.id).inputs.find((entry) => entry.actorId === receiver.id);
  assert.ok(input);
  assert.equal(input.enqueuedBy, setup.agent.id);
});
