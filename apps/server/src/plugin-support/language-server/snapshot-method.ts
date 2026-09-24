import { implement, type AccessContext, type MethodContribution } from "@ragents/engine";
import { languageServerSnapshotOperation, type LanguageServerSnapshot } from "@ragents/workspace-executor";
import type { SandboxServices } from "../workspace-sandbox-host.js";
import { languageServerSnapshotContract } from "./contract.js";

export interface LanguageServerMethodOptions {
  pluginId: string;
  adapterId: string;
  sandbox: SandboxServices;
  /** Die Sprachserver arbeiten im Arbeitsbereich des Runs; wer ihn nicht sehen darf, sieht auch ihren Stand nicht. */
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
}

export const createLanguageServerSnapshotMethod = (options: LanguageServerMethodOptions): MethodContribution =>
  implement(languageServerSnapshotContract(options.pluginId), async ({ runId }, { access }) => {
    options.ensureWorkspaceAccess(access, runId);
    return await options.sandbox.execute(runId, languageServerSnapshotOperation(options.adapterId), null) as LanguageServerSnapshot;
  });
