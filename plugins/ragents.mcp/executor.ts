import type { WorkspaceExecutorContribution } from "@ragents/workspace-executor";
import { mcpModule } from "./executor/module.js";

export const executor: WorkspaceExecutorContribution = (machine) => ({ modules: [mcpModule(machine)] });
