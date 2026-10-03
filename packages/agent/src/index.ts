// Everything the engine, the server and the workspace executor use; the rest is internal.
export { aliasedModel, type ModelAlias, ModelRuntime, thinkingLevelsProblem } from "./core/model-runtime.ts";
export { type AgentSettings, type AgentSettingsInput, agentSettings } from "./core/agent-settings.ts";
export {
	activeContextEntries,
	type ContextCompaction,
	type ContextLogEntry,
	contextMessages,
	latestCompaction,
} from "./core/context-log.ts";
export {
	calculateContextTokens,
	compact,
	compactionOf,
	compactionProblem,
	type CompactionSource,
	estimateContextTokens,
	prepareCompaction,
	shouldCompact,
} from "./core/compaction/index.ts";
export { convertToLlm } from "./core/messages.ts";
export { formatSkillsForPrompt, type Skill } from "./core/skills.ts";
export { defineTool, type ToolDefinition } from "./core/tool-definition.ts";
export {
	type BackgroundTaskOperations,
	type BackgroundTaskOutput,
	type BackgroundTaskStatus,
	backgroundStatusText,
	BASH_MAX_TIMEOUT_MS,
	type BashOperations,
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createTaskOutputToolDefinition,
	createTaskStopToolDefinition,
	createWriteToolDefinition,
	editApplies,
} from "./core/tools/index.ts";
export {
	Agent,
	type AgentEvent,
	type AgentLoopTurnUpdate,
	type AgentMessage,
	type AgentTool,
	type AgentToolResult,
	EMPTY_RESPONSE_NUDGE,
	isRunFailure,
	type ThinkingLevel,
} from "./loop/index.ts";
export { parseFrontmatter, stripFrontmatter } from "./utils/frontmatter.ts";
export { getShellConfig, killProcessTree, type ShellConfig } from "./utils/shell.ts";
