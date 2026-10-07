import { implement, type AccessContext, type MethodContribution } from "@ragents/engine";
import {
  languageServerSnapshotOperation,
  languageServerSolutionsOperation,
  languageServerSwitchOperation,
  type LanguageServerSnapshot,
  type LanguageServerSolutions,
} from "@ragents/workspace-executor";
import type { SandboxServices } from "../workspace-sandbox-host.js";
import { languageServerSnapshotContract, languageServerSolutionsContract, languageServerSwitchContract } from "./contract.js";

export interface LanguageServerMethodOptions {
  pluginId: string;
  adapterId: string;
  sandbox: SandboxServices;
  /** The language servers work in the run's workspace; whoever may not see it does not see their state either. */
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
  opened: (runId: string) => void;
}

export const createLanguageServerSnapshotMethod = (options: LanguageServerMethodOptions): MethodContribution =>
  implement(languageServerSnapshotContract(options.pluginId), async ({ runId }, { access, signal }) => {
    options.ensureWorkspaceAccess(access, runId);
    return await options.sandbox.execute(runId, languageServerSnapshotOperation(options.adapterId), null, { signal }) as LanguageServerSnapshot;
  });

export const createLanguageServerSolutionMethods = (options: LanguageServerMethodOptions): MethodContribution[] => {
  const solutions = async (runId: string, signal: AbortSignal): Promise<LanguageServerSolutions> =>
    await options.sandbox.execute(runId, languageServerSolutionsOperation(options.adapterId), null, { signal }) as LanguageServerSolutions;
  return [
    implement(languageServerSolutionsContract(options.pluginId), async ({ runId }, { access, signal }) => {
      options.ensureWorkspaceAccess(access, runId);
      return await solutions(runId, signal);
    }),
    implement(languageServerSwitchContract(options.pluginId), async ({ runId, root }, { access, signal }) => {
      options.ensureWorkspaceAccess(access, runId);
      await options.sandbox.execute(runId, languageServerSwitchOperation(options.adapterId), { root }, { signal });
      signal.throwIfAborted();
      if (root !== null) options.opened(runId);
      return await solutions(runId, signal);
    }),
  ];
};
