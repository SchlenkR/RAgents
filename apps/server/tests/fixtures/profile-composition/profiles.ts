export interface CompositionFixture {
  product: { id: string; title: string };
  plugins: readonly string[];
}

export const coreFixture: CompositionFixture = {
  product: { id: "test-core", title: "Core composition fixture" },
  plugins: [
    "ragents.orchestration", "ragents.workspace", "ragents.product", "ragents.overseer",
    "ragents.activity", "ragents.processes", "ragents.documents", "ragents.browser", "ragents.ask", "ragents.todo",
    "ragents.watch", "ragents.transcript", "ragents.actor-programs", "ragents.reference",
    "ragents.lsp-roslyn", "ragents.lsp-fsharp", "ragents.lsp-typescript",
  ],
};

export const minimalFixture: CompositionFixture = {
  product: { id: "test-minimal", title: "Minimal composition fixture" },
  plugins: ["ragents.orchestration", "ragents.workspace", "ragents.product", "ragents.documents", "ragents.ask", "ragents.todo"],
};

export const compositionEnvironment: Readonly<Record<string, string | undefined>> = {
  PRODUCT_PROFILE: "test-composition",
  PRODUCT_ID: "test-composition",
  PRODUCT_TITLE: "Composition fixture",
  AGENT_PROVIDER: "openrouter",
  AGENT_MODEL: "z-ai/glm-5.3",
  AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash",
  AGENT_THINKING: "high",
  AGENT_COORDINATOR_THINKING: "low",
  AGENT_MODELS: undefined,
  AGENT_MODEL_REASONING: undefined,
  MODEL_SELECTABLE: undefined,
  OPENROUTER_API_KEY: "test-key",
  ACCESS_TOKEN: undefined,
  COMPACTION_MODEL: "",
  SYSTEM_PROMPT_PATH: undefined,
  SYSTEM_PROMPTS_DIR: undefined,
  SYSTEM_PROMPT_MODE: undefined,
  SYSTEM_PROMPT_DEFAULT: undefined,
  SYSTEM_PROMPT_SHARE_DEFAULT: undefined,
  SKILLS_DIR: undefined,
  DOCUMENTS_DIR: undefined,
  BROWSER_EXECUTABLE_PATH: undefined,
};
