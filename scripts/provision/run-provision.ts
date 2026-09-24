import "../../apps/server/src/host-resolution.ts";
import { readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hostDataDirectory } from "@ragents/workspace-executor/src/tools.ts";
import { loadConfigFile, profileFileName } from "../../apps/server/src/config-file.ts";
import { callerDirectory, localProfile } from "../../apps/server/src/profile-target.ts";
import { reportMissingEnvironment } from "../../apps/server/src/missing-environment.ts";
import { resolvePluginEntries } from "../../apps/server/src/profile/plugin-discovery.ts";
import {
  provisionPlugins,
  provisionWorkspace,
  type PluginProvisionReport,
} from "../../apps/server/src/profile/provisioning.ts";

const PROFILE_FILE = /^ragents\.config\.([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const usage = (): string => `Verwendung: pnpm provision [<profil>|<pfad zu ragents.config.<profil>.ts>|--workspace]
Provisioniert die Werkzeuge der Plugins eines Profils nach <Datenordner>/tools/<plugin-id>/ und
berichtet je Plugin bereit, installiert oder fehlt. --workspace provisioniert stattdessen
Sprachserver und Browser eines Arbeitsplatzes auf dieser Maschine. Ein relativer Pfad gilt ab dem
aufrufenden Ordner; ohne Argument gilt das Profil aus der Umgebung (PRODUCT_PROFILE_FILE oder
PRODUCT_PROFILE).`;

const availableProfiles = (): readonly string[] => readdirSync(repositoryRoot)
  .map((name) => PROFILE_FILE.exec(name)?.[1])
  .filter((name): name is string => name !== undefined && name !== "example")
  .sort();

/** Ein Name gilt neben dem Host, ein Pfad ab dem Aufrufer, wie bei ragents start. */
export const selectedProfile = (selection: string, root = repositoryRoot, caller = callerDirectory()): { profile: string; file: string } => {
  const own = localProfile(selection, root, caller);
  if (!own) throw new Error(`Konfiguration fehlt: ${path.join(root, profileFileName(selection))}`);
  return { profile: own.profile, file: own.profileFile };
};

const forProfile = async (selection: string): Promise<readonly PluginProvisionReport[]> => {
  const { profile, file } = selectedProfile(selection);
  process.env.PRODUCT_PROFILE = profile;
  process.env.PRODUCT_PROFILE_FILE = file;
  await loadConfigFile();
  const { config } = await import("../../apps/server/src/config.ts");
  console.log(`== Provisionierung Profil ${profile} (${file})`);
  console.log(`== Werkzeuge unter ${path.join(config.dataDir, "tools")}`);
  return provisionPlugins(resolvePluginEntries(config.plugins), config.dataDir, (line) => console.log(line));
};

const forWorkspace = (): Promise<readonly PluginProvisionReport[]> => {
  console.log("== Provisionierung Arbeitsplatz");
  console.log(`== Werkzeuge unter ${path.join(hostDataDirectory(), "tools")}`);
  return provisionWorkspace((line) => console.log(line));
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (argv.length > 1 || argv.some((argument) => argument.startsWith("-") && argument !== "--workspace")) {
    throw new Error(`Unerwartete Argumente: ${argv.join(" ")}\n${usage()}`);
  }
  const selection = argv[0] ?? process.env.PRODUCT_PROFILE_FILE ?? process.env.PRODUCT_PROFILE;
  if (!selection) throw new Error(`Kein Profil genannt; im Repository liegen ${availableProfiles().join(", ")}.\n${usage()}`);
  const reports = selection === "--workspace" ? await forWorkspace() : await forProfile(selection);
  if (reports.length === 0) console.log("Kein Plugin bringt eine Provisionierung mit.");
  if (reports.some((report) => report.outcome === "missing")) process.exitCode = 1;
};

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    reportMissingEnvironment(error, (line) => console.error(line));
    process.exit(1);
  });
}
