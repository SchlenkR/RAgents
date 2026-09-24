import type {
  SettingsAgentExtension,
  SettingsConfigurationDescriptor,
  SettingsPromptContribution,
  SettingsResponse,
  SettingsSkill,
  SettingsTool,
} from "./api";
import type { SettingsContribution, StartEntry, WebPlugin } from "./PluginRegistry";

export const settingsForCategory = <T extends SettingsContribution>(
  contributions: readonly T[],
  category: NonNullable<SettingsContribution["category"]>,
  can: (right: string) => boolean,
): readonly T[] => contributions.filter((entry) => entry.category === category && (!entry.readRight || can(entry.readRight)));

export type ContributionKind =
  | "tools"
  | "prompts"
  | "startEntries"
  | "skills"
  | "extensions"
  | "configuration"
  | "web";

export type ContributionFilter = "all" | ContributionKind;

export interface ContributionFilterOption {
  id: ContributionFilter;
  label: string;
}

export const contributionFilters: readonly ContributionFilterOption[] = [
  { id: "all", label: "Alle" },
  { id: "tools", label: "Funktionen" },
  { id: "prompts", label: "Prompts" },
  { id: "startEntries", label: "Einstiege" },
  { id: "skills", label: "Skills" },
  { id: "extensions", label: "Erweiterungen" },
  { id: "configuration", label: "Konfiguration" },
  { id: "web", label: "Web" },
];

export interface WebContribution {
  kind: string;
  details: readonly string[];
  count: number;
}

export type PluginWebModule =
  | { state: "hidden" }
  | { state: "none" }
  | { state: "withoutContributions" }
  | { state: "contributions"; contributions: readonly WebContribution[] };

export interface PluginGroup {
  id: string;
  requires: readonly string[];
  serverRegistered: boolean;
  webActive: boolean;
  tools: readonly SettingsTool[];
  prompts: readonly SettingsPromptContribution[];
  startEntries: readonly StartEntry[];
  skills: readonly SettingsSkill[];
  extensions: readonly SettingsAgentExtension[];
  configuration: readonly SettingsConfigurationDescriptor[];
  settings: readonly (SettingsContribution & { owner: string })[];
  clientConfig: Readonly<Record<string, unknown>> | undefined;
  web: PluginWebModule;
}

export interface ContributionSource {
  plugins: readonly WebPlugin[];
  activePlugins: readonly { id: string }[];
  startEntries: readonly StartEntry[];
  settings?: PluginGroup["settings"];
}

export const toolKindLabel = (kind: SettingsTool["kind"]): string => {
  if (kind === "ragents") return "RAgents";
  return "Plugin";
};

export const toolScopeLabel = (scope: SettingsTool["scope"]): string => {
  if (scope === "global") return "Laufzeitweit";
  if (scope === "per-agent") return "Je Agent";
  return "Je Turn";
};

export const toolAvailabilityLabel = (availability: SettingsTool["availability"]): string =>
  availability === "always" ? "Grundsätzlich verfügbar" : "Bedingt verfügbar";

export const functionSurfaceLabel = (nativeTool: SettingsTool["nativeTool"]): string =>
  nativeTool === true ? "LLM-Werkzeug" : "TypeScript-Funktion";

export const skillAudienceLabel = (audience: SettingsSkill["audiences"][number]): string =>
  audience === "coordinator" ? "Koordinator" : "Agenten";

export const groupContributions = (
  settings: SettingsResponse,
  source: ContributionSource,
): readonly PluginGroup[] => {
  const activeIds = new Set(source.activePlugins.map((plugin) => plugin.id));
  const webPlugins = new Map(source.plugins.map((plugin) => [plugin.id, plugin]));
  const serverPlugins = new Map(settings.plugins.map((plugin) => [plugin.id, plugin]));
  const extensions = settings.agentExtensions.filter((extension) => extension.kind === "plugin");
  const editableSettings = (source.settings ?? []).filter((contribution) => activeIds.has(contribution.owner));
  const owners = [
    ...settings.plugins.map((plugin) => plugin.id),
    ...ownersOf(settings.tools),
    ...ownersOf(settings.promptContributions),
    ...ownersOf(source.startEntries),
    ...ownersOf(settings.skills),
    ...ownersOf(extensions),
    ...activeIds,
  ];
  const ordered = [...new Set(owners)];
  return ordered.map((id) => {
    const plugin = serverPlugins.get(id);
    const web = webPlugins.get(id);
    return {
      id,
      requires: plugin?.requires ?? [],
      serverRegistered: plugin !== undefined,
      webActive: activeIds.has(id),
      tools: settings.tools.filter((tool) => tool.owner === id),
      prompts: settings.promptContributions.filter((contribution) => contribution.owner === id),
      startEntries: source.startEntries.filter((entry) => entry.owner === id),
      skills: settings.skills.filter((skill) => skill.owner === id),
      extensions: extensions.filter((extension) => extension.owner === id),
      configuration: plugin?.configuration ?? [],
      settings: editableSettings.filter((contribution) => contribution.owner === id),
      clientConfig: plugin?.clientConfig,
      web: webModuleOf(web),
    };
  });
};

