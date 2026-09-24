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
  throw new Error(`${key} muss "0" oder "1" sein, nicht "${value}"`);
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
      `Das Prompt-Verzeichnis ${directory} ist nicht lesbar (${error instanceof Error ? error.message : String(error)})`);
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
  if (duplicate) throw new Error(`Das Prompt-Verzeichnis ${directory} enthält die Kennung ${duplicate.id} mehrfach`);
  if (options.length === 0) {
    throw new Error(`Das Prompt-Verzeichnis ${directory} enthält keine ${PROMPT_EXTENSIONS.join("- oder ")}-Datei`);
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
    throw new Error(`Der Systemprompt ${collision.id} kommt aus dem Plugin-Ordner und aus SYSTEM_PROMPTS_DIR`);
  }
  if (options.length === 0) {
    return Object.freeze({ mode: "fixed" as const, options: [], defaultIds: [], shareDefault: false });
  }
  if (mode !== undefined && !SYSTEM_PROMPT_MODES.includes(mode as SystemPromptMode)) {
    throw new Error(`SYSTEM_PROMPT_MODE muss einer der Werte ${SYSTEM_PROMPT_MODES.join(", ")} sein, nicht "${mode}"`);
  }
  const effectiveMode = (mode ?? "selectable") as SystemPromptMode;
  const wanted = (defaultId ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (effectiveMode === "fixed" && wanted.length === 0) {
    throw new Error("SYSTEM_PROMPT_MODE ist fixed, SYSTEM_PROMPT_DEFAULT benennt dann die gültigen Prompts");
  }
  for (const id of wanted) {
    if (!options.some((option) => option.id === id)) {
      throw new Error(
        `SYSTEM_PROMPT_DEFAULT ${id} ist kein auswählbarer Systemprompt; `
        + `vorhanden sind ${options.map((option) => option.id).join(", ")}`);
    }
  }
  const duplicate = wanted.find((id, index) => wanted.indexOf(id) !== index);
  if (duplicate) throw new Error(`SYSTEM_PROMPT_DEFAULT nennt ${duplicate} mehrfach`);
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
    if (!option) throw new Error(`Der Systemprompt ${id} ist nicht mehr konfiguriert`);
    return option;
  });
};
