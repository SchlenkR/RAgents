import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolsPanel } from "../../../plugins/ragents.actor-programs/web/AppsPanel";
import { ActorProgramsContext, type ActorProgramsContextValue } from "../../../plugins/ragents.actor-programs/web/context";
import { toolKeyOf, type RunScriptTool } from "../../../plugins/ragents.actor-programs/web/api";
import type { SessionNavigation } from "../src/PluginRegistry";

const tool = (room: string): RunScriptTool => ({
  actorId: `${room}-list`, actorHandle: `${room}.list`, functionId: "append", revision: "build", moduleId: `${room}.list`, name: "append_to_list",
  description: "Appends an entry", parameters: [], card: false, sourceHash: "a".repeat(64), targets: [], installedBy: "owner",
});
const tools = [tool("review"), tool("review-2")];

const render = (selection: unknown) => {
  const value: ActorProgramsContextValue = {
    api: {} as ActorProgramsContextValue["api"], error: undefined, listing: { apps: [], tools },
    refresh: async () => {}, invoke: async () => { throw new Error("No calls in this test"); }, runId: "run-1",
  };
  const navigation = { openTab: () => {} } as unknown as SessionNavigation;
  return renderToStaticMarkup(createElement(ActorProgramsContext.Provider, { value },
    createElement(ToolsPanel, { active: false, navigation, selection, session: {} as never })));
};

test("the functions tab selects a function by package and function, so equal tool names of two rooms stay apart", () => {
  const overview = render(null);
  assert.equal(overview.match(/append_to_list/g)?.length, 2);
  const second = render(toolKeyOf(tools[1]!));
  assert.match(second, /Function of @review-2\.list/);
  assert.doesNotMatch(second, /@review\.list/);
  assert.match(render(toolKeyOf(tools[0]!)), /Function of @review\.list/);
  assert.match(render("append_to_list"), /Function no longer available/, "a bare tool name names no function any more");
});
