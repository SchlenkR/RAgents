import type { ThinkingLevel } from "../loop/index.ts";
import type { Model } from "@ragents/ai";
import { resolvePath } from "../utils/paths.ts";
import type { ExtensionFactorySettlementObserver, ToolDefinition } from "./extensions/index.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import { DefaultResourceLoader, type DefaultResourceLoaderOptions, type ResourceLoader } from "./resource-loader.ts";
import { type CreateAgentSessionResult, createAgentSession } from "./sdk.ts";
import type { SessionManager } from "./session-manager.ts";

/** Inputs for creating the services of one session: its cwd, model runtime and loaded resources. */
export interface CreateAgentSessionServicesOptions {
	cwd: string;
	signal?: AbortSignal;
	modelRuntime: ModelRuntime;
	onExtensionFactorySettlement?: ExtensionFactorySettlementObserver;
	resourceLoaderOptions?: Omit<DefaultResourceLoaderOptions, "onExtensionFactorySettlement">;
}

/** Inputs for creating an AgentSession from already-created services. */
export interface CreateAgentSessionFromServicesOptions {
	services: AgentSessionServices;
	sessionManager: SessionManager;
	model: Model<any>;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
	customTools?: ToolDefinition[];
}

/** The services of one session; the AgentSession itself is created separately. */
export interface AgentSessionServices {
	cwd: string;
	modelRuntime: ModelRuntime;
	resourceLoader: ResourceLoader;
}

/** Create the services of one session and load its extensions; it does not create an AgentSession. */
export async function createAgentSessionServices(
	options: CreateAgentSessionServicesOptions,
): Promise<AgentSessionServices> {
	options.signal?.throwIfAborted();
	const resourceLoader = new DefaultResourceLoader({
		...(options.resourceLoaderOptions ?? {}),
		...(options.onExtensionFactorySettlement
			? { onExtensionFactorySettlement: options.onExtensionFactorySettlement }
			: {}),
	});
	await resourceLoader.reload(options.signal ? { signal: options.signal } : undefined);
	if (options.signal?.aborted) {
		resourceLoader.getExtensions().runtime.invalidate("Extension creation was aborted.");
		options.signal.throwIfAborted();
	}

	return {
		cwd: resolvePath(options.cwd),
		modelRuntime: options.modelRuntime,
		resourceLoader,
	};
}

/** Create an AgentSession from previously created services. */
export async function createAgentSessionFromServices(
	options: CreateAgentSessionFromServicesOptions,
): Promise<CreateAgentSessionResult> {
	return createAgentSession({
		cwd: options.services.cwd,
		modelRuntime: options.services.modelRuntime,
		resourceLoader: options.services.resourceLoader,
		sessionManager: options.sessionManager,
		model: options.model,
		thinkingLevel: options.thinkingLevel,
		tools: options.tools,
		customTools: options.customTools,
	});
}
