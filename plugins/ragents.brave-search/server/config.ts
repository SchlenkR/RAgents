import { declaredEnvironment } from "@ragents/host/plugin-support/plugin-config.js";
import { countryCode, languageCode, safeSearchMode, type BraveSearchConfig } from "./client.js";

export const braveSearchConfigDescriptors = [
  { key: "BRAVE_API_KEY", source: "environment", secret: true },
  { key: "BRAVE_SEARCH_COUNTRY", source: "environment" },
  { key: "BRAVE_SEARCH_LANGUAGE", source: "environment" },
  { key: "BRAVE_SEARCH_SAFESEARCH", source: "environment" },
  { key: "BRAVE_SEARCH_TIMEOUT_SECONDS", source: "environment" },
] as const;

const env = declaredEnvironment(braveSearchConfigDescriptors);

/** Without a key the plugin is inactive; every other setting is checked when the server starts. */
export const braveSearchConfig = (): BraveSearchConfig | undefined => {
  const apiKey = env.optional("BRAVE_API_KEY")?.trim();
  if (!apiKey) return undefined;
  const country = env.optional("BRAVE_SEARCH_COUNTRY");
  const language = env.optional("BRAVE_SEARCH_LANGUAGE");
  const safeSearch = env.optional("BRAVE_SEARCH_SAFESEARCH");
  return {
    apiKey,
    ...(country ? { country: countryCode(country, "BRAVE_SEARCH_COUNTRY") } : {}),
    ...(language ? { language: languageCode(language, "BRAVE_SEARCH_LANGUAGE") } : {}),
    ...(safeSearch ? { safeSearch: safeSearchMode(safeSearch, "BRAVE_SEARCH_SAFESEARCH") } : {}),
    timeoutSeconds: env.positiveNumber("BRAVE_SEARCH_TIMEOUT_SECONDS", "10"),
  };
};
