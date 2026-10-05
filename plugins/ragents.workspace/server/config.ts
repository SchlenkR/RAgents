import { declaredEnvironment } from "@ragents/host/plugin-support/plugin-config.js";
import { PROCESS_SANDBOX_DEFAULT_NETWORK } from "@ragents/host/plugin-support/process-sandbox.js";

export const workspaceConfigDescriptors = [
  { key: "PROCESS_SANDBOX", source: "environment" },
  { key: "PROCESS_SANDBOX_NETWORK", source: "environment" },
  { key: "RAGENTS_BASH", source: "environment" },
  { key: "RAGENTS_RG", source: "environment" },
  { key: "RAGENTS_BASH_TIMEOUT_SECONDS", source: "environment" },
] as const;

const env = declaredEnvironment(workspaceConfigDescriptors);

export interface ProcessSandboxSetting {
  readonly enabled: boolean;
  readonly network: readonly string[];
}

export const PROCESS_SANDBOX_OFF = 'PROCESS_SANDBOX: "auto" in the ragents.workspace section (administrator runs only)';

export const processSandboxSetting = (): ProcessSandboxSetting => {
  const mode = env.optional("PROCESS_SANDBOX") ?? "auto";
  if (mode !== "on" && mode !== "off" && mode !== "auto") {
    throw new Error(`PROCESS_SANDBOX in the ragents.workspace section is "on", "auto" or "off", not "${mode}"`);
  }
  const network = env.optional("PROCESS_SANDBOX_NETWORK") === undefined
    ? PROCESS_SANDBOX_DEFAULT_NETWORK
    : env.list("PROCESS_SANDBOX_NETWORK");
  return { enabled: mode === "on", network };
};

/** The bash with which the executor of this server starts the bash tool; on Windows the VS Code extension sets it for its local host. */
export const bashSetting = (): string | undefined => env.optional("RAGENTS_BASH") || undefined;

/** The rg that the executor of this server puts at the front of the bash PATH; the VS Code extension sets it for its local host. */
export const rgSetting = (): string | undefined => env.optional("RAGENTS_RG") || undefined;

/** The bash timeout in seconds for calls without their own; the server rejects more than the largest a call may name at startup. */
export const bashTimeoutSetting = (): number | undefined =>
  env.optional("RAGENTS_BASH_TIMEOUT_SECONDS") ? env.positiveNumber("RAGENTS_BASH_TIMEOUT_SECONDS", "") : undefined;
