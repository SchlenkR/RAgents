import { createExtensionRuntime, loadExtensionFromFactory } from "./extensions/loader.ts";
import type {
	Extension,
	ExtensionFactorySettlementObserver,
	ExtensionRuntime,
	InlineExtension,
	LoadExtensionsResult,
} from "./extensions/types.ts";
import type { Skill } from "./skills.ts";

export interface ResourceLoaderReloadOptions {
	signal?: AbortSignal;
}

export interface ResourceLoader {
	getExtensions(): LoadExtensionsResult;
	getSkills(): readonly Skill[];
	getSystemPrompt(): string | undefined;
	setSystemPrompt(value: string): void;
	reload(options?: ResourceLoaderReloadOptions): Promise<void>;
	waitForSettlement?(): Promise<void> | undefined;
}

export interface DefaultResourceLoaderOptions {
	skills?: readonly Skill[];
	extensionFactories?: InlineExtension[];
	systemPrompt?: string;
	onExtensionFactorySettlement?: ExtensionFactorySettlementObserver;
}

/** Extensions come only as inline factories and skills as given by the caller; nothing is discovered or installed. */
export class DefaultResourceLoader implements ResourceLoader {
	private readonly skills: readonly Skill[];
	private readonly extensionFactories: InlineExtension[];
	private readonly onExtensionFactorySettlement?: ExtensionFactorySettlementObserver;
	private readonly extensionFactorySettlements = new Set<Promise<void>>();

	private extensionsResult: LoadExtensionsResult;
	private systemPrompt?: string;

	constructor(options: DefaultResourceLoaderOptions) {
		this.skills = options.skills ?? [];
		this.extensionFactories = options.extensionFactories ?? [];
		this.systemPrompt = options.systemPrompt;
		this.onExtensionFactorySettlement = options.onExtensionFactorySettlement;
		this.extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	}

	getExtensions(): LoadExtensionsResult {
		return this.extensionsResult;
	}

	waitForSettlement(): Promise<void> | undefined {
		const settlements = [...this.extensionFactorySettlements];
		return settlements.length > 0 ? Promise.allSettled(settlements).then(() => undefined) : undefined;
	}

	private readonly trackExtensionFactorySettlement: ExtensionFactorySettlementObserver = (settlement) => {
		this.extensionFactorySettlements.add(settlement);
		this.onExtensionFactorySettlement?.(settlement);
		void settlement.then(
			() => this.extensionFactorySettlements.delete(settlement),
			() => this.extensionFactorySettlements.delete(settlement),
		);
	};

	getSkills(): readonly Skill[] {
		return this.skills;
	}

	getSystemPrompt(): string | undefined {
		return this.systemPrompt;
	}

	setSystemPrompt(value: string): void {
		this.systemPrompt = value;
	}

	async reload(options?: ResourceLoaderReloadOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		const runtime = createExtensionRuntime();
		const { extensions, errors } = await this.loadExtensionFactories(runtime, options?.signal);
		for (const conflict of this.detectToolConflicts(extensions)) {
			errors.push(conflict);
		}
		this.extensionsResult = { extensions, errors, runtime };
	}

	private async loadExtensionFactories(runtime: ExtensionRuntime, signal?: AbortSignal): Promise<{
		extensions: Extension[];
		errors: Array<{ path: string; error: string }>;
	}> {
		const extensions: Extension[] = [];
		const errors: Array<{ path: string; error: string }> = [];

		for (const [index, input] of this.extensionFactories.entries()) {
			if (signal?.aborted) {
				runtime.invalidate("Extension creation was aborted.");
				signal.throwIfAborted();
			}
			const isNamed = typeof input !== "function";
			const factory = isNamed ? input.factory : input;
			const extensionPath = `<inline:${isNamed ? input.name : index + 1}>`;
			try {
				const extension = await loadExtensionFromFactory(
					factory,
					runtime,
					extensionPath,
					signal,
					this.trackExtensionFactorySettlement,
				);
				extensions.push(extension);
			} catch (error) {
				if (signal?.aborted) {
					throw error;
				}
				const message = error instanceof Error ? error.message : "failed to load extension";
				errors.push({ path: extensionPath, error: message });
			}
		}

		return { extensions, errors };
	}

	private detectToolConflicts(extensions: Extension[]): Array<{ path: string; error: string }> {
		const conflicts: Array<{ path: string; error: string }> = [];
		const toolOwners = new Map<string, string>();

		for (const ext of extensions) {
			for (const toolName of ext.tools.keys()) {
				const existingOwner = toolOwners.get(toolName);
				if (existingOwner && existingOwner !== ext.path) {
					conflicts.push({ path: ext.path, error: `Tool "${toolName}" conflicts with ${existingOwner}` });
				} else {
					toolOwners.set(toolName, ext.path);
				}
			}
		}

		return conflicts;
	}
}
