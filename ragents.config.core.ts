import { env, provisioned, type RAgentsConfig } from "./apps/server/src/config-definition.js";

export const config = {
  host: {
    PORT: 4710,
    PRODUCT_PROFILE: "core",
    COMPACTION_MODEL: "google/gemma-4-26b-a4b-it",
    PRODUCT_ID: "ragents",
    PRODUCT_TITLE: "RAgents",
    PLUGINS: [
      "ragents.orchestration",
      "ragents.workspace",
      "ragents.product",
      "ragents.overseer",
      "ragents.activity",
      "ragents.processes",
      "ragents.documents",
      "ragents.browser",
      "ragents.ask",
      "ragents.todo",
      "ragents.watch",
      "ragents.transcript",
      "ragents.actor-programs",
      "ragents.lsp-roslyn",
      "ragents.lsp-fsharp",
      "ragents.lsp-typescript",
      "ragents.model-relay",
      "ragents.profile-distribution",
    ],
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

  // Modell-Relay: Aliasse für andere RAgents-Server, die ihre Modelle von hier beziehen.
  "ragents.model-relay": {
    RELAY_MODELS: ["core-standard=openrouter/z-ai/glm-5.3-flash", "core-coordinator=openrouter/deepseek/deepseek-v4-flash-0731"],
  },

  "ragents.lsp-roslyn": {
    ROSLYN_LANGUAGE_SERVER: provisioned("ragents.lsp-roslyn", "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"),
  },
  "ragents.lsp-fsharp": {
    FSHARP_LANGUAGE_SERVER: provisioned("ragents.lsp-fsharp", "fsautocomplete/fsautocomplete.dll"),
  },
} as const satisfies RAgentsConfig;
