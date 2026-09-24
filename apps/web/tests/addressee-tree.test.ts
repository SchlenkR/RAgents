import assert from "node:assert/strict";
import test from "node:test";
import {
  ADDRESSEE_GROUP_MIN,
  addresseeMatches,
  addresseeNodeContains,
  addresseeStatus,
  addresseeStatusCounts,
  addresseeSummaries,
  addresseeTree,
  type AddresseeNode,
} from "../../../plugins/ragents.orchestration/web/run-panel/addressee-tree.ts";
import { runPanelActors } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-actors.ts";
import type { RunActor, RunActorInput, RunView } from "../src/run-view.ts";

const at = "2026-09-25T10:00:00Z";
const idle = { kind: "idle", since: at } as const;
const running = { kind: "running", turnId: "t", inputId: "i", startedAt: at } as const;
const stopped = { kind: "stopped", stoppedAt: at, reason: "fertig" } as const;
const actor = (id: string, kind: RunActor["kind"], createdBy: string | undefined, extra: Partial<RunActor> = {}): RunActor =>
  ({ id, kind, handle: id, displayName: id, grants: [], createdAt: at, ...createdBy === undefined ? {} : { createdBy }, lifecycle: kind === "human" ? undefined : idle, ...extra });
const input = (actorId: string, sequence: number, content: string, extra: Partial<RunActorInput> = {}): RunActorInput =>
  ({ id: `input-${actorId}-${sequence}`, actorId, content, artifactIds: [], sourceEventIds: [], subscriptionId: null, enqueuedBy: "owner", enqueuedAt: at, sequence, lifecycle: { kind: "claimed", turnId: "t", steered: false }, ...extra });

const reviewers = Array.from({ length: 37 }, (_, index) => actor(`reviewer-${index + 1}`, "agent", "coordinator", {
  description: `prüft Regel ${index + 1}`,
  lifecycle: index < 3 ? running : index === 36 ? stopped : idle,
}));
const view: RunView = {
  id: "run", revision: 1, title: "Review", ownerId: "owner", primaryActorId: "coordinator", createdAt: at, forkedFrom: null,
  actors: [
    actor("owner", "human", undefined),
    actor("legacy", "agent", undefined, { displayName: "Altlast aus einem alten Journal" }),
    actor("coordinator", "agent", "owner", { displayName: "Koordinator" }),
    actor("implementer", "agent", "coordinator", { displayName: "Implementierer", lifecycle: running }),
    actor("formatter", "script", "implementer", { displayName: "Formatierer", description: "formatiert geänderte Dateien" }),
    actor("formatter-helper", "agent", "formatter", { displayName: "formatter-helper" }),
    ...reviewers,
    actor("test-a", "agent", "coordinator"),
    actor("test-b", "agent", "coordinator"),
    actor("test-c", "agent", "coordinator"),
    actor("test-script", "script", "coordinator"),
  ],
  inputs: [
    input("implementer", 4, "\n\n  Baue die   Adressatenliste als Baum um.\nDetails folgen."),
    input("implementer", 2, "Frühere Nachricht aus einem Abonnement", { subscriptionId: "sub", sourceEventIds: ["e"] }),
    input("test-a", 5, `Schreibe Tests für ${"sehr ".repeat(30)}viele Fälle`),
    input("test-b", 6, "Hintergrund", { presentation: "background" }),
  ],
  turns: [], subscriptions: [], pluginStates: [],
  actions: [{ id: "q", askedBy: "test-a", owner: "ragents.ask", payload: null, title: "?", description: null, parameters: {}, input: null, status: "pending", proposedAt: at, resolvedAt: null, resolvedBy: null, result: null }],
  artifacts: [],
};

const outline = (nodes: readonly AddresseeNode[]): unknown[] => nodes.map((node) => node.kind === "actor"
  ? node.children.length > 0 ? { [node.actor.id]: outline(node.children) } : node.actor.id
  : { group: node.label, members: node.members.length });

test("the tree follows createdBy: coordinator first, children below their creator, unknown creators at the top", () => {
  const actors = runPanelActors(view, true);
  assert.deepEqual(outline(addresseeTree(view, actors)), [
    {
      coordinator: [
        { implementer: [{ formatter: ["formatter-helper"] }] },
        { group: "@reviewer-*", members: 37 },
        "test-a",
        "test-b",
        "test-c",
        "test-script",
      ],
    },
    "legacy",
  ]);
});

