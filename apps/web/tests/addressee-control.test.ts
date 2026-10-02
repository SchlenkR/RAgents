import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AddresseeControl } from "../../../plugins/ragents.orchestration/web/run-panel/AddresseeControl.tsx";
import { runPanelActors } from "../../../plugins/ragents.orchestration/web/run-panel/run-panel-actors.ts";
import type { RunActor, RunView } from "../src/run-view.ts";

const at = "2026-10-02T10:00:00.000Z";
const actor = (id: string, createdBy: string): RunActor =>
  ({ id, kind: "agent", handle: id, displayName: id, grants: [], createdAt: at, createdBy, lifecycle: { kind: "idle", since: at } });
const view: RunView = {
  id: "run", revision: 1, title: "Run", ownerId: "owner", primaryActorId: "coordinator", createdAt: at, forkedFrom: null,
  actors: [{ id: "owner", kind: "human", handle: "owner", displayName: "Owner", grants: [], createdAt: at }, actor("coordinator", "owner"), actor("reviewer", "coordinator")],
  inputs: [], turns: [], subscriptions: [], pluginStates: [], actions: [], artifacts: [],
};
const actors = runPanelActors(view, true);
const chip = (selected: string) => {
  const addressee = actors.find((entry) => entry.id === selected);
  assert.ok(addressee, selected);
  return renderToStaticMarkup(createElement(AddresseeControl, { actors, onSelect: () => {}, selected: addressee, technical: true, view }));
};

test("the addressee chip offers the way back to the primary actor only while another actor is addressed", () => {
  const primary = chip("coordinator");
  assert.match(primary, /title="Addressee: @coordinator\./);
  assert.doesNotMatch(primary, /Back to/);
  const other = chip("reviewer");
  assert.match(other, /title="Addressee: @reviewer\./);
  assert.match(other, /<button[^>]*aria-label="Back to @coordinator"[^>]*title="Back to @coordinator"/);
  assert.equal((other.match(/<button/g) ?? []).length, 2, "the x is a button of its own beside the chip, not inside it");
});
