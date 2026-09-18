import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  modelToolDescriptors,
  skillPreloadExtensionName,
  turnDispatcherExtensionName,
  runtimeOwner,
  type AgentProfile,
  type CatalogModel,
  type PluginHost,
  type ProductDescriptor,
  type PublicAgentExtensionContribution,
  type PublicPluginManifest,
  type PublicPromptContribution,
  type PublicSkillContribution,
  type PublicToolDescriptor,
} from "@aicontainer/ragents";
import { config } from "./config.js";
import { configFilePath } from "./config-file.js";
import type { Engine, RuntimeContract } from "./ragents/engine.js";
import { documentStoreToken } from "./ragents/document-store.js";
import { productRuntimeToken } from "./ragents/product-runtime.js";
import { workspaceRuntimeToken } from "./ragents/workspace-runtime.js";

export interface SettingsRuntime {
  profile: string;
  configFile: string | null;
  workspaceMode: string;
  host: {
    mode: "native" | "container";
    platform: NodeJS.Platform;
    workingDirectory: string;
  };
  dataDirectory: string;
  workspace: { directoryPattern: string };
  documents: { directoryPattern: string } | null;
}

export interface SettingsSystemPrompt {
  scope: "product";
  content: string;
  finalPromptIsRunSpecific: true;
  composition: string;
  runtimeContracts: readonly RuntimeContract[];
}

export interface InternalAgentExtensionContribution {
  id: string;
  owner: string;
  kind: "internal";
  factories: readonly {
    name: string;
    scope: "per-agent";
  }[];
  resolvesPerAgent: true;
}

export interface SettingsSkillFile {
  root: string;
  path: string;
  bytes: number;
  frontMatter: string | null;
  content: string | null;
}

export interface SettingsSkillDetail {
  id: string;
  owner: string;
  paths: readonly string[];
  files: readonly SettingsSkillFile[];
}

export interface SettingsResponse {
  version: 2;
  product: ProductDescriptor;
  runtime: SettingsRuntime;
  models: readonly CatalogModel[];
  profiles: readonly AgentProfile[];
  systemPrompt: SettingsSystemPrompt;
  promptContributions: readonly PublicPromptContribution[];
  plugins: readonly PublicPluginManifest[];
  agentExtensions: readonly (PublicAgentExtensionContribution | InternalAgentExtensionContribution)[];
  skills: readonly PublicSkillContribution[];
  tools: readonly PublicToolDescriptor[];
}

const runtimeSettings = (plugins: PluginHost): SettingsRuntime => {
  const workspace = plugins.service(workspaceRuntimeToken).describe();
  const documents = plugins.optionalService(documentStoreToken)?.describe();
  return {
    profile: config.productProfile,
    configFile: configFilePath(),
    workspaceMode: workspace.mode,
    host: {
      mode: existsSync("/.dockerenv") || existsSync("/run/.containerenv") ? "container" : "native",
      platform: process.platform,
      workingDirectory: process.cwd(),
    },
    dataDirectory: config.dataDir,
    workspace: { directoryPattern: workspace.directoryPattern },
    documents: documents ? { directoryPattern: documents.directoryPattern } : null,
  };
};

const internalAgentExtensions: readonly InternalAgentExtensionContribution[] = [
  turnDispatcherExtensionName,
  skillPreloadExtensionName,
].map((name): InternalAgentExtensionContribution => ({
  id: name,
  owner: runtimeOwner,
  kind: "internal",
  factories: [{ name, scope: "per-agent" }],
  resolvesPerAgent: true,
}));

const toolsSettings = (plugins: PluginHost): readonly PublicToolDescriptor[] => {
  const tools: PublicToolDescriptor[] = [
    ...modelToolDescriptors.map((tool) => ({
      id: `ragents:${tool.name}`,
      owner: runtimeOwner,
      source: "ragents.agent-tools",
      kind: "ragents" as const,
      ...tool,
    })),
    ...plugins.tools.describe(),
    ...plugins.agentRuntime.describeTools(),
  ];
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`Werkzeug ${tool.name} ist im öffentlichen Katalog mehrfach registriert`);
    names.add(tool.name);
  }
  return tools;
};

const MAX_SKILL_FILE_BYTES = 512 * 1024;

const isHidden = (relative: string): boolean =>
  relative.split(path.sep).some((segment) => segment.startsWith("."));

const splitFrontMatter = (text: string): { frontMatter: string | null; body: string } => {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match === null
    ? { frontMatter: null, body: text }
    : { frontMatter: match[1], body: text.slice(match[0].length) };
};

const skillFile = async (root: string, file: string): Promise<SettingsSkillFile> => {
  const bytes = (await stat(file)).size;
  const text = bytes > MAX_SKILL_FILE_BYTES ? null : await readFile(file, "utf8");
  const split = text === null || text.includes("\u0000") ? null : splitFrontMatter(text);
  return {
    root,
    path: path.relative(root, file),
    bytes,
    frontMatter: split?.frontMatter ?? null,
    content: split?.body ?? null,
  };
};

const skillFiles = async (root: string): Promise<readonly SettingsSkillFile[]> => {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return Promise.all(entries
    .filter((entry) => entry.isFile() && !isHidden(path.relative(root, path.join(entry.parentPath, entry.name))))
    .map((entry) => skillFile(root, path.join(entry.parentPath, entry.name))));
};

const byReadingOrder = (left: SettingsSkillFile, right: SettingsSkillFile): number =>
  Number(right.path === "SKILL.md") - Number(left.path === "SKILL.md")
  || left.path.localeCompare(right.path, "de-DE");

export const skillDetailResponse = async (
  plugins: PluginHost,
  id: string,
): Promise<SettingsSkillDetail | null> => {
  const skill = (await plugins.skills.describe(undefined)).find((entry) => entry.id === id);
  if (!skill) return null;
  const files = await Promise.all(skill.paths.map(skillFiles));
  return {
    id: skill.id,
    owner: skill.owner,
    paths: skill.paths,
    files: files.flat().sort(byReadingOrder),
  };
};

export const settingsResponse = async (
  engine: Engine,
  plugins: PluginHost,
): Promise<SettingsResponse> => ({
  version: 2,
  product: plugins.publicProfile().product,
  runtime: runtimeSettings(plugins),
  models: await engine.catalog.models(),
  profiles: engine.catalog.profiles(),
  systemPrompt: {
    scope: "product",
    content: engine.systemPrompt,
    finalPromptIsRunSpecific: true,
    composition: plugins.service(productRuntimeToken).promptComposition,
    runtimeContracts: engine.runtimeContracts,
  },
  promptContributions: engine.promptContributions,
  plugins: plugins.publicManifests(),
  agentExtensions: [...plugins.agentRuntime.describe(), ...internalAgentExtensions],
  skills: await plugins.skills.describe(undefined),
  tools: toolsSettings(plugins),
});
