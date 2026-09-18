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

test("Einstellungsbereiche gehören ihrem Plugin und folgen optionaler Reihenfolge und Kennung", () => {
  const registry = registryWith([
    { id: "test.first", settings: [
      { id: "later", label: "Später", order: 10, Settings: Empty },
      { id: "second", label: "Zweiter", Settings: Empty },
    ] },
    { id: "test.second", settings: [{ id: "first", label: "Erster", order: 0, Settings: Empty }] },
  ]);
  assert.deepEqual(registry.settings.map(({ id, owner }) => ({ id, owner })), [
    { id: "first", owner: "test.second" },
    { id: "second", owner: "test.first" },
    { id: "later", owner: "test.first" },
  ]);
});

test("Entfernen oder Deaktivieren eines Plugins entfernt seine editierbaren Einstellungen", () => {
  const retained: WebPlugin = {
    id: "test.retained", settings: [{ id: "shared", label: "Bleibt", Settings: Empty }],
  };
  const removed: WebPlugin = {
    id: "test.removed", settings: [{ id: "removed", label: "Entfernt", Settings: Empty }],
  };
  const disabled: WebPlugin = {
    id: "test.disabled", enabled: () => false,
    settings: [{ id: "shared", label: "Inaktiv", Settings: Empty }],
  };
  assert.equal(registryWith([retained, removed, disabled]).settings.length, 2);
  assert.deepEqual(registryWith([retained, disabled]).settings.map((entry) => entry.owner), ["test.retained"]);
  assert.deepEqual(registryWith([disabled]).settings, []);
  assert.deepEqual(registryWith([]).settings, []);
});

test("models and appearance select real editable contributions while keeping their owners and order", () => {
  const registry = registryWith([
    { id: "test.product", settings: [
      { id: "product.models", label: "Neue Runs und Agenten", category: "models", order: 20, Settings: Empty },
      { id: "product.technical", label: "Technische Optionen", Settings: Empty },
    ] },
    { id: "test.coordinator", settings: [{ id: "global.model", label: "Globaler Koordinator", category: "models", order: 10, Settings: Empty }] },
    { id: "test.canvas", settings: [{ id: "canvas.zoom", label: "Canvas-Zoom", category: "appearance", Settings: Empty }] },
  ]);
  const models = settingsForCategory(registry.settings, "models", () => true);
  assert.deepEqual(models.map(({id, owner}) => ({id, owner})), [
    { id: "global.model", owner: "test.coordinator" },
    { id: "product.models", owner: "test.product" },
  ]);
  assert.equal(models[0], registry.settings.find((entry) => entry.id === "global.model"));
  assert.deepEqual(settingsForCategory(registry.settings, "appearance", () => true).map((entry) => entry.id), ["canvas.zoom"]);
  assert.equal(registry.settings.some((entry) => entry.id === "product.technical"), true);
});

test("settings categories hide contributions without read access and retain read-only contributions", () => {
  const registry = registryWith([{ id: "test.models", settings: [
    { id: "restricted", label: "Globaler Koordinator", category: "models", readRight: "global.read", Settings: Empty },
    { id: "public", label: "Neue Runs und Agenten", category: "models", Settings: Empty },
  ] }]);
  assert.deepEqual(settingsForCategory(registry.settings, "models", () => false).map((entry) => entry.id), ["public"]);
  assert.deepEqual(settingsForCategory(registry.settings, "models", (right) => right === "global.read").map((entry) => entry.id), ["public", "restricted"]);
});

test("doppelte oder leere Einstellungskennungen werden abgelehnt", () => {
  const settings = [{ id: "duplicate", label: "Beispiel", Settings: Empty }];
  assert.throws(() => registryWith([
    { id: "test.first", settings }, { id: "test.second", settings },
  ]), /Einstellungsbeitrag doppelt registriert: duplicate/);
  assert.throws(() => registryWith([
    { id: "test.empty", settings: [{ id: "", label: "Leer", Settings: Empty }] },
  ]), /Einstellungsbeitrag ohne ID/);
});

