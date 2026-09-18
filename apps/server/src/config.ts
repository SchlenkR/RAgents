import path from "node:path";
import { fileURLToPath } from "node:url";
import { declaredEnvironment } from "./plugin-support/plugin-config.js";
import { defaultDataDirectory } from "./data-directory.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const hostConfigDescriptors = [
  { key: "PORT", source: "environment" },
  { key: "DATA_DIR", source: "environment" },
  { key: "WEB_DIST_DIR", source: "environment" },
  { key: "AGENT_THINKING", source: "environment" },
  { key: "AGENT_HOME_DIR", source: "environment" },
  { key: "COMPACTION_PROVIDER", source: "environment" },
  { key: "COMPACTION_MODEL", source: "environment" },
  { key: "PRODUCT_PROFILE", source: "environment" },
  { key: "PLUGINS", source: "environment" },
  { key: "PRODUCT_ID", source: "environment" },
  { key: "PRODUCT_TITLE", source: "environment" },
  { key: "RAGENTS_BASH_TIMEOUT_SECONDS", source: "environment" },
  { key: "ACCESS_TOKEN", source: "environment", secret: true },
] as const;

export const hostConfigKeys: readonly string[] = hostConfigDescriptors.map((descriptor) => descriptor.key);

export const HOST_SECRET_ENV_NAMES: readonly string[] = hostConfigDescriptors
  .filter((descriptor) => "secret" in descriptor && descriptor.secret)
  .map((descriptor) => descriptor.key);

const env = declaredEnvironment(hostConfigDescriptors);

export const config = Object.freeze({
  port: Number(env.value("PORT", "4710")),
  dataDir: path.resolve(env.value("DATA_DIR", defaultDataDirectory(env.required("PRODUCT_PROFILE")))),
  webDistDir: path.resolve(env.value("WEB_DIST_DIR", path.join(rootDir, "apps/web/dist"))),
  agentThinking: env.value("AGENT_THINKING", "high"),
  agentHomeDir: path.resolve(env.value("AGENT_HOME_DIR", path.join(rootDir, "apps/server/agent-home"))),
  compactionProvider: env.value("COMPACTION_PROVIDER", "openrouter"),
  compactionModel: env.value("COMPACTION_MODEL", ""),
  productProfile: env.required("PRODUCT_PROFILE"),
  productId: env.required("PRODUCT_ID"),
  productTitle: env.required("PRODUCT_TITLE"),
  plugins: env.list("PLUGINS"),
});

export type Config = typeof config;
