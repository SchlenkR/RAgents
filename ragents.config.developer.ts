// Programming profile: a server without sign-in on your own machine, for agents and workspaces.
import { env, provisioned, type ProfileAnonymousUser, type RAgentsConfig } from "./apps/server/src/config-definition.js";

export const anonymousUser = {
  id: "developer",
  label: "Developer",
  rights: ["*"],
} as const satisfies ProfileAnonymousUser;

export const config = {
  host: {
    MODEL_PROVIDERS: [{
      id: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: env("OPENROUTER_API_KEY"),
      models: [
        {
          id: "z-ai/glm-5.3-flash",
          contextWindow: 1048575,
          maxTokens: 943717,
          reasoning: true,
          input: ["text", "image", "video"],
          thinkingLevelMap: {
            off: null,
            minimal: null,
            low: "low",
            medium: null,
            high: "high",
            xhigh: null,
            max: "max",
          },
          cost: {
            input: 0.15,
            output: 0.5,
            cacheRead: 0.03,
            cacheWrite: 0,
          },
        },
        {
          id: "deepseek/deepseek-v4-flash-0731",
          contextWindow: 1048576,
          maxTokens: 943718,
          reasoning: true,
          input: ["text"],
          thinkingLevelMap: {
            off: "none",
            minimal: null,
            low: null,
            medium: null,
            high: "high",
            xhigh: "xhigh",
            max: null,
          },
          cost: {
            input: 0.018,
            output: 0.32,
            cacheRead: 0.018,
            cacheWrite: 0,
          },
        },
      ],
    }],
    PORT: 4715,
    PRODUCT_PROFILE: "developer",
    PRODUCT_ID: "ragents-developer",
    PRODUCT_TITLE: "RAgents Developer",
    PLUGINS: [
      "ragents.orchestration",
      "ragents.workspace",
      "ragents.compaction",
      "ragents.product",
      "ragents.documents",
      "ragents.browser",
      "ragents.mcp",
      "ragents.ask",
      "ragents.acp",
      "ragents.todo",
      "ragents.watch",
      "ragents.actor-programs",
      "ragents.overseer",
      "ragents.global-apps",
      "ragents.activity",
      "ragents.processes",
      "ragents.lsp-roslyn",
      "ragents.lsp-fsharp",
      "ragents.lsp-typescript",
    ],
  },

  "ragents.acp": {
    ACP_AGENTS: {},
  },

  "ragents.mcp": {
    MCP_SERVERS: {},
  },

  "ragents.product": {
    AGENT_PROVIDER: "openrouter",
    AGENT_MODEL: "z-ai/glm-5.3-flash",
    AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash",
    AGENT_COORDINATOR_THINKING: "low",
    AGENT_MODELS: ["z-ai/glm-5.3-flash", "deepseek/deepseek-v4-flash-0731"],
  },

  "ragents.lsp-roslyn": {
    ROSLYN_LANGUAGE_SERVER: provisioned("ragents.lsp-roslyn", "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll"),
    ROSLYN_SOLUTION_ON_START: "on",
  },
  "ragents.lsp-fsharp": {
    FSHARP_LANGUAGE_SERVER: provisioned("ragents.lsp-fsharp", "fsautocomplete/fsautocomplete.dll"),
  },
} as const satisfies RAgentsConfig;
