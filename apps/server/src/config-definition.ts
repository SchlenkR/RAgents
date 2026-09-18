import type { hostConfigDescriptors } from "./config.js";

export interface EnvironmentReference {
  readonly kind: "environment";
  readonly name: string;
}

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const env = (name: string): EnvironmentReference => {
  if (!ENVIRONMENT_NAME.test(name)) {
    throw new Error(`env("${name}") nennt keinen gültigen Namen einer Umgebungsvariablen`);
  }
  return { kind: "environment", name };
};

export const isEnvironmentReference = (value: unknown): value is EnvironmentReference =>
  typeof value === "object" && value !== null && (value as EnvironmentReference).kind === "environment";

export interface ProfileAnonymousUser {
  readonly id: string;
  readonly label?: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}

export interface ProfileUser extends ProfileAnonymousUser {
  readonly password: string | EnvironmentReference;
}

export type ConfigValue = string | number | boolean | readonly string[] | EnvironmentReference;

type Descriptors = readonly { readonly key: string }[];

type SecretKeyOf<T extends Descriptors> = T[number] extends infer Descriptor
  ? Descriptor extends { readonly secret: true; readonly key: infer Key } ? Key : never
  : never;

type Section<T extends Descriptors> = {
  readonly [Key in T[number]["key"]]?: Key extends SecretKeyOf<T> ? EnvironmentReference : ConfigValue;
};

// Der Kern kennt keine Plugin-IDs: welche Sektion und welcher Schlüssel gültig ist, entscheidet die
// Laufzeitprüfung gegen die Deklarationen der geladenen Plugins.
export type PluginSection = {
  readonly [key: `${string}_PAT`]: EnvironmentReference | undefined;
  readonly [key: `${string}_KEY`]: EnvironmentReference | undefined;
  readonly [key: `${string}_TOKEN`]: EnvironmentReference | undefined;
  readonly [key: `${string}_SECRET`]: EnvironmentReference | undefined;
  readonly [key: `${string}_PASSWORD`]: EnvironmentReference | undefined;
  readonly [key: string]: ConfigValue | undefined;
};

export type RAgentsConfig =
  & { readonly host?: Section<typeof hostConfigDescriptors> }
  & { readonly [pluginId: string]: PluginSection | undefined };
