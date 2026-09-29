import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { PluginHost } from "@ragents/engine";
import { plugin } from "../../../plugins/ragents.overseer/server/index.ts";
import { overseerContracts } from "../../../plugins/ragents.overseer/contract.ts";
import { overseerOrientation } from "../../../plugins/ragents.overseer/server/orientation.ts";
import { createActorProgramToolContributors } from "../../../plugins/ragents.actor-programs/server/tool-contributor.ts";
import { createControlsToolContributor } from "../../../plugins/ragents.actor-programs/server/controls-tool.ts";
import type { ActorProgramRuntime } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import { globalChatToken, runManagementToken } from "../src/ragents/global-chat.ts";

test("global orientation reflects installed descriptors without resolving tools or exposing internal operations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-orientation-"));
  try {
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
    host.provideHost(runManagementToken, () => { throw new Error("Orientation must not start or read a run"); });
    host.register(plugin.create(host));
    const initial = overseerOrientation(host, true);
    assert.doesNotMatch(initial, /actor_program_create|actor_program_controls/);
    for (const method of host.methods.describe()) assert.ok(initial.includes(`- ${method.id}: `), method.id);
    assert.ok(initial.includes(`- ${overseerContracts.createRun.id}: `));
    assert.match(initial, /runs.read, runs.write, runs.create/);
    assert.match(initial, /not an additional tool list of this chat/);
    assert.match(initial, /actor, grants, declared script subset/);
    host.register({ manifest: { id: "ragents.actor-programs" }, register: (registration) => {
      registration.functions(...createActorProgramToolContributors({} as ActorProgramRuntime, {} as never), createControlsToolContributor());
      registration.operations({ id: "test.internal", label: "Internal", description: "INTERNAL_OPERATION_SECRET", operator: "unavailable", schema: Type.Object({}), resultSchema: Type.Null(), execute: async () => null });
      registration.clientConfig({ privateValue: "CLIENT_CONFIG_SECRET" });
    } });
    const updated = overseerOrientation(host, true);
    assert.match(updated, /actor_program_create: Create a private TypeScript package with fixed libraries/);
    assert.match(updated, /actor_view_set_visibility: Set surface visibility/);
    assert.match(updated, /actor_program_controls: Read Mini-App control contracts or the actor-program authoring guide/);
    assert.doesNotMatch(updated, /INTERNAL_OPERATION_SECRET|CLIENT_CONFIG_SECRET|test.internal|resultSchema/);
    assert.match(updated, /public help describes core/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("global system prompt includes later plugin registrations and its own quick-answer tool", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-policy-"));
  try {
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
    host.provideHost(runManagementToken, () => { throw new Error("Orientation must not start or read a run"); });
    host.register(plugin.create(host));
    const policy = host.service(globalChatToken);
    assert.deepEqual(policy.toolNames, ["read", "write", "edit", "bash", "quick_answer"]);
    assert.match(policy.prompt, /First write your normal complete answer.*Afterwards run a snippet with context\.functions\.quick_answer/s);
    assert.match(policy.prompt, /native interface contains typescript_api, typescript_eval as well as read, write, edit and bash/);
    assert.match(policy.prompt, /A multi-part setup does not require its own setup package/);
    assert.match(policy.prompt, /The task describes the desired outcome/);
    assert.doesNotMatch(policy.prompt, /setup handler must|run builder can use the direct setup tools/i);
    assert.match(policy.prompt, /repeat the current user question briefly in your own words in question/);
    assert.match(policy.prompt, /summarize the result as a short sentence in text/);
    assert.match(policy.prompt, /Both fields are required.*each be at most 240 characters/);
    assert.match(policy.prompt, /After the successful quick_answer call no further substantive chat answer is needed/);
    const contributor = host.tools.entries().find((entry) => entry.name === "ragents.overseer");
    assert.ok(contributor);
    const tools = await contributor.tools({} as never);
    assert.deepEqual(tools.map((tool) => tool.name), ["quick_answer"]);
    assert.equal(Value.Check(tools[0].schema, { question: "Is the review complete?", text: "The review is complete." }), true);
    assert.equal(Value.Check(tools[0].schema, { text: "The review is complete." }), false);
    assert.doesNotMatch(policy.prompt, /late_public_tool/);
    host.register({ manifest: { id: "test.later" }, register: (registration) => {
      registration.functions({ name: "test.later.tools", descriptors: [{ name: "late_public_tool", description: "A later registered capability. " + "Detailed contract text. ".repeat(100), scope: "per-agent", availability: "conditional", availabilityDetail: "Only in applicable runs" }], tools: () => { throw new Error("Must not execute a tool factory"); } });
    } });
    const prompt = policy.prompt;
    assert.match(prompt, /late_public_tool: A later registered capability\. \[context-dependent\]/);
    assert.doesNotMatch(prompt, /Detailed contract text/);
    assert.match(prompt, new RegExp(`- ${overseerContracts.createRun.id}: `));
    assert.match(prompt, /POST \$RAGENTS_API_BASE_URL\/rpc/);
    assert.match(prompt, /rpc-reference.md/);
    assert.deepEqual(policy.access, { read: "ragents.overseer.read", write: "ragents.overseer.write" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
