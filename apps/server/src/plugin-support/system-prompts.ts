import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DeclaredEnvironment } from "./plugin-config.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

export const SYSTEM_PROMPT_MODES = ["fixed", "selectable"] as const;

export type SystemPromptMode = (typeof SYSTEM_PROMPT_MODES)[number];

export interface SystemPromptOption {
  readonly id: string;
  readonly label: string;
  readonly file: string;
  readonly text: string;
}

export interface SystemPromptCatalog {
  readonly mode: SystemPromptMode;
  readonly options: readonly SystemPromptOption[];
  readonly defaultIds: readonly string[];
  readonly shareDefault: boolean;
}

export const systemPromptEnvDescriptors = [
  { key: "SYSTEM_PROMPTS_DIR", source: "environment" },
  { key: "SYSTEM_PROMPT_MODE", source: "environment" },
  { key: "SYSTEM_PROMPT_DEFAULT", source: "environment" },
  { key: "SYSTEM_PROMPT_SHARE_DEFAULT", source: "environment" },
] as const;

type SystemPromptEnvironment = DeclaredEnvironment<(typeof systemPromptEnvDescriptors)[number]["key"]>;

const PROMPT_EXTENSIONS = [".md", ".hbs"];

const flag = (value: string | undefined, key: string): boolean => {
  if (value === undefined || value === "") return false;
  if (value === "1") return true;
  if (value === "0") return false;
  throw new Error(`${key} must be "0" or "1", not "${value}"`);
};

const labelOf = (text: string, id: string): string => {
  const heading = text.split("\n").find((line) => line.startsWith("# "));
  return heading ? heading.slice(2).trim() : id;
};

export const systemPromptOptionsFromDirectory = (directory: string): readonly SystemPromptOption[] => {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      `The prompt directory ${directory} is not readable (${error instanceof Error ? error.message : String(error)})`);
  }
  const files = entries
    .filter((entry) => entry.isFile() && PROMPT_EXTENSIONS.includes(path.extname(entry.name)))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, "de-DE"));
  const options = files.map((name) => {
    const file = path.join(directory, name);
    const id = path.basename(name, path.extname(name));
    const text = readFileSync(file, "utf8").trim();
    return { id, label: labelOf(text, id), file, text };
  });
  const duplicate = options.find((option, index) => options.findIndex((other) => other.id === option.id) !== index);
  if (duplicate) throw new Error(`The prompt directory ${directory} contains the identifier ${duplicate.id} more than once`);
  if (options.length === 0) {
    throw new Error(`The prompt directory ${directory} contains no ${PROMPT_EXTENSIONS.join(" or ")} file`);
  }
  return options;
};

export const lazySystemPromptCatalog = (
  env: SystemPromptEnvironment,
  folderOptions: () => readonly SystemPromptOption[],
): (() => SystemPromptCatalog) => {
  let catalog: SystemPromptCatalog | undefined;
  return () => catalog ??= systemPromptCatalogFromEnvironment(env, folderOptions());
};

export const systemPromptCatalogFromEnvironment = (
  env: SystemPromptEnvironment,
  folderOptions: readonly SystemPromptOption[] = [],
): SystemPromptCatalog => {
  const directory = env.optional("SYSTEM_PROMPTS_DIR");
  const mode = env.optional("SYSTEM_PROMPT_MODE") || undefined;
  const defaultId = env.optional("SYSTEM_PROMPT_DEFAULT") || undefined;
  const shareRaw = env.optional("SYSTEM_PROMPT_SHARE_DEFAULT") || undefined;
  const options = [
    ...folderOptions,
    ...(directory ? systemPromptOptionsFromDirectory(path.resolve(rootDir, directory)) : []),
  ];
  const collision = options.find((option, index) => options.findIndex((other) => other.id === option.id) !== index);
  if (collision) {
    throw new Error(`The system prompt ${collision.id} comes from the plugin folder and from SYSTEM_PROMPTS_DIR`);
  }
  if (options.length === 0) {
    return Object.freeze({ mode: "fixed" as const, options: [], defaultIds: [], shareDefault: false });
  }
  if (mode !== undefined && !SYSTEM_PROMPT_MODES.includes(mode as SystemPromptMode)) {
    throw new Error(`SYSTEM_PROMPT_MODE must be one of ${SYSTEM_PROMPT_MODES.join(", ")}, not "${mode}"`);
  }
  const effectiveMode = (mode ?? "selectable") as SystemPromptMode;
  const wanted = (defaultId ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (effectiveMode === "fixed" && wanted.length === 0) {
    throw new Error("SYSTEM_PROMPT_MODE is fixed, so SYSTEM_PROMPT_DEFAULT names the valid prompts");
  }
  for (const id of wanted) {
    if (!options.some((option) => option.id === id)) {
      throw new Error(
        `SYSTEM_PROMPT_DEFAULT ${id} is not a selectable system prompt; `
        + `available are ${options.map((option) => option.id).join(", ")}`);
    }
  }
  const duplicate = wanted.find((id, index) => wanted.indexOf(id) !== index);
  if (duplicate) throw new Error(`SYSTEM_PROMPT_DEFAULT names ${duplicate} more than once`);
  return Object.freeze({
    mode: effectiveMode,
    options,
    defaultIds: Object.freeze(wanted.length > 0 ? wanted : [options[0].id]),
    shareDefault: flag(shareRaw, "SYSTEM_PROMPT_SHARE_DEFAULT"),
  });
};

export const selectedSystemPrompts = (
  catalog: SystemPromptCatalog,
  selection: readonly string[] | undefined,
): readonly SystemPromptOption[] => {
  if (catalog.options.length === 0) return [];
  const wanted = catalog.mode === "fixed" ? catalog.defaultIds : selection ?? catalog.defaultIds;
  return wanted.map((id) => {
    const option = catalog.options.find((entry) => entry.id === id);
    if (!option) throw new Error(`The system prompt ${id} is no longer configured`);
    return option;
  });
};
