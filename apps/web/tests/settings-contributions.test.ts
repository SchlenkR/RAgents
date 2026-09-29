import assert from "node:assert/strict";
import test from "node:test";

import { PluginRegistry, type StartEntry, type WebPlugin } from "../src/PluginRegistry.tsx";
import type { SettingsResponse, SettingsSkill, SettingsTool } from "../src/api.ts";
import {
  capabilityGroups,
  countContributions,
  filterGroup,
  groupContributions,
  functionSurfaceLabel,
  settingsForCategory,
  type ContributionSource,
  type PluginGroup,
} from "../src/settings-contributions.ts";

const Empty = () => null;

const registryWith = (plugins: WebPlugin[]) => new PluginRegistry({
  brand: { title: "Test" },
  product: { id: "test", title: "Test" },
  startEntries: [],
  plugins,
});

test("settings sections belong to their plugin and follow an optional order and id", () => {
  const registry = registryWith([
    { id: "test.first", settings: [
      { id: "later", label: "Later", order: 10, Settings: Empty },
      { id: "second", label: "Second", Settings: Empty },
    ] },
    { id: "test.second", settings: [{ id: "first", label: "First", order: 0, Settings: Empty }] },
  ]);
  assert.deepEqual(registry.settings.map(({ id, owner }) => ({ id, owner })), [
    { id: "first", owner: "test.second" },
    { id: "second", owner: "test.first" },
    { id: "later", owner: "test.first" },
  ]);
});

test("removing or disabling a plugin removes its editable settings", () => {
  const retained: WebPlugin = {
    id: "test.retained", settings: [{ id: "shared", label: "Stays", Settings: Empty }],
  };
  const removed: WebPlugin = {
    id: "test.removed", settings: [{ id: "removed", label: "Removed", Settings: Empty }],
  };
  const disabled: WebPlugin = {
    id: "test.disabled", enabled: () => false,
    settings: [{ id: "shared", label: "Inactive", Settings: Empty }],
  };
  assert.equal(registryWith([retained, removed, disabled]).settings.length, 2);
  assert.deepEqual(registryWith([retained, disabled]).settings.map((entry) => entry.owner), ["test.retained"]);
  assert.deepEqual(registryWith([disabled]).settings, []);
  assert.deepEqual(registryWith([]).settings, []);
});

test("models and appearance select real editable contributions while keeping their owners and order", () => {
  const registry = registryWith([
    { id: "test.product", settings: [
      { id: "product.models", label: "New runs and agents", category: "models", order: 20, Settings: Empty },
      { id: "product.technical", label: "Technical options", Settings: Empty },
    ] },
    { id: "test.coordinator", settings: [{ id: "global.model", label: "Global coordinator", category: "models", order: 10, Settings: Empty }] },
    { id: "test.surface", settings: [{ id: "surface.runPanel", label: "Run panel", category: "appearance", Settings: Empty }] },
  ]);
  const models = settingsForCategory(registry.settings, "models", () => true);
  assert.deepEqual(models.map(({id, owner}) => ({id, owner})), [
    { id: "global.model", owner: "test.coordinator" },
    { id: "product.models", owner: "test.product" },
  ]);
  assert.equal(models[0], registry.settings.find((entry) => entry.id === "global.model"));
  assert.deepEqual(settingsForCategory(registry.settings, "appearance", () => true).map((entry) => entry.id), ["surface.runPanel"]);
  assert.equal(registry.settings.some((entry) => entry.id === "product.technical"), true);
});

test("settings categories hide contributions without read access and retain read-only contributions", () => {
  const registry = registryWith([{ id: "test.models", settings: [
    { id: "restricted", label: "Global coordinator", category: "models", readRight: "global.read", Settings: Empty },
    { id: "public", label: "New runs and agents", category: "models", Settings: Empty },
  ] }]);
  assert.deepEqual(settingsForCategory(registry.settings, "models", () => false).map((entry) => entry.id), ["public"]);
  assert.deepEqual(settingsForCategory(registry.settings, "models", (right) => right === "global.read").map((entry) => entry.id), ["public", "restricted"]);
});

