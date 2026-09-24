import { statSync } from "node:fs";
import path from "node:path";
import type {
  PluginRegistration,
  RAgentsPlugin,
  SkillContribution,
  StartEntryContribution,
} from "@ragents/engine";
import { skillsFromDirectory, type FolderSkills } from "./skills.js";
import { pluginFolder } from "./plugins-root.js";
import { runScriptsFromDirectory, type ScriptStartEntry } from "./run-scripts.js";
import { systemPromptOptionsFromDirectory, type SystemPromptOption } from "./system-prompts.js";

export { pluginFolder };

/** A file shipped in the plugin folder; code never locates it through its own module path. */
export const pluginAsset = (pluginId: string, name: string): string => path.join(pluginFolder(pluginId), name);

const assetFolder = (folder: string, name: string): string | undefined => {
  const directory = path.join(folder, name);
  const stats = statSync(directory, { throwIfNoEntry: false });
  if (!stats) return undefined;
  if (!stats.isDirectory()) throw new Error(`${directory} muss ein Verzeichnis sein`);
  return directory;
};

export const folderSkills = (folder: string, pluginId: string): FolderSkills => {
  const directory = assetFolder(folder, "skills");
  return directory ? skillsFromDirectory(directory, pluginId) : { startEntries: [], paths: [] };
};

export const folderRunScripts = (
  folder: string,
  pluginId: string,
): readonly ScriptStartEntry[] => {
  const directory = assetFolder(folder, "run-scripts");
  return directory ? runScriptsFromDirectory(directory, pluginId) : [];
};

export const folderSkillPaths = (folder: string): readonly string[] => folderSkills(folder, path.basename(folder)).paths;

export const folderSystemPrompts = (folder: string): readonly SystemPromptOption[] => {
  const directory = assetFolder(folder, "prompts");
  return directory ? systemPromptOptionsFromDirectory(directory) : [];
};

export const withFolderAssets = (plugin: RAgentsPlugin): RAgentsPlugin => ({
  manifest: plugin.manifest,
  register: (host) => {
    const explicitEntries: StartEntryContribution[] = [];
    const explicitSkills: SkillContribution[] = [];
    const observed: PluginRegistration = {
      ...host,
      startEntries: (...contributions) => {
        explicitEntries.push(...contributions);
        host.startEntries(...contributions);
      },
      skills: (...contributions) => {
        explicitSkills.push(...contributions);
        host.skills(...contributions);
      },
    };
    plugin.register(observed);

    const folder = pluginFolder(plugin.manifest.id);
    const skills = folderSkills(folder, plugin.manifest.id);
    const entries = [
      ...skills.startEntries,
      ...folderRunScripts(folder, plugin.manifest.id),
    ].filter((entry) => !explicitEntries.some((explicit) => explicit.id === entry.id));
    if (entries.length > 0) host.startEntries(...entries);

    const skillPaths = skills.paths;
    if (skillPaths.length === 0) return;
    host.skills({
      id: `${plugin.manifest.id}.folder-skills`,
      paths: async (context) => {
        const explicit = await Promise.all(explicitSkills.map((skill) => skill.paths(context)));
        const taken = new Set(explicit.flat());
        return skillPaths.filter((skillPath) => !taken.has(skillPath));
      },
    });
  },
});
