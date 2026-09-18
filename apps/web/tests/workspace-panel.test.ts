import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceTabContribution } from "../src/PluginRegistry.tsx";
import { mountedTabs } from "../src/WorkspacePanel.tsx";

const Empty = () => null;

const tab = (id: string, keepMounted?: boolean): WorkspaceTabContribution =>
  ({ id, label: id, order: 0, Icon: Empty, Panel: Empty, keepMounted });

const idsOf = (tabs: readonly WorkspaceTabContribution[]) => tabs.map((entry) => entry.id);

test("ohne keepMounted wird nur der aktive Reiter gerendert", () => {
  const tabs = [tab("a"), tab("b"), tab("c")];
  assert.deepEqual(idsOf(mountedTabs(tabs, "b", ["a", "b", "c"])), ["b"]);
});

test("besuchte Reiter mit keepMounted bleiben neben dem aktiven montiert", () => {
  const tabs = [tab("a", true), tab("b"), tab("c", true)];
  assert.deepEqual(idsOf(mountedTabs(tabs, "b", ["a", "b"])), ["a", "b"]);
});

test("ein keepMounted-Reiter wird erst nach seinem ersten Besuch montiert", () => {
  const tabs = [tab("a", true), tab("b")];
  assert.deepEqual(idsOf(mountedTabs(tabs, "b", ["b"])), ["b"]);
});

test("der aktive Reiter wird auch ohne Besuchsvermerk gerendert", () => {
  const tabs = [tab("a", true), tab("b")];
  assert.deepEqual(idsOf(mountedTabs(tabs, "a", [])), ["a"]);
});