test("duplicate or empty settings ids are rejected", () => {
  const settings = [{ id: "duplicate", label: "Example", Settings: Empty }];
  assert.throws(() => registryWith([
    { id: "test.first", settings }, { id: "test.second", settings },
  ]), /Settings contribution registered twice: duplicate/);
  assert.throws(() => registryWith([
    { id: "test.empty", settings: [{ id: "", label: "Empty", Settings: Empty }] },
  ]), /Settings contribution without ID/);
});

test("activated settings renderers are created from the public plugin configuration", () => {
  const Configured = () => null;
  const registry = new PluginRegistry({
    brand: { title: "Test" }, product: { id: "test", title: "Test" }, startEntries: [],
    plugins: [{ id: "test.configured", activate: (config) => ({
      id: "test.configured",
      settings: [{ id: "configured", label: String(config.label), Settings: Configured }],
    }) }],
  }, new Map([["test.configured", { label: "Configured" }]]));
  assert.equal(registry.settings[0]?.label, "Configured");
  assert.equal(registry.settings[0]?.Settings, Configured);
  assert.equal(registry.settings[0]?.owner, "test.configured");
});

const tool = (id: string, owner: string, name: string, description: string): SettingsTool => ({
  id,
  name,
  description,
  owner,
  source: "test",
  kind: "plugin",
  scope: "global",
  availability: "always",
  availabilityDetail: "always",
});

const skill = (id: string, owner: string): SettingsSkill => ({
  id,
  owner,
  audiences: ["coordinator"],
  paths: [`/skills/${id}`],
});

const card = (id: string, owner: string, title: string): StartEntry => ({
  id,
  owner,
  action: "skill",
  skill: `${owner}-skill`,
  category: "Examples",
  title,
  description: `Description of ${title}`,
  prompt: "free",
});

const starter = (id: string, owner: string, title: string): StartEntry => ({
  id,
  owner,
  action: "skill",
  title,
  description: `Workflow ${title}`,
  skill: `${owner}-skill`,
  category: "Development",
  prompt: "Implement feature",
});

const settingsWith = (overrides: Partial<SettingsResponse>): SettingsResponse => ({
  version: 2,
  product: { id: "test", title: "Test" },
  runtime: {
    profile: "test",
    configFile: null,
    workspaceMode: "per-run",
    host: { mode: "native", platform: "darwin", workingDirectory: "/tmp" },
    dataDirectory: "/tmp/.data",
    workspace: { directoryPattern: "/tmp/runs" },
    documents: null,
  },
  models: [],
  profiles: [],
  systemPrompt: {
    scope: "product",
    content: "",
    finalPromptIsRunSpecific: true,
    composition: "",
    runtimeContracts: [],
  },
  promptContributions: [],
  plugins: [],
  agentHooks: [],
  skills: [],
  tools: [],
  ...overrides,
});

const sourceWith = (overrides: Partial<ContributionSource>): ContributionSource => ({
  plugins: [],
  activePlugins: [],
  startEntries: [],
  ...overrides,
});

const groupOf = (groups: readonly PluginGroup[], id: string): PluginGroup => {
  const found = groups.find((group) => group.id === id);
  assert.ok(found, `Group ${id} is missing`);
  return found;
};

