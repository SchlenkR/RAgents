// Showcase: the core profile plus the bundled examples from ragents.reference.
import { env, provisioned, type RAgentsConfig } from "./apps/server/src/config-definition.js";

export const config = {
  host: {
    PORT: 4713,
    PRODUCT_PROFILE: "showcase",
    COMPACTION_MODEL: "google/gemma-4-26b-a4b-it",
    // Aliases for other RAgents servers that obtain their models from here via ragents.model-relay.
    MODEL_ALIASES: [
      { alias: "showcase-standard", model: "openrouter/z-ai/glm-5.3-flash", compaction: { threshold: 160_000, keepRecentTokens: 24_000, summaryTokens: 12_000 } },
      { alias: "showcase-coordinator", model: "openrouter/deepseek/deepseek-v4-flash-0731", compaction: { threshold: 300_000, keepRecentTokens: 40_000, summaryTokens: 16_000 } },
    ],
    PRODUCT_ID: "ragents-showcase",
    PRODUCT_TITLE: "RAgents Showcase",
    PLUGINS: [
      "ragents.orchestration",
      "ragents.workspace",
      "ragents.product",
      "ragents.overseer",
      "ragents.activity",
      "ragents.processes",
      "ragents.documents",
      "ragents.browser",
      "ragents.mcp",
      "ragents.ask",
      "ragents.acp",
      "ragents.todo",
      "ragents.watch",
      "ragents.actor-programs",
      "ragents.reference",
      "ragents.lsp-roslyn",
      "ragents.lsp-fsharp",
      "ragents.lsp-typescript",
      "ragents.model-relay",
      "ragents.profile-distribution",
    ],
  },

  "ragents.acp": {
    ACP_AGENTS: {},
  },

  "ragents.mcp": {
    MCP_SERVERS: {},
  },

  "ragents.product": {
    OPENROUTER_API_KEY: env("OPENROUTER_API_KEY"),
    AGENT_MODEL: "z-ai/glm-5.3-flash",
    AGENT_MODELS: [
      "deepseek/deepseek-v4-flash-0731",
      "deepseek/deepseek-v4-pro-0813",
      "qwen/qwen3.8-max",
      "z-ai/glm-5.3",
      "z-ai/glm-5.3-flash",
      "qwen/qwen3.8-flash",
      "moonshotai/kimi-k3",
      "minimax/minimax-m3",
      "qwen/qwen3.8-27b",
      "moonshotai/kimi-k2.7-code",
    ],
    AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash",
    AGENT_COORDINATOR_THINKING: "high",
  },

  "ragents.lsp-roslyn": {
    ROSLYN_LANGUAGE_SERVER: provisioned("ragents.lsp-roslyn", "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"),
  },
  "ragents.lsp-fsharp": {
    FSHARP_LANGUAGE_SERVER: provisioned("ragents.lsp-fsharp", "fsautocomplete/fsautocomplete.dll"),
  },
} as const satisfies RAgentsConfig;
