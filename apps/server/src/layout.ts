import path from "node:path";
import { isPortableId } from "@ragents/engine";
import { config } from "./config.js";

const portableId = (value: string, name: string) => {
  if (!isPortableId(value)) throw new Error(`${name} must be a lowercase portable ID.`);

  return value;
};

export const layout = {
  runsDir: path.join(config.dataDir, "runs"),
  artifactsDir: path.join(config.dataDir, "artifacts"),
  sessionsDir: path.join(config.dataDir, "sessions"),
  deleteIntentsDir: path.join(config.dataDir, "delete-intents"),
  archiveDir: path.join(config.dataDir, "archive"),
  recoveryDir: path.join(config.dataDir, "recovery"),
  serverLog: path.join(config.dataDir, "logs/server.log"),

  sessionDir: (id: string) => path.join(config.dataDir, "sessions", id),
  chatDir: (id: string) => path.join(config.dataDir, "sessions", id, "chat"),
  agentChatDir: (id: string, agentId: string) => path.join(
    config.dataDir,
    "sessions",
    portableId(id, "Run ID"),
    "chat",
    portableId(agentId, "Actor ID"),
  ),
  deleteIntentFile: (id: string) => path.join(config.dataDir, "delete-intents", `${id}.json`),
  archiveSessionDir: (id: string) => path.join(config.dataDir, "archive", id),
  recoverySessionDir: (id: string) => path.join(config.dataDir, "recovery", id),
} as const;

export const SESSIONS_MODE = 0o711;
export const SESSION_MODE = 0o711;
export const ROOT_ONLY_MODE = 0o700;
