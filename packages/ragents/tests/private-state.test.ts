import assert from "node:assert/strict";
import test from "node:test";
import { AccessProjectionRegistry } from "../src/plugin-host.ts";
import { unrestrictedAccess } from "../src/access.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { testServices } from "./support.ts";

test("private runtime state restores from the journal but never becomes a query result, chat event or subscription input", () => {
    const services = testServices();
    const projections = new AccessProjectionRegistry();
    projections.register("acme.runtime", [{ id: "acme.session", private: true, state: () => undefined, chatEvent: () => undefined }]);
    const journal = new Journal(":memory:", services);
    const runtime = new Orchestration(journal, services, undefined, (event) => projections.eventVisible(event));
    const created = runtime.createRun({ commandId: "create" }, { title: "Private state", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const view = runtime.spawnAgent({ commandId: "spawn", actorId: created.ownerId }, created.id, { handle: "observer", displayName: "Observer", prompt: "", toolNames: [], grants: [],
        execution: { driver: { kind: "agent", config: { provider: "fixture", model: "fixture" } }, workspacePath: null, turnTimeoutMs: null } });
    const actor = view.actors.find((entry) => entry.kind === "agent")!;
    assert.throws(() => runtime.createSubscription({ commandId: "private-subscribe", actorId: created.ownerId }, view.id, { subscriberId: actor.id, eventTypes: ["plugin.state-replaced" as never] }), /control or unknown event type/);
    runtime.createSubscription({ commandId: "subscribe", actorId: created.ownerId }, view.id, { subscriberId: actor.id, eventTypes: ["model.output.completed"] });
    runtime.replacePluginState({ commandId: "keep", actorId: created.ownerId }, view.id, { pluginId: "acme.session", scope: { kind: "actor", actorId: actor.id }, state: { sessionId: "internal-session" } });
    const state = runtime.view(view.id).pluginStates[0]!;
    assert.equal(projections.state(state, unrestrictedAccess), undefined);
    assert.equal(projections.chatEvent("acme.session", { type: "state-replaced", payload: state }, unrestrictedAccess), undefined);
    assert.equal(runtime.view(view.id).inputs.length, 0);
    assert.equal(runtime.publicEvents(view.id).some((event) => event.type === "plugin.state-replaced"), false);
    assert.ok(journal.load(view.id).some((event) => event.type === "plugin.state-replaced"));
    const replay = new Orchestration(journal, services, undefined, (event) => projections.eventVisible(event));
    assert.deepEqual(replay.view(view.id).pluginStates, runtime.view(view.id).pluginStates);
});
