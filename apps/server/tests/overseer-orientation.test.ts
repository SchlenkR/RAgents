import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { PluginHost } from "@ragents/engine";
import { plugin } from "../../../plugins/ragents.overseer/server/index.ts";
import { overseerContracts } from "../../../plugins/ragents.overseer/contract.ts";
import { overseerOrientation, runFunctionCatalog } from "../../../plugins/ragents.overseer/server/orientation.ts";
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
    assert.match(initial, /run-functions.md in your working directory lists the functions .* they are not your tools/);
    assert.match(runFunctionCatalog(host), /not a list of the global coordinator's tools.*actor, grants, declared script subset/);
    host.register({ manifest: { id: "ragents.actor-programs" }, register: (registration) => {
      registration.functions(...createActorProgramToolContributors({} as ActorProgramRuntime, {} as never), createControlsToolContributor());
      registration.operations({ id: "test.internal", label: "Internal", description: "INTERNAL_OPERATION_SECRET", operator: "unavailable", schema: Type.Object({}), resultSchema: Type.Null(), execute: async () => null });
      registration.clientConfig({ privateValue: "CLIENT_CONFIG_SECRET" });
    } });
    const updated = overseerOrientation(host, true);
    assert.doesNotMatch(updated, /actor_program_|actor_view_/, "the prompt names no function of regular runs");
    const catalog = runFunctionCatalog(host);
    assert.match(catalog, /actor_program_create: Create a private TypeScript package with fixed libraries/);
    assert.match(catalog, /actor_view_set_visibility: Set surface visibility/);
    assert.match(catalog, /actor_program_controls: Read Mini-App control contracts or the actor-program authoring guide/);
    for (const text of [updated, catalog]) assert.doesNotMatch(text, /INTERNAL_OPERATION_SECRET|CLIENT_CONFIG_SECRET|test.internal|resultSchema/);
    assert.match(updated, /public help describes core/);
    const tools = host.service(globalChatToken).toolNames;
    assert.ok(tools.includes("actor_program_create"));
    assert.ok(tools.includes("actor_program_diagnostics"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the global system prompt names no function of regular runs, and their catalog includes later plugin registrations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-policy-"));
  try {
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
    host.provideHost(runManagementToken, () => { throw new Error("Orientation must not start or read a run"); });
    host.register(plugin.create(host));
    const policy = host.service(globalChatToken);
    assert.deepEqual(policy.toolNames, ["read", "write", "edit", "bash", "overseer_notify"]);
    assert.match(policy.prompt, /Your tools include read, write, edit and bash\. Call your tools directly/);
    assert.match(policy.prompt, /A multi-part setup does not require its own setup package/);
    assert.match(policy.prompt, /The task describes the desired outcome/);
    assert.doesNotMatch(policy.prompt, /setup handler must|run builder can use the direct setup tools/i);
    assert.doesNotMatch(policy.prompt, /late_public_tool/);
    host.register({ manifest: { id: "test.later" }, register: (registration) => {
      registration.functions({ name: "test.later.tools", descriptors: [
        { name: "late_public_tool", description: "A later registered capability. " + "Detailed contract text. ".repeat(100), scope: "per-agent", availability: "conditional", availabilityDetail: "Only in applicable runs" },
        ...["global_app_create", "global_app_list", "global_app_remove", "actor_program_controls", "actor_program_trigger", "actor_program_pause", "actor_program_status", "actor_program_activate", "typescript_api", "lsp_typescript_hover"].map((name) => ({ name, description: "Author a global app.", scope: "per-agent" as const, availability: "conditional" as const, availabilityDetail: "With the actor's grants" })),
      ], tools: () => { throw new Error("Must not execute a tool factory"); } });
    } });
    const prompt = policy.prompt;
    assert.doesNotMatch(prompt, /late_public_tool/);
    assert.match(runFunctionCatalog(host), /late_public_tool: A later registered capability\. \[context-dependent\]/);
    assert.doesNotMatch(runFunctionCatalog(host), /Detailed contract text/);
    assert.match(prompt, new RegExp(`- ${overseerContracts.createRun.id}: `));
    assert.match(prompt, /POST \$RAGENTS_API_BASE_URL\/rpc/);
    assert.match(prompt, /rpc-reference.md/);
    assert.deepEqual(policy.access, { read: "ragents.overseer.read", write: "ragents.overseer.write" });
    for (const name of ["read", "write", "edit", "global_app_create", "global_app_list", "global_app_remove", "actor_program_controls", "actor_program_trigger", "actor_program_pause", "actor_program_status", "typescript_api", "lsp_typescript_hover"]) assert.ok(policy.toolNames.includes(name), name);
    assert.equal(policy.toolNames.includes("late_public_tool"), false);
    assert.equal(policy.toolNames.includes("actor_program_activate"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
