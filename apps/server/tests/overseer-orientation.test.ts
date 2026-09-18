import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { PluginHost } from "@aicontainer/ragents";
import { plugin } from "../../../plugins/ragents.overseer/server/index.ts";
import { overseerOrientation } from "../../../plugins/ragents.overseer/server/orientation.ts";
import { MANAGEMENT_API_PREFIX, managementRouteContracts } from "../../../plugins/ragents.overseer/server/http-api.ts";
import { createActorProgramToolContributors } from "../../../plugins/ragents.actor-programs/server/tool-contributor.ts";
import { createControlsToolContributor } from "../../../plugins/ragents.actor-programs/server/controls-tool.ts";
import type { ActorProgramRuntime } from "../../../plugins/ragents.actor-programs/server/runtime.ts";
import { globalChatToken, sessionManagementToken } from "../src/ragents/global-chat.ts";

test("global orientation reflects installed descriptors without resolving tools or exposing internal operations", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-orientation-"));
  try {
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
    const initial = overseerOrientation(host);
    assert.doesNotMatch(initial, /actor_program_create|actor_program_controls/);
    for (const route of managementRouteContracts) assert.ok(initial.includes(`${route.method} ${MANAGEMENT_API_PREFIX}${route.path}`), route.id);
    assert.match(initial, /runs.read, runs.write/);
    assert.match(initial, /keine zusätzliche Werkzeugliste dieses Chats/);
    assert.match(initial, /Actor, Grants, deklarierter Script-Teilmenge/);
    host.register({ manifest: { id: "ragents.actor-programs" }, register: (registration) => {
      registration.functions(...createActorProgramToolContributors({} as ActorProgramRuntime, {} as never), createControlsToolContributor());
      registration.operations({ id: "test.internal", label: "Internal", description: "INTERNAL_OPERATION_SECRET", operator: "unavailable", schema: Type.Object({}), resultSchema: Type.Null(), execute: async () => null });
      registration.clientConfig({ privateValue: "CLIENT_CONFIG_SECRET" });
    } });
    const updated = overseerOrientation(host);
    assert.match(updated, /actor_program_create: Create a private TypeScript package with fixed libraries/);
    assert.match(updated, /actor_view_set_visibility: Set Canvas visibility/);
    assert.match(updated, /actor_program_controls: Read Mini-App control contracts or the actor-program authoring guide/);
    assert.doesNotMatch(updated, /INTERNAL_OPERATION_SECRET|CLIENT_CONFIG_SECRET|test.internal|resultSchema/);
    assert.match(updated, /öffentliche Hilfe beschreibt core/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("global system prompt includes later plugin registrations and its own quick-answer tool", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-overseer-policy-"));
  try {
    const host = new PluginHost({ product: { id: "test", title: "Test" }, dataDirectory: directory });
    host.provideHost(sessionManagementToken, () => { throw new Error("Orientation must not start or read a run"); });
    host.register(plugin.create(host));
    const policy = host.service(globalChatToken);
    assert.deepEqual(policy.toolNames, ["read", "write", "edit", "bash", "quick_answer"]);
    assert.match(policy.prompt, /zuerst deine normale vollständige Antwort.*danach ein Snippet mit context\.functions\.quick_answer/s);
    assert.match(policy.prompt, /native Oberfläche besteht aus typescript_api und typescript_eval/);
    assert.match(policy.prompt, /Ein mehrteiliger Aufbau verlangt kein eigenes Setup-Paket/);
    assert.match(policy.prompt, /Der Auftrag beschreibt das gewünschte Ergebnis/);
    assert.doesNotMatch(policy.prompt, /Setup-Handler muss|Run-Builder kann die direkten Aufbauwerkzeuge/);
    assert.match(policy.prompt, /in question die aktuelle Nutzerfrage kurz in eigenen Worten/);
    assert.match(policy.prompt, /in text das Ergebnis als kurzen Satz/);
    assert.match(policy.prompt, /Beide Felder sind Pflicht.*jeweils höchstens 240 Zeichen/);
    assert.match(policy.prompt, /Nach dem erfolgreichen quick_answer-Aufruf ist keine weitere inhaltliche Chatantwort nötig/);
    const contributor = host.tools.entries().find((entry) => entry.name === "ragents.overseer");
    assert.ok(contributor);
    const tools = await contributor.tools({} as never);
    assert.deepEqual(tools.map((tool) => tool.name), ["quick_answer"]);
    assert.equal(Value.Check(tools[0].schema, { question: "Ist die Prüfung abgeschlossen?", text: "Die Prüfung ist abgeschlossen." }), true);
    assert.equal(Value.Check(tools[0].schema, { text: "Die Prüfung ist abgeschlossen." }), false);
    assert.doesNotMatch(policy.prompt, /late_public_tool/);
    host.register({ manifest: { id: "test.later" }, register: (registration) => {
      registration.functions({ name: "test.later.tools", descriptors: [{ name: "late_public_tool", description: "A later registered capability. " + "Detailed contract text. ".repeat(100), scope: "per-agent", availability: "conditional", availabilityDetail: "Only in applicable runs" }], tools: () => { throw new Error("Must not execute a tool factory"); } });
    } });
    const prompt = policy.prompt;
    assert.match(prompt, /late_public_tool: A later registered capability\. \[kontextabhängig\]/);
    assert.doesNotMatch(prompt, /Detailed contract text/);
    assert.match(prompt, /POST \/api\/plugins\/ragents.overseer\/runs/);
    assert.match(prompt, /reference.md/);
    assert.deepEqual(policy.access, { read: "ragents.overseer.read", write: "ragents.overseer.write" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
