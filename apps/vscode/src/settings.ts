import type { RunPanelTheme } from "../../web/src/run-panel/host-contract";

export type ThemeSetting = "auto" | "light" | "dark";

export interface Settings {
  serverUrl: string;
  theme: ThemeSetting;
}

export const parseServerUrl = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("ragents.serverUrl ist leer.");
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`ragents.serverUrl muss mit http:// oder https:// beginnen, nicht ${url.protocol}`);
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("ragents.serverUrl nennt nur Host und Port, keinen Pfad.");
  return url.origin;
};

export const parseThemeSetting = (value: unknown): ThemeSetting => {
  if (value === "auto" || value === "light" || value === "dark") return value;
  throw new Error(`ragents.theme muss auto, light oder dark sein, nicht ${JSON.stringify(value)}`);
};

export const resolveTheme = (setting: ThemeSetting, editorTheme: RunPanelTheme): RunPanelTheme => setting === "auto" ? editorTheme : setting;

export const tokenSecretKey = (serverUrl: string): string => `ragents.access-token:${serverUrl}`;

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SecretReader {
  get: (key: string) => Thenable<string | undefined>;
}

export const isEnvironmentName = (value: string): boolean => ENVIRONMENT_NAME.test(value);

/** Die Namen aus ragents.hostEnvironment; die Einstellung führt nur Namen, die Werte stehen in der SecretStorage. */
export const parseHostEnvironment = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("ragents.hostEnvironment muss eine Liste von Namen sein");
  const names = value.map((entry, index) => {
    const name = typeof entry === "string" ? entry.trim() : "";
    if (!isEnvironmentName(name)) throw new Error(`ragents.hostEnvironment[${index}] ist kein Name einer Umgebungsvariablen (Buchstaben, Ziffern und _, nicht mit einer Ziffer am Anfang)`);
    return name;
  });
  return [...new Set(names)];
};

/** Der Schlüssel in der SecretStorage: der Wert, den ein gestarteter Host als diese Umgebungsvariable bekommt. */
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

/** Die Namen ohne Wert in der SecretStorage; die Seite Server nennt sie, damit der fehlende Wert nicht erst beim Start auffällt. */
export const missingHostEnvironmentSecrets = async (names: readonly string[], secrets: SecretReader): Promise<string[]> =>
  (await readSecrets(names, secrets)).filter(([, value]) => value === undefined).map(([name]) => name);

/** Die Schritte, aus denen der geführte Weg zu einem fehlenden Wert besteht; die Erweiterung hängt VS Code daran. */
export interface SecretSteps {
  /** Die Namen, die ragents.hostEnvironment gerade führt. */
  names: () => readonly string[];
  writeNames: (names: readonly string[]) => Promise<void>;
  /** Fragt nach dem Wert; ein Abbruch ist undefined. */
  askValue: () => Promise<string | undefined>;
  store: (value: string) => Promise<void>;
  retry: () => Promise<void>;
}

/** Der Name gehört vor der Frage nach dem Wert in die Einstellung, sonst reicht die Erweiterung ihn nie an einen Host weiter;
 * erst danach kommt der Wert und mit ihm der neue Versuch. */
export const provideMissingSecret = async (name: string, steps: SecretSteps): Promise<boolean> => {
  const names = steps.names();
  if (!names.includes(name)) await steps.writeNames([...names, name]);
  const value = await steps.askValue();
  if (value === undefined) return false;
  await steps.store(value);
  await steps.retry();
  return true;
};

/** Was ein verteiltes Profil an sein Relay braucht, steht schon in der Sitzung; sie schlägt eine geerbte Variable, aber nicht den gesetzten Wert aus der SecretStorage. */
export const withRelaySession = (environment: NodeJS.ProcessEnv, serverUrl: string, token: string): NodeJS.ProcessEnv =>
  ({ ...environment, RAGENTS_RELAY_URL: serverUrl, RAGENTS_RELAY_TOKEN: token });

/** Die Umgebung eines Hosts: das Geerbte, überlagert von den Werten aus der SecretStorage; fehlt einer, nennt das Protokoll nur seinen Namen. */
export const withHostEnvironmentSecrets = async (
  inherited: NodeJS.ProcessEnv,
  names: readonly string[],
  secrets: SecretReader,
  log: (line: string) => void,
): Promise<NodeJS.ProcessEnv> => {
  const read = await readSecrets(names, secrets);
  const missing = read.filter(([, value]) => value === undefined).map(([name]) => name);
  if (missing.length > 0) log(`== ragents.hostEnvironment: kein Wert in der SecretStorage für ${missing.join(", ")}; Befehl "RAgents: Secret setzen"`);
  return { ...inherited, ...Object.fromEntries(read.filter((entry): entry is readonly [string, string] => entry[1] !== undefined)) };
};
