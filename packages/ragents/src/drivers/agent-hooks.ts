import type {
  AgentContribution,
  AgentContributionContext,
  AgentHookContext,
  ModelCallContext,
  ToolCallOutcome,
  ToolResultReplacement,
} from "../plugin-types.ts";

/** A hook of a plugin, bound to one agent; the agent driver calls it directly. */
export interface AgentHook {
  readonly id: string;
  readonly beforeModelCall?: (call: ModelCallContext) => string | undefined | Promise<string | undefined>;
  readonly afterToolCall?: (outcome: ToolCallOutcome, call: AgentHookContext) =>
    ToolResultReplacement | undefined | Promise<ToolResultReplacement | undefined>;
}

/** The one place that binds the hooks of a plugin to an agent; plugins never see the agent runtime. */
export const agentHookOf = (contribution: AgentContribution, agent: AgentContributionContext): AgentHook => {
  const { id, beforeModelCall, afterToolCall } = contribution;

  return {
    id,
    ...(beforeModelCall ? { beforeModelCall: (call: ModelCallContext) => beforeModelCall(agent, call) } : {}),
    ...(afterToolCall ? { afterToolCall: (outcome: ToolCallOutcome, call: AgentHookContext) => afterToolCall(agent, outcome, call) } : {}),
  };
};