export const filterGroup = (
  group: PluginGroup,
  filter: ContributionFilter,
  searchText: string,
): PluginGroup => {
  const needle = searchText.trim().toLocaleLowerCase("de-DE");
  const kept = (kind: ContributionKind) => filter === "all" || filter === kind;
  const matches = (haystack: readonly (string | undefined)[]) =>
    needle === "" || haystack.filter((part): part is string => part !== undefined)
      .join(" ").toLocaleLowerCase("de-DE").includes(needle);
  const configuration = kept("configuration")
    ? group.configuration.filter((entry) => matches([entry.key, entry.source]))
    : [];
  const clientConfig = kept("configuration")
    && group.clientConfig !== undefined
    && matches([group.id, "Client-Konfiguration", JSON.stringify(group.clientConfig)])
    ? group.clientConfig
    : undefined;
  return {
    ...group,
    tools: kept("tools") ? group.tools.filter((tool) => matches(toolSearchParts(tool))) : [],
    prompts: kept("prompts")
      ? group.prompts.filter((contribution) => matches([contribution.id, contribution.owner]))
      : [],
    startEntries: kept("startEntries")
      ? group.startEntries.filter((entry) => matches(entrySearchParts(entry)))
      : [],
    skills: kept("skills")
      ? group.skills.filter((skill) => matches([skill.id, skill.owner, ...skill.paths]))
      : [],
    extensions: kept("extensions")
      ? group.extensions.filter((extension) => matches([extension.id, extension.owner]))
      : [],
    configuration,
    settings: kept("configuration")
      ? group.settings.filter((contribution) => matches([contribution.id, contribution.label, contribution.owner]))
      : [],
    clientConfig,
    web: kept("web") ? filterWebModule(group.web, needle) : { state: "hidden" },
  };
};

export const countContributions = (group: PluginGroup): number =>
  group.tools.length
  + group.prompts.length
  + group.startEntries.length
  + group.skills.length
  + group.extensions.length
  + group.configuration.length
  + group.settings.length
  + (group.clientConfig === undefined ? 0 : 1)
  + webCount(group.web);

export const capabilityGroups = (
  groups: readonly PluginGroup[],
  kind: ContributionKind,
  query: string,
): readonly PluginGroup[] => groups
  .map((group) => filterGroup(group, kind, query))
  .filter((group) => countContributions(group) > 0);

const webCount = (web: PluginWebModule): number =>
  web.state === "contributions" ? web.contributions.length : 0;

const filterWebModule = (web: PluginWebModule, needle: string): PluginWebModule => {
  if (web.state !== "contributions") return needle === "" ? web : { state: "hidden" };
  const contributions = web.contributions.filter((contribution) =>
    [contribution.kind, ...contribution.details].join(" ").toLocaleLowerCase("de-DE").includes(needle));
  return contributions.length === 0 && needle !== "" ? { state: "hidden" } : { state: "contributions", contributions };
};

const ownersOf = (items: readonly { owner: string }[]): readonly string[] => items.map((item) => item.owner);

export const entryActionLabel = (entry: StartEntry): string =>
  entry.action === "skill" ? "Skill" : "Run-Script";

const entrySearchParts = (entry: StartEntry): readonly (string | undefined)[] => [
  entry.id,
  entry.title,
  entry.description,
  entry.guide,
  entryActionLabel(entry),
  entry.action === "skill" ? entry.category : undefined,
  entry.action === "skill" ? entry.skill : undefined,
];

const webModuleOf = (plugin: WebPlugin | undefined): PluginWebModule => {
  if (plugin === undefined) return { state: "none" };
  const contributions = webContributionsOf(plugin);
  return contributions.length === 0 ? { state: "withoutContributions" } : { state: "contributions", contributions };
};

const webContributionsOf = (plugin: WebPlugin): readonly WebContribution[] => [
  listed("Arbeitsbereichs-Tabs", (plugin.workspaceTabs ?? []).map((tab) => `${tab.id} (${tab.label})`)),
  flagged("Dynamische Arbeitsbereichs-Tabs", plugin.workspaceTabsFor !== undefined),
  listed("Leitfäden", (plugin.guides ?? []).map((guide) => guide.id)),
  flagged("Branding", plugin.brand !== undefined),
  flagged("Canvas", plugin.canvas !== undefined),
  counted("Canvas-Elemente", (plugin.canvasElements ?? []).length),
  counted("Karten-Abschnitte", (plugin.cardSections ?? []).length),
  counted("Werkzeug-Darstellungen", (plugin.toolPresenters ?? []).length),
  counted("Entitäts-Darstellungen", (plugin.entityPresenters ?? []).length),
  counted("Session-Kopfbeiträge", (plugin.sessionHeaders ?? []).length),
  listed("Übersichtsbeiträge", (plugin.overviewPanels ?? []).map((panel) => panel.id)),
  listed("Einstellungen", (plugin.settings ?? []).map((setting) => `${setting.id} (${setting.label})`)),
  counted("Session-Metadaten", (plugin.sessionMetadata ?? []).length),
  counted("Attention-Beiträge", (plugin.attention ?? []).length),
  listed("Startoptionen", (plugin.startOptions ?? []).map((option) => option.id)),
  flagged("Chat-Darstellung", plugin.chatDisplayPolicy !== undefined),
  listed("Aktionsdarstellungen", (plugin.actionViews ?? []).map((view) => view.owner)),
  flagged("Session-Provider", plugin.SessionProvider !== undefined),
].filter((contribution): contribution is WebContribution => contribution !== undefined);

const listed = (kind: string, details: readonly string[]): WebContribution | undefined =>
  details.length === 0 ? undefined : { kind, details, count: details.length };

const counted = (kind: string, count: number): WebContribution | undefined =>
  count === 0 ? undefined : { kind, details: [], count };

const flagged = (kind: string, present: boolean): WebContribution | undefined =>
  present ? { kind, details: [], count: 1 } : undefined;

const toolSearchParts = (tool: SettingsTool): readonly string[] => [
  tool.id,
  tool.name,
  tool.description,
  tool.owner,
  tool.source,
  toolKindLabel(tool.kind),
  toolScopeLabel(tool.scope),
  toolAvailabilityLabel(tool.availability),
  functionSurfaceLabel(tool.nativeTool),
  tool.availabilityDetail,
];
