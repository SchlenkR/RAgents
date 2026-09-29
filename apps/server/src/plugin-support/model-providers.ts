import { EXTENDED_THINKING_LEVELS, type Api, type InputModality, type Model } from "@ragents/ai";
import { builtinProviders } from "@ragents/ai/providers/all";
import type { ModelProviderRegistration } from "@ragents/engine";
import { isEnvironmentReference } from "../config-definition.js";
import { MissingEnvironmentError } from "../missing-environment.js";
import type { ModelUpstream } from "./model-upstreams.js";
import { declaredEnvironment } from "./plugin-config.js";
import { RELAY_PROVIDER } from "./product-relay.js";

export const modelProviderEnvDescriptors = [
  { key: "MODEL_PROVIDERS", source: "environment" },
] as const;

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROVIDER_KEYS: readonly string[] = ["id", "baseUrl", "apiKey", "compat", "models"];
const COMPAT_KEYS: readonly string[] = ["thinkingFormat", "requiresReasoningContentOnAssistantMessages"];
const THINKING_FORMATS: readonly string[] = ["qwen-chat-template"];
const MODEL_KEYS: readonly string[] = ["id", "contextWindow", "maxTokens", "reasoning", "input", "thinkingLevelMap"];
const INPUTS: readonly InputModality[] = ["text", "image", "video", "file", "audio"];

type Entry = Record<string, unknown>;

const objectAt = (value: unknown, location: string, expected: string): Entry => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} must be an object with ${expected}`);
  return value as Entry;
};

const onlyKeys = (entry: Entry, allowed: readonly string[], location: string): void => {
  const unknown = Object.keys(entry).find((key) => !allowed.includes(key));
  if (unknown) throw new Error(`${location}.${unknown} is not supported; allowed are ${allowed.join(", ")}`);
};

const positiveInteger = (value: unknown, location: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`${location} must be a positive integer`);
  return value;
};

const baseUrlOf = (value: unknown, location: string): string => {
  const text = typeof value === "string" ? value : "";
  const url = URL.canParse(text) ? new URL(text) : undefined;
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:") || text.endsWith("/")) {
    throw new Error(`${location}.baseUrl needs an http or https address without a trailing slash, such as http://localhost:8000/v1`);
  }
  return text;
};

const apiKeyOf = (value: unknown, location: string, environment: Readonly<Record<string, string | undefined>>): string => {
  if (!isEnvironmentReference(value) || typeof value.name !== "string" || !ENVIRONMENT_NAME.test(value.name)) {
    throw new Error(`${location}.apiKey must be env("NAME"); a key never appears in plain text in the configuration`);
  }
  const key = environment[value.name];
  if (!key) {
    throw new MissingEnvironmentError({ variable: value.name, section: "host", key: "MODEL_PROVIDERS" },
      `${location}.apiKey refers with env("${value.name}") to an environment variable that is not set in this shell`);
  }
  return key;
};

const compatOf = (value: unknown, location: string): Model<Api>["compat"] => {
  if (value === undefined) return undefined;
  const entry = objectAt(value, `${location}.compat`, COMPAT_KEYS.join(" and/or "));
  onlyKeys(entry, COMPAT_KEYS, `${location}.compat`);
  if (entry.thinkingFormat !== undefined && !THINKING_FORMATS.includes(entry.thinkingFormat as string)) {
    throw new Error(`${location}.compat.thinkingFormat "${String(entry.thinkingFormat)}" is not supported; supported are ${THINKING_FORMATS.join(", ")}`);
  }
  const reasoningContent = entry.requiresReasoningContentOnAssistantMessages;
  if (reasoningContent !== undefined && typeof reasoningContent !== "boolean") {
    throw new Error(`${location}.compat.requiresReasoningContentOnAssistantMessages must be true or false`);
  }
  return entry as Model<Api>["compat"];
};

const thinkingLevelMapOf = (value: unknown, reasoning: boolean, location: string): Model<Api>["thinkingLevelMap"] => {
  if (value === undefined) return undefined;
  if (!reasoning) throw new Error(`${location}.thinkingLevelMap needs reasoning: true`);
  const entry = objectAt(value, `${location}.thinkingLevelMap`, "thinking levels as keys");
  for (const [level, sent] of Object.entries(entry)) {
    if (!EXTENDED_THINKING_LEVELS.includes(level as never)) throw new Error(`${location}.thinkingLevelMap.${level} is not a thinking level`);
    if (sent !== null && (typeof sent !== "string" || !sent)) {
      throw new Error(`${location}.thinkingLevelMap.${level} must be the value to send or null for a level the model does not offer`);
    }
  }
  return entry as Model<Api>["thinkingLevelMap"];
};

