import { Agent, type ThinkingLevel } from "../loop/index.ts";
import { clampThinkingLevel, type Model } from "@ragents/ai";
import { resolvePath } from "../utils/paths.ts";
import { AgentSession } from "./agent-session.ts";
import { DEFAULT_THINKING_LEVEL } from "./defaults.ts";
import type { ExtensionRunner, LoadExtensionsResult, ToolDefinition } from "./extensions/index.ts";
import { convertToLlm } from "./messages.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import type { ResourceLoader } from "./resource-loader.ts";
import type { SessionManager } from "./session-manager.ts";
import { type AgentSettingsInput, agentSettings } from "./agent-settings.ts";

export interface CreateAgentSessionOptions {
	/** Working directory of the session. Default: the working directory of the session manager */
	cwd?: string;
	modelRuntime: ModelRuntime;
	/** The model of the session; a session without one is an error. */
	model: Model<any>;
	/** Thinking level. Default: from the session, else settings, else 'medium' (clamped to model capabilities) */
	thinkingLevel?: ThinkingLevel;
	/** Optional allowlist of tool names; without it every registered tool is enabled. */
	tools?: string[];
	/** Custom tools to register besides the tools of extensions. */
	customTools?: ToolDefinition[];
	/** Loaded resources: extensions, skills and the system prompt. */
	resourceLoader: ResourceLoader;
	sessionManager: SessionManager;
	settings?: AgentSettingsInput;
}

/** Result from createAgentSession */
export interface CreateAgentSessionResult {
	/** The created session */
	session: AgentSession;
	/** Extensions of the session, with the errors of their factories */
	extensionsResult: LoadExtensionsResult;
}

// Re-exports

export * from "./agent-session-runtime.ts";
export type { ExtensionAPI, ExtensionContext, ExtensionFactory, InlineExtension, ToolDefinition } from "./extensions/index.ts";
export type { Skill } from "./skills.ts";

/** Create an AgentSession for the given model. */
export async function createAgentSession(options: CreateAgentSessionOptions): Promise<CreateAgentSessionResult> {
	const model = options.model;
	if (!model) {
		throw new Error("An agent session needs a model.");
	}
	const cwd = resolvePath(options.cwd ?? options.sessionManager.getCwd());
	const { modelRuntime, resourceLoader, sessionManager } = options;
	const settings = agentSettings(options.settings);

	// Check if session has existing data to restore
	const existingSession = sessionManager.buildSessionContext();
	const hasExistingSession = existingSession.messages.length > 0;
	const hasThinkingEntry = sessionManager.getBranch().some((entry) => entry.type === "thinking_level_change");

	// A resumed session keeps its thinking level unless the caller sets one
	const restoredThinkingLevel =
		hasExistingSession && hasThinkingEntry ? (existingSession.thinkingLevel as ThinkingLevel) : undefined;
	const thinkingLevel = clampThinkingLevel(
		model,
		options.thinkingLevel ?? restoredThinkingLevel ?? DEFAULT_THINKING_LEVEL,
	) as ThinkingLevel;

	const extensionRunnerRef: { current?: ExtensionRunner } = {};

	const agent = new Agent({
		initialState: {
			systemPrompt: "",
			model,
			thinkingLevel,
			tools: [],
		},
		convertToLlm,
		streamFn: async (model, context, options) =>
			modelRuntime.streamSimple(model, context, {
				...options,
				timeoutMs: options?.timeoutMs ?? settings.providerRequest.timeoutMs,
				maxRetries: options?.maxRetries ?? settings.providerRequest.maxRetries,
				maxRetryDelayMs: options?.maxRetryDelayMs ?? settings.providerRequest.maxRetryDelayMs,
			}),
		sessionId: sessionManager.getSessionId(),
		transformContext: async (messages) => {
			const runner = extensionRunnerRef.current;
			if (!runner) return messages;
			return runner.emitContext(messages);
		},
		maxRetryDelayMs: settings.providerRequest.maxRetryDelayMs,
	});

	// Restore messages if session has existing data
	if (hasExistingSession) {
		agent.state.messages = existingSession.messages;
		if (!hasThinkingEntry) {
			sessionManager.appendThinkingLevelChange(thinkingLevel);
		}
	} else {
		// Save initial model and thinking level for new sessions so they can be restored on resume
		sessionManager.appendModelChange(model.provider, model.id);
		sessionManager.appendThinkingLevelChange(thinkingLevel);
	}

	const session = new AgentSession({
		agent,
		sessionManager,
		settings,
		cwd,
		resourceLoader,
		customTools: options.customTools,
		modelRuntime,
		allowedToolNames: options.tools,
		extensionRunnerRef,
	});
	const extensionsResult = resourceLoader.getExtensions();

	return {
		session,
		extensionsResult,
	};
}
