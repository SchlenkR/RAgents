import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlugins, watchPlugins } from "../../apps/server/src/plugin-build/build.ts";
import { bundlesRoot, pluginsRoot } from "../../apps/server/src/plugin-support/plugins-root.ts";
import { printOutcome, untilStopped } from "./plugin-cli.ts";

/** Every plugin of the host that describes itself in ragents-plugin.json. */
export const builtInPluginFolders = (root = pluginsRoot): readonly string[] =>
  readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(root, entry.name, "ragents-plugin.json")))
    .map((entry) => path.join(root, entry.name))
    .sort();

/** Removes bundles whose plugin no longer exists, so that no id resolves to an orphan. */
const removeOrphans = async (folders: readonly string[]): Promise<void> => {
  const ids = new Set(folders.map((folder) => path.basename(folder)));
  const orphans = readdirSync(bundlesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !ids.has(entry.name));
  for (const orphan of orphans) {
    await rm(path.join(bundlesRoot, orphan.name), { recursive: true, force: true });
    console.log(`entfernt: ${orphan.name} (kein Quellordner mehr)`);
  }
};

// Ohne Typprüfung, weil pnpm -r typecheck die Quellen schon prüft; nur Veraltetes, damit laufende Server und parallele Bauläufe ihre Bundles behalten.
const main = async (argv: readonly string[]): Promise<number> => {
  const unknown = argv.filter((argument) => argument !== "--watch");
  if (unknown.length > 0) throw new Error(`Unbekanntes Argument: ${unknown.join(" ")} (erlaubt: --watch)`);
  const folders = builtInPluginFolders();
  if (argv.includes("--watch")) {
    const watching = await watchPlugins(folders, { out: bundlesRoot }, printOutcome);
    console.log(`beobachte ${folders.length} eingebaute Plugins; Strg+C beendet`);
    await untilStopped();
    await watching.stop();
    return 0;
  }
  const outcomes = await buildPlugins(folders, { out: bundlesRoot, typecheck: false, onlyOutdated: true });
  for (const outcome of outcomes) printOutcome(outcome);
  if (outcomes.length < folders.length) console.log(`aktuell: ${folders.length - outcomes.length} von ${folders.length} eingebauten Plugins, unverändert gelassen`);
  await removeOrphans(folders);
  return outcomes.every((outcome) => outcome.kind === "built") ? 0 : 1;
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
