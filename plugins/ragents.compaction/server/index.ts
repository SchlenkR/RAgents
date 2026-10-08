import { contextToolResults, type AgentContribution, type Orchestration, type RAgentsPlugin } from "@ragents/engine";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { runtimeProviderToken } from "@ragents/host/ragents/host-services.js";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { COMPACTION_PLUGIN_ID, recalledContent, recoveryNotes, resultByReference, retainedResults, retentionState } from "./context.js";
import { createContextTools } from "./tools.js";

export const compactionContribution = (runtime: () => Orchestration): AgentContribution => ({
  id: COMPACTION_PLUGIN_ID,
  beforeModelCall: (_agent, call) => {
    if (!call.toolNames?.includes("context_keep")) return undefined;
    const state = retentionState(call.kept);
    if (state.budgetTokens !== call.retentionTokens || state.modelReadsImages !== call.modelReadsImages)
      call.keep({ ...state, budgetTokens: call.retentionTokens ?? 0, modelReadsImages: call.modelReadsImages });
    return undefined;
  },
  beforeCompaction: (agent, call) => {
    const results = contextToolResults(runtime().modelContext(agent.runId, agent.agentId).entries);
    const state = retentionState(call.kept);
    const selected = retainedResults(results, state, call.retentionTokens, call.modelReadsImages);
    const canRecall = call.toolNames?.includes("context_list") && call.toolNames.includes("context_recall");
    return {
      toolResultIds: selected.map((result) => result.entryId),
      ...(canRecall ? { contextNotes: recoveryNotes(results, Math.floor(call.retentionTokens / 2), call.toolNames!.includes("context_keep")) } : {}),
    };
  },
  afterToolCall: (agent, outcome, call) => {
    if (outcome.toolName !== "context_recall" || outcome.isError || !outcome.toolCallId) return;
    const entries = runtime().modelContext(agent.runId, agent.agentId).entries;
    const invocation = entries.flatMap((entry) => entry.kind === "message" && entry.message.role === "assistant"
      ? entry.message.content.flatMap((part) => part.type === "toolCall" && part.id === outcome.toolCallId ? [part] : []) : []).at(-1);
    if (!invocation || typeof invocation.arguments.reference !== "string") throw new Error("The context recall call is missing from the journal.");
    const result = resultByReference(contextToolResults(entries), invocation.arguments.reference);
    const content = recalledContent(result, invocation.arguments.offset as number | undefined, invocation.arguments.limit as number | undefined);
    if (content.some((part) => part.type === "image") && !call.modelReadsImages) {
      return { content: [{ type: "text", text: "This result contains images, but the selected model does not accept image input." }], isError: true };
    }
    return { content };
  },
});

const createPlugin = (): RAgentsPlugin => ({
  manifest: { id: COMPACTION_PLUGIN_ID },
  register: (host) => {
    const runtime = host.service(runtimeProviderToken);
    const tools = createContextTools();
    host.functions({
      name: COMPACTION_PLUGIN_ID,
      descriptors: tools.map((tool) => toolDescriptorFrom(tool, tool.available)),
      tools: () => tools,
    });
    host.agentRuntime(compactionContribution(runtime));
  },
});

export const plugin: PluginModule = { create: createPlugin };
