import type { RunPanelTheme } from "../../web/src/run-panel/host-contract";

export type ThemeSetting = "auto" | "light" | "dark";

export interface Settings {
  serverUrl: string;
  theme: ThemeSetting;
}

export const parseServerUrl = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("ragents.serverUrl is empty.");
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`ragents.serverUrl must start with http:// or https://, not ${url.protocol}`);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("ragents.serverUrl names only host and port, no path.");
  return url.origin;
};

export const parseThemeSetting = (value: unknown): ThemeSetting => {
  if (value === "auto" || value === "light" || value === "dark") return value;
  throw new Error(`ragents.theme must be auto, light, or dark, not ${JSON.stringify(value)}`);
};

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;

export const parseZoomSetting = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX) return value;
  throw new Error(`ragents.zoom must be between ${ZOOM_MIN} and ${ZOOM_MAX} percent, not ${JSON.stringify(value)}`);
};

export const resolveTheme = (setting: ThemeSetting, editorTheme: RunPanelTheme): RunPanelTheme => setting === "auto" ? editorTheme : setting;

export const tokenSecretKey = (serverUrl: string): string => `ragents.access-token:${serverUrl}`;

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SecretReader {
  get: (key: string) => Thenable<string | undefined>;
}

export const isEnvironmentName = (value: string): boolean => ENVIRONMENT_NAME.test(value);

/** The names from ragents.hostEnvironment; the setting holds only names, the values are in the SecretStorage. */
export const parseHostEnvironment = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("ragents.hostEnvironment must be a list of names");
  const names = value.map((entry, index) => {
    const name = typeof entry === "string" ? entry.trim() : "";
    if (!isEnvironmentName(name)) throw new Error(`ragents.hostEnvironment[${index}] is not the name of an environment variable (letters, digits, and _, not starting with a digit)`);
    return name;
  });
  return [...new Set(names)];
};

/** The key in the SecretStorage: the value a started host gets as this environment variable. */
export const hostEnvironmentSecretKey = (name: string): string => `ragents.host-env:${name}`;

const secretValue = async (secrets: SecretReader, name: string): Promise<string | undefined> => {
  try {
    return await secrets.get(hostEnvironmentSecretKey(name));
  } catch {
    return undefined;
  }
};

const readSecrets = (names: readonly string[], secrets: SecretReader): Promise<(readonly [string, string | undefined])[]> =>
  Promise.all(names.map(async (name) => [name, await secretValue(secrets, name)] as const));

/** The names without a value in the SecretStorage; the server page names them so the missing value does not only show up at start. */
export const missingHostEnvironmentSecrets = async (names: readonly string[], secrets: SecretReader): Promise<string[]> =>
  (await readSecrets(names, secrets)).filter(([, value]) => value === undefined).map(([name]) => name);

/** The steps of the guided way to a missing value; the extension attaches VS Code to them. */
export interface SecretSteps {
  /** The names ragents.hostEnvironment currently holds. */
  names: () => readonly string[];
  writeNames: (names: readonly string[]) => Promise<void>;
  /** Asks for the value; a cancel is undefined. */
  askValue: () => Promise<string | undefined>;
  store: (value: string) => Promise<void>;
  retry: () => Promise<void>;
}

/** The name goes into the setting before asking for the value, otherwise the extension never passes it on to a host;
 * only then comes the value and with it the new attempt. */
export const provideMissingSecret = async (name: string, steps: SecretSteps): Promise<boolean> => {
  const names = steps.names();
  if (!names.includes(name)) await steps.writeNames([...names, name]);
  const value = await steps.askValue();
  if (value === undefined) return false;
  await steps.store(value);
  await steps.retry();
  return true;
};

/** What a distributed profile needs for its relay is already in the session; it beats an inherited variable, but not the value set in the SecretStorage. */
export const withRelaySession = (environment: NodeJS.ProcessEnv, serverUrl: string, token: string): NodeJS.ProcessEnv =>
  ({ ...environment, RAGENTS_RELAY_URL: serverUrl, RAGENTS_RELAY_TOKEN: token });

/** The environment of a host: the inherited one, overlaid by the values from the SecretStorage; if one is missing, the log names only its name. */
export const withHostEnvironmentSecrets = async (
  inherited: NodeJS.ProcessEnv,
  names: readonly string[],
  secrets: SecretReader,
  log: (line: string) => void,
): Promise<NodeJS.ProcessEnv> => {
  const read = await readSecrets(names, secrets);
  const missing = read.filter(([, value]) => value === undefined).map(([name]) => name);
  if (missing.length > 0) log(`== ragents.hostEnvironment: no value in the SecretStorage for ${missing.join(", ")}; command "RAgents: Set secret"`);
  return { ...inherited, ...Object.fromEntries(read.filter((entry): entry is readonly [string, string] => entry[1] !== undefined)) };
};
