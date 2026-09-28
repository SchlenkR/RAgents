/** The form of the read, write, edit and bash tools; the host runs them in its workspace executor. */

import type { AgentToolResult, AgentToolUpdateCallback, ToolExecutionMode } from "../loop/index.ts";
import type { Static, TSchema } from "typebox";

export type { AgentToolResult, AgentToolUpdateCallback, ToolExecutionMode };

export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown> {
	name: string;
	label: string;
	description: string;
	parameters: TParams;
	/** Optional compatibility shim to prepare raw tool call arguments before schema validation. */
	prepareArguments?: (args: unknown) => Static<TParams>;
	executionMode?: ToolExecutionMode;
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
	): Promise<AgentToolResult<TDetails>>;
}

/** Preserve parameter inference for standalone tool definitions. */
export function defineTool<TParams extends TSchema, TDetails = unknown>(
	tool: ToolDefinition<TParams, TDetails>,
): ToolDefinition<TParams, TDetails> {
	return tool;
}
