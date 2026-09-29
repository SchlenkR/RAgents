import type { WorkspaceExecutorContribution } from "@ragents/workspace-executor";
import { browserModule } from "./module.js";

/** The browser runs where the run's workspace lives: in the server's executor or in the workspace's. */
export const executor: WorkspaceExecutorContribution = (machine) => ({ modules: [browserModule(machine)] });
