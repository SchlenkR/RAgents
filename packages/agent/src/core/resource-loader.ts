import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import chalk from "chalk";
import { CONFIG_DIR_NAME } from "../config.ts";
import type { ResourceDiagnostic } from "./diagnostics.ts";

export type { ResourceCollision, ResourceDiagnostic } from "./diagnostics.ts";

import { canonicalizePath, isLocalPath, resolvePath } from "../utils/paths.ts";
import { createEventBus, type EventBus } from "./event-bus.ts";
import {
	clearExtensionCache,
	createExtensionRuntime,
	loadExtensionFromFactory,
	loadExtensionsCached,
} from "./extensions/loader.ts";
import type {
	Extension,
	ExtensionFactorySettlementObserver,
	ExtensionRuntime,
	InlineExtension,
	LoadExtensionsResult,
} from "./extensions/types.ts";
import { DefaultPackageManager, type PathMetadata, type ResolvedResource } from "./package-manager.ts";
import type { PromptTemplate } from "./prompt-templates.ts";
import { loadPromptTemplates } from "./prompt-templates.ts";
import { SettingsManager } from "./settings-manager.ts";
import type { Skill } from "./skills.ts";
import { loadSkills } from "./skills.ts";
import { createSourceInfo, type SourceInfo } from "./source-info.ts";
import { resetTimings } from "./timings.ts";

export interface ResourceExtensionPaths {
	skillPaths?: Array<{ path: string; metadata: PathMetadata }>;
	promptPaths?: Array<{ path: string; metadata: PathMetadata }>;
	
}

export interface ResourceLoaderReloadOptions {
	resolveProjectTrust?: (input: { extensionsResult: LoadExtensionsResult }) => Promise<boolean>;
	signal?: AbortSignal;
}

export interface ResourceLoader {
	getExtensions(): LoadExtensionsResult;
	getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
	
	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> };
	getSystemPrompt(): string | undefined;
	setSystemPrompt(value: string): void;
	getAppendSystemPrompt(): string[];
	extendResources(paths: ResourceExtensionPaths): void;
	reload(options?: ResourceLoaderReloadOptions): Promise<void>;
	waitForSettlement?(): Promise<void> | undefined;
}

function resolvePromptInput(input: string | undefined, description: string): string | undefined {
	if (!input) {
		return undefined;
	}

	if (existsSync(input)) {
		try {
			return readFileSync(input, "utf-8");
		} catch (error) {
			console.error(chalk.yellow(`Warning: Could not read ${description} file ${input}: ${error}`));
			return input;
		}
	}

	return input;
}

function loadContextFileFromDir(dir: string): { path: string; content: string } | null {
	const candidates = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
	for (const filename of candidates) {
		const filePath = join(dir, filename);
		if (existsSync(filePath)) {
			try {
				return {
					path: filePath,
					content: readFileSync(filePath, "utf-8"),
				};
			} catch (error) {
				console.error(chalk.yellow(`Warning: Could not read ${filePath}: ${error}`));
			}
		}
	}
	return null;
}

