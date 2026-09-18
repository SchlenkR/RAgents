import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { ActorProgramFile, StartEntryContribution } from "@aicontainer/ragents";
import { flag, frontMatterOf, numberOf, tagsOf } from "./front-matter.js";

export type ScriptStartEntry = Extract<StartEntryContribution, { action: "script" }>;

const PACKAGE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const RUN_FIELDS = ["title", "description", "order", "guide", "tags", "coordinator"];

const requiredFile = (directory: string, name: string): string => {
  const file = path.join(directory, name);
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) throw new Error(`Dem Run-Script ${directory} fehlt die Datei ${name}`);
  return file;
};

const packageFiles = (directory: string, relative = ""): ActorProgramFile[] =>
  readdirSync(path.join(directory, relative), {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      if (["node_modules", "dist"].includes(entry.name) || entry.name.startsWith(".")) return [];
      if (!relative && ["actors", "RUN.md"].includes(entry.name)) return [];
      const filePath = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) return packageFiles(directory, filePath);
      if (!entry.isFile()) throw new Error(`${directory}: ${filePath} ist keine reguläre Paketdatei`);
      return [{path: filePath, content: readFileSync(path.join(directory, filePath), "utf8")}];
    });

const filesOf = (directory: string): ActorProgramFile[] => {
  requiredFile(directory, "package.json");
  return packageFiles(directory);
};

const runScriptFrom = (directory: string, name: string, id: string): ScriptStartEntry => {
  if (!PACKAGE_NAME.test(name))
    throw new Error(`${directory}: der Ordnername ${name} ist kein Handle (Kleinbuchstaben, Ziffern, Bindestrich)`);
  const runFile = requiredFile(directory, "RUN.md");
  const {fields} = frontMatterOf(runFile, readFileSync(runFile, "utf8"), "title und description");
  const unknown = [...fields.keys()].filter((key) => !RUN_FIELDS.includes(key));
  if (unknown.length > 0) throw new Error(`${runFile}: unbekannte Kopfzeilen ${unknown.join(", ")}`);
  const title = fields.get("title");
  const description = fields.get("description");
  if (!title) throw new Error(`${runFile}: title fehlt`);
  if (!description) throw new Error(`${runFile}: description fehlt`);
  const order = numberOf(runFile, "order", fields.get("order"));
  const guide = fields.get("guide");
  const tags = tagsOf(runFile, fields.get("tags"));
  const programsDirectory = path.join(directory, "actors");
  const programsStats = statSync(programsDirectory, {throwIfNoEntry: false});
  if (programsStats && !programsStats.isDirectory()) throw new Error(`${programsDirectory} muss ein Verzeichnis sein`);
  const programs = programsStats ? readdirSync(programsDirectory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      if (!entry.isDirectory() || !PACKAGE_NAME.test(entry.name))
        throw new Error(`${programsDirectory}: ${entry.name} ist kein Actor-Programm-Ordner`);
      return {name: entry.name, files: filesOf(path.join(programsDirectory, entry.name))};
    }) : [];
  return {
    id, action: "script", title, description,
    ...(order !== undefined ? {order} : {}),
    ...(guide ? {guide} : {}),
    ...(tags !== undefined ? {tags} : {}),
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
  catch (error) { throw new Error(`Das Run-Script-Verzeichnis ${resolved} ist nicht lesbar (${error instanceof Error ? error.message : String(error)})`); }
  const packages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const stray = entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
  if (stray.length > 0) throw new Error(`${resolved} enthält Dateien statt Run-Script-Ordner: ${stray.join(", ")}`);
  if (packages.length === 0) throw new Error(`${resolved} enthält keinen Run-Script-Ordner`);
  return packages.map((name) => runScriptFrom(path.join(resolved, name), name, `${idPrefix}.${name}`));
};

export const runScriptFromDirectory = (directory: string): ScriptStartEntry => {
  if (!path.isAbsolute(directory)) throw new Error("Das Run-Script-Paket braucht einen absoluten Serverdateipfad");
  const resolved = path.resolve(directory);
  return runScriptFrom(resolved, path.basename(resolved), `local.${path.basename(resolved)}`);
};