test("contributions end up with their owner and the plugin order is kept", () => {
  const settings = settingsWith({
    plugins: [
      { id: "ragents.core", requires: [], configuration: [] },
      { id: "test.tasks", requires: ["ragents.core"], configuration: [{ key: "PAT", source: "env", secret: true }] },
    ],
    tools: [tool("t1", "test.tasks", "Search", "searches"), tool("t2", "ragents.core", "Note", "takes notes")],
    skills: [skill("s1", "test.tasks")],
    promptContributions: [{ id: "p1", owner: "ragents.core", order: 10, content: "Content" }],
    agentHooks: [
      { id: "e1", owner: "test.tasks", kind: "plugin", factories: [], resolvesPerAgent: false },
      { id: "e2", owner: "agent", kind: "internal", factories: [], resolvesPerAgent: true },
    ],
  });
  const source = sourceWith({
    startEntries: [card("c1", "test.tasks", "Card"), starter("st1", "ragents.core", "Start")],
  });
  const groups = groupContributions(settings, source);
  assert.deepEqual(groups.map((group) => group.id), ["ragents.core", "test.tasks"]);
  const core = groupOf(groups, "ragents.core");
  const tasks = groupOf(groups, "test.tasks");
  assert.deepEqual(core.tools.map((entry) => entry.id), ["t2"]);
  assert.deepEqual(core.prompts.map((entry) => entry.id), ["p1"]);
  assert.deepEqual(core.startEntries.map((entry) => entry.id), ["st1"]);
  assert.deepEqual(tasks.tools.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(tasks.skills.map((entry) => entry.id), ["s1"]);
  assert.deepEqual(tasks.startEntries.map((entry) => entry.id), ["c1"]);
  assert.deepEqual(tasks.hooks.map((entry) => entry.id), ["e1"]);
  assert.deepEqual(tasks.requires, ["ragents.core"]);
  assert.equal(tasks.configuration.length, 1);
});

test("web settings and overview contributions can be found with their owner", () => {
  const registry = registryWith([{
    id: "test.settings",
    overviewPanels: [{ id: "test.panel", order: 1, Panel: Empty }],
    settings: [{ id: "test.model", label: "Model selection", Settings: Empty }],
  }]);
  const group = groupOf(groupContributions(settingsWith({}), registry), "test.settings");
  assert.equal(group.webActive, true);
  assert.equal(group.serverRegistered, false);
  assert.deepEqual(group.web, { state: "contributions", contributions: [
    { kind: "Overview contributions", details: ["test.panel"], count: 1 },
    { kind: "Settings", details: ["test.model (Model selection)"], count: 1 },
  ] });
  assert.equal(countContributions(filterGroup(group, "web", "model selection")), 1);
  assert.equal(countContributions(filterGroup(group, "web", "test.panel")), 1);
  assert.deepEqual(groupContributions(settingsWith({}), registryWith([])), []);
});

test("internal hooks belong to no plugin group", () => {
  const settings = settingsWith({
    plugins: [{ id: "ragents.core", requires: [], configuration: [] }],
    agentHooks: [{ id: "e2", owner: "agent", kind: "internal", factories: [], resolvesPerAgent: true }],
  });
  const groups = groupContributions(settings, sourceWith({}));
  assert.deepEqual(groups.map((group) => group.id), ["ragents.core"]);
  assert.deepEqual(groupOf(groups, "ragents.core").hooks, []);
});

test("unknown owners get a group of their own at the end", () => {
  const settings = settingsWith({ plugins: [{ id: "ragents.core", requires: [], configuration: [] }] });
  const source = sourceWith({ startEntries: [card("external", "filesystem", "External card")] });
  const groups = groupContributions(settings, source);
  assert.deepEqual(groups.map((group) => group.id), ["ragents.core", "filesystem"]);
  const external = groupOf(groups, "filesystem");
  assert.equal(external.serverRegistered, false);
  assert.equal(external.webActive, false);
  assert.deepEqual(external.requires, []);
  assert.deepEqual(external.web, { state: "none" });
  assert.deepEqual(external.startEntries.map((entry) => entry.id), ["external"]);
});

test("the web module distinguishes missing, without contributions and contributing", () => {
  const settings = settingsWith({
    plugins: [
      { id: "server.only", requires: [], configuration: [] },
      { id: "web.silent", requires: [], configuration: [] },
      { id: "web.loud", requires: [], configuration: [] },
    ],
  });
  const registry = new PluginRegistry({
    plugins: [
      { id: "web.silent" },
      {
        id: "web.loud",
        brand: { title: "Test" },
        workspaceTabs: [{ id: "board", label: "Board", order: 1, Icon: Empty, Panel: Empty }],
        cardSections: [{ id: "sec", order: 1, Section: Empty }],
      },
    ],
    product: { id: "test", title: "Test" },
    startEntries: [],
  });
  const groups = groupContributions(settings, registry);
  assert.deepEqual(groupOf(groups, "server.only").web, { state: "none" });
  assert.deepEqual(groupOf(groups, "web.silent").web, { state: "withoutContributions" });
  const loud = groupOf(groups, "web.loud");
  assert.equal(loud.webActive, true);
  assert.equal(loud.web.state, "contributions");
  if (loud.web.state !== "contributions") return;
  assert.deepEqual(loud.web.contributions.map((entry) => entry.kind), [
    "Sidebar tabs",
    "Branding",
    "Card sections",
  ]);
  assert.deepEqual(loud.web.contributions[0].details, ["board (Board)"]);
});

test("the filter leaves only one kind of contribution", () => {
  const settings = settingsWith({
    plugins: [{ id: "test.tasks", requires: [], configuration: [{ key: "PAT", source: "env", secret: true }] }],
    tools: [tool("t1", "test.tasks", "Search", "searches")],
    skills: [skill("s1", "test.tasks")],
  });
  const source = sourceWith({ startEntries: [card("c1", "test.tasks", "Card")] });
  const group = groupOf(groupContributions(settings, source), "test.tasks");
  assert.equal(countContributions(group), 4);
  const onlyTools = filterGroup(group, "tools", "");
  assert.deepEqual(onlyTools.tools.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(onlyTools.skills, []);
  assert.deepEqual(onlyTools.startEntries, []);
  assert.deepEqual(onlyTools.configuration, []);
  assert.deepEqual(onlyTools.web, { state: "hidden" });
  assert.equal(countContributions(onlyTools), 1);
  assert.equal(countContributions(filterGroup(group, "configuration", "")), 1);
  assert.equal(countContributions(filterGroup(group, "web", "")), 0);
});

test("the search covers all kinds of contributions of the group", () => {
  const settings = settingsWith({
    plugins: [{ id: "test.tasks", requires: [], configuration: [] }],
    tools: [tool("t1", "test.tasks", "Search", "finds ticket entries"), tool("t2", "test.tasks", "Note", "writes")],
  });
  const source = sourceWith({ startEntries: [card("c1", "test.tasks", "Create ticket")] });
  const group = groupOf(groupContributions(settings, source), "test.tasks");
  const found = filterGroup(group, "all", "ticket");
  assert.deepEqual(found.tools.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(found.startEntries.map((entry) => entry.id), ["c1"]);
  assert.equal(countContributions(found), 2);
  const category = filterGroup(group, "startEntries", "examples");
  assert.deepEqual(category.startEntries.map((entry) => entry.id), ["c1"]);
  assert.equal(countContributions(category), 1);
  assert.equal(countContributions(filterGroup(group, "all", "none of it")), 0);
});

test("the function catalog distinguishes TypeScript functions and explicit native tools in labels and search", () => {
  const functions = [
    tool("function", "test.functions", "sum", "Add numbers"),
    { ...tool("native", "test.functions", "typescript_eval", "Evaluate code"), nativeTool: true },
  ];
  const groups = groupContributions(settingsWith({ tools: functions }), sourceWith({}));
  assert.equal(functionSurfaceLabel(undefined), "TypeScript function");
  assert.equal(functionSurfaceLabel(false), "TypeScript function");
  assert.equal(functionSurfaceLabel(true), "LLM tool");
  assert.deepEqual(capabilityGroups(groups, "tools", "TypeScript function")[0]?.tools.map((entry) => entry.id), ["function"]);
  assert.deepEqual(capabilityGroups(groups, "tools", "LLM tool")[0]?.tools.map((entry) => entry.id), ["native"]);
  assert.deepEqual(capabilityGroups(groups, "tools", "Tool index"), []);
});

test("without search text the count stays the sum of all contributions", () => {
  const settings = settingsWith({
    plugins: [{ id: "test.tasks", requires: [], configuration: [{ key: "PAT", source: "env", secret: false }] }],
    tools: [tool("t1", "test.tasks", "Search", "searches")],
    promptContributions: [{ id: "p1", owner: "test.tasks", order: 1, content: "Content" }],
    skills: [skill("s1", "test.tasks")],
    agentHooks: [{ id: "e1", owner: "test.tasks", kind: "plugin", factories: [], resolvesPerAgent: false }],
  });
  const registry = new PluginRegistry({
    brand: { title: "Test" },
    plugins: [{ id: "test.tasks", guides: [{ id: "guide", Guide: Empty }] }],
    product: { id: "test", title: "Test" },
    startEntries: [card("c1", "test.tasks", "Card"), { ...starter("st1", "test.tasks", "Start"), guide: "guide" }],
  });
  const group = groupOf(groupContributions(settings, registry), "test.tasks");
  assert.equal(countContributions(group), 8);
  assert.equal(countContributions(filterGroup(group, "all", "")), 8);
});

test("editable settings stay with their owner and keep their object identity", () => {
  const first = Object.freeze({ id: "first.setting", owner: "test.first", label: "Model", Settings: Empty });
  const second = Object.freeze({ id: "second.setting", owner: "test.second", label: "Appearance", Settings: Empty });
  const contributions = Object.freeze([second, first]);
  const groups = groupContributions(settingsWith({}), sourceWith({
    activePlugins: [{ id: "test.first" }, { id: "test.second" }],
    settings: contributions,
  }));
  assert.deepEqual(groups.map((group) => group.id), ["test.first", "test.second"]);
  assert.equal(groupOf(groups, "test.first").settings[0], first);
  assert.equal(groupOf(groups, "test.second").settings[0], second);
  assert.equal(capabilityGroups(groups, "configuration", "Model")[0]?.settings[0], first);
  assert.deepEqual(contributions, [second, first]);
  assert.equal(groupOf(groups, "test.second").settings[0], second);
});

test("configuration counts and searches editable settings next to static values", () => {
  const registry = registryWith([{
    id: "test.owner",
    settings: [{ id: "display.options", label: "Choose view", Settings: Empty }],
  }]);
  const groups = groupContributions(settingsWith({ plugins: [{
    id: "test.owner", requires: [],
    configuration: [{ key: "OPTION", source: "file", secret: false }],
    clientConfig: { enabled: true },
  }] }), registry);
  const group = groupOf(groups, "test.owner");
  assert.equal(countContributions(filterGroup(group, "configuration", "")), 3);
  assert.equal(countContributions(group), 4);
  for (const query of ["display.options", "  CHOOSE  ", "test.owner"]) {
    assert.equal(filterGroup(group, "configuration", query).settings[0], registry.settings[0]);
    assert.equal(filterGroup(group, "all", query).settings[0], registry.settings[0]);
  }
  assert.deepEqual(filterGroup(group, "configuration", "no match").settings, []);
  assert.deepEqual(filterGroup(group, "web", "").settings, []);
  assert.equal(countContributions(filterGroup(group, "web", "choose")), 1);
  assert.deepEqual(filterGroup(group, "tools", "").settings, []);
});

test("removed and inactive settings contributions appear in no configuration view", () => {
  const active = { id: "active.option", owner: "test.active", label: "Active", Settings: Empty };
  const inactive = { id: "inactive.option", owner: "test.inactive", label: "Inactive", Settings: Empty };
  const response = settingsWith({ plugins: [
    { id: "test.active", requires: [], configuration: [] },
    { id: "test.inactive", requires: [], configuration: [] },
  ] });
  const groups = groupContributions(response, sourceWith({
    activePlugins: [{ id: "test.active" }], settings: [active, inactive],
  }));
  assert.deepEqual(groupOf(groups, "test.inactive").settings, []);
  assert.deepEqual(capabilityGroups(groups, "configuration", "").map((group) => group.id), ["test.active"]);
  assert.deepEqual(capabilityGroups(groupContributions(response, sourceWith({
    activePlugins: [{ id: "test.active" }], settings: [],
  })), "configuration", ""), []);
  assert.deepEqual(capabilityGroups(groupContributions(response, sourceWith({
    settings: [active, inactive],
  })), "configuration", ""), []);
});

test("capability groups search across owners and remove empty groups without changing the originals", () => {
  const first = Object.freeze(tool("first.tool", "test.first", "Search", "finds tasks"));
  const second = Object.freeze(tool("second.tool", "test.second", "Search", "finds files"));
  const groups = groupContributions(settingsWith({
    plugins: [
      { id: "test.first", requires: [], configuration: [] },
      { id: "test.empty", requires: [], configuration: [] },
      { id: "test.second", requires: [], configuration: [] },
    ],
    tools: [first, second],
    skills: [skill("first.skill", "test.first")],
  }), sourceWith({}));
  const original = structuredClone(groups);
  const found = capabilityGroups(groups, "tools", " Search ");
  assert.deepEqual(found.map((group) => group.id), ["test.first", "test.second"]);
  assert.equal(found[0]?.tools[0], first);
  assert.equal(found[1]?.tools[0], second);
  assert.deepEqual(found[0]?.skills, []);
  assert.deepEqual(capabilityGroups(groups, "tools", "Files").map((group) => group.id), ["test.second"]);
  assert.deepEqual(capabilityGroups(groups, "tools", "no match"), []);
  assert.deepEqual(capabilityGroups(groups, "web", ""), []);
  assert.deepEqual(capabilityGroups([], "configuration", ""), []);
  assert.deepEqual(groups, original);
});
