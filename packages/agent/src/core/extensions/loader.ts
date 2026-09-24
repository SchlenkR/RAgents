/**
 * Extension loader - creates extensions from inline factories.
 */

import { createSyntheticSourceInfo } from "../source-info.ts";
import type {
	Extension,
	ExtensionAPI,
	ExtensionFactory,
	ExtensionFactorySettlementObserver,
	ExtensionRuntime,
	ToolDefinition,
} from "./types.ts";

type HandlerFn = (...args: unknown[]) => Promise<unknown>;

function abortReason(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new Error("Extension creation was aborted.");
}

function awaitWithSignal<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
	if (!signal) {
		return operation;
	}
	if (signal.aborted) {
		return Promise.reject(abortReason(signal));
	}

	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(abortReason(signal));
		signal.addEventListener("abort", abort, { once: true });
		operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}

/**
 * Create a runtime with throwing stubs for action methods.
 * Runner.bindCore() replaces these with real implementations.
 */
export function createExtensionRuntime(): ExtensionRuntime {
	const notInitialized = () => {
		throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
	};
	const state: { staleMessage?: string } = {};

	return {
		appendEntry: notInitialized,
		getAllTools: notInitialized,
		setActiveTools: notInitialized,
		// registerTool() is valid during extension load; refresh is only needed post-bind.
		refreshTools: () => {},
		assertActive: () => {
			if (state.staleMessage) {
				throw new Error(state.staleMessage);
			}
		},
		invalidate: (message) => {
			state.staleMessage ??= message ?? "This extension is stale.";
		},
	};
}

/** Registration methods write to the extension object, action methods delegate to the shared runtime. */
function createExtensionAPI(extension: Extension, runtime: ExtensionRuntime): ExtensionAPI {
	return {
		on(event: string, handler: HandlerFn): void {
			runtime.assertActive();
			const list = extension.handlers.get(event) ?? [];
			list.push(handler);
			extension.handlers.set(event, list);
		},

		registerTool(tool: ToolDefinition): void {
			runtime.assertActive();
			extension.tools.set(tool.name, {
				definition: tool,
				sourceInfo: extension.sourceInfo,
			});
			runtime.refreshTools();
		},

		appendEntry(customType: string, data?: unknown): void {
			runtime.assertActive();
			runtime.appendEntry(customType, data);
		},

		getAllTools() {
			runtime.assertActive();
			return runtime.getAllTools();
		},

		setActiveTools(toolNames: string[]): void {
			runtime.assertActive();
			runtime.setActiveTools(toolNames);
		},
	} as ExtensionAPI;
}

/** Create an Extension from an inline factory function. */
export async function loadExtensionFromFactory(
	factory: ExtensionFactory,
	runtime: ExtensionRuntime,
	extensionPath: string,
	signal?: AbortSignal,
	onFactorySettlement?: ExtensionFactorySettlementObserver,
): Promise<Extension> {
	const extension: Extension = {
		path: extensionPath,
		sourceInfo: createSyntheticSourceInfo(extensionPath, { source: "inline" }),
		handlers: new Map(),
		tools: new Map(),
	};
	const api = createExtensionAPI(extension, runtime);
	try {
		const factorySettlement = Promise.resolve(factory(api, { signal: signal ?? new AbortController().signal }));
		onFactorySettlement?.(factorySettlement);
		await awaitWithSignal(factorySettlement, signal);
	} catch (error) {
		if (signal?.aborted) {
			runtime.invalidate("Extension creation was aborted.");
		}
		throw error;
	}
	return extension;
}
