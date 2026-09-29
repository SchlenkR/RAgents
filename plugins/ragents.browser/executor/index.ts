import type { WorkspaceExecutorContribution } from "@ragents/workspace-executor";
import { browserModule } from "./module.js";

/** Der Browser läuft dort, wo der Arbeitsbereich des Runs liegt: im Executor des Servers oder in dem des Arbeitsplatzes. */
export const executor: WorkspaceExecutorContribution = (machine) => ({ modules: [browserModule(machine)] });
