/**
 * Extension runner - executes extension handlers against one agent session.
 */

import type { AgentMessage } from "../../loop/index.ts";
import type { Model, UserAttachment } from "@ragents/ai";
import type { SessionManager } from "../session-manager.ts";
import type { BuildSystemPromptOptions } from "../system-prompt.ts";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ContextEvent,
	ContextEventResult,
	Extension,
	ExtensionActions,
	ExtensionContext,
	ExtensionError,
	ExtensionRuntime,
	RegisteredTool,
	ToolResultEvent,
	ToolResultEventResult,
} from "./types.ts";

export type ExtensionErrorListener = (error: ExtensionError) => void;

/** What the runner reads from its session when it builds a handler context. */
export interface ExtensionContextSource {
	getModel: () => Model<any> | undefined;
	getSignal: () => AbortSignal | undefined;
}

export const STALE_EXTENSION_MESSAGE = "This extension is stale: its agent session was disposed.";

export class ExtensionRunner {
	private readonly extensions: Extension[];
	private readonly runtime: ExtensionRuntime;
	private readonly sessionManager: SessionManager;
	private readonly errorListeners: Set<ExtensionErrorListener> = new Set();
	private contextSource: ExtensionContextSource = { getModel: () => undefined, getSignal: () => undefined };
	private staleMessage: string | undefined;

	constructor(extensions: Extension[], runtime: ExtensionRuntime, sessionManager: SessionManager) {
		this.extensions = extensions;
		this.runtime = runtime;
		this.sessionManager = sessionManager;
	}

	bindCore(actions: ExtensionActions, contextSource: ExtensionContextSource): void {
		this.runtime.appendEntry = actions.appendEntry;
		this.runtime.getAllTools = actions.getAllTools;
		this.runtime.setActiveTools = actions.setActiveTools;
		this.runtime.refreshTools = actions.refreshTools;
		this.contextSource = contextSource;
	}

	/** Get all registered tools from all extensions (first registration per name wins). */
	getAllRegisteredTools(): RegisteredTool[] {
		const toolsByName = new Map<string, RegisteredTool>();
		for (const ext of this.extensions) {
			for (const tool of ext.tools.values()) {
				if (!toolsByName.has(tool.definition.name)) {
					toolsByName.set(tool.definition.name, tool);
				}
			}
		}
		return Array.from(toolsByName.values());
	}

	invalidate(message = STALE_EXTENSION_MESSAGE): void {
		if (!this.staleMessage) {
			this.staleMessage = message;
			this.runtime.invalidate(message);
		}
	}

	private assertActive(): void {
		if (this.staleMessage) {
			throw new Error(this.staleMessage);
		}
	}

	onError(listener: ExtensionErrorListener): () => void {
		this.errorListeners.add(listener);
		return () => this.errorListeners.delete(listener);
	}

	private emitError(ext: Extension, event: string, err: unknown): void {
		const error: ExtensionError = {
			extensionPath: ext.path,
			event,
			error: err instanceof Error ? err.message : String(err),
			stack: err instanceof Error ? err.stack : undefined,
		};
		for (const listener of this.errorListeners) {
			listener(error);
		}
	}

	hasHandlers(eventType: string): boolean {
		return this.extensions.some((ext) => (ext.handlers.get(eventType)?.length ?? 0) > 0);
	}

	/** Context values are resolved at call time, so a disposed session is detected on every access. */
	createContext(): ExtensionContext {
		const runner = this;
		return {
			get sessionManager() {
				runner.assertActive();
				return runner.sessionManager;
			},
			get model() {
				runner.assertActive();
				return runner.contextSource.getModel();
			},
			get signal() {
				runner.assertActive();
				return runner.contextSource.getSignal();
			},
		};
	}

	async emitToolResult(event: ToolResultEvent): Promise<ToolResultEventResult | undefined> {
		const ctx = this.createContext();
		const currentEvent: ToolResultEvent = { ...event };
		let modified = false;

		for (const ext of this.extensions) {
			for (const handler of ext.handlers.get("tool_result") ?? []) {
				try {
					const handlerResult = (await handler(currentEvent, ctx)) as ToolResultEventResult | undefined;
					if (!handlerResult) continue;

					if (handlerResult.content !== undefined) {
						currentEvent.content = handlerResult.content;
						modified = true;
					}
					if (handlerResult.details !== undefined) {
						currentEvent.details = handlerResult.details;
						modified = true;
					}
					if (handlerResult.isError !== undefined) {
						currentEvent.isError = handlerResult.isError;
						modified = true;
					}
				} catch (err) {
					this.emitError(ext, "tool_result", err);
				}
			}
		}

		return modified
			? { content: currentEvent.content, details: currentEvent.details, isError: currentEvent.isError }
			: undefined;
	}

	async emitContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
		const ctx = this.createContext();
		let currentMessages = structuredClone(messages);

		for (const ext of this.extensions) {
			for (const handler of ext.handlers.get("context") ?? []) {
				try {
					const event: ContextEvent = { type: "context", messages: currentMessages };
					const handlerResult = (await handler(event, ctx)) as ContextEventResult | undefined;
					if (handlerResult?.messages) {
						currentMessages = handlerResult.messages;
					}
				} catch (err) {
					this.emitError(ext, "context", err);
				}
			}
		}

		return currentMessages;
	}

	/** Chains the system prompt through all before_agent_start handlers; undefined when none changed it. */
	async emitBeforeAgentStart(
		prompt: string,
		systemPrompt: string,
		systemPromptOptions: BuildSystemPromptOptions,
		attachments?: UserAttachment[],
	): Promise<string | undefined> {
		const ctx = this.createContext();
		let currentSystemPrompt = systemPrompt;
		let systemPromptModified = false;

		for (const ext of this.extensions) {
			for (const handler of ext.handlers.get("before_agent_start") ?? []) {
				try {
					const event: BeforeAgentStartEvent = {
						type: "before_agent_start",
						prompt,
						attachments,
						systemPrompt: currentSystemPrompt,
						systemPromptOptions,
					};
					const handlerResult = (await handler(event, ctx)) as BeforeAgentStartEventResult | undefined;
					if (handlerResult?.systemPrompt !== undefined) {
						currentSystemPrompt = handlerResult.systemPrompt;
						systemPromptModified = true;
					}
				} catch (err) {
					this.emitError(ext, "before_agent_start", err);
				}
			}
		}

		return systemPromptModified ? currentSystemPrompt : undefined;
	}
}