export function loadProjectContextFiles(options: {
	cwd: string;
	agentDir: string;
}): Array<{ path: string; content: string }> {
	const resolvedCwd = resolvePath(options.cwd);
	const resolvedAgentDir = resolvePath(options.agentDir);

	const contextFiles: Array<{ path: string; content: string }> = [];
	const seenPaths = new Set<string>();

	const globalContext = loadContextFileFromDir(resolvedAgentDir);
	if (globalContext) {
		contextFiles.push(globalContext);
		seenPaths.add(globalContext.path);
	}

	const ancestorContextFiles: Array<{ path: string; content: string }> = [];

	let currentDir = resolvedCwd;

	while (true) {
		const contextFile = loadContextFileFromDir(currentDir);
		if (contextFile && !seenPaths.has(contextFile.path)) {
			ancestorContextFiles.unshift(contextFile);
			seenPaths.add(contextFile.path);
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	contextFiles.push(...ancestorContextFiles);

	return contextFiles;
}

export interface DefaultResourceLoaderOptions {
	cwd: string;
	agentDir: string;
	settingsManager?: SettingsManager;
	eventBus?: EventBus;
	additionalExtensionPaths?: string[];
	additionalSkillPaths?: string[];
	additionalPromptTemplatePaths?: string[];
	
	extensionFactories?: InlineExtension[];
	noExtensions?: boolean;
	noSkills?: boolean;
	noPromptTemplates?: boolean;
	
	noContextFiles?: boolean;
	systemPrompt?: string;
	appendSystemPrompt?: string[];
	onExtensionFactorySettlement?: ExtensionFactorySettlementObserver;
	extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
	skillsOverride?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		skills: Skill[];
		diagnostics: ResourceDiagnostic[];
	};
	promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
	
	agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	systemPromptOverride?: (base: string | undefined) => string | undefined;
	appendSystemPromptOverride?: (base: string[]) => string[];
}

export class DefaultResourceLoader implements ResourceLoader {
	private cwd: string;
	private agentDir: string;
	private settingsManager: SettingsManager;
	private eventBus: EventBus;
	private packageManager: DefaultPackageManager;
	private additionalExtensionPaths: string[];
	private additionalSkillPaths: string[];
	private additionalPromptTemplatePaths: string[];
	
	private extensionFactories: InlineExtension[];
	private noExtensions: boolean;
	private noSkills: boolean;
	private noPromptTemplates: boolean;
	
	private noContextFiles: boolean;
	private systemPromptSource?: string;
	private appendSystemPromptSource?: string[];
	private extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult;
	private skillsOverride?: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
		skills: Skill[];
		diagnostics: ResourceDiagnostic[];
	};
	private promptsOverride?: (base: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }) => {
		prompts: PromptTemplate[];
		diagnostics: ResourceDiagnostic[];
	};
	
	private agentsFilesOverride?: (base: { agentsFiles: Array<{ path: string; content: string }> }) => {
		agentsFiles: Array<{ path: string; content: string }>;
	};
	private systemPromptOverride?: (base: string | undefined) => string | undefined;
	private appendSystemPromptOverride?: (base: string[]) => string[];
	private readonly onExtensionFactorySettlement?: ExtensionFactorySettlementObserver;
	private readonly extensionFactorySettlements = new Set<Promise<void>>();

	private extensionsResult: LoadExtensionsResult;
	private skills: Skill[];
	private skillDiagnostics: ResourceDiagnostic[];
	private prompts: PromptTemplate[];
	private promptDiagnostics: ResourceDiagnostic[];
	
	
	private agentsFiles: Array<{ path: string; content: string }>;
	private systemPrompt?: string;
	private appendSystemPrompt: string[];
	private lastSkillPaths: string[];
	private extensionSkillSourceInfos: Map<string, SourceInfo>;
	private extensionPromptSourceInfos: Map<string, SourceInfo>;
	
	private lastPromptPaths: string[];
	
	private loaded: boolean;

	constructor(options: DefaultResourceLoaderOptions) {
		this.cwd = resolvePath(options.cwd);
		this.agentDir = resolvePath(options.agentDir);
		this.settingsManager = options.settingsManager ?? SettingsManager.create(this.cwd, this.agentDir);
		this.eventBus = options.eventBus ?? createEventBus();
		this.packageManager = new DefaultPackageManager({
			cwd: this.cwd,
			agentDir: this.agentDir,
			settingsManager: this.settingsManager,
		});
		this.additionalExtensionPaths = options.additionalExtensionPaths ?? [];
		this.additionalSkillPaths = options.additionalSkillPaths ?? [];
		this.additionalPromptTemplatePaths = options.additionalPromptTemplatePaths ?? [];
		this.extensionFactories = options.extensionFactories ?? [];
		this.noExtensions = options.noExtensions ?? false;
		this.noSkills = options.noSkills ?? false;
		this.noPromptTemplates = options.noPromptTemplates ?? false;
		this.noContextFiles = options.noContextFiles ?? false;
		this.systemPromptSource = options.systemPrompt;
		this.appendSystemPromptSource = options.appendSystemPrompt;
		this.extensionsOverride = options.extensionsOverride;
		this.skillsOverride = options.skillsOverride;
		this.promptsOverride = options.promptsOverride;
		this.agentsFilesOverride = options.agentsFilesOverride;
		this.systemPromptOverride = options.systemPromptOverride;
		this.appendSystemPromptOverride = options.appendSystemPromptOverride;
		this.onExtensionFactorySettlement = options.onExtensionFactorySettlement;

		this.extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
		this.skills = [];
		this.skillDiagnostics = [];
		this.prompts = [];
		this.promptDiagnostics = [];
		this.agentsFiles = [];
		this.appendSystemPrompt = [];
		this.lastSkillPaths = [];
		this.extensionSkillSourceInfos = new Map();
		this.extensionPromptSourceInfos = new Map();
		this.lastPromptPaths = [];
		this.loaded = false;
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

	getSkills(): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
		return { skills: this.skills, diagnostics: this.skillDiagnostics };
	}

	getPrompts(): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		return { prompts: this.prompts, diagnostics: this.promptDiagnostics };
	}

	

	getAgentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
		return { agentsFiles: this.agentsFiles };
	}

	getSystemPrompt(): string | undefined {
		return this.systemPrompt;
	}

	setSystemPrompt(value: string): void {
		this.systemPrompt = value;
	}

	getAppendSystemPrompt(): string[] {
		return this.appendSystemPrompt;
	}

	extendResources(paths: ResourceExtensionPaths): void {
		const skillPaths = this.normalizeExtensionPaths(paths.skillPaths ?? []);
		const promptPaths = this.normalizeExtensionPaths(paths.promptPaths ?? []);

		for (const entry of skillPaths) {
			this.extensionSkillSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
		}
		for (const entry of promptPaths) {
			this.extensionPromptSourceInfos.set(entry.path, createSourceInfo(entry.path, entry.metadata));
		}

		if (skillPaths.length > 0) {
			this.lastSkillPaths = this.mergePaths(
				this.lastSkillPaths,
				skillPaths.map((entry) => entry.path),
			);
			this.updateSkillsFromPaths(this.lastSkillPaths);
		}

		if (promptPaths.length > 0) {
			this.lastPromptPaths = this.mergePaths(
				this.lastPromptPaths,
				promptPaths.map((entry) => entry.path),
			);
			this.updatePromptsFromPaths(this.lastPromptPaths);
		}
	}

	async loadProjectTrustExtensions(signal?: AbortSignal): Promise<LoadExtensionsResult> {
		// Force untrusted project settings for the bootstrap pass. This keeps project-local
		// extensions/packages out while still loading user/global and temporary CLI extensions.
		this.settingsManager.setProjectTrusted(false);
		await this.settingsManager.reload();
		return this.loadCurrentExtensionSet({ includeInlineFactories: true }, signal);
	}

	async reload(options?: ResourceLoaderReloadOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		resetTimings("extensions");

		if (this.loaded) {
			clearExtensionCache();
		}

		let preTrustExtensions: LoadExtensionsResult | undefined;
		if (options?.resolveProjectTrust) {
			preTrustExtensions = await this.loadProjectTrustExtensions(options.signal);
			const projectTrusted = await options.resolveProjectTrust({ extensionsResult: preTrustExtensions });
			if (options.signal?.aborted) {
				preTrustExtensions.runtime.invalidate("Extension creation was aborted.");
				options.signal.throwIfAborted();
			}
			this.settingsManager.setProjectTrusted(projectTrusted);
		}

		// reload() preserves SettingsManager.projectTrusted and reloads settings for that trust state.
		await this.settingsManager.reload();
		const resolvedPaths = await this.packageManager.resolve();
		const cliExtensionPaths = await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {
			temporary: true,
		});
		const metadataByPath = new Map<string, PathMetadata>();

		this.extensionSkillSourceInfos = new Map();
		this.extensionPromptSourceInfos = new Map();

		// Helper to extract enabled paths and store metadata
		const getEnabledResources = (resources: ResolvedResource[]): ResolvedResource[] => {
			for (const r of resources) {
				if (!metadataByPath.has(r.path)) {
					metadataByPath.set(r.path, r.metadata);
				}
			}
			return resources.filter((r) => r.enabled);
		};

		const getEnabledPaths = (resources: ResolvedResource[]): string[] =>
			getEnabledResources(resources).map((r) => r.path);
		const enabledExtensions = getEnabledPaths(resolvedPaths.extensions);
		const enabledSkillResources = getEnabledResources(resolvedPaths.skills);
		const enabledPrompts = getEnabledPaths(resolvedPaths.prompts);

		const enabledSkills = enabledSkillResources.map((resource) => this.mapSkillPath(resource, metadataByPath));

		// Add CLI paths metadata
		for (const r of cliExtensionPaths.extensions) {
			if (!metadataByPath.has(r.path)) {
				metadataByPath.set(r.path, { source: "cli", scope: "temporary", origin: "top-level" });
			}
		}
		for (const r of cliExtensionPaths.skills) {
			if (!metadataByPath.has(r.path)) {
				metadataByPath.set(r.path, { source: "cli", scope: "temporary", origin: "top-level" });
			}
		}

		const cliEnabledExtensions = getEnabledPaths(cliExtensionPaths.extensions);
		const cliEnabledSkills = getEnabledPaths(cliExtensionPaths.skills);
		const cliEnabledPrompts = getEnabledPaths(cliExtensionPaths.prompts);

		const extensionPaths = this.noExtensions
			? cliEnabledExtensions
			: this.mergePaths(cliEnabledExtensions, enabledExtensions);

		const extensionsResult = await this.loadFinalExtensionSet(extensionPaths, preTrustExtensions, options?.signal);
		for (const p of this.additionalExtensionPaths) {
			if (isLocalPath(p)) {
				const resolved = this.resolveResourcePath(p);
				if (!existsSync(resolved)) {
					extensionsResult.errors.push({ path: resolved, error: `Extension path does not exist: ${resolved}` });
				}
			}
		}
		this.extensionsResult = this.extensionsOverride ? this.extensionsOverride(extensionsResult) : extensionsResult;
		this.applyExtensionSourceInfo(this.extensionsResult.extensions, metadataByPath);

		const skillPaths = this.noSkills
			? this.mergePaths(cliEnabledSkills, this.additionalSkillPaths)
			: this.mergePaths([...cliEnabledSkills, ...enabledSkills], this.additionalSkillPaths);

		this.lastSkillPaths = skillPaths;
		this.updateSkillsFromPaths(skillPaths, metadataByPath);
		for (const p of this.additionalSkillPaths) {
			if (isLocalPath(p)) {
				const resolved = this.resolveResourcePath(p);
				if (!existsSync(resolved) && !this.skillDiagnostics.some((d) => d.path === resolved)) {
					this.skillDiagnostics.push({ type: "error", message: "Skill path does not exist", path: resolved });
				}
			}
		}

		const promptPaths = this.noPromptTemplates
			? this.mergePaths(cliEnabledPrompts, this.additionalPromptTemplatePaths)
			: this.mergePaths([...cliEnabledPrompts, ...enabledPrompts], this.additionalPromptTemplatePaths);

		this.lastPromptPaths = promptPaths;
		this.updatePromptsFromPaths(promptPaths, metadataByPath);
		for (const p of this.additionalPromptTemplatePaths) {
			if (isLocalPath(p)) {
				const resolved = this.resolveResourcePath(p);
				if (!existsSync(resolved) && !this.promptDiagnostics.some((d) => d.path === resolved)) {
					this.promptDiagnostics.push({
						type: "error",
						message: "Prompt template path does not exist",
						path: resolved,
					});
				}
			}
		}

		const agentsFiles = {
			agentsFiles: this.noContextFiles
				? []
				: loadProjectContextFiles({
						cwd: this.cwd,
						agentDir: this.agentDir,
					}),
		};
		const resolvedAgentsFiles = this.agentsFilesOverride ? this.agentsFilesOverride(agentsFiles) : agentsFiles;
		this.agentsFiles = resolvedAgentsFiles.agentsFiles;

		const baseSystemPrompt = resolvePromptInput(
			this.systemPromptSource ?? this.discoverSystemPromptFile(),
			"system prompt",
		);
		this.systemPrompt = this.systemPromptOverride ? this.systemPromptOverride(baseSystemPrompt) : baseSystemPrompt;

		const appendSources =
			this.appendSystemPromptSource ??
			(this.discoverAppendSystemPromptFile() ? [this.discoverAppendSystemPromptFile()!] : []);
		const baseAppend = appendSources
			.map((s) => resolvePromptInput(s, "append system prompt"))
			.filter((s): s is string => s !== undefined);
		this.appendSystemPrompt = this.appendSystemPromptOverride
			? this.appendSystemPromptOverride(baseAppend)
			: baseAppend;
		this.loaded = true;
	}

	private async loadCurrentExtensionSet(
		options: { includeInlineFactories: boolean },
		signal?: AbortSignal,
	): Promise<LoadExtensionsResult> {
		const resolvedPaths = await this.packageManager.resolve();
		const cliExtensionPaths = await this.packageManager.resolveExtensionSources(this.additionalExtensionPaths, {
			temporary: true,
		});
		const enabledExtensions = resolvedPaths.extensions.filter((r) => r.enabled).map((r) => r.path);
		const cliEnabledExtensions = cliExtensionPaths.extensions.filter((r) => r.enabled).map((r) => r.path);
		const extensionPaths = this.noExtensions
			? cliEnabledExtensions
			: this.mergePaths(cliEnabledExtensions, enabledExtensions);
		const extensionsResult = await loadExtensionsCached(
			extensionPaths,
			this.cwd,
			this.eventBus,
			undefined,
			signal,
			this.trackExtensionFactorySettlement,
		);
		if (!options.includeInlineFactories) {
			return extensionsResult;
		}

		const inlineExtensions = await this.loadExtensionFactories(extensionsResult.runtime, signal);
		extensionsResult.extensions.push(...inlineExtensions.extensions);
		extensionsResult.errors.push(...inlineExtensions.errors);
		return extensionsResult;
	}

	private resolveExtensionLoadPath(path: string): string {
		return resolvePath(path, this.cwd, { normalizeUnicodeSpaces: true });
	}

	private async loadFinalExtensionSet(
		extensionPaths: string[],
		preTrustExtensions: LoadExtensionsResult | undefined,
		signal?: AbortSignal,
	): Promise<LoadExtensionsResult> {
		if (!preTrustExtensions) {
			const extensionsResult = await loadExtensionsCached(
				extensionPaths,
				this.cwd,
				this.eventBus,
				undefined,
				signal,
				this.trackExtensionFactorySettlement,
			);
			const inlineExtensions = await this.loadExtensionFactories(extensionsResult.runtime, signal);
			extensionsResult.extensions.push(...inlineExtensions.extensions);
			extensionsResult.errors.push(...inlineExtensions.errors);
			this.addExtensionConflictDiagnostics(extensionsResult);
			return extensionsResult;
		}

		const preloadedByPath = new Map(
			preTrustExtensions.extensions
				.filter((extension) => !extension.path.startsWith("<inline:"))
				.map((extension) => [extension.resolvedPath, extension]),
		);
		const failedPreloadPaths = new Set(
			preTrustExtensions.errors.map((error) => this.resolveExtensionLoadPath(error.path)),
		);
		const remainingPaths = extensionPaths.filter((path) => {
			const resolvedPath = this.resolveExtensionLoadPath(path);
			return !preloadedByPath.has(resolvedPath) && !failedPreloadPaths.has(resolvedPath);
		});
		const remainingExtensions = await loadExtensionsCached(
			remainingPaths,
			this.cwd,
			this.eventBus,
			preTrustExtensions.runtime,
			signal,
			this.trackExtensionFactorySettlement,
		);
		const loadedByPath = new Map(preloadedByPath);
		for (const extension of remainingExtensions.extensions) {
			loadedByPath.set(extension.resolvedPath, extension);
		}

		const inlineExtensions = preTrustExtensions.extensions.filter((extension) =>
			extension.path.startsWith("<inline:"),
		);
		const orderedExtensions = extensionPaths
			.map((path) => loadedByPath.get(this.resolveExtensionLoadPath(path)))
			.filter((extension): extension is Extension => extension !== undefined);
		orderedExtensions.push(...inlineExtensions);

		const extensionsResult: LoadExtensionsResult = {
			extensions: orderedExtensions,
			errors: [...preTrustExtensions.errors, ...remainingExtensions.errors],
			runtime: preTrustExtensions.runtime,
		};
		this.addExtensionConflictDiagnostics(extensionsResult);
		return extensionsResult;
	}

	private addExtensionConflictDiagnostics(extensionsResult: LoadExtensionsResult): void {
		// Detect extension conflicts (tools, commands, flags with same names from different extensions)
		// Keep all extensions loaded. Conflicts are reported as diagnostics, and precedence is handled by load order.
		const conflicts = this.detectExtensionConflicts(extensionsResult.extensions);
		for (const conflict of conflicts) {
			extensionsResult.errors.push({ path: conflict.path, error: conflict.message });
		}
	}

	private mapSkillPath(resource: ResolvedResource, metadataByPath: Map<string, PathMetadata>): string {
		if (resource.metadata.source !== "auto" && resource.metadata.origin !== "package") {
			return resource.path;
		}
		try {
			const stats = statSync(resource.path);
			if (!stats.isDirectory()) {
				return resource.path;
			}
		} catch {
			return resource.path;
		}
		const skillFile = join(resource.path, "SKILL.md");
		if (existsSync(skillFile)) {
			if (!metadataByPath.has(skillFile)) {
				metadataByPath.set(skillFile, resource.metadata);
			}
			return skillFile;
		}
		return resource.path;
	}

	private normalizeExtensionPaths(
		entries: Array<{ path: string; metadata: PathMetadata }>,
	): Array<{ path: string; metadata: PathMetadata }> {
		return entries.map((entry) => {
			const metadata = entry.metadata.baseDir
				? { ...entry.metadata, baseDir: this.resolveResourcePath(entry.metadata.baseDir) }
				: entry.metadata;
			return {
				path: this.resolveResourcePath(entry.path),
				metadata,
			};
		});
	}

	private updateSkillsFromPaths(skillPaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
		let skillsResult: { skills: Skill[]; diagnostics: ResourceDiagnostic[] };
		if (this.noSkills && skillPaths.length === 0) {
			skillsResult = { skills: [], diagnostics: [] };
		} else {
			skillsResult = loadSkills({
				cwd: this.cwd,
				agentDir: this.agentDir,
				skillPaths,
				includeDefaults: false,
			});
		}
		const resolvedSkills = this.skillsOverride ? this.skillsOverride(skillsResult) : skillsResult;
		this.skills = resolvedSkills.skills.map((skill) => ({
			...skill,
			sourceInfo:
				this.findSourceInfoForPath(skill.filePath, this.extensionSkillSourceInfos, metadataByPath) ??
				skill.sourceInfo ??
				this.getDefaultSourceInfoForPath(skill.filePath),
		}));
		this.skillDiagnostics = resolvedSkills.diagnostics;
	}

	private updatePromptsFromPaths(promptPaths: string[], metadataByPath?: Map<string, PathMetadata>): void {
		let promptsResult: { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] };
		if (this.noPromptTemplates && promptPaths.length === 0) {
			promptsResult = { prompts: [], diagnostics: [] };
		} else {
			const allPrompts = loadPromptTemplates({
				cwd: this.cwd,
				agentDir: this.agentDir,
				promptPaths,
				includeDefaults: false,
			});
			promptsResult = this.dedupePrompts(allPrompts);
		}
		const resolvedPrompts = this.promptsOverride ? this.promptsOverride(promptsResult) : promptsResult;
		this.prompts = resolvedPrompts.prompts.map((prompt) => ({
			...prompt,
			sourceInfo:
				this.findSourceInfoForPath(prompt.filePath, this.extensionPromptSourceInfos, metadataByPath) ??
				prompt.sourceInfo ??
				this.getDefaultSourceInfoForPath(prompt.filePath),
		}));
		this.promptDiagnostics = resolvedPrompts.diagnostics;
	}

	

	private applyExtensionSourceInfo(extensions: Extension[], metadataByPath: Map<string, PathMetadata>): void {
		for (const extension of extensions) {
			extension.sourceInfo =
				this.findSourceInfoForPath(extension.path, undefined, metadataByPath) ??
				this.getDefaultSourceInfoForPath(extension.path);
			for (const command of extension.commands.values()) {
				command.sourceInfo = extension.sourceInfo;
			}
			for (const tool of extension.tools.values()) {
				tool.sourceInfo = extension.sourceInfo;
			}
		}
	}

	private findSourceInfoForPath(
		resourcePath: string,
		extraSourceInfos?: Map<string, SourceInfo>,
		metadataByPath?: Map<string, PathMetadata>,
	): SourceInfo | undefined {
		if (!resourcePath) {
			return undefined;
		}

		if (resourcePath.startsWith("<")) {
			return this.getDefaultSourceInfoForPath(resourcePath);
		}

		const normalizedResourcePath = resolve(resourcePath);
		if (extraSourceInfos) {
			for (const [sourcePath, sourceInfo] of extraSourceInfos.entries()) {
				const normalizedSourcePath = resolve(sourcePath);
				if (
					normalizedResourcePath === normalizedSourcePath ||
					normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
				) {
					return { ...sourceInfo, path: resourcePath };
				}
			}
		}

		if (metadataByPath) {
			const exact = metadataByPath.get(normalizedResourcePath) ?? metadataByPath.get(resourcePath);
			if (exact) {
				return createSourceInfo(resourcePath, exact);
			}

			for (const [sourcePath, metadata] of metadataByPath.entries()) {
				const normalizedSourcePath = resolve(sourcePath);
				if (
					normalizedResourcePath === normalizedSourcePath ||
					normalizedResourcePath.startsWith(`${normalizedSourcePath}${sep}`)
				) {
					return createSourceInfo(resourcePath, metadata);
				}
			}
		}

		return undefined;
	}

	private getDefaultSourceInfoForPath(filePath: string): SourceInfo {
		if (filePath.startsWith("<") && filePath.endsWith(">")) {
			return {
				path: filePath,
				source: filePath.slice(1, -1).split(":")[0] || "temporary",
				scope: "temporary",
				origin: "top-level",
			};
		}

		const normalizedPath = resolve(filePath);
		const agentRoots = [
			join(this.agentDir, "skills"),
			join(this.agentDir, "prompts"),
			join(this.agentDir, "themes"),
			join(this.agentDir, "extensions"),
		];
		const projectRoots = [
			join(this.cwd, CONFIG_DIR_NAME, "skills"),
			join(this.cwd, CONFIG_DIR_NAME, "prompts"),
			join(this.cwd, CONFIG_DIR_NAME, "themes"),
			join(this.cwd, CONFIG_DIR_NAME, "extensions"),
		];

		for (const root of agentRoots) {
			if (this.isUnderPath(normalizedPath, root)) {
				return { path: filePath, source: "local", scope: "user", origin: "top-level", baseDir: root };
			}
		}

		for (const root of projectRoots) {
			if (this.isUnderPath(normalizedPath, root)) {
				return { path: filePath, source: "local", scope: "project", origin: "top-level", baseDir: root };
			}
		}

		return {
			path: filePath,
			source: "local",
			scope: "temporary",
			origin: "top-level",
			baseDir: statSync(normalizedPath).isDirectory() ? normalizedPath : resolve(normalizedPath, ".."),
		};
	}

	private mergePaths(primary: string[], additional: string[]): string[] {
		const merged: string[] = [];
		const seen = new Set<string>();

		for (const p of [...primary, ...additional]) {
			const resolved = this.resolveResourcePath(p);
			const canonicalPath = canonicalizePath(resolved);
			if (seen.has(canonicalPath)) continue;
			seen.add(canonicalPath);
			merged.push(resolved);
		}

		return merged;
	}

	private resolveResourcePath(p: string): string {
		return resolvePath(p, this.cwd, { trim: true });
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
					this.cwd,
					this.eventBus,
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

	private dedupePrompts(prompts: PromptTemplate[]): { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] } {
		const seen = new Map<string, PromptTemplate>();
		const diagnostics: ResourceDiagnostic[] = [];

		for (const prompt of prompts) {
			const existing = seen.get(prompt.name);
			if (existing) {
				diagnostics.push({
					type: "collision",
					message: `name "/${prompt.name}" collision`,
					path: prompt.filePath,
					collision: {
						resourceType: "prompt",
						name: prompt.name,
						winnerPath: existing.filePath,
						loserPath: prompt.filePath,
					},
				});
			} else {
				seen.set(prompt.name, prompt);
			}
		}

		return { prompts: Array.from(seen.values()), diagnostics };
	}

	

	private discoverSystemPromptFile(): string | undefined {
		const projectPath = join(this.cwd, CONFIG_DIR_NAME, "SYSTEM.md");
		if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
			return projectPath;
		}

		const globalPath = join(this.agentDir, "SYSTEM.md");
		if (existsSync(globalPath)) {
			return globalPath;
		}

		return undefined;
	}

	private discoverAppendSystemPromptFile(): string | undefined {
		const projectPath = join(this.cwd, CONFIG_DIR_NAME, "APPEND_SYSTEM.md");
		if (this.settingsManager.isProjectTrusted() && existsSync(projectPath)) {
			return projectPath;
		}

		const globalPath = join(this.agentDir, "APPEND_SYSTEM.md");
		if (existsSync(globalPath)) {
			return globalPath;
		}

		return undefined;
	}

	private isUnderPath(target: string, root: string): boolean {
		const normalizedRoot = resolve(root);
		if (target === normalizedRoot) {
			return true;
		}
		const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : `${normalizedRoot}${sep}`;
		return target.startsWith(prefix);
	}

	private detectExtensionConflicts(extensions: Extension[]): Array<{ path: string; message: string }> {
		const conflicts: Array<{ path: string; message: string }> = [];

		// Track which extension registered each tool and flag
		const toolOwners = new Map<string, string>();
		const flagOwners = new Map<string, string>();

		for (const ext of extensions) {
			// Check tools
			for (const toolName of ext.tools.keys()) {
				const existingOwner = toolOwners.get(toolName);
				if (existingOwner && existingOwner !== ext.path) {
					conflicts.push({
						path: ext.path,
						message: `Tool "${toolName}" conflicts with ${existingOwner}`,
					});
				} else {
					toolOwners.set(toolName, ext.path);
				}
			}

			// Check flags
			for (const flagName of ext.flags.keys()) {
				const existingOwner = flagOwners.get(flagName);
				if (existingOwner && existingOwner !== ext.path) {
					conflicts.push({
						path: ext.path,
						message: `Flag "--${flagName}" conflicts with ${existingOwner}`,
					});
				} else {
					flagOwners.set(flagName, ext.path);
				}
			}
		}

		return conflicts;
	}
}
