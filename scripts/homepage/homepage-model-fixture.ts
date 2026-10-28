import { env, type ProfileModelProvider } from "../../apps/server/src/config-definition.js";

const providers = [{
  id: "reference",
  baseUrl: "https://models.example.invalid/v1",
  apiKey: env("REFERENCE_MODEL_KEY"),
  models: [
    { id: "reference-agent", contextWindow: 262_144, maxTokens: 32_768, reasoning: true, input: ["text", "image", "video", "file", "audio"] },
    { id: "reference-coordinator", contextWindow: 262_144, maxTokens: 32_768, reasoning: true, input: ["text", "image", "video", "file", "audio"] },
  ],
}] as const satisfies readonly ProfileModelProvider[];

export const referenceModelEnvironment = {
  AGENT_PROVIDER: "reference",
  AGENT_MODEL: "reference-agent",
  AGENT_COORDINATOR_MODEL: "reference-coordinator",
  COMPACTION_PROVIDER: "reference",
  MODEL_PROVIDERS: JSON.stringify(providers),
  REFERENCE_MODEL_KEY: "documentation-only",
  BRAVE_API_KEY: "documentation-only",
} as const;
