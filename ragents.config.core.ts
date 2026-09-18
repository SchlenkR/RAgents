import { env, type RAgentsConfig } from "./apps/server/src/config-definition.js";

const languageServers = `${import.meta.dirname}/.data/language-servers`;

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
      "ragents.reference",
      "ragents.lsp-roslyn",
      "ragents.lsp-fsharp",
      "ragents.lsp-typescript",
    ],
  },

  // Wächter: ein kleines Modell entscheidet je Änderung, ob ein Actor geweckt wird.

  "ragents.product": {
    OPENROUTER_API_KEY: env("OPENROUTER_VSCODE_APIKEY"),
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
    ROSLYN_LANGUAGE_SERVER: `${languageServers}/roslyn/Microsoft.CodeAnalysis.LanguageServer.dll`,
  },
  "ragents.lsp-fsharp": {
    FSHARP_LANGUAGE_SERVER: `${languageServers}/fsautocomplete/fsautocomplete`,
  },
} as const satisfies RAgentsConfig;
