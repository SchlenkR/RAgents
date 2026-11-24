import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import type { Engine } from "../../src/ragents/engine.ts";

export const startProductProfile = async (t: TestContext, toolNames: readonly string[], suffix?: string) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-product-prompt-"));
  let shutdown: (() => Promise<void>) | undefined;
  t.after(async () => {
    try { await shutdown?.(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const preamblePath = path.join(directory, "preamble.hbs");
  const suffixPath = path.join(directory, "suffix.hbs");
  await writeFile(preamblePath, 'Product instructions.{{#if (available "bash")}} Shell enabled.{{/if}}');
  if (suffix !== undefined) await writeFile(suffixPath, suffix);
  const profile = {
    host: {
      PRODUCT_ID: "test-assistant",
      PRODUCT_TITLE: "Test Assistant",
      DATA_DIR: path.join(directory, "data"),
      PLUGINS: ["ragents.orchestration", "ragents.workspace", "ragents.product", "ragents.processes", "ragents.ask", "ragents.overseer"],
      MODEL_PROVIDERS: [{
        id: "example", baseUrl: "https://models.invalid/v1", apiKey: { kind: "environment", name: "TEST_PROFILE_MODEL_KEY" },
        models: [{ id: "assistant", contextWindow: 131_072, maxTokens: 16_384, reasoning: false, input: ["text"] }],
      }],
    },
    "ragents.workspace": { PROCESS_SANDBOX: "off" },
    "ragents.product": {
      AGENT_PROVIDER: "example",
      AGENT_MODEL: "assistant",
      AGENT_THINKING: "off",
      AGENT_COORDINATOR_THINKING: "off",
      AGENT_TOOLS: toolNames,
      SYSTEM_PROMPT_PATH: preamblePath,
      ...(suffix === undefined ? {} : { SYSTEM_PROMPT_SUFFIX_PATH: suffixPath }),
    },
  };
  const profileFile = path.join(directory, "ragents.config.test-assistant.ts");
  await writeFile(profileFile, `export const config = ${JSON.stringify(profile)};\n`);
  for (const section of Object.values(profile)) {
    for (const key of Object.keys(section)) delete process.env[key];
  }
  for (const key of ["AGENT_COORDINATOR_MODEL", "MODEL_ALIASES", "SYSTEM_PROMPT_SUFFIX_PATH", "SYSTEM_PROMPTS_DIR", "TITLE_MODEL"]) delete process.env[key];
  process.env.PRODUCT_PROFILE = "test-assistant";
  process.env.PRODUCT_PROFILE_FILE = profileFile;
  process.env.TEST_PROFILE_MODEL_KEY = "test-key";
  const { loadConfigFile, validateConfigFileSections } = await import("../../src/config-file.ts");
  await loadConfigFile();
  const { config, hostConfigKeys, HOST_SECRET_ENV_NAMES } = await import("../../src/config.ts");
  const { RunSessionProvider } = await import("../../src/provider.ts");
  const { loadPlugins } = await import("../../src/profile/plugin-discovery.ts");
  const { composeProfile } = await import("../../src/profile/compose.ts");
  const loaded = await loadPlugins(config.plugins);
  const provider = new RunSessionProvider((bridges) => composeProfile({
    product: { id: config.productId, title: config.productTitle }, pluginIds: config.plugins,
    modules: loaded.modules, web: loaded.web, executor: loaded.executor,
  }, bridges), undefined);
  validateConfigFileSections({
    hostKeys: hostConfigKeys, knownPluginIds: loaded.known, activePluginIds: config.plugins,
    declaredKeysFor: (id) => provider.plugins.config.publicEntries(id).map((entry) => entry.key),
    secretKeys: [...HOST_SECRET_ENV_NAMES, ...provider.plugins.config.secretKeys()],
  });
  shutdown = () => provider.shutdown();
  await provider.init();
  return { provider, engine: (provider as unknown as { engine: Engine }).engine };
};
