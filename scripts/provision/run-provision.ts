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

const usage = (): string => `Usage: pnpm provision [<profile>|<path to ragents.config.<profile>.ts>|--workspace]
Provisions the tools of a profile's plugins to <data folder>/tools/<plugin-id>/ and reports per
plugin ready, installed or missing. --workspace instead provisions the built-in plugins that
contribute to a workspace's executor. A relative path is resolved from the calling folder; without
an argument the profile from the environment applies (PRODUCT_PROFILE_FILE or PRODUCT_PROFILE).`;

const availableProfiles = (): readonly string[] => readdirSync(repositoryRoot)
  .map((name) => PROFILE_FILE.exec(name)?.[1])
  .filter((name): name is string => name !== undefined && name !== "example")
  .sort();

/** A name applies next to the host, a path from the caller, as with ragents start. */
export const selectedProfile = (selection: string, root = repositoryRoot, caller = callerDirectory()): { profile: string; file: string } => {
  const own = localProfile(selection, root, caller);
  if (!own) throw new Error(`Configuration is missing: ${path.join(root, profileFileName(selection))}`);
  return { profile: own.profile, file: own.profileFile };
};

const forProfile = async (selection: string): Promise<readonly PluginProvisionReport[]> => {
  const { profile, file } = selectedProfile(selection);
  process.env.PRODUCT_PROFILE = profile;
  process.env.PRODUCT_PROFILE_FILE = file;
  await loadConfigFile();
  const { config } = await import("../../apps/server/src/config.ts");
  console.log(`== Provisioning profile ${profile} (${file})`);
  console.log(`== Tools under ${path.join(config.dataDir, "tools")}`);
  return provisionPlugins(resolvePluginEntries(config.plugins), config.dataDir, (line) => console.log(line));
};

const forWorkspace = (): Promise<readonly PluginProvisionReport[]> => {
  console.log("== Provisioning workspace");
  console.log(`== Tools under ${path.join(hostDataDirectory(), "tools")}`);
  return provisionWorkspace((line) => console.log(line));
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (argv.length > 1 || argv.some((argument) => argument.startsWith("-") && argument !== "--workspace")) {
    throw new Error(`Unexpected arguments: ${argv.join(" ")}\n${usage()}`);
  }
  const selection = argv[0] ?? process.env.PRODUCT_PROFILE_FILE ?? process.env.PRODUCT_PROFILE;
  if (!selection) throw new Error(`No profile named; the repository contains ${availableProfiles().join(", ")}.\n${usage()}`);
  const reports = selection === "--workspace" ? await forWorkspace() : await forProfile(selection);
  if (reports.length === 0) console.log("No plugin brings a provisioning.");
  if (reports.some((report) => report.outcome === "missing")) process.exitCode = 1;
};

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    reportMissingEnvironment(error, (line) => console.error(line));
    process.exit(1);
  });
}
