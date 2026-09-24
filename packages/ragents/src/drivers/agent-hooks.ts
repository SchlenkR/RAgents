import type { InlineExtension } from "@ragents/agent";
import type { JsonValue } from "../domain/json.ts";
import type { AgentContribution, AgentContributionContext, AgentHookContext } from "../plugin-types.ts";

const hookContextOf = (context: { signal: AbortSignal | undefined; model: { input: readonly string[] } | undefined }): AgentHookContext => ({
  signal: context.signal,
  modelReadsImages: context.model?.input.includes("image") === true,
});

/** The one place that turns the hooks of a plugin into an extension of the agent runtime; plugins never see the runtime. */
export const agentHookExtension = (contribution: AgentContribution, agent: AgentContributionContext): InlineExtension => ({
  name: contribution.id,
  factory: (api) => {
    const { beforeModelCall, afterToolCall } = contribution;
    if (beforeModelCall) {
      api.on("context", async (event, context) => {
        const stored = context.sessionManager.getBranch()
          .filter((entry) => entry.type === "custom" && entry.customType === contribution.id)
          .at(-1);
        const note = await beforeModelCall(agent, {
          ...hookContextOf(context),
          kept: stored?.type === "custom" ? stored.data as JsonValue : undefined,
          keep: (value) => api.appendEntry(contribution.id, value),
        });
        if (note === undefined) return undefined;
        return { messages: [...event.messages, { role: "custom" as const, customType: contribution.id, content: note, display: false, timestamp: Date.now() }] };
      });
    }
    if (afterToolCall) {
      api.on("tool_result", async (event, context) => {
        const replacement = await afterToolCall(agent, { toolName: event.toolName, isError: event.isError }, hookContextOf(context));
        if (replacement === undefined) return undefined;
        return {
          content: replacement.content.map((part) => ({ ...part })),
          ...(replacement.isError === undefined ? {} : { isError: replacement.isError }),
        };
      });
    }
  },
});
