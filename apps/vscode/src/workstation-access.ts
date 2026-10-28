import * as vscode from "vscode";
import { dirname, join } from "node:path";

export const workstationFullAccessOptions = (globalStorageDirectory?: string) => ({
  protectedPaths: (): readonly string[] => {
    if (!globalStorageDirectory) return [];
    const user = dirname(dirname(globalStorageDirectory));
    return [dirname(globalStorageDirectory), join(user, "settings.json"), join(user, "profiles"), join(dirname(user), "Machine")];
  },
  fullAccess: (): "ask" | "allow" | "deny" => {
    const policy = vscode.workspace.getConfiguration("ragents").get<string>("workstation.fullAccess", "ask");
    return policy === "allow" || policy === "deny" ? policy : "ask";
  },
  confirmFullAccess: async ({ name, runId }: { readonly name: string; readonly runId: string }) => await vscode.window.showWarningMessage(
    `Allow full access for the run "${name}" (${runId})?`,
    { modal: true, detail: "The run can read and change every file this account can access, run commands without an OS sandbox, "
      + "and use the full inherited environment, including credentials. This decision is remembered on this machine for this run." },
    "Allow full access",
  ) === "Allow full access",
});
