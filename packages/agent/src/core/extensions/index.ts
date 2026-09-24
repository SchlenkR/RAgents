/**
 * Extension system for agent hooks and custom tools.
 */

export type { SourceInfo } from "../source-info.ts";
export { createExtensionRuntime, loadExtensionFromFactory } from "./loader.ts";
export type { ExtensionContextSource, ExtensionErrorListener } from "./runner.ts";
export { ExtensionRunner, STALE_EXTENSION_MESSAGE } from "./runner.ts";
export type {
	AgentToolResult,
	AgentToolUpdateCallback,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	BuildSystemPromptOptions,
	ContextEvent,
	ContextEventResult,
	Extension,
	ExtensionActions,
	ExtensionAPI,
	ExtensionContext,
	ExtensionError,
	ExtensionEvent,
	ExtensionFactory,
	ExtensionFactoryContext,
	ExtensionFactorySettlementObserver,
	ExtensionHandler,
	ExtensionRuntime,
	InlineExtension,
	LoadExtensionsResult,
	RegisteredTool,
	ToolDefinition,
	ToolExecutionMode,
	ToolInfo,
	ToolResultEvent,
	ToolResultEventResult,
} from "./types.ts";
export { defineTool } from "./types.ts";
export { wrapRegisteredTools } from "./wrapper.ts";
