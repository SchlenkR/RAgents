import type { WorkspaceExecutorContribution } from "@ragents/workspace-executor";
import { acpModule } from "./executor/module.js";

export const executor: WorkspaceExecutorContribution = (machine) => ({ modules: [acpModule(machine)] });
