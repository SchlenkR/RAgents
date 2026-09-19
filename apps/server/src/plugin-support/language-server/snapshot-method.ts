import { implement, type MethodContribution } from "@aicontainer/ragents";
import { languageServerSnapshotContract } from "./contract.js";
import type { LanguageServerHost } from "./host.js";

export interface LanguageServerMethodOptions {
  pluginId: string;
  servers: LanguageServerHost;
  ensureSession: (runId: string) => void;
}

export const createLanguageServerSnapshotMethod = (options: LanguageServerMethodOptions): MethodContribution =>
  implement(languageServerSnapshotContract(options.pluginId), ({ runId }) => {
    options.ensureSession(runId);
    return options.servers.snapshot(runId);
  });
