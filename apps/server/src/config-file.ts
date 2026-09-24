import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pluginToolsDirectory } from "@ragents/workspace-executor/src/tools.ts";
import { isAccessRight, type AccessUser } from "../../../packages/ragents/src/access.js";
import {
  isEnvironmentReference,
  isProvisionedReference,
  type ConfigValue,
  type EnvironmentReference,
  type ProvisionedReference,
  type RAgentsConfig,
} from "./config-definition.js";
import { defaultDataDirectory } from "./data-directory.js";
import { MissingEnvironmentError } from "./missing-environment.js";
import { isPluginPath, pluginFolderFor } from "./plugin-support/plugins-root.js";

// Der Befund über eine fehlende Umgebungsvariable gehört zum Laden der Konfiguration; main.ts holt ihn darum von hier.
export { missingEnvironmentOf, reportMissingEnvironment } from "./missing-environment.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const SECRET_KEY_PATTERN = /(_PAT|_KEY|_TOKEN|_SECRET|_PASSWORD)$/;
const ENVIRONMENT_PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const START_ENTRY_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

interface ConfigFileEntry {
  section: string;
  key: string;
  value: string;
  viaReference: boolean;
  overriddenByEnvironment: boolean;
}

interface LoadedConfigFile {
  path: string;
  entries: readonly ConfigFileEntry[];
  users: readonly ResolvedProfileUser[] | undefined;
  anonymousUser: AccessUser | undefined;
  defaultStartEntry: string | undefined;
}

export interface ResolvedProfileUser extends AccessUser {
  readonly password: string;
  readonly token?: string;
}

const MIN_TOKEN_LENGTH = 16;
const MAX_TOKEN_LENGTH = 512;

const resolveUserToken = (
  location: string,
  raw: unknown,
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  if (raw === undefined) return undefined;
  if (!isEnvironmentReference(raw) || typeof raw.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.name)) {
    throw new Error(`${location}.token braucht env("ENV_NAME"); ein Token steht nie im Klartext in der Profildatei`);
  }
  // Ein Benutzer meldet sich weiter mit seinem Passwort an; ohne gesetzte Variable hat er nur keinen persönlichen Token.
  const token = environment[raw.name];
  if (!token) return undefined;
  // $ und ! sind tabu, weil der Verbraucher den Token als API-Schlüssel mit Vorlagen- und Befehlssyntax auswertet.
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH || !/^[\x21-\x7e]+$/.test(token) || /[$!]/.test(token)) {
    throw new Error(`${location}.token (${raw.name}) braucht ${MIN_TOKEN_LENGTH} bis ${MAX_TOKEN_LENGTH} druckbare ASCII-Zeichen ohne Leerzeichen, $ und !`);
  }
  return token;
};

const resolveIdentity = (location: string, entry: Record<string, unknown>): AccessUser => {
  if (typeof entry.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(entry.id)) {
    throw new Error(`${location}.id braucht 1 bis 64 Zeichen: Buchstaben, Ziffern, Punkt, Unterstrich oder Bindestrich`);
  }
  if (entry.label !== undefined && (typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 120)) {
    throw new Error(`${location}.label braucht 1 bis 120 Zeichen`);
  }
  if (!Array.isArray(entry.rights) || !entry.rights.every(isAccessRight)) {
    throw new Error(`${location}.rights braucht gültige Rechte als Strings oder "*" für alle Rechte`);
  }
  if (new Set(entry.rights).size !== entry.rights.length) throw new Error(`${location}.rights enthält doppelte Rechte`);
  if (entry.startEntries !== undefined && (!Array.isArray(entry.startEntries)
    || !entry.startEntries.every((id) => typeof id === "string" && START_ENTRY_ID.test(id))
    || new Set(entry.startEntries).size !== entry.startEntries.length)) {
    throw new Error(`${location}.startEntries braucht eindeutige Einstiegkennungen als Strings`);
  }
  return Object.freeze({
    id: entry.id,
    label: entry.label?.trim() ?? entry.id,
    rights: Object.freeze([...entry.rights]),
    ...(entry.startEntries ? { startEntries: Object.freeze([...entry.startEntries as string[]]) } : {}),
  });
};

