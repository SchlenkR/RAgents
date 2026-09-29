import assert from "node:assert/strict";
import test from "node:test";

import type { WorkspaceTabContribution } from "../src/PluginRegistry.tsx";
import { mountedTabs } from "../src/WorkspacePanel.tsx";

const Empty = () => null;

const tab = (id: string, keepMounted?: boolean): WorkspaceTabContribution =>
  ({ id, label: id, order: 0, Icon: Empty, Panel: Empty, keepMounted });

const idsOf = (tabs: readonly WorkspaceTabContribution[]) => tabs.map((entry) => entry.id);

test("without keepMounted only the active tab is rendered", () => {
  const tabs = [tab("a"), tab("b"), tab("c")];
  assert.deepEqual(idsOf(mountedTabs(tabs, "b", ["a", "b", "c"])), ["b"]);
});

test("visited tabs with keepMounted stay mounted next to the active one", () => {
  const tabs = [tab("a", true), tab("b"), tab("c", true)];
  assert.deepEqual(idsOf(mountedTabs(tabs, "b", ["a", "b"])), ["a", "b"]);
});

test("a keepMounted tab is mounted only after its first visit", () => {
  const tabs = [tab("a", true), tab("b")];
  assert.deepEqual(idsOf(mountedTabs(tabs, "b", ["b"])), ["b"]);
});

test("the active tab is rendered even without a visit record", () => {
  const tabs = [tab("a", true), tab("b")];
  assert.deepEqual(idsOf(mountedTabs(tabs, "a", [])), ["a"]);
});
