import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseServerUrl } from "./settings";

/** Where the extension connects to: a server (sign-in there; if it distributes a profile, the host runs locally) or, for developers, a profile it starts itself. */
export type Connection =
  | { kind: "server"; name: string; url: string }
  | { kind: "profile"; name: string; profileFile: string };

const PROFILE_FILE = /^ragents\.config\.([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;

export const expandHome = (value: string): string => value.startsWith("~/") || value === "~" ? path.join(homedir(), value.slice(1)) : value;

export const profileNameOf = (profileFile: string): string => {
  const match = PROFILE_FILE.exec(path.basename(profileFile));
  if (!match) throw new Error(`A profile file is named ragents.config.<profile>.ts, not ${path.basename(profileFile)}`);
  return match[1]!;
};

export const parseConnectionName = (value: unknown, location = "name"): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new Error(`${location} needs 1 to 80 characters`);
  return value.trim();
};

const parseConnection = (value: unknown, index: number, names: Set<string>): Connection => {
  const location = `ragents.connections[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} is not an object`);
  const entry = value as Record<string, unknown>;
  const name = parseConnectionName(entry.name, `${location}.name`);
  if (names.has(name)) throw new Error(`${location}: the name ${name} is a duplicate`);
  names.add(name);
  const keys = Object.keys(entry).filter((key) => key !== "kind");
  if (entry.kind !== undefined && !["server", "running", "profile"].includes(String(entry.kind))) throw new Error(`${location}.kind is unknown: ${String(entry.kind)}`);
  if ("profileFile" in entry) {
    const unknown = keys.find((key) => !["name", "profileFile"].includes(key));
    if (unknown) throw new Error(`${location} allows only name and profileFile for a profile, not ${unknown}`);
    if (typeof entry.profileFile !== "string" || !entry.profileFile.trim()) throw new Error(`${location}.profileFile is missing`);
    const profileFile = path.resolve(expandHome(entry.profileFile.trim()));
    try { profileNameOf(profileFile); }
    catch (cause) { throw new Error(`${location}.profileFile: ${cause instanceof Error ? cause.message : String(cause)}`); }
    return { kind: "profile", name, profileFile };
  }
  const unknown = keys.find((key) => !["name", "url"].includes(key));
  if (unknown) throw new Error(`${location} allows only name and url for a server, not ${unknown}`);
  let url: string;
  try { url = parseServerUrl(entry.url); }
  catch (cause) { throw new Error(`${location}.url: ${cause instanceof Error ? cause.message : String(cause)}`); }
  return { kind: "server", name, url };
};

export const parseConnections = (value: unknown): Connection[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("ragents.connections must be a list");
  const names = new Set<string>();
  return value.map((entry, index) => parseConnection(entry, index, names));
};

/** The key in the SecretStorage: the bearer token the extension identifies itself with at the server. */
export const connectionSecretKey = (connection: Connection): string | undefined =>
  connection.kind === "server" ? `ragents.token:${connection.url}` : undefined;

/** The key in the SecretStorage: user and password the extension uses to sign in to the server silently. */
export const credentialsSecretKey = (connection: Connection): string | undefined =>
  connection.kind === "server" ? `ragents.login:${connection.url}` : undefined;

/** An entry as it appears in ragents.connections; the setting knows only name and url or profileFile. */
export const connectionSetting = (connection: Connection): Record<string, string> =>
  connection.kind === "server" ? { name: connection.name, url: connection.url } : { name: connection.name, profileFile: connection.profileFile };

export const describeConnection = (connection: Connection): string =>
  connection.kind === "profile" ? `Profile ${profileNameOf(connection.profileFile)} (${connection.profileFile})` : connection.url;

/** The host of a server as the target line names it: without scheme and path, with port only if it is not the default. */
export const serverHost = (url: string): string => new URL(url).host;

/** What the line of a server shows: its address or the path of its profile file. */
export const connectionAddress = (connection: Connection): string =>
  connection.kind === "profile" ? connection.profileFile : connection.url;

/** The profile files in the host folder; the settings dialog offers them, without a host the list stays empty. */
export const profileFilesIn = (hostPath: string | undefined): string[] => {
  if (hostPath === undefined) return [];
  try {
    return readdirSync(hostPath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && PROFILE_FILE.test(entry.name))
      .map((entry) => path.join(hostPath, entry.name))
      .sort();
  } catch {
    return [];
  }
};

/** Does the profile file exist? Otherwise a server with a path to nowhere only fails when starting. */
export const isProfileFile = (profileFile: string): boolean =>
  statSync(profileFile, { throwIfNoEntry: false })?.isFile() === true;

/** Where the servers are stored: in the workspace if it holds the list, otherwise at the user level. Arrays do not merge, the narrower scope wins entirely. */
export interface ConnectionsLocation {
  readonly scope: "global" | "workspace";
  readonly entries: readonly unknown[];
}

export const connectionsLocation = (inspected: { workspaceValue?: unknown; globalValue?: unknown } | undefined): ConnectionsLocation =>
  Array.isArray(inspected?.workspaceValue)
    ? { scope: "workspace", entries: inspected.workspaceValue }
    : { scope: "global", entries: Array.isArray(inspected?.globalValue) ? inspected.globalValue : [] };

export const isHostRoot = (candidate: string): boolean =>
  statSync(path.join(candidate, "package.json"), { throwIfNoEntry: false })?.isFile() === true
  && statSync(path.join(candidate, "apps/server/src/main.ts"), { throwIfNoEntry: false })?.isFile() === true;

/** The host from the setting or the repo of the extension; without either, it fetches the package @schlenkr/ragents itself. */
export const resolveHostPath = (configured: unknown, extensionPath: string): string | undefined => {
  if (configured !== undefined && configured !== "" && typeof configured !== "string") throw new Error("ragents.hostPath must be a path");
  const setting = typeof configured === "string" ? configured.trim() : "";
  if (!setting) {
    const repository = path.resolve(extensionPath, "../..");
    return isHostRoot(repository) ? repository : undefined;
  }
  const candidate = path.resolve(expandHome(setting));
  if (!isHostRoot(candidate)) {
    throw new Error(`${candidate} is not a RAgents host (package.json and apps/server/src/main.ts expected); `
      + "set ragents.hostPath to a checkout or to the package @schlenkr/ragents");
  }
  return candidate;
};