const modelOf = (value: unknown, index: number, provider: { id: string; baseUrl: string; compat: Model<Api>["compat"] }, location: string): Model<Api> => {
  const at = `${location}.models[${index}]`;
  const entry = objectAt(value, at, "id, contextWindow, maxTokens, reasoning, input and optionally thinkingLevelMap");
  onlyKeys(entry, MODEL_KEYS, at);
  if (typeof entry.id !== "string" || !entry.id.trim()) throw new Error(`${at}.id must name the model as the server knows it`);
  const contextWindow = positiveInteger(entry.contextWindow, `${at}.contextWindow`);
  const maxTokens = positiveInteger(entry.maxTokens, `${at}.maxTokens`);
  if (maxTokens > contextWindow) throw new Error(`${at}.maxTokens (${maxTokens}) exceeds the contextWindow (${contextWindow})`);
  if (typeof entry.reasoning !== "boolean") throw new Error(`${at}.reasoning must be true or false`);
  const input = entry.input;
  if (!Array.isArray(input) || !input.includes("text") || input.some((kind) => !INPUTS.includes(kind as InputModality))) {
    throw new Error(`${at}.input needs "text" and optionally ${INPUTS.filter((kind) => kind !== "text").join(", ")}`);
  }
  const thinkingLevelMap = thinkingLevelMapOf(entry.thinkingLevelMap, entry.reasoning, at);
  return {
    id: entry.id,
    name: entry.id,
    api: "openai-completions",
    provider: provider.id,
    baseUrl: provider.baseUrl,
    reasoning: entry.reasoning,
    input: [...new Set(input as InputModality[])],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens,
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(provider.compat ? { compat: provider.compat } : {}),
  };
};

const providerOf = (value: unknown, index: number, reserved: ReadonlySet<string>, environment: Readonly<Record<string, string | undefined>>): ModelUpstream => {
  const location = `MODEL_PROVIDERS[${index}]`;
  const entry = objectAt(value, location, "id, baseUrl, apiKey, models and optionally compat");
  onlyKeys(entry, PROVIDER_KEYS, location);
  if (typeof entry.id !== "string" || !PROVIDER_ID.test(entry.id)) {
    throw new Error(`${location}.id needs 1 to 64 lowercase letters, digits, dots, underscores or hyphens`);
  }
  if (reserved.has(entry.id)) throw new Error(`${location}.id ${entry.id} is already a provider of the host`);
  const at = `${location} (${entry.id})`;
  const baseUrl = baseUrlOf(entry.baseUrl, at);
  const apiKey = apiKeyOf(entry.apiKey, at, environment);
  const compat = compatOf(entry.compat, at);
  if (!Array.isArray(entry.models) || entry.models.length === 0) throw new Error(`${at}.models needs at least one model`);
  const models = entry.models.map((model, modelIndex) => modelOf(model, modelIndex, { id: entry.id as string, baseUrl, compat }, at));
  const duplicate = models.find((model, modelIndex) => models.findIndex((other) => other.id === model.id) !== modelIndex);
  if (duplicate) throw new Error(`${at}.models names the model ${duplicate.id} more than once`);
  return { id: entry.id, baseUrl, apiKey, models };
};

/** MODEL_PROVIDERS: a list of OpenAI-compatible servers { id, baseUrl, apiKey: env("NAME"), compat?, models }, for instance self-hosted ones. */
export const parseModelProviders = (entries: unknown, environment: Readonly<Record<string, string | undefined>> = process.env): readonly ModelUpstream[] => {
  if (!Array.isArray(entries)) throw new Error("MODEL_PROVIDERS must be a list of providers");
  const reserved = new Set([...builtinProviders().map((provider) => provider.id), RELAY_PROVIDER]);
  const providers = entries.map((entry, index) => providerOf(entry, index, reserved, environment));
  const duplicate = providers.find((entry, index) => providers.findIndex((other) => other.id === entry.id) !== index);
  if (duplicate) throw new Error(`MODEL_PROVIDERS names the provider ${duplicate.id} more than once`);
  return providers;
};

const env = declaredEnvironment(modelProviderEnvDescriptors);

/** The profile's providers; the environment holds MODEL_PROVIDERS as JSON of the list from the profile file, each key as its env reference. */
export const configuredModelProviders = (): readonly ModelUpstream[] => {
  const value = env.optional("MODEL_PROVIDERS");
  if (value === undefined || value === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("MODEL_PROVIDERS is no JSON list of providers");
  }
  return parseModelProviders(parsed);
};

/** The registration in the model runtime: every model over the OpenAI-compatible transport with the provider's address and key. */
export const modelProviderRegistration = (provider: ModelUpstream): ModelProviderRegistration => ({
  id: provider.id,
  config: {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    api: "openai-completions",
    models: provider.models.map((model) => ({ ...model })),
  },
});
