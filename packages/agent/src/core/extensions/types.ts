/** Extensions are inline factories: they adjust the system prompt, the messages of a model call and tool results, and register tools. */

import type { AgentMessage, AgentToolResult, AgentToolUpdateCallback, ToolExecutionMode } from "../../loop/index.ts";
import type { ImageContent, Model, TextContent, UserAttachment } from "@ragents/ai";
import type { Static, TSchema } from "typebox";
import type { ReadonlySessionManager } from "../session-manager.ts";
import type { SourceInfo } from "../source-info.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";

export type { BuildSystemPromptOptions } from "../system-prompt.ts";
export type { AgentToolResult, AgentToolUpdateCallback, ToolExecutionMode };

/** Context passed to extension event handlers and tools. */
export interface ExtensionContext {
	/** Session manager (read-only) */
	sessionManager: ReadonlySessionManager;
	/** Current model (may be undefined) */
	model: Model<any> | undefined;
	/** The current abort signal, or undefined when the agent is not streaming. */
	signal: AbortSignal | undefined;
}

/** Tool definition for registerTool(). */
export interface ToolDefinition<TParams extends TSchema = TSchema, TDetails = unknown, TState = any> {
	/** Tool name (used in LLM tool calls) */
	name: string;
	/** Human-readable label */
	label: string;
	/** Description for LLM */
	description: string;
	/** Optional one-line snippet for the Available tools section in the default system prompt. */
	promptSnippet?: string;
	/** Optional guideline bullets appended to the default system prompt Guidelines section when this tool is active. */
	promptGuidelines?: string[];
	/** Parameter schema (TypeBox) */
	parameters: TParams;
	/** Optional compatibility shim to prepare raw tool call arguments before schema validation. */
	prepareArguments?: (args: unknown) => Static<TParams>;
	/** Per-tool execution mode override; if omitted, the default execution mode applies. */
	executionMode?: ToolExecutionMode;
	/** Execute the tool. */
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<TDetails>>;
}

type AnyToolDefinition = ToolDefinition<any, any, any>;

/** Preserve parameter inference for standalone tool definitions. */
export function defineTool<TParams extends TSchema, TDetails = unknown, TState = any>(
	tool: ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition {
	return tool as ToolDefinition<TParams, TDetails, TState> & AnyToolDefinition;
}

/** Fired before each LLM call. Can modify messages. */
export interface ContextEvent {
	type: "context";
	messages: AgentMessage[];
}

/** Fired after the user submits a prompt but before the agent loop. */
export interface BeforeAgentStartEvent {
	type: "before_agent_start";
	/** The raw user prompt text. */
	prompt: string;
	attachments?: UserAttachment[];
	/** The fully assembled system prompt string. */
	systemPrompt: string;
	/** Structured options used to build the system prompt. */
	systemPromptOptions: BuildSystemPromptOptions;
}

/** Fired after a tool executes. Can modify the result. */
export interface ToolResultEvent {
	type: "tool_result";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
	content: (TextContent | ImageContent)[];
	details: unknown;
	isError: boolean;
}

export type ExtensionEvent = ContextEvent | BeforeAgentStartEvent | ToolResultEvent;

export interface ContextEventResult {
	messages?: AgentMessage[];
}

export interface ToolResultEventResult {
	content?: (TextContent | ImageContent)[];
	details?: unknown;
	isError?: boolean;
}

export interface BeforeAgentStartEventResult {
	/** Replace the system prompt for this turn. If multiple extensions return this, they are chained. */
	systemPrompt?: string;
}

/** Handler function type for events */
export type ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;

/** ExtensionAPI passed to extension factory functions. */
export interface ExtensionAPI {
	on(event: "before_agent_start", handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>): void;
	on(event: "context", handler: ExtensionHandler<ContextEvent, ContextEventResult>): void;
	on(event: "tool_result", handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>): void;

	/** Register a tool that the LLM can call. */
	registerTool<TParams extends TSchema = TSchema, TDetails = unknown, TState = any>(
		tool: ToolDefinition<TParams, TDetails, TState>,
	): void;

	/** Append a custom entry to the session for state persistence (not sent to LLM). */
	appendEntry<T = unknown>(customType: string, data?: T): void;

	/** Get all configured tools with parameter schema, prompt guidelines, and source metadata. */
	getAllTools(): ToolInfo[];

	/** Set the active tools by name. */
	setActiveTools(toolNames: string[]): void;
}

export interface ExtensionFactoryContext {
	readonly signal: AbortSignal;
}

/** Extension factory function type. Supports both sync and async initialization. */
export type ExtensionFactory = (agent: ExtensionAPI, context: ExtensionFactoryContext) => void | Promise<void>;

/** Observes the actual lifetime of an async extension factory, independently of an aborted loader wait. */
export type ExtensionFactorySettlementObserver = (settlement: Promise<void>) => void;

export type InlineExtension =
	| ExtensionFactory
	| {
			/** Display name shown as `<inline:name>`. */
			name: string;
			factory: ExtensionFactory;
	  };

export interface RegisteredTool {
	definition: ToolDefinition;
	sourceInfo: SourceInfo;
}

type HandlerFn = (...args: unknown[]) => Promise<unknown>;

/** Tool info with name, description, parameter schema, prompt guidelines, and source metadata. */
export type ToolInfo = Pick<ToolDefinition, "name" | "description" | "parameters" | "promptGuidelines"> & {
	sourceInfo: SourceInfo;
};

/** Action implementations behind the ExtensionAPI, provided by the session. */
export interface ExtensionActions {
	appendEntry: <T = unknown>(customType: string, data?: T) => void;
	getAllTools: () => ToolInfo[];
	setActiveTools: (toolNames: string[]) => void;
	refreshTools: () => void;
}

/** Shared state created by the loader; actions are throwing stubs until the runner binds the session. */
export interface ExtensionRuntime extends ExtensionActions {
	/** Throws when this extension instance is stale. */
	assertActive: () => void;
	/** Marks this extension instance as stale. */
	invalidate: (message?: string) => void;
}

/** Loaded extension with all registered items. */
export interface Extension {
	path: string;
	sourceInfo: SourceInfo;
	handlers: Map<string, HandlerFn[]>;
	tools: Map<string, RegisteredTool>;
}

/** Result of loading extensions. */
export interface LoadExtensionsResult {
	extensions: Extension[];
	errors: Array<{ path: string; error: string }>;
	/** Shared runtime - actions are throwing stubs until the runner binds the session */
	runtime: ExtensionRuntime;
}

export interface ExtensionError {
	extensionPath: string;
	event: string;
	error: string;
	stack?: string;
}