export const resolveAnonymousUser = (source: string, raw: unknown): AccessUser | undefined => {
  if (raw === undefined) return undefined;
  const location = `${source}: anonymousUser`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${location} ist kein Benutzer`);
  const entry = raw as Record<string, unknown>;
  if (Object.keys(entry).some((key) => !["id", "label", "rights", "startEntries"].includes(key))) {
    throw new Error(`${location} erlaubt nur id, label, rights und startEntries`);
  }
  return resolveIdentity(location, entry);
};

/** Der Einstieg, den ein neuer Run ohne Auswahl nimmt; ob er registriert ist, prüft der PluginHost beim Start. */
export const resolveDefaultStartEntry = (source: string, raw: unknown): string | undefined => {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !START_ENTRY_ID.test(raw)) {
    throw new Error(`${source}: defaultStartEntry braucht eine Einstiegkennung als String, etwa "ragents.reference.word-game"`);
  }
  return raw;
};

export const resolveProfileUsers = (
  source: string,
  raw: unknown,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): readonly ResolvedProfileUser[] | undefined => {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${source}: users muss eine nicht leere Liste sein; ohne users ist die Anmeldung ausgeschaltet`);
  }
  const ids = new Set<string>();
  const tokens = new Map<string, string>();
  return raw.map((value: unknown, index: number) => {
    const location = `${source}: users[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} ist kein Benutzer`);
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !["id", "label", "password", "token", "rights", "startEntries"].includes(key))) {
      throw new Error(`${location} erlaubt nur id, label, password, token, rights und startEntries`);
    }
    const user = resolveIdentity(location, entry);
    if (ids.has(user.id)) throw new Error(`${location}.id ist doppelt: ${user.id}`);
    ids.add(user.id);
    if (typeof entry.password !== "string" && (!isEnvironmentReference(entry.password)
      || typeof entry.password.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.password.name))) {
      throw new Error(`${location}.password braucht einen Text oder env("ENV_NAME")`);
    }
    const password = typeof entry.password === "string" ? entry.password : environment[entry.password.name];
    if (!password || password.length > 2048) throw new Error(`${location}.password fehlt, ist leer oder länger als 2048 Zeichen`);
    const token = resolveUserToken(location, entry.token, environment);
    if (token !== undefined) {
      const other = tokens.get(token);
      if (other) throw new Error(`${location}.token ist derselbe wie bei Benutzer ${other}; jeder Token gehört genau einem Benutzer`);
      tokens.set(token, user.id);
    }
    return Object.freeze({ ...user, password, ...(token !== undefined ? { token } : {}) });
  });
};

export const listFromEnvironmentValue = (value: string): readonly string[] | undefined => {
  if (!value.startsWith("[")) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`Der Wert ${value} sieht aus wie eine Liste, ist aber keine Liste von Strings`);
  }
  return parsed as string[];
};

const materialize = (value: Exclude<ConfigValue, EnvironmentReference | ProvisionedReference>): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return JSON.stringify(value);
};

/** Der Datenordner des Hosts, in dessen tools/ die Provisionierung ihre Werkzeuge legt. */
const dataDirectoryOf = (source: string, raw: RAgentsConfig): string => {
  const configured = raw.host?.DATA_DIR;
  if (isEnvironmentReference(configured) && process.env[configured.name] === undefined) {
    throw new MissingEnvironmentError({ variable: configured.name, section: "host", key: "DATA_DIR" },
      `${source}: host.DATA_DIR verweist auf die nicht gesetzte Umgebungsvariable ${configured.name}`);
  }
  const fromFile = isEnvironmentReference(configured) ? process.env[configured.name] : typeof configured === "string" ? configured : undefined;
  const profile = process.env.PRODUCT_PROFILE;
  if (!profile) throw new Error(`${source}: ohne PRODUCT_PROFILE gibt es keinen Datenordner und damit keinen Werkzeugordner`);
  return path.resolve(process.env.DATA_DIR ?? fromFile ?? defaultDataDirectory(profile));
};

