// Programmierprofil: ein Server ohne Anmeldung auf dem eigenen Rechner, für Agenten und Arbeitsplätze.
import { env, provisioned, type ProfileAnonymousUser, type RAgentsConfig } from "./apps/server/src/config-definition.js";

export const anonymousUser = {
  id: "developer",
  label: "Entwickler",
  rights: ["*"],
} as const satisfies ProfileAnonymousUser;

export const config = {
  host: {
    PORT: 4715,
    PRODUCT_PROFILE: "developer",
    PRODUCT_ID: "ragents-developer",
    PRODUCT_TITLE: "RAgents Entwickler",
    PLUGINS: [
      "ragents.orchestration",
      "ragents.workspace",
      "ragents.product",
      "ragents.documents",
      "ragents.ask",
      "ragents.todo",
      "ragents.activity",
      "ragents.processes",
      "ragents.lsp-roslyn",
      "ragents.lsp-fsharp",
      "ragents.lsp-typescript",
    ],
  },

  "ragents.product": {
    AGENT_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: env("OPENROUTER_API_KEY"),
    AGENT_MODEL: "z-ai/glm-5.3-flash",
    AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash",
    AGENT_COORDINATOR_THINKING: "low",
    AGENT_MODELS: ["z-ai/glm-5.3-flash", "deepseek/deepseek-v4-flash-0731"],
  },

  "ragents.lsp-roslyn": {
    ROSLYN_LANGUAGE_SERVER: provisioned("ragents.lsp-roslyn", "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"),
  },
  "ragents.lsp-fsharp": {
    FSHARP_LANGUAGE_SERVER: provisioned("ragents.lsp-fsharp", "fsautocomplete/fsautocomplete.dll"),
  },
} as const satisfies RAgentsConfig;
