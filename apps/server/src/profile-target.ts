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

/** pnpm und der bin-Befehl führen die Skripte mit dem Arbeitsverzeichnis apps/server aus; ein relativer Pfad gilt trotzdem ab dem Aufrufer. */
export const callerDirectory = (): string => process.env.RAGENTS_CWD ?? process.env.INIT_CWD ?? process.cwd();

/** Ein Profil ist ein Name neben dem Host (Checkout wie Paket) oder ein Pfad zu einer ragents.config.<profil>.ts an beliebiger Stelle. */
export const localProfile = (selection: string, root = hostRoot(), caller = callerDirectory()): LocalProfile | undefined => {
  if (!selection.includes("/") && !selection.endsWith(".ts")) {
    const file = path.join(root, profileFileName(selection));
    return statSync(file, { throwIfNoEntry: false })?.isFile() ? { profile: selection, profileFile: file } : undefined;
  }
  const profileFile = path.resolve(caller, selection);
  const match = PROFILE_FILE.exec(path.basename(profileFile));
  if (!match) throw new Error(`Eine Profildatei heißt ragents.config.<profil>.ts, nicht ${path.basename(profileFile)}`);
  if (!statSync(profileFile, { throwIfNoEntry: false })?.isFile()) throw new Error(`Die Profildatei fehlt: ${profileFile}`);
  return { profile: match[1]!, profileFile };
};

/** Port und Datenordner eines Profils, wie der Server sie später selbst bestimmt: Umgebung vor Profildatei vor Vorgabe. */
export const readProfileTarget = async (profile: string, profileFile: string, environment = process.env): Promise<ProfileTarget> => {
  if (!statSync(profileFile, { throwIfNoEntry: false })?.isFile()) throw new Error(`Die Profildatei fehlt: ${profileFile}`);
  const module = await import(pathToFileURL(profileFile).href) as { config: { host: { PORT?: number; DATA_DIR?: unknown } } };
  const port = Number(environment.PORT || module.config.host.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`host.PORT des Profils ${profile} ist keine gültige Portnummer.`);
  const configured = module.config.host.DATA_DIR;
  if (isEnvironmentReference(configured) && environment.DATA_DIR === undefined && environment[configured.name] === undefined) {
    throw new Error(`host.DATA_DIR des Profils ${profile} verweist auf die nicht gesetzte Umgebungsvariable ${configured.name}.`);
  }
  const fromFile = isEnvironmentReference(configured) ? environment[configured.name] : typeof configured === "string" ? configured : undefined;
  const dataDirectory = path.resolve(environment.DATA_DIR ?? fromFile ?? defaultDataDirectory(profile));
  return { profile, profileFile, port, dataDirectory, baseUrl: `http://localhost:${port}` };
};

/** Die eine Auflösung für alle Befehle: Name oder Pfad zum Profil, danach Port und Datenordner wie beim Server. */
export const selectProfileTarget = async (selection: string, root = hostRoot(), environment = process.env): Promise<ProfileTarget> => {
  const own = localProfile(selection, root);
  if (!own) throw new Error(`Die Profildatei fehlt: ${path.join(root, profileFileName(selection))}`);
  return readProfileTarget(own.profile, own.profileFile, environment);
};
