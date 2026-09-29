import type { ModelCompaction } from "@ragents/ai";
import type { ThinkingLevel } from "@ragents/engine";
import type { hostConfigDescriptors } from "./config.js";

export interface EnvironmentReference {
  readonly kind: "environment";
  readonly name: string;
}

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const env = (name: string): EnvironmentReference => {
  if (!ENVIRONMENT_NAME.test(name)) {
    throw new Error(`env("${name}") does not name a valid environment variable`);
  }
  return { kind: "environment", name };
};

export const isEnvironmentReference = (value: unknown): value is EnvironmentReference =>
  typeof value === "object" && value !== null && (value as EnvironmentReference).kind === "environment";

export interface ProvisionedReference {
  readonly kind: "provisioned";
  readonly plugin: string;
  readonly path: string;
}

const PLUGIN_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** A file in a plugin's tool folder; loading the profile file turns it into an absolute path. */
export const provisioned = (plugin: string, file: string): ProvisionedReference => {
  if (!PLUGIN_ID.test(plugin)) {
    throw new Error(`provisioned("${plugin}", ...) does not name a valid plugin id`);
  }
  if (!file || file.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`provisioned("${plugin}", "${file}") needs a relative path in the tool folder`);
  }
  return { kind: "provisioned", plugin, path: file };
};

export const isProvisionedReference = (value: unknown): value is ProvisionedReference =>
  typeof value === "object" && value !== null && (value as ProvisionedReference).kind === "provisioned";

export interface ProfileAnonymousUser {
  readonly id: string;
  readonly label?: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}

export interface ProfileUser extends ProfileAnonymousUser {
  readonly password: string | EnvironmentReference;
  /** Permanent bearer token for clients without a sign-in dialog; only as env(...), never in plain text. */
  readonly token?: EnvironmentReference;
}

/** An entry of MODEL_ALIASES: a model under its own name with the compaction values that apply to this model. */
export interface ProfileModelAlias {
  readonly alias: string;
  /** The target as provider/model from a provider of MODEL_PROVIDERS or a built-in catalog. */
  readonly model: string;
  readonly thinking?: ThinkingLevel;
  /** The levels the alias offers, each mapped to a level of the target; without them it offers the target's levels. */
  readonly thinkingLevels?: Readonly<Partial<Record<ThinkingLevel, ThinkingLevel>>>;
  readonly compaction: Readonly<ModelCompaction>;
}

/** An entry of MODEL_PROVIDERS: an OpenAI-compatible server, for instance a self-hosted one, whose models aliases can name as provider/model. */
export interface ProfileModelProvider {
  readonly id: string;
  /** The address up to /v1, without a trailing slash; requests go to baseUrl/chat/completions. */
  readonly baseUrl: string;
  /** Only as env(...), never in plain text. */
  readonly apiKey: EnvironmentReference;
  readonly compat?: Readonly<{
    /** "qwen-chat-template" switches thinking with chat_template_kwargs.enable_thinking and sends the effort as reasoning_effort. */
    thinkingFormat?: "qwen-chat-template";
    requiresReasoningContentOnAssistantMessages?: boolean;
  }>;
  readonly models: readonly Readonly<{
    id: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    input: readonly ("text" | "image" | "video" | "file" | "audio")[];
    /** What the server gets per level; null removes a level, xhigh and max exist only when named here. */
    thinkingLevelMap?: Readonly<Partial<Record<ThinkingLevel, string | null>>>;
  }>[];
}

export type ConfigValue =
  | string
  | number
  | boolean
  | readonly string[]
  | readonly ProfileModelAlias[]
  | readonly ProfileModelProvider[]
  | EnvironmentReference
  | ProvisionedReference;

type Descriptors = readonly { readonly key: string }[];

type SecretKeyOf<T extends Descriptors> = T[number] extends infer Descriptor
  ? Descriptor extends { readonly secret: true; readonly key: infer Key } ? Key : never
  : never;

type Section<T extends Descriptors> = {
  readonly [Key in T[number]["key"]]?: Key extends SecretKeyOf<T> ? EnvironmentReference : ConfigValue;
};

type HostSection = Omit<Section<typeof hostConfigDescriptors>, "MODEL_ALIASES" | "MODEL_PROVIDERS"> & {
  readonly MODEL_ALIASES?: readonly ProfileModelAlias[];
  readonly MODEL_PROVIDERS?: readonly ProfileModelProvider[];
};

// The core knows no plugin ids: which section and which key is valid is decided by the
// runtime check against the declarations of the loaded plugins.
export type PluginSection = {
  readonly [key: `${string}_PAT`]: EnvironmentReference | undefined;
  readonly [key: `${string}_KEY`]: EnvironmentReference | undefined;
  readonly [key: `${string}_TOKEN`]: EnvironmentReference | undefined;
  readonly [key: `${string}_SECRET`]: EnvironmentReference | undefined;
  readonly [key: `${string}_PASSWORD`]: EnvironmentReference | undefined;
  readonly [key: string]: ConfigValue | undefined;
};

export type RAgentsConfig =
  & { readonly host?: HostSection }
  & { readonly [pluginId: string]: PluginSection | undefined };
