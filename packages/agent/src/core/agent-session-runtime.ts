import type { AgentSession } from "./agent-session.ts";
import type { AgentSessionServices } from "./agent-session-services.ts";
import type { ExtensionFactorySettlementObserver } from "./extensions/index.ts";
import type { CreateAgentSessionResult } from "./sdk.ts";
import type { SessionManager } from "./session-manager.ts";

/** Result returned by runtime creation: the created session and its cwd-bound services. */
export interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
	services: AgentSessionServices;
}

/** Creates the services and the AgentSession for a target cwd and session manager. */
export type CreateAgentSessionRuntimeFactory = (options: {
	cwd: string;
	sessionManager: SessionManager;
	signal: AbortSignal;
	onExtensionFactorySettlement?: ExtensionFactorySettlementObserver;
}) => Promise<CreateAgentSessionRuntimeResult>;

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("Agent session runtime creation was aborted.");
}

function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		return Promise.reject(abortReason(signal));
	}

	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(abortReason(signal));
		signal.addEventListener("abort", abort, { once: true });
		operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}

/** Owns one AgentSession plus its cwd-bound services. */
export class AgentSessionRuntime {
	readonly session: AgentSession;
	readonly services: AgentSessionServices;

	constructor(session: AgentSession, services: AgentSessionServices) {
		this.session = session;
		this.services = services;
	}

	waitForSettlement(): Promise<void> {
		return this.session.waitForSettlement();
	}

	async dispose(): Promise<void> {
		this.session.dispose();
	}
}

/** Create the runtime from a runtime factory; an abort during creation disposes the late session. */
export async function createAgentSessionRuntime(
	createRuntime: CreateAgentSessionRuntimeFactory,
	options: {
		cwd: string;
		sessionManager: SessionManager;
		signal?: AbortSignal;
		onExtensionFactorySettlement?: ExtensionFactorySettlementObserver;
	},
): Promise<AgentSessionRuntime> {
	const signal = options.signal ?? new AbortController().signal;
	signal.throwIfAborted();
	const creation = Promise.resolve().then(() => createRuntime({
		cwd: options.cwd,
		sessionManager: options.sessionManager,
		signal,
		...(options.onExtensionFactorySettlement
			? { onExtensionFactorySettlement: options.onExtensionFactorySettlement }
			: {}),
	}));
	let result: CreateAgentSessionRuntimeResult;

	try {
		result = await awaitWithSignal(creation, signal);
	} catch (error) {
		if (signal.aborted) {
			void creation.then((lateResult) => lateResult.session.dispose(), () => undefined);
		}
		throw error;
	}
	return new AgentSessionRuntime(result.session, result.services);
}

export {
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./agent-session-services.ts";
