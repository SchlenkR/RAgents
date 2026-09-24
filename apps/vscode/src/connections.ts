import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseServerUrl } from "./settings";

/** Wohin sich die Erweiterung verbindet: ein Server (Anmeldung dort; verteilt er ein Profil, läuft der Host lokal) oder, für Entwickler, ein Profil, das sie selbst startet. */
export type Connection =
  | { kind: "server"; name: string; url: string }
  | { kind: "profile"; name: string; profileFile: string };

const PROFILE_FILE = /^ragents\.config\.([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;

export const expandHome = (value: string): string => value.startsWith("~/") || value === "~" ? path.join(homedir(), value.slice(1)) : value;

export const profileNameOf = (profileFile: string): string => {
  const match = PROFILE_FILE.exec(path.basename(profileFile));
  if (!match) throw new Error(`Eine Profildatei heißt ragents.config.<profil>.ts, nicht ${path.basename(profileFile)}`);
  return match[1]!;
};

export const parseConnectionName = (value: unknown, location = "name"): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new Error(`${location} braucht 1 bis 80 Zeichen`);
  return value.trim();
};

const parseConnection = (value: unknown, index: number, names: Set<string>): Connection => {
  const location = `ragents.connections[${index}]`;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} ist kein Objekt`);
  const entry = value as Record<string, unknown>;
  const name = parseConnectionName(entry.name, `${location}.name`);
  if (names.has(name)) throw new Error(`${location}: der Name ${name} ist doppelt`);
  names.add(name);
  const keys = Object.keys(entry).filter((key) => key !== "kind");
  if (entry.kind !== undefined && !["server", "running", "profile"].includes(String(entry.kind))) throw new Error(`${location}.kind ist unbekannt: ${String(entry.kind)}`);
  if ("profileFile" in entry) {
    const unknown = keys.find((key) => !["name", "profileFile"].includes(key));
    if (unknown) throw new Error(`${location} erlaubt für ein Profil nur name und profileFile, nicht ${unknown}`);
    if (typeof entry.profileFile !== "string" || !entry.profileFile.trim()) throw new Error(`${location}.profileFile fehlt`);
    const profileFile = path.resolve(expandHome(entry.profileFile.trim()));
    try { profileNameOf(profileFile); }
    catch (cause) { throw new Error(`${location}.profileFile: ${cause instanceof Error ? cause.message : String(cause)}`); }
    return { kind: "profile", name, profileFile };
  }
  const unknown = keys.find((key) => !["name", "url"].includes(key));
  if (unknown) throw new Error(`${location} erlaubt für einen Server nur name und url, nicht ${unknown}`);
  let url: string;
  try { url = parseServerUrl(entry.url); }
  catch (cause) { throw new Error(`${location}.url: ${cause instanceof Error ? cause.message : String(cause)}`); }
  return { kind: "server", name, url };
};

export const parseConnections = (value: unknown): Connection[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("ragents.connections muss eine Liste sein");
  const names = new Set<string>();
  return value.map((entry, index) => parseConnection(entry, index, names));
};

/** Der Schlüssel in der SecretStorage: der Bearer-Token, mit dem die Erweiterung sich beim Server ausweist. */
export const connectionSecretKey = (connection: Connection): string | undefined =>
  connection.kind === "server" ? `ragents.token:${connection.url}` : undefined;

/** Der Schlüssel in der SecretStorage: Benutzer und Passwort, mit denen sich die Erweiterung still am Server anmeldet. */
export const credentialsSecretKey = (connection: Connection): string | undefined =>
  connection.kind === "server" ? `ragents.login:${connection.url}` : undefined;

/** Ein Eintrag so, wie er in ragents.connections steht; die Einstellung kennt nur name und url oder profileFile. */
export const connectionSetting = (connection: Connection): Record<string, string> =>
  connection.kind === "server" ? { name: connection.name, url: connection.url } : { name: connection.name, profileFile: connection.profileFile };

export const describeConnection = (connection: Connection): string =>
  connection.kind === "profile" ? `Profil ${profileNameOf(connection.profileFile)} (${connection.profileFile})` : connection.url;

/** Der Host eines Servers, wie die Zielzeile ihn nennt: ohne Schema und Pfad, mit Port nur, wenn er nicht der Standard ist. */
export const serverHost = (url: string): string => new URL(url).host;

/** Was die Zeile eines Servers zeigt: seine Adresse oder den Pfad seiner Profildatei. */
export const connectionAddress = (connection: Connection): string =>
  connection.kind === "profile" ? connection.profileFile : connection.url;

/** Die Profildateien im Host-Ordner; der Dialog der Einstellungen bietet sie an, ohne Host bleibt die Liste leer. */
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

/** Gibt es die Profildatei? Ein Server mit einem Pfad ins Leere scheitert sonst erst beim Starten. */
export const isProfileFile = (profileFile: string): boolean =>
  statSync(profileFile, { throwIfNoEntry: false })?.isFile() === true;

/** Wo die Server stehen: im Arbeitsbereich, wenn er die Liste führt, sonst beim Benutzer. Arrays mischen sich nicht, der engere Bereich gewinnt ganz. */
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

/** Der Host aus der Einstellung oder dem Repo der Erweiterung; ohne beides holt sie das Paket @schlenkr/ragents selbst. */
export const resolveHostPath = (configured: unknown, extensionPath: string): string | undefined => {
  if (configured !== undefined && configured !== "" && typeof configured !== "string") throw new Error("ragents.hostPath muss ein Pfad sein");
  const setting = typeof configured === "string" ? configured.trim() : "";
  if (!setting) {
    const repository = path.resolve(extensionPath, "../..");
    return isHostRoot(repository) ? repository : undefined;
  }
  const candidate = path.resolve(expandHome(setting));
  if (!isHostRoot(candidate)) {
    throw new Error(`${candidate} ist kein RAgents-Host (package.json und apps/server/src/main.ts erwartet); `
      + "ragents.hostPath auf einen Checkout oder auf das Paket @schlenkr/ragents setzen");
  }
  return candidate;
};