const entryFor = (source: string, section: string, key: string, value: ConfigValue, dataDirectory: () => string): ConfigFileEntry => {
  const overriddenByEnvironment = process.env[key] !== undefined;
  if (isProvisionedReference(value)) {
    const file = path.join(pluginToolsDirectory(dataDirectory(), value.plugin), ...value.path.split("/"));
    return { section, key, value: file, viaReference: false, overriddenByEnvironment };
  }
  if (isEnvironmentReference(value)) {
    const resolved = process.env[value.name];
    if (resolved === undefined) {
      throw new MissingEnvironmentError({ variable: value.name, section, key },
        `${source}: ${section}.${key} verweist mit env("${value.name}") auf eine Umgebungsvariable, `
        + `die in dieser Shell nicht gesetzt ist. Setze sie vor dem Start (export ${value.name}=...) oder `
        + "hinterlege sie in der Startdatei Deiner Shell; Secrets stehen nie in der Konfigurationsdatei.");
    }
    return { section, key, value: resolved, viaReference: true, overriddenByEnvironment };
  }
  if (typeof value === "string" && ENVIRONMENT_PLACEHOLDER.test(value)) {
    throw new Error(
      `${source}: ${section}.${key} steht als Text "${value}" in der Konfiguration; `
      + `eine Referenz auf die Umgebung wird als env("...") geschrieben`);
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    throw new Error(
      `${source}: ${section}.${key} ist ein Secret und darf nicht im Klartext in der Konfiguration stehen; `
      + `per Umgebungsvariable setzen oder als env("ENV_NAME") referenzieren`);
  }
  return { section, key, value: materialize(value), viaReference: false, overriddenByEnvironment };
};

const parseEntries = (source: string, raw: RAgentsConfig): readonly ConfigFileEntry[] => {
  const sections = Object.entries(raw) as readonly [string, Readonly<Record<string, ConfigValue>>][];
  let resolved: string | undefined;
  const dataDirectory = (): string => resolved ??= dataDirectoryOf(source, raw);
  const entries: ConfigFileEntry[] = [];
  for (const [section, sectionValue] of sections) {
    for (const [key, value] of Object.entries(sectionValue)) {
      entries.push(entryFor(source, section, key, value, dataDirectory));
    }
  }
  const byKey = new Map<string, ConfigFileEntry>();
  for (const entry of entries) {
    const existing = byKey.get(entry.key);
    if (existing && existing.value !== entry.value) {
      throw new Error(
        `${source}: ${entry.key} steht in ${existing.section} und ${entry.section} mit unterschiedlichen Werten`);
    }
    byKey.set(entry.key, entry);
  }
  return entries;
};

const PROFILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const profileFileName = (profile: string): string => `ragents.config.${profile}.ts`;

