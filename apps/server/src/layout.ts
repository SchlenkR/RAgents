import path from "node:path";
import { config } from "./config.js";

export const layout = {
  runsDir: path.join(config.dataDir, "runs"),
  artifactsDir: path.join(config.dataDir, "artifacts"),
  sessionsDir: path.join(config.dataDir, "sessions"),
  deleteIntentsDir: path.join(config.dataDir, "delete-intents"),
  archiveDir: path.join(config.dataDir, "archive"),
  recoveryDir: path.join(config.dataDir, "recovery"),
  serverLog: path.join(config.dataDir, "logs/server.log"),
  readMarkersFile: path.join(config.dataDir, "run-read-markers.json"),

  sessionDir: (id: string) => path.join(config.dataDir, "sessions", id),
  deleteIntentFile: (id: string) => path.join(config.dataDir, "delete-intents", `${id}.json`),
  archiveSessionDir: (id: string) => path.join(config.dataDir, "archive", id),
  recoverySessionDir: (id: string) => path.join(config.dataDir, "recovery", id),
} as const;

export const SESSIONS_MODE = 0o711;
export const SESSION_MODE = 0o711;
export const ROOT_ONLY_MODE = 0o700;
