import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ActorProgramFile, JsonValue, StartEntryContribution } from "@ragents/engine";
import { flag, frontMatterOf, numberOf, tagsOf } from "./front-matter.js";

export type ScriptStartEntry = Extract<StartEntryContribution, { action: "script" }>;

const PACKAGE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const RUN_FIELDS = ["title", "description", "order", "guide", "tags", "coordinator", "category", "fixed-start-options"];

const requiredFile = (directory: string, name: string): string => {
  const file = path.join(directory, name);
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`The run script ${directory} is missing the file ${name}`);
  return file;
};

/** The header line fixed-start-options is a JSON object on one line: start option id to fixed value. */
const fixedStartOptionsOf = (file: string, value: string | undefined): Readonly<Record<string, JsonValue>> | undefined => {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch (error) { throw new Error(`${file}: fixed-start-options is not JSON (${error instanceof Error ? error.message : String(error)})`); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file}: fixed-start-options must be a JSON object of start option id and value`);
  }
  return parsed as Record<string, JsonValue>;
};

const packageFiles = (directory: string, relative = ""): ActorProgramFile[] =>
  readdirSync(path.join(directory, relative), {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (["node_modules", "dist"].includes(entry.name) || entry.name.startsWith(".")) return [];
      if (!relative && ["actors", "RUN.md"].includes(entry.name)) return [];
      const filePath = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) return packageFiles(directory, filePath);
      if (!entry.isFile()) throw new Error(`${directory}: ${filePath} is not a regular package file`);
      return [{path: filePath, content: readFileSync(path.join(directory, filePath), "utf8")}];
    });

const filesOf = (directory: string): ActorProgramFile[] => {
  requiredFile(directory, "package.json");
  return packageFiles(directory);
};

const runScriptFrom = (directory: string, name: string, id: string): ScriptStartEntry => {
  if (!PACKAGE_NAME.test(name))
    throw new Error(`${directory}: the folder name ${name} is not a handle (lowercase letters, digits, hyphen)`);
  const runFile = requiredFile(directory, "RUN.md");
  const {fields} = frontMatterOf(runFile, readFileSync(runFile, "utf8"), "title and description");
  const unknown = [...fields.keys()].filter((key) => !RUN_FIELDS.includes(key));
  if (unknown.length > 0) throw new Error(`${runFile}: unknown header lines ${unknown.join(", ")}`);
  const title = fields.get("title");
  const description = fields.get("description");
  if (!title) throw new Error(`${runFile}: title is missing`);
  if (!description) throw new Error(`${runFile}: description is missing`);
  const order = numberOf(runFile, "order", fields.get("order"));
  const guide = fields.get("guide");
  const tags = tagsOf(runFile, fields.get("tags"));
  const category = fields.get("category");
  if (category !== undefined && !category.trim()) throw new Error(`${runFile}: category is empty`);
  const fixedStartOptions = fixedStartOptionsOf(runFile, fields.get("fixed-start-options"));
  const programsDirectory = path.join(directory, "actors");
  const programsStats = statSync(programsDirectory, {throwIfNoEntry: false});
  if (programsStats && !programsStats.isDirectory()) throw new Error(`${programsDirectory} must be a directory`);
  const programs = programsStats ? readdirSync(programsDirectory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      if (!entry.isDirectory() || !PACKAGE_NAME.test(entry.name))
        throw new Error(`${programsDirectory}: ${entry.name} is not an actor program folder`);
      return {name: entry.name, files: filesOf(path.join(programsDirectory, entry.name))};
    }) : [];
  return {
    id, action: "script", title, description,
    ...(order !== undefined ? {order} : {}),
    ...(guide ? {guide} : {}),
    ...(tags !== undefined ? {tags} : {}),
    ...(category ? {category} : {}),
    ...(fixedStartOptions !== undefined ? {fixedStartOptions} : {}),
    script: {
      handle: name,
      coordinator: flag(runFile, "coordinator", fields.get("coordinator"), true),
      files: filesOf(directory),
      programs,
    },
  };
};

export const runScriptsFromDirectory = (directory: string, idPrefix: string): readonly ScriptStartEntry[] => {
  const resolved = path.resolve(directory);
  let entries;
  try { entries = readdirSync(resolved, {withFileTypes: true}); }
  catch (error) { throw new Error(`The run script directory ${resolved} is not readable (${error instanceof Error ? error.message : String(error)})`); }
  const packages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const stray = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  if (stray.length > 0) throw new Error(`${resolved} contains files instead of run script folders: ${stray.join(", ")}`);
  if (packages.length === 0) throw new Error(`${resolved} contains no run script folder`);
  return packages.map((name) => runScriptFrom(path.join(resolved, name), name, `${idPrefix}.${name}`));
};

export const runScriptFromDirectory = (directory: string): ScriptStartEntry => {
  if (!path.isAbsolute(directory)) throw new Error("The run script package needs an absolute server file path");
  const resolved = path.resolve(directory);
  return runScriptFrom(resolved, path.basename(resolved), `local.${path.basename(resolved)}`);
};
