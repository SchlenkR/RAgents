import { declaredEnvironment } from "@ragents/host/plugin-support/plugin-config.js";
import { PROCESS_SANDBOX_DEFAULT_NETWORK } from "@ragents/host/plugin-support/process-sandbox.js";

export const workspaceConfigDescriptors = [
  { key: "PROCESS_SANDBOX", source: "environment" },
  { key: "PROCESS_SANDBOX_NETWORK", source: "environment" },
  { key: "RAGENTS_BASH", source: "environment" },
] as const;

const env = declaredEnvironment(workspaceConfigDescriptors);

export interface ProcessSandboxSetting {
  readonly enabled: boolean;
  readonly network: readonly string[];
}

/** Ohne Angabe ist die Sandbox an; abschalten geht nur ausdrücklich mit "off". */
export const processSandboxSetting = (): ProcessSandboxSetting => {
  const mode = env.optional("PROCESS_SANDBOX") ?? "on";
  if (mode !== "on" && mode !== "off") {
    throw new Error(`PROCESS_SANDBOX in der Sektion ragents.workspace ist "on" oder "off", nicht "${mode}"`);
  }
  const network = env.optional("PROCESS_SANDBOX_NETWORK") === undefined
    ? PROCESS_SANDBOX_DEFAULT_NETWORK
    : env.list("PROCESS_SANDBOX_NETWORK");
  return { enabled: mode === "on", network };
};

/** Die Bash, mit der der Executor dieses Servers das Werkzeug bash startet; unter Windows setzt sie die VS-Code-Erweiterung für ihren lokalen Host. */
export const bashSetting = (): string | undefined => env.optional("RAGENTS_BASH") || undefined;
