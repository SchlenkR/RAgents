import { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isEnvironmentReference } from "./config-definition.js";
import { profileFileName } from "./config-file.js";
import { defaultDataDirectory } from "./data-directory.js";
import { hostRoot } from "./host-version.js";

export interface ProfileTarget {
  readonly profile: string;
  readonly profileFile: string;
  readonly port: number;
  readonly dataDirectory: string;
  readonly baseUrl: string;
}

export interface LocalProfile {
  readonly profile: string;
  readonly profileFile: string;
}

const PROFILE_FILE = /^ragents\.config\.([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;

/** pnpm and the bin command run the scripts with the working directory apps/server; a relative path still applies from the caller. */
export const callerDirectory = (): string => process.env.RAGENTS_CWD ?? process.env.INIT_CWD ?? process.cwd();

/** A profile is a name next to the host (checkout as well as package) or a path to a ragents.config.<profile>.ts anywhere. */
export const localProfile = (selection: string, root = hostRoot(), caller = callerDirectory()): LocalProfile | undefined => {
  if (!selection.includes("/") && !selection.endsWith(".ts")) {
    const file = path.join(root, profileFileName(selection));
    return statSync(file, { throwIfNoEntry: false })?.isFile() ? { profile: selection, profileFile: file } : undefined;
  }
  const profileFile = path.resolve(caller, selection);
  const match = PROFILE_FILE.exec(path.basename(profileFile));
  if (!match) throw new Error(`A profile file is named ragents.config.<profile>.ts, not ${path.basename(profileFile)}`);
  if (!statSync(profileFile, { throwIfNoEntry: false })?.isFile()) throw new Error(`The profile file is missing: ${profileFile}`);
  return { profile: match[1]!, profileFile };
};

/** Port and data folder of a profile, as the server determines them itself later: environment before profile file before default. */
export const readProfileTarget = async (profile: string, profileFile: string, environment = process.env): Promise<ProfileTarget> => {
  if (!statSync(profileFile, { throwIfNoEntry: false })?.isFile()) throw new Error(`The profile file is missing: ${profileFile}`);
  const module = await import(pathToFileURL(profileFile).href) as { config: { host: { PORT?: number; DATA_DIR?: unknown } } };
  const port = Number(environment.PORT || module.config.host.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`host.PORT of profile ${profile} is not a valid port number.`);
  const configured = module.config.host.DATA_DIR;
  if (isEnvironmentReference(configured) && environment.DATA_DIR === undefined && environment[configured.name] === undefined) {
    throw new Error(`host.DATA_DIR of profile ${profile} refers to the unset environment variable ${configured.name}.`);
  }
  const fromFile = isEnvironmentReference(configured) ? environment[configured.name] : typeof configured === "string" ? configured : undefined;
  const dataDirectory = path.resolve(environment.DATA_DIR ?? fromFile ?? defaultDataDirectory(profile));
  return { profile, profileFile, port, dataDirectory, baseUrl: `http://localhost:${port}` };
};

/** The one resolution for all commands: name or path of the profile, then port and data folder as in the server. */
export const selectProfileTarget = async (selection: string, root = hostRoot(), environment = process.env): Promise<ProfileTarget> => {
  const own = localProfile(selection, root);
  if (!own) throw new Error(`The profile file is missing: ${path.join(root, profileFileName(selection))}`);
  return readProfileTarget(own.profile, own.profileFile, environment);
};
