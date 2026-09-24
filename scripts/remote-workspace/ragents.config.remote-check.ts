// Prüfprofil des Läufers scripts/remote-workspace: drei Benutzer mit persönlichem Token, Modelle aus seinem Skriptmodell.
import { env, type ProfileUser, type RAgentsConfig } from "../../apps/server/src/config-definition.js";

const operatorRights = [
  "runs.read",
  "runs.write",
  "runs.create",
  "runs.inspect",
  "runs.trace",
  "runs.delete",
  "ragents.processes.read",
] as const;

export const users = [
  {
    id: "alice",
    label: "Alice",
    password: env("REMOTE_CHECK_ALICE_PASSWORD"),
    token: env("REMOTE_CHECK_ALICE_TOKEN"),
    rights: operatorRights,
  },
  {
    id: "bob",
    label: "Bob",
    password: env("REMOTE_CHECK_BOB_PASSWORD"),
    token: env("REMOTE_CHECK_BOB_TOKEN"),
    rights: operatorRights,
  },
  {
    id: "admin",
    label: "Admin",
    password: env("REMOTE_CHECK_ADMIN_PASSWORD"),
    token: env("REMOTE_CHECK_ADMIN_TOKEN"),
    rights: ["*"],
  },
] as const satisfies readonly ProfileUser[];

export const config = {
  host: {
    PRODUCT_PROFILE: "remote-check",
    PRODUCT_ID: "ragents-remote-check",
    PRODUCT_TITLE: "RAgents Prüflauf",
    PLUGINS: [
      "ragents.orchestration",
      "ragents.workspace",
      "ragents.product",
      "ragents.processes",
      "ragents.documents",
      "ragents.ask",
      "ragents.actor-programs",
      "ragents.lsp-typescript",
    ],
  },

  "ragents.product": {
    AGENT_PROVIDER: "relay",
    RELAY_URL: env("REMOTE_CHECK_MODEL_URL"),
    RELAY_TOKEN: env("REMOTE_CHECK_MODEL_TOKEN"),
    AGENT_MODEL: "script",
    AGENT_THINKING: "off",
    AGENT_COORDINATOR_MODEL: "script",
    AGENT_COORDINATOR_THINKING: "off",
  },
} as const satisfies RAgentsConfig;
