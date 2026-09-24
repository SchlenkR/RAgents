// Der Hook löst @ragents/* auch für eine Profildatei außerhalb des Hosts auf; im Paket gibt es dort kein node_modules.
import "../../apps/server/src/host-resolution.ts";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ragentsDataRoot } from "../../apps/server/src/data-directory.ts";
import { localProfile } from "../../apps/server/src/profile-target.ts";
import { startCached, startProfile, type CachedProfile } from "./connect.ts";

const usage = (): string => `Verwendung: ragents start <profil|pfad> [--port <n>]
Startet ein Profil dieses Hosts (core, developer, showcase), eine eigene ragents.config.<profil>.ts an
beliebiger Stelle oder einen Stand, den ragents connect schon geholt hat, ohne den Server zu
fragen. Das Web kommt fertig mit dem Host, für jedes Profil dasselbe.`;

export const parseArguments = (argv: readonly string[]): { selection: string; port: number | undefined } => {
  let profile: string | undefined;
  let port: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--port") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`--port braucht eine ganze Zahl von 0 bis 65535, nicht ${argv[index + 1]}`);
      port = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("-") || profile) throw new Error(`Unbekanntes Argument: ${argument}\n${usage()}`);
    profile = argument;
  }
  if (!profile) throw new Error(`Der Profilname fehlt.\n${usage()}`);
  return { selection: profile, port };
};

const directories = async (folder: string): Promise<readonly string[]> =>
  (await readdir(folder, { withFileTypes: true }).catch(() => [])).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

/** Alle Stände, die connect in diesem Datenordner hinterlassen hat. */
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
    throw new Error(`Das Profil ${profile} liegt nicht im Cache. `
      + (known.length ? `Geholt sind: ${known.join(", ")}.` : "Es ist noch kein Profil geholt; hol es mit ragents connect <server-url>."));
  }
  throw new Error(`Das Profil ${profile} kommt von mehreren Servern (${matching.map((entry) => entry.serverUrl).join(", ")}); `
    + "nimm ragents connect <server-url>.");
};

const main = async (): Promise<void> => {
  const arguments_ = parseArguments(process.argv.slice(2));
  const own = localProfile(arguments_.selection);
  if (own) {
    console.log(`== Profil ${own.profile}`);
    console.log(`== Profildatei ${own.profileFile}`);
    process.exitCode = await startProfile({ profile: own.profile, profileFile: own.profileFile, port: arguments_.port });
    return;
  }
  const cached = selectCachedProfile(await cachedProfiles(ragentsDataRoot()), arguments_.selection);
  console.log(`== Profil ${cached.profile} vom Server ${cached.serverUrl}, Stand ${cached.version.slice(0, 12)} (aus dem Cache)`);
  console.log(`== Profildatei ${cached.profileFile}`);
  console.log(`== Daten ${cached.dataDirectory}`);
  process.exitCode = await startCached(cached, arguments_.port);
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
