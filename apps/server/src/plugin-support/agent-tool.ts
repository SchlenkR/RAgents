import type { ToolDefinition } from "@aicontainer/agent";
import { Type } from "typebox";
import {
  describeToolAvailability,
  defineRunFunction,
  type RunFunction,
  type ToolAvailability,
  type ToolDescriptor,
  type ToolExecutionMode,
} from "@aicontainer/ragents";

export type AgentToolDefinition = ToolDefinition<any, any, any> & { longDescription?: string; nativeTool?: boolean };
export type AgentToolMetadata = Pick<AgentToolDefinition, "name" | "description"> & { nativeTool?: boolean };

type ToolOutput = { content?: ReadonlyArray<{ type: string; text?: string }> };

type BoundExecute = (
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: unknown,
) => Promise<ToolOutput>;

const textOf = (result: ToolOutput): string =>
  (result.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

export const agentToolFrom = (
  definition: AgentToolDefinition,
  available: ToolAvailability,
  executionMode?: ToolExecutionMode,
): RunFunction =>
  defineRunFunction({
    name: definition.name,
    label: definition.label ?? definition.name,
    description: definition.description,
    ...(definition.longDescription === undefined ? {} : { longDescription: definition.longDescription }),
    ...(definition.nativeTool === undefined ? {} : { nativeTool: definition.nativeTool }),
    schema: definition.parameters,
    resultSchema: Type.String(),
    available,
    ...(executionMode ? { executionMode } : {}),
    run: async (scope, toolCallId, input) =>
      textOf(await (definition.execute as BoundExecute)(toolCallId, input, scope.signal, undefined, undefined)),
  });

export const toolDescriptorFrom = (
  definition: AgentToolMetadata,
  available: ToolAvailability,
  scope: ToolDescriptor["scope"] = "per-turn",
): ToolDescriptor => ({
  name: definition.name,
  description: definition.description,
  scope,
  ...(definition.nativeTool === undefined ? {} : { nativeTool: definition.nativeTool }),
  ...describeToolAvailability(available),
});
