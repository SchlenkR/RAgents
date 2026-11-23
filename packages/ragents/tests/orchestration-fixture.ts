import { orchestrationToolContributor } from "../../../plugins/ragents.orchestration/server/functions.ts";
import { ToolRegistry } from "../src/agents/plugins.ts";

export const orchestrationRegistry = () => new ToolRegistry().register(orchestrationToolContributor());