/** The profile file lives in the repository root or wherever PRODUCT_PROFILE_FILE points; its name carries the profile. */
export const profileFilePath = (root: string, environment: Readonly<Record<string, string | undefined>> = process.env): string | undefined => {
  const profile = environment.PRODUCT_PROFILE;
  if (!profile) return undefined;
  if (!PROFILE_NAME.test(profile)) throw new Error(`PRODUCT_PROFILE ist kein gültiger Profilname: ${profile}`);
  const file = environment.PRODUCT_PROFILE_FILE;
  if (!file) return path.join(root, profileFileName(profile));
  const source = path.resolve(file);
  if (path.basename(source) !== profileFileName(profile)) {
    throw new Error(`PRODUCT_PROFILE_FILE ${source} passt nicht zum Profil ${profile}; erwartet wird ${profileFileName(profile)}`);
  }
  if (!statSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error(`Die Profildatei ${source} fehlt`);
  return source;
};

const withPluginPaths = (source: string, raw: RAgentsConfig): RAgentsConfig => {
  const plugins = raw.host?.PLUGINS;
  if (!Array.isArray(plugins)) return raw;
  const resolved = plugins.map((entry) => isPluginPath(entry) ? pluginFolderFor(entry, path.dirname(source)) : entry);
  return { ...raw, host: { ...raw.host, PLUGINS: resolved } };
};

const readProfileConfiguration = async (root: string): Promise<LoadedConfigFile | undefined> => {
  const source = profileFilePath(root);
  if (!source || !statSync(source, { throwIfNoEntry: false })?.isFile()) return undefined;
  const module = await import(pathToFileURL(source).href) as Record<string, unknown>;
  const loadedConfig = module.config;
  if (typeof loadedConfig !== "object" || loadedConfig === null) {
    throw new Error(`${source} exportiert keine Konstante config mit den Konfigurationssektionen`);
  }
  const raw = withPluginPaths(source, loadedConfig as RAgentsConfig);
  const users = resolveProfileUsers(source, module.users);
  const anonymousUser = resolveAnonymousUser(source, module.anonymousUser);
  if (users && anonymousUser) throw new Error(`${source}: users und anonymousUser schließen einander aus`);
  const defaultStartEntry = resolveDefaultStartEntry(source, module.defaultStartEntry);
  return { path: source, entries: parseEntries(source, raw), users, anonymousUser, defaultStartEntry };
};

let loadedConfigFile: LoadedConfigFile | undefined;
let loadCompleted = false;

export const loadConfigFile = async (root = rootDir): Promise<void> => {
  if (loadCompleted) throw new Error("Die Konfiguration wurde bereits geladen");
  loadedConfigFile = await readProfileConfiguration(root);
  loadCompleted = true;
  if (!loadedConfigFile) return;
  let applied = 0;
  for (const entry of loadedConfigFile.entries) {
    if (entry.overriddenByEnvironment) continue;
    process.env[entry.key] = entry.value;
    applied++;
  }
  const overridden = loadedConfigFile.entries.length - applied;
  console.log(`Konfiguration ${loadedConfigFile.path} geladen `
    + `(${applied} Werte übernommen, ${overridden} durch Umgebung überstimmt)`);
};

export const configFilePath = (): string | null => loadedConfigFile?.path ?? null;

export const configuredUsers = (): readonly ResolvedProfileUser[] | undefined => loadedConfigFile?.users;

export const configuredAnonymousUser = (): AccessUser | undefined => loadedConfigFile?.anonymousUser;

export const configuredDefaultStartEntry = (): string | undefined => loadedConfigFile?.defaultStartEntry;

export interface ConfigFileValidationContext {
  hostKeys: readonly string[];
  knownPluginIds: readonly string[];
  activePluginIds: readonly string[];
  declaredKeysFor: (pluginId: string) => readonly string[];
  secretKeys: readonly string[];
}

export const validateConfigFileSections = (context: ConfigFileValidationContext): void => {
  if (!loadCompleted) throw new Error("Die Konfiguration muss vor ihrer Prüfung geladen werden");
  if (!loadedConfigFile) return;
  const source = loadedConfigFile.path;
  const known = new Set(context.knownPluginIds);
  const active = new Set(context.activePluginIds);
  const secret = new Set(context.secretKeys);
  for (const section of new Set(loadedConfigFile.entries.map((entry) => entry.section))) {
    if (section === "host") continue;
    if (!known.has(section)) {
      throw new Error(`${source}: unbekannte Sektion ${section}; bekannt sind host, ${[...known].join(", ")}`);
    }
    if (!active.has(section)) {
      console.log(`Konfiguration: Sektion ${section} gehört zu einem inaktiven Plugin und wird ignoriert`);
    }
  }
  for (const entry of loadedConfigFile.entries) {
    if (secret.has(entry.key) && !entry.viaReference) {
      throw new Error(
        `${source}: ${entry.section}.${entry.key} ist als Secret deklariert und darf nicht im Klartext `
        + `in der Konfiguration stehen; per Umgebungsvariable setzen oder als env("ENV_NAME") referenzieren`);
    }
    if (entry.section === "host") {
      if (!context.hostKeys.includes(entry.key)) {
        throw new Error(`${source}: host.${entry.key} ist kein Host-Schlüssel; erlaubt sind ${context.hostKeys.join(", ")}`);
      }
      continue;
    }
    if (!active.has(entry.section)) continue;
    const declared = context.declaredKeysFor(entry.section);
    if (!declared.includes(entry.key)) {
      throw new Error(
        `${source}: ${entry.section}.${entry.key} ist für dieses Plugin nicht deklariert; `
        + (declared.length > 0 ? `deklariert sind ${declared.join(", ")}` : "das Plugin deklariert keine Schlüssel"));
    }
  }
};
