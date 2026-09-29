// The hook resolves @ragents/* also for a profile file outside the host; in the package there is no node_modules there.
import "../../apps/server/src/host-resolution.ts";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ragentsDataRoot } from "../../apps/server/src/data-directory.ts";
import { localProfile } from "../../apps/server/src/profile-target.ts";
import { startCached, startProfile, type CachedProfile } from "./connect.ts";

const usage = (): string => `Usage: ragents start <profile|path> [--port <n>]
Starts a profile of this host (core, developer, showcase), your own ragents.config.<profile>.ts at
any location or a version that ragents connect has already fetched, without asking the server.
The web app comes ready-made with the host, the same for every profile.`;

export const parseArguments = (argv: readonly string[]): { selection: string; port: number | undefined } => {
  let profile: string | undefined;
  let port: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--port") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`--port needs an integer from 0 to 65535, not ${argv[index + 1]}`);
      port = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-") || profile) throw new Error(`Unknown argument: ${argument}\n${usage()}`);
    profile = argument;
  }
  if (!profile) throw new Error(`The profile name is missing.\n${usage()}`);
  return { selection: profile, port };
};

const directories = async (folder: string): Promise<readonly string[]> =>
  (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

/** All versions that connect has left in this data folder. */
export const cachedProfiles = async (dataRoot: string): Promise<readonly CachedProfile[]> => {
  const remote = path.join(dataRoot, "remote");
  const found: CachedProfile[] = [];
  for (const server of await directories(remote)) {
    for (const profile of await directories(path.join(remote, server))) {
      const file = path.join(remote, server, profile, "current.json");
      const content = await readFile(file, "utf8").catch(() => undefined);
      if (content !== undefined) found.push(JSON.parse(content) as CachedProfile);
    }
  }
  return found.sort((left, right) => `${left.profile} ${left.serverUrl}`.localeCompare(`${right.profile} ${right.serverUrl}`, "en"));
};

export const selectCachedProfile = (cached: readonly CachedProfile[], profile: string): CachedProfile => {
  const matching = cached.filter((entry) => entry.profile === profile);
  if (matching.length === 1) return matching[0]!;
  if (matching.length === 0) {
    const known = cached.map((entry) => `${entry.profile} (${entry.serverUrl})`);
    throw new Error(`The profile ${profile} is not in the cache. `
      + (known.length ? `Fetched are: ${known.join(", ")}.` : "No profile has been fetched yet; fetch it with ragents connect <server-url>."));
  }
  throw new Error(`The profile ${profile} comes from several servers (${matching.map((entry) => entry.serverUrl).join(", ")}); `
    + "use ragents connect <server-url>.");
};

const main = async (): Promise<void> => {
  const arguments_ = parseArguments(process.argv.slice(2));
  const own = localProfile(arguments_.selection);
  if (own) {
    console.log(`== Profile ${own.profile}`);
    console.log(`== Profile file ${own.profileFile}`);
    process.exitCode = await startProfile({ profile: own.profile, profileFile: own.profileFile, port: arguments_.port });
    return;
  }
  const cached = selectCachedProfile(await cachedProfiles(ragentsDataRoot()), arguments_.selection);
  console.log(`== Profile ${cached.profile} from server ${cached.serverUrl}, version ${cached.version.slice(0, 12)} (from cache)`);
  console.log(`== Profile file ${cached.profileFile}`);
  console.log(`== Data ${cached.dataDirectory}`);
  process.exitCode = await startCached(cached, arguments_.port);
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