test("aktivierte Einstellungsrenderer werden aus öffentlicher Plugin-Konfiguration erzeugt", () => {
  const Configured = () => null;
  const registry = new PluginRegistry({
    brand: { title: "Test" }, product: { id: "test", title: "Test" }, startEntries: [],
    plugins: [{ id: "test.configured", activate: (config) => ({
      id: "test.configured",
      settings: [{ id: "configured", label: String(config.label), Settings: Configured }],
    }) }],
  }, new Map([["test.configured", { label: "Konfiguriert" }]]));
  assert.equal(registry.settings[0]?.label, "Konfiguriert");
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
  availabilityDetail: "immer",
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
  category: "Beispiele",
  title,
  description: `Beschreibung von ${title}`,
  prompt: "frei",
});

const starter = (id: string, owner: string, title: string): StartEntry => ({
  id,
  owner,
  action: "skill",
  title,
  description: `Ablauf ${title}`,
  skill: `${owner}-skill`,
  category: "Entwicklung",
  prompt: "Feature umsetzen",
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
  agentExtensions: [],
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
  assert.ok(found, `Gruppe ${id} fehlt`);
  return found;
};

test("Beiträge landen bei ihrem Eigentümer und die Plugin-Reihenfolge bleibt erhalten", () => {
  const settings = settingsWith({
    plugins: [
      { id: "ragents.core", requires: [], configuration: [] },
      { id: "test.tasks", requires: ["ragents.core"], configuration: [{ key: "PAT", source: "env", secret: true }] },
    ],
    tools: [tool("t1", "test.tasks", "Suche", "sucht"), tool("t2", "ragents.core", "Notiz", "notiert")],
    skills: [skill("s1", "test.tasks")],
    promptContributions: [{ id: "p1", owner: "ragents.core", order: 10, content: "Inhalt" }],
    agentExtensions: [
      { id: "e1", owner: "test.tasks", kind: "plugin", factories: [], resolvesPerAgent: false },
      { id: "e2", owner: "agent", kind: "internal", factories: [], resolvesPerAgent: true },
    ],
  });
  const source = sourceWith({
    startEntries: [card("c1", "test.tasks", "Karte"), starter("st1", "ragents.core", "Start")],
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
  assert.deepEqual(tasks.extensions.map((entry) => entry.id), ["e1"]);
  assert.deepEqual(tasks.requires, ["ragents.core"]);
  assert.equal(tasks.configuration.length, 1);
});

test("Web-Einstellungen und Übersichtsbeiträge sind beim Eigentümer auffindbar", () => {
  const registry = registryWith([{
    id: "test.settings",
    overviewPanels: [{ id: "test.panel", order: 1, Panel: Empty }],
    settings: [{ id: "test.model", label: "Modellauswahl", Settings: Empty }],
  }]);
  const group = groupOf(groupContributions(settingsWith({}), registry), "test.settings");
  assert.equal(group.webActive, true);
  assert.equal(group.serverRegistered, false);
  assert.deepEqual(group.web, { state: "contributions", contributions: [
    { kind: "Übersichtsbeiträge", details: ["test.panel"], count: 1 },
    { kind: "Einstellungen", details: ["test.model (Modellauswahl)"], count: 1 },
  ] });
  assert.equal(countContributions(filterGroup(group, "web", "modellauswahl")), 1);
  assert.equal(countContributions(filterGroup(group, "web", "test.panel")), 1);
  assert.deepEqual(groupContributions(settingsWith({}), registryWith([])), []);
});

test("interne Erweiterungen gehören keiner Plugin-Gruppe", () => {
  const settings = settingsWith({
    plugins: [{ id: "ragents.core", requires: [], configuration: [] }],
    agentExtensions: [{ id: "e2", owner: "agent", kind: "internal", factories: [], resolvesPerAgent: true }],
  });
  const groups = groupContributions(settings, sourceWith({}));
  assert.deepEqual(groups.map((group) => group.id), ["ragents.core"]);
  assert.deepEqual(groupOf(groups, "ragents.core").extensions, []);
});

test("unbekannte Eigentümer bekommen eine eigene Gruppe am Ende", () => {
  const settings = settingsWith({ plugins: [{ id: "ragents.core", requires: [], configuration: [] }] });
  const source = sourceWith({ startEntries: [card("extern", "dateisystem", "Externe Karte")] });
  const groups = groupContributions(settings, source);
  assert.deepEqual(groups.map((group) => group.id), ["ragents.core", "dateisystem"]);
  const external = groupOf(groups, "dateisystem");
  assert.equal(external.serverRegistered, false);
  assert.equal(external.webActive, false);
  assert.deepEqual(external.requires, []);
  assert.deepEqual(external.web, { state: "none" });
  assert.deepEqual(external.startEntries.map((entry) => entry.id), ["extern"]);
});

test("das Web-Modul unterscheidet fehlend, beitragslos und beitragend", () => {
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
    "Arbeitsbereichs-Tabs",
    "Branding",
    "Karten-Abschnitte",
  ]);
  assert.deepEqual(loud.web.contributions[0].details, ["board (Board)"]);
});

test("der Filter lässt nur eine Beitragsart übrig", () => {
  const settings = settingsWith({
    plugins: [{ id: "test.tasks", requires: [], configuration: [{ key: "PAT", source: "env", secret: true }] }],
    tools: [tool("t1", "test.tasks", "Suche", "sucht")],
    skills: [skill("s1", "test.tasks")],
  });
  const source = sourceWith({ startEntries: [card("c1", "test.tasks", "Karte")] });
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

test("die Suche greift über alle Beitragsarten der Gruppe", () => {
  const settings = settingsWith({
    plugins: [{ id: "test.tasks", requires: [], configuration: [] }],
    tools: [tool("t1", "test.tasks", "Suche", "findet Arbeitsvorgang-Einträge"), tool("t2", "test.tasks", "Notiz", "schreibt")],
  });
  const source = sourceWith({ startEntries: [card("c1", "test.tasks", "Arbeitsvorgang anlegen")] });
  const group = groupOf(groupContributions(settings, source), "test.tasks");
  const found = filterGroup(group, "all", "arbeitsvorgang");
  assert.deepEqual(found.tools.map((entry) => entry.id), ["t1"]);
  assert.deepEqual(found.startEntries.map((entry) => entry.id), ["c1"]);
  assert.equal(countContributions(found), 2);
  const category = filterGroup(group, "startEntries", "beispiele");
  assert.deepEqual(category.startEntries.map((entry) => entry.id), ["c1"]);
  assert.equal(countContributions(category), 1);
  assert.equal(countContributions(filterGroup(group, "all", "nichts davon")), 0);
});

test("the function catalog distinguishes TypeScript functions and explicit native tools in labels and search", () => {
  const functions = [
    tool("function", "test.functions", "sum", "Add numbers"),
    { ...tool("native", "test.functions", "typescript_eval", "Evaluate code"), nativeTool: true },
  ];
  const groups = groupContributions(settingsWith({ tools: functions }), sourceWith({}));
  assert.equal(functionSurfaceLabel(undefined), "TypeScript-Funktion");
  assert.equal(functionSurfaceLabel(false), "TypeScript-Funktion");
  assert.equal(functionSurfaceLabel(true), "LLM-Werkzeug");
  assert.deepEqual(capabilityGroups(groups, "tools", "TypeScript-Funktion")[0]?.tools.map((entry) => entry.id), ["function"]);
  assert.deepEqual(capabilityGroups(groups, "tools", "LLM-Werkzeug")[0]?.tools.map((entry) => entry.id), ["native"]);
  assert.deepEqual(capabilityGroups(groups, "tools", "Werkzeug-Index"), []);
});

test("ohne Suchtext bleibt die Zählung die Summe aller Beiträge", () => {
  const settings = settingsWith({
    plugins: [{ id: "test.tasks", requires: [], configuration: [{ key: "PAT", source: "env", secret: false }] }],
    tools: [tool("t1", "test.tasks", "Suche", "sucht")],
    promptContributions: [{ id: "p1", owner: "test.tasks", order: 1, content: "Inhalt" }],
    skills: [skill("s1", "test.tasks")],
    agentExtensions: [{ id: "e1", owner: "test.tasks", kind: "plugin", factories: [], resolvesPerAgent: false }],
  });
  const registry = new PluginRegistry({
    brand: { title: "Test" },
    plugins: [{ id: "test.tasks", guides: [{ id: "guide", Guide: Empty }] }],
    product: { id: "test", title: "Test" },
    startEntries: [card("c1", "test.tasks", "Karte"), { ...starter("st1", "test.tasks", "Start"), guide: "guide" }],
  });
  const group = groupOf(groupContributions(settings, registry), "test.tasks");
  assert.equal(countContributions(group), 8);
  assert.equal(countContributions(filterGroup(group, "all", "")), 8);
});

test("bearbeitbare Einstellungen bleiben bei ihrem Eigentümer und behalten ihre Objektidentität", () => {
  const first = Object.freeze({ id: "first.setting", owner: "test.first", label: "Modell", Settings: Empty });
  const second = Object.freeze({ id: "second.setting", owner: "test.second", label: "Darstellung", Settings: Empty });
  const contributions = Object.freeze([second, first]);
  const groups = groupContributions(settingsWith({}), sourceWith({
    activePlugins: [{ id: "test.first" }, { id: "test.second" }],
    settings: contributions,
  }));
  assert.deepEqual(groups.map((group) => group.id), ["test.first", "test.second"]);
  assert.equal(groupOf(groups, "test.first").settings[0], first);
  assert.equal(groupOf(groups, "test.second").settings[0], second);
  assert.equal(capabilityGroups(groups, "configuration", "Modell")[0]?.settings[0], first);
  assert.deepEqual(contributions, [second, first]);
  assert.equal(groupOf(groups, "test.second").settings[0], second);
});

test("Konfiguration zählt und durchsucht editierbare Einstellungen neben statischen Werten", () => {
  const registry = registryWith([{
    id: "test.owner",
    settings: [{ id: "display.options", label: "Ansicht auswählen", Settings: Empty }],
  }]);
  const groups = groupContributions(settingsWith({ plugins: [{
    id: "test.owner", requires: [],
    configuration: [{ key: "OPTION", source: "file", secret: false }],
    clientConfig: { enabled: true },
  }] }), registry);
  const group = groupOf(groups, "test.owner");
  assert.equal(countContributions(filterGroup(group, "configuration", "")), 3);
  assert.equal(countContributions(group), 4);
  for (const query of ["display.options", "  AUSWÄHLEN  ", "test.owner"]) {
    assert.equal(filterGroup(group, "configuration", query).settings[0], registry.settings[0]);
    assert.equal(filterGroup(group, "all", query).settings[0], registry.settings[0]);
  }
  assert.deepEqual(filterGroup(group, "configuration", "kein Treffer").settings, []);
  assert.deepEqual(filterGroup(group, "web", "").settings, []);
  assert.equal(countContributions(filterGroup(group, "web", "auswählen")), 1);
  assert.deepEqual(filterGroup(group, "tools", "").settings, []);
});

test("entfernte und inaktive Einstellungsbeiträge erscheinen in keiner Konfigurationsansicht", () => {
  const active = { id: "active.option", owner: "test.active", label: "Aktiv", Settings: Empty };
  const inactive = { id: "inactive.option", owner: "test.inactive", label: "Inaktiv", Settings: Empty };
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

test("Fähigkeitsgruppen suchen über Eigentümer hinweg und entfernen leere Gruppen ohne Originale zu ändern", () => {
  const first = Object.freeze(tool("first.tool", "test.first", "Suche", "findet Aufgaben"));
  const second = Object.freeze(tool("second.tool", "test.second", "Suche", "findet Dateien"));
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
  const found = capabilityGroups(groups, "tools", " Suche ");
  assert.deepEqual(found.map((group) => group.id), ["test.first", "test.second"]);
  assert.equal(found[0]?.tools[0], first);
  assert.equal(found[1]?.tools[0], second);
  assert.deepEqual(found[0]?.skills, []);
  assert.deepEqual(capabilityGroups(groups, "tools", "Dateien").map((group) => group.id), ["test.second"]);
  assert.deepEqual(capabilityGroups(groups, "tools", "kein Treffer"), []);
  assert.deepEqual(capabilityGroups(groups, "web", ""), []);
  assert.deepEqual(capabilityGroups([], "configuration", ""), []);
  assert.deepEqual(groups, original);
});