test("without the inspect right an agent created by a hidden TypeScript actor hangs under the nearest visible creator", () => {
  const actors = runPanelActors(view, false);
  const tree = addresseeTree(view, actors);
  const coordinator = tree[0];
  assert.ok(coordinator?.kind === "actor");
  const implementer = coordinator.children[0];
  assert.ok(implementer?.kind === "actor" && implementer.actor.id === "implementer");
  assert.deepEqual(outline(implementer.children), ["formatter-helper"]);
});

test("similar siblings group from the threshold on, per kind and creator, and keep their own children", () => {
  const tree = addresseeTree(view, runPanelActors(view, true));
  const coordinator = tree[0];
  assert.ok(coordinator?.kind === "actor");
  const group = coordinator.children.find((node) => node.kind === "group");
  assert.ok(group?.kind === "group");
  assert.equal(group.members.length, 37);
  assert.equal(group.members[0]?.actor.id, "reviewer-1");
  assert.ok(addresseeNodeContains(group, "reviewer-12"));
  assert.equal(addresseeNodeContains(group, "implementer"), false);
  assert.equal(ADDRESSEE_GROUP_MIN, 4);
  assert.deepEqual(coordinator.children.filter((node) => node.kind === "actor").map((node) => node.kind === "actor" && node.actor.id), ["implementer", "test-a", "test-b", "test-c", "test-script"], "three test agents and one script stay single");
  const mixed = addresseeTree(view, [view.actors[2]!, ...["review-comments", "review-async", "review-naming", "review-errors"].map((id) => actor(id, "agent", "coordinator"))]);
  const mixedGroup = mixed[0]?.kind === "actor" ? mixed[0].children[0] : undefined;
  assert.equal(mixedGroup?.kind === "group" && mixedGroup.label, "@review-*");
});

test("the short description comes from the spawn, else the first assignment shortened, else a differing display name", () => {
  const summary = addresseeSummaries(view);
  const byId = (id: string) => view.actors.find((entry) => entry.id === id)!;
  assert.equal(summary(byId("reviewer-5")), "prüft Regel 5");
  assert.equal(summary(byId("formatter")), "formatiert geänderte Dateien");
  assert.equal(summary(byId("implementer")), "Baue die Adressatenliste als Baum um.");
  const shortened = summary(byId("test-a"));
  assert.ok(shortened && shortened.length <= 90 && shortened.endsWith("..."), shortened);
  assert.equal(summary(byId("test-b")), undefined, "background inputs and equal display names give no description");
  assert.equal(summary(byId("coordinator")), "Koordinator");
});

test("states read as working, waiting for input, waiting or stopped and add up per group", () => {
  const byId = (id: string) => view.actors.find((entry) => entry.id === id)!;
  assert.deepEqual(["implementer", "test-a", "test-b", "reviewer-37"].map((id) => addresseeStatus(view, byId(id))), ["running", "input", "waiting", "stopped"]);
  assert.equal(addresseeStatusCounts(view, reviewers), "3 arbeiten, 33 warten, 1 gestoppt");
  assert.equal(addresseeStatusCounts(view, [byId("implementer"), byId("test-a")]), "1 arbeitet, 1 wartet auf Eingabe");
});

test("search keeps matches with their creators so each hit stays in place", () => {
  const actors = runPanelActors(view, true);
  const summary = addresseeSummaries(view);
  assert.deepEqual(addresseeMatches(view, actors, "regel 12", summary).map((entry) => entry.id), ["coordinator", "reviewer-12"]);
  assert.deepEqual(addresseeMatches(view, actors, "@formatter-helper", summary).map((entry) => entry.id), ["coordinator", "implementer", "formatter", "formatter-helper"]);
  assert.deepEqual(addresseeMatches(view, actors, "  ", summary).length, actors.length);
  assert.deepEqual(outline(addresseeTree(view, addresseeMatches(view, actors, "Regel 3", summary))), [{ coordinator: [{ group: "@reviewer-*", members: 11 }] }], "every word matches on its own: 3, 13, 23 and 30 to 37");
});
