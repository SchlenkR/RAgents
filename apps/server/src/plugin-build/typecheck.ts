import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { HostApiHalf } from "../host-api.js";
import { hostRoot } from "../host-version.js";
import { PLUGIN_DESCRIPTION_FILE, sourceFileOf, type PluginSource } from "./plugin-description.js";

/** The host's compiler settings for plugin code anywhere on disk; authors may extend the same file for their editor. */
export const PLUGIN_TSCONFIG: Readonly<Record<HostApiHalf, string>> = {
  server: "apps/server/tsconfig.plugin.json",
  web: "apps/web/tsconfig.plugin.json",
};

/** The files a half starts from: its entry, the provisioning for the server, and the declared exports. */
export const halfEntries = (source: PluginSource, half: HostApiHalf): readonly string[] => {
  const own = half === "server" ? ["server/index", "provision"] : ["web/index"];
  return [...own, ...source.description.exports[half]]
    .map((name) => sourceFileOf(path.join(source.folder, name)))
    .filter((file): file is string => file !== undefined);
};

const configOptions = (file: string): ts.CompilerOptions => {
  const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    },
  });
  if (!parsed) throw new Error(`${file} ist keine gültige tsconfig`);
  return parsed.options;
};

/** Plugins beside the built ones can be imported by id; the host's own resolve through the plugin tsconfig. */
const siblingPaths = (sources: readonly PluginSource[]): ts.MapLike<string[]> => {
  const parents = [...new Set(sources.map((source) => path.dirname(source.folder)))];
  return Object.fromEntries(parents.flatMap((parent) => readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(parent, entry.name, PLUGIN_DESCRIPTION_FILE)))
    .map((entry) => [`@ragents/plugins/${entry.name}/*`, [path.join(parent, entry.name, "*")]])));
};

const inside = (folder: string, file: string): boolean => file.startsWith(folder + path.sep);

/** Type errors per plugin id; one program per half covers all given plugins, errors in host files stay the host's. */
export const typecheckPlugins = (sources: readonly PluginSource[], root = hostRoot()): ReadonlyMap<string, readonly string[]> => {
  const problems = new Map<string, string[]>(sources.map((source) => [source.description.id, []]));
  for (const half of ["server", "web"] as const) {
    const rootNames = sources.flatMap((source) => halfEntries(source, half));
    if (rootNames.length === 0) continue;
    const base = configOptions(path.join(root, PLUGIN_TSCONFIG[half]));
    const options: ts.CompilerOptions = { ...base, noEmit: true, paths: { ...base.paths, ...siblingPaths(sources) } };
    const program = ts.createProgram({ rootNames, options });
    for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
      const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      const file = diagnostic.file?.fileName ? path.resolve(diagnostic.file.fileName) : undefined;
      if (!file) {
        for (const list of problems.values()) list.push(`${half}: ${text}`);
        continue;
      }
      const owner = sources.find((source) => inside(source.folder, file));
      if (!owner) continue;
      const { line, character } = diagnostic.file!.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      problems.get(owner.description.id)!.push(`${path.relative(owner.folder, file)}:${line + 1}:${character + 1}: ${text}`);
    }
  }
  return problems;
};
