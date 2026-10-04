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

// The finding about a missing environment variable belongs to loading the configuration; that is why main.ts gets it from here.
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
    throw new Error(`${location}.token needs env("ENV_NAME"); a token never appears in plain text in the profile file`);
  }
  // A user still signs in with their password; without the variable set they just have no personal token.
  const token = environment[raw.name];
  if (!token) return undefined;
  // $ and ! are off limits because the consumer evaluates the token as an API key with template and command syntax.
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH || !/^[\x21-\x7e]+$/.test(token) || /[$!]/.test(token)) {
    throw new Error(`${location}.token (${raw.name}) needs ${MIN_TOKEN_LENGTH} to ${MAX_TOKEN_LENGTH} printable ASCII characters without spaces, $ and !`);
  }
  return token;
};

const resolveIdentity = (location: string, entry: Record<string, unknown>): AccessUser => {
  if (typeof entry.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(entry.id)) {
    throw new Error(`${location}.id needs 1 to 64 characters: letters, digits, period, underscore or hyphen`);
  }
  if (entry.label !== undefined && (typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 120)) {
    throw new Error(`${location}.label needs 1 to 120 characters`);
  }
  if (!Array.isArray(entry.rights) || !entry.rights.every(isAccessRight)) {
    throw new Error(`${location}.rights needs valid rights as strings or "*" for all rights`);
  }
  if (new Set(entry.rights).size !== entry.rights.length) throw new Error(`${location}.rights contains duplicate rights`);
  if (entry.startEntries !== undefined && (!Array.isArray(entry.startEntries)
    || !entry.startEntries.every((id) => typeof id === "string" && START_ENTRY_ID.test(id))
    || new Set(entry.startEntries).size !== entry.startEntries.length)) {
    throw new Error(`${location}.startEntries needs unique template ids as strings`);
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
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${location} is not a user`);
  const entry = raw as Record<string, unknown>;
  if (Object.keys(entry).some((key) => !["id", "label", "rights", "startEntries"].includes(key))) {
    throw new Error(`${location} allows only id, label, rights and startEntries`);
  }
  return resolveIdentity(location, entry);
};

/** The template a new run takes without a choice; whether it is registered is checked by the PluginHost at startup. */
export const resolveDefaultStartEntry = (source: string, raw: unknown): string | undefined => {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !START_ENTRY_ID.test(raw)) {
    throw new Error(`${source}: defaultStartEntry needs a template id as a string, such as "acme.tasks.setup"`);
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
    throw new Error(`${source}: users must be a non-empty list; without users, sign-in is turned off`);
  }
  const ids = new Set<string>();
  const tokens = new Map<string, string>();
  return raw.map((value: unknown, index: number) => {
    const location = `${source}: users[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} is not a user`);
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !["id", "label", "password", "token", "rights", "startEntries"].includes(key))) {
      throw new Error(`${location} allows only id, label, password, token, rights and startEntries`);
    }
    const user = resolveIdentity(location, entry);
    if (ids.has(user.id)) throw new Error(`${location}.id is a duplicate: ${user.id}`);
    ids.add(user.id);
    if (typeof entry.password !== "string" && (!isEnvironmentReference(entry.password)
      || typeof entry.password.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.password.name))) {
      throw new Error(`${location}.password needs a text or env("ENV_NAME")`);
    }
    const password = typeof entry.password === "string" ? entry.password : environment[entry.password.name];
    if (!password || password.length > 2048) throw new Error(`${location}.password is missing, empty or longer than 2048 characters`);
    const token = resolveUserToken(location, entry.token, environment);
    if (token !== undefined) {
      const other = tokens.get(token);
      if (other) throw new Error(`${location}.token is the same as for user ${other}; every token belongs to exactly one user`);
      tokens.set(token, user.id);
    }
    return Object.freeze({ ...user, password, ...(token !== undefined ? { token } : {}) });
  });
};

export const listFromEnvironmentValue = (value: string): readonly string[] | undefined => {
  if (!value.startsWith("[")) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`The value ${value} looks like a list, but is not a list of strings`);
  }
  return parsed as string[];
};

const materialize = (value: Exclude<ConfigValue, EnvironmentReference | ProvisionedReference>): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  return JSON.stringify(value);
};

/** The host's data folder, in whose tools/ the provisioning puts its tools. */
const dataDirectoryOf = (source: string, raw: RAgentsConfig): string => {
  const configured = raw.host?.DATA_DIR;
  if (isEnvironmentReference(configured) && process.env[configured.name] === undefined) {
    throw new MissingEnvironmentError({ variable: configured.name, section: "host", key: "DATA_DIR" },
      `${source}: host.DATA_DIR refers to the unset environment variable ${configured.name}`);
  }
  const fromFile = isEnvironmentReference(configured) ? process.env[configured.name] : typeof configured === "string" ? configured : undefined;
  const profile = process.env.PRODUCT_PROFILE;
  if (!profile) throw new Error(`${source}: without PRODUCT_PROFILE there is no data folder and therefore no tool folder`);
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
        `${source}: ${section}.${key} refers with env("${value.name}") to an environment variable `
        + `that is not set in this shell. Set it before starting (export ${value.name}=...) or `
        + "put it in your shell's startup file; secrets never appear in the configuration file.");
    }
    return { section, key, value: resolved, viaReference: true, overriddenByEnvironment };
  }
  if (typeof value === "string" && ENVIRONMENT_PLACEHOLDER.test(value)) {
    throw new Error(
      `${source}: ${section}.${key} appears as the text "${value}" in the configuration; `
      + `a reference to the environment is written as env("...")`);
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    throw new Error(
      `${source}: ${section}.${key} is a secret and must not appear in plain text in the configuration; `
      + `set it through an environment variable or reference it as env("ENV_NAME")`);
  }
  const resolved = section === "host" ? value : resolveStructuredConfig(source, section, key, value, dataDirectory);
  return { section, key, value: materialize(resolved as Exclude<ConfigValue, EnvironmentReference | ProvisionedReference>), viaReference: false, overriddenByEnvironment };
};

export const resolveStructuredConfig = (
  source: string,
  section: string,
  key: string,
  value: unknown,
  dataDirectory?: () => string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ConfigValue => {
  const location = `${source}: ${section}.${key}`;
  if (isEnvironmentReference(value)) {
    if (typeof value.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.name)) throw new Error(`${location} has an invalid environment reference`);
    const resolved = environment[value.name];
    if (resolved === undefined) throw new MissingEnvironmentError({ variable: value.name, section, key }, `${location} refers to the unset environment variable ${value.name}`);
    return resolved;
  }
  if (isProvisionedReference(value)) {
    if (!dataDirectory) throw new Error(`${location} cannot resolve a provisioned file without the data directory`);
    return path.join(pluginToolsDirectory(dataDirectory(), value.plugin), ...value.path.split("/"));
  }
  if (SECRET_KEY_PATTERN.test(key.split(".").at(-1)!)) throw new Error(`${location} is a secret and must use env("ENV_NAME")`);
  if (typeof value === "string" && ENVIRONMENT_PLACEHOLDER.test(value)) throw new Error(`${location} must use env("ENV_NAME") instead of a text placeholder`);
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (Array.isArray(value)) return value.map((entry, index) => resolveStructuredConfig(source, section, `${key}.${index}`, entry, dataDirectory, environment));
  if (typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, resolveStructuredConfig(source, section, `${key}.${name}`, entry, dataDirectory, environment)]));
  }
  throw new Error(`${location} must be a JSON value or env("ENV_NAME")`);
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
        `${source}: ${entry.key} appears in ${existing.section} and ${entry.section} with different values`);
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
  if (!PROFILE_NAME.test(profile)) throw new Error(`PRODUCT_PROFILE is not a valid profile name: ${profile}`);
  const file = environment.PRODUCT_PROFILE_FILE;
  if (!file) return path.join(root, profileFileName(profile));
  const source = path.resolve(file);
  if (path.basename(source) !== profileFileName(profile)) {
    throw new Error(`PRODUCT_PROFILE_FILE ${source} does not match the profile ${profile}; expected is ${profileFileName(profile)}`);
  }
  if (!statSync(source, { throwIfNoEntry: false })?.isFile()) throw new Error(`The profile file ${source} is missing`);
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
    throw new Error(`${source} does not export a constant config with the configuration sections`);
  }
  const raw = withPluginPaths(source, loadedConfig as RAgentsConfig);
  const users = resolveProfileUsers(source, module.users);
  const anonymousUser = resolveAnonymousUser(source, module.anonymousUser);
  if (users && anonymousUser) throw new Error(`${source}: users and anonymousUser exclude each other`);
  const defaultStartEntry = resolveDefaultStartEntry(source, module.defaultStartEntry);
  return { path: source, entries: parseEntries(source, raw), users, anonymousUser, defaultStartEntry };
};

let loadedConfigFile: LoadedConfigFile | undefined;
let loadCompleted = false;

export const loadConfigFile = async (root = rootDir): Promise<void> => {
  if (loadCompleted) throw new Error("The configuration has already been loaded");
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
  console.log(`Configuration ${loadedConfigFile.path} loaded `
    + `(${applied} values applied, ${overridden} overridden by the environment)`);
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
  if (!loadCompleted) throw new Error("The configuration must be loaded before it is checked");
  if (!loadedConfigFile) return;
  const source = loadedConfigFile.path;
  const known = new Set(context.knownPluginIds);
  const active = new Set(context.activePluginIds);
  const secret = new Set(context.secretKeys);
  for (const section of new Set(loadedConfigFile.entries.map((entry) => entry.section))) {
    if (section === "host") continue;
    if (!known.has(section)) {
      throw new Error(`${source}: unknown section ${section}; known are host, ${[...known].join(", ")}`);
    }
    if (!active.has(section)) {
      console.log(`Configuration: section ${section} belongs to an inactive plugin and is ignored`);
    }
  }
  for (const entry of loadedConfigFile.entries) {
    if (secret.has(entry.key) && !entry.viaReference) {
      throw new Error(
        `${source}: ${entry.section}.${entry.key} is declared as a secret and must not appear in plain text `
        + `in the configuration; set it through an environment variable or reference it as env("ENV_NAME")`);
    }
    if (entry.section === "host") {
      if (!context.hostKeys.includes(entry.key)) {
        throw new Error(`${source}: host.${entry.key} is not a host key; allowed are ${context.hostKeys.join(", ")}`);
      }
      continue;
    }
    if (!active.has(entry.section)) continue;
    const declared = context.declaredKeysFor(entry.section);
    if (!declared.includes(entry.key)) {
      throw new Error(
        `${source}: ${entry.section}.${entry.key} is not declared for this plugin; `
        + (declared.length > 0 ? `declared are ${declared.join(", ")}` : "the plugin declares no keys"));
    }
  }
};
