import { ToolRegistry, type RunFunction, type ExecutableActor, type PluginHost } from "@ragents/engine";
import { runtimeProviderToken, runWorkspaceProviderToken } from "@ragents/host/ragents/host-services.js";

export const agentToolsFrom = (host: PluginHost) =>
  async (runId: string, actorId: string, provisional?: ExecutableActor): Promise<readonly RunFunction[]> => {
    const runtime = host.service(runtimeProviderToken)();
    const view = runtime.view(runId);
    const actor = provisional ?? view.actors.find((candidate) => candidate.id === actorId);
    if (!actor || actor.kind === "human" || actor.lifecycle.kind === "stopped") {
      throw new Error(`${actorId} bezeichnet keinen aktiven Agenten in diesem Run.`);
    }
    const registry = new ToolRegistry();
    host.tools.entries().forEach((contributor) => registry.register(contributor));
    const workspace = await host.service(runWorkspaceProviderToken)(runId);
    const tools = await registry.resolve({
      runId,
      actorId,
      turnId: null,
      actor,
      view: provisional ? {...view,actors:[...view.actors,provisional]} : view,
      workspace: workspace.cwd,
    });
    if (actor.toolNames === null) return tools;
    const availableNames = new Set(tools.map((tool) => tool.name));
    const unknown = actor.toolNames.filter((name) => !availableNames.has(name));
    if (unknown.length > 0) {
      throw new Error(`Actor ${actorId} verlangt unbekannte Werkzeuge: ${unknown.join(", ")}.`);
    }
    const selected = new Set(actor.toolNames);
    return tools.filter((tool) => selected.has(tool.name));
  };
