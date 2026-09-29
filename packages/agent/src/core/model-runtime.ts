import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type AuthCheck,
	type AuthResult,
	type Context,
	createModels,
	EXTENDED_THINKING_LEVELS,
	getSupportedThinkingLevels,
	lazyStream,
	type Model,
	type ModelCompaction,
	type ModelThinkingLevel,
	type MutableModels,
	type Provider,
	type SimpleStreamOptions,
} from "@ragents/ai";
import { builtinProviders } from "@ragents/ai/providers/all";
import { compactionProblem } from "./compaction/compaction.ts";
import { composeModelProvider, type ProviderConfigInput } from "./provider-composer.ts";

/** A name under which a model of another provider is offered, with its own compaction values; only the alias is visible to callers. */
export interface ModelAlias {
	readonly alias: string;
	readonly upstream: string;
	readonly model: string;
	readonly compaction: ModelCompaction;
	/** The levels the alias offers, each mapped to a level of the target; without it the alias offers the target's levels. */
	readonly thinkingLevels?: Readonly<Partial<Record<ModelThinkingLevel, ModelThinkingLevel>>>;
}

interface AliasRegistration {
	readonly provider: string;
	readonly aliases: ReadonlyMap<string, ModelAlias>;
}

/** Why an alias cannot offer these thinking levels, checked against the target if given; without levels it offers the target's. */
export function thinkingLevelsProblem(value: unknown, target?: Model<Api>): string | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) return "thinkingLevels needs an object from offered to target level";
	const levels = Object.entries(value);
	if (levels.length === 0) return "thinkingLevels needs at least one level";
	const unknown = levels.find(([offered]) => !EXTENDED_THINKING_LEVELS.includes(offered as ModelThinkingLevel));
	if (unknown) return `thinkingLevels.${unknown[0]} is not a thinking level`;
	const invalid = levels.find(([, mapped]) => !EXTENDED_THINKING_LEVELS.includes(mapped as ModelThinkingLevel));
	if (invalid) return `thinkingLevels.${invalid[0]} names the unknown thinking level "${String(invalid[1])}"`;
	const off = levels.find(([offered, mapped]) => offered !== "off" && mapped === "off");
	if (off) return `thinkingLevels.${off[0]} maps to off, which only off may do`;
	if (!target) return undefined;
	const supported = getSupportedThinkingLevels(target);
	const unsupported = levels.find(([, mapped]) => !supported.includes(mapped as ModelThinkingLevel));
	return unsupported && `thinkingLevels.${unsupported[0]} maps to ${String(unsupported[1])}, which the target does not offer (valid: ${supported.join(", ")})`;
}

/** The target with only the levels the alias offers, each carrying what the target sends for the level it maps to. */
function withOfferedThinking(entry: ModelAlias, target: Model<Api>): Model<Api> {
	const levels = entry.thinkingLevels;
	if (!levels) return target;
	return {
		...target,
		thinkingLevelMap: Object.fromEntries(EXTENDED_THINKING_LEVELS.flatMap((level): [ModelThinkingLevel, string | null][] => {
			const mapped = levels[level];
			if (mapped === undefined) return [[level, null]];
			const sent = mapped === "off" ? target.thinkingLevelMap?.off : (target.thinkingLevelMap?.[mapped] ?? mapped);
			return sent === undefined ? [] : [[level, sent]];
		})),
	};
}

/** The metadata of the target under the alias as id and name, with the alias provider as provider, the alias's compaction values and the levels it offers. */
export function aliasedModel(providerId: string, entry: ModelAlias, target: Model<Api>): Model<Api> {
	return { ...withOfferedThinking(entry, target), id: entry.alias, name: entry.alias, provider: providerId, compaction: entry.compaction };
}

/** The built-in providers plus the ones registered at runtime; a key comes from the registration or the environment. */
export class ModelRuntime {
	private readonly models: MutableModels = createModels();
	private readonly builtins: ReadonlyMap<string, Provider>;
	private readonly registrations = new Map<string, ProviderConfigInput>();
	private aliasRegistration: AliasRegistration | undefined;

	private constructor() {
		this.builtins = new Map(builtinProviders().map((provider) => [provider.id, provider]));
		for (const provider of this.builtins.values()) this.models.setProvider(provider);
	}

	static create(): ModelRuntime {
		return new ModelRuntime();
	}

	getModels(providerId?: string): readonly Model<Api>[] {
		if (providerId !== undefined && providerId === this.aliasRegistration?.provider) return this.aliasModels();
		const models = this.models.getModels(providerId);
		return providerId === undefined ? [...models, ...this.aliasModels()] : models;
	}

	getModel(providerId: string, modelId: string): Model<Api> | undefined {
		if (providerId === this.aliasRegistration?.provider) return this.aliasModels().find((model) => model.id === modelId);
		return this.models.getModel(providerId, modelId);
	}

	async checkAuth(providerId: string): Promise<AuthCheck | undefined> {
		const registration = this.aliasRegistration;
		if (providerId !== registration?.provider) return this.models.checkAuth(providerId);
		const upstreams = [...new Set([...registration.aliases.values()].map((entry) => entry.upstream))];
		const checks = await Promise.all(upstreams.map((upstream) => this.models.checkAuth(upstream)));
		return checks.every((check) => check !== undefined) ? checks[0] : undefined;
	}

	getAuth(model: Model<Api>): Promise<AuthResult | undefined> {
		return this.models.getAuth(this.targetOf(model) ?? model);
	}

	streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
		const target = this.targetOf(model);
		if (!target) return this.models.streamSimple(model, context, options);
		const source = this.models.streamSimple(target, withTargetHistory(context, model, target), options);
		return lazyStream(model, async () => relabeledEvents(source, model, target));
	}

	completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage> {
		return this.streamSimple(model, context, options).result();
	}

	/** A repeated registration keeps the earlier values it does not set; an invalid one throws and changes nothing. */
	registerProvider(providerId: string, config: ProviderConfigInput): void {
		if (providerId === this.aliasRegistration?.provider) throw new Error(`Provider ${providerId} is the alias provider.`);
		const effective: ProviderConfigInput = {
			...this.registrations.get(providerId),
			...Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
		};
		this.models.setProvider(composeModelProvider(providerId, this.builtins.get(providerId), effective));
		this.registrations.set(providerId, effective);
	}

	/** Offers models of registered providers under alias names; requests go to the target, answers carry the alias. */
	registerAliases(providerId: string, aliases: readonly ModelAlias[]): void {
		if (this.aliasRegistration) throw new Error(`Aliases are already registered under ${this.aliasRegistration.provider}.`);
		if (this.models.getProvider(providerId)) throw new Error(`Alias provider ${providerId} collides with a registered provider.`);
		const duplicate = aliases.find((entry, index) => aliases.findIndex((other) => other.alias === entry.alias) !== index);
		if (duplicate) throw new Error(`Alias ${duplicate.alias} is registered twice.`);
		const missing = aliases.find((entry) => !this.models.getModel(entry.upstream, entry.model));
		if (missing) throw new Error(`Alias ${missing.alias}: model ${missing.upstream}/${missing.model} is not configured.`);
		for (const entry of aliases) {
			const target = this.models.getModel(entry.upstream, entry.model);
			const problem = compactionProblem(entry.compaction, target) ?? thinkingLevelsProblem(entry.thinkingLevels, target);
			if (problem) throw new Error(`Alias ${entry.alias}: ${problem}.`);
		}
		this.aliasRegistration = { provider: providerId, aliases: new Map(aliases.map((entry) => [entry.alias, entry])) };
	}

	private aliasModels(): Model<Api>[] {
		const registration = this.aliasRegistration;
		if (!registration) return [];
		return [...registration.aliases.values()].flatMap((entry) => {
			const target = this.models.getModel(entry.upstream, entry.model);
			return target ? [aliasedModel(registration.provider, entry, target)] : [];
		});
	}

	/** The target of an alias with the levels the alias offers, so a request clamps to them and sends the mapped level. */
	private targetOf(model: Model<Api>): Model<Api> | undefined {
		const registration = this.aliasRegistration;
		if (model.provider !== registration?.provider) return undefined;
		const entry = registration.aliases.get(model.id);
		const target = entry && this.models.getModel(entry.upstream, entry.model);
		if (!entry || !target) throw new Error(`Model ${model.provider}/${model.id} is not configured.`);
		return withOfferedThinking(entry, target);
	}
}

/** Earlier answers of the alias count as answers of the target, so the target keeps its reasoning across turns. */
function withTargetHistory(context: Context, alias: Model<Api>, target: Model<Api>): Context {
	return {
		...context,
		messages: context.messages.map((message) =>
			message.role === "assistant" && message.provider === alias.provider && message.model === alias.id
				? { ...message, provider: target.provider, model: target.id }
				: message,
		),
	};
}

function relabeled(message: AssistantMessage, alias: Model<Api>, target: Model<Api>): AssistantMessage {
	return {
		...message,
		provider: alias.provider,
		model: alias.id,
		...(message.responseModel === undefined ? {} : { responseModel: alias.id }),
		...(message.errorMessage === undefined ? {} : { errorMessage: message.errorMessage.replaceAll(target.id, alias.id) }),
	};
}

async function* relabeledEvents(
	source: AssistantMessageEventStream,
	alias: Model<Api>,
	target: Model<Api>,
): AsyncIterable<AssistantMessageEvent> {
	for await (const event of source) {
		if (event.type === "done") yield { ...event, message: relabeled(event.message, alias, target) };
		else if (event.type === "error") yield { ...event, error: relabeled(event.error, alias, target) };
		else yield { ...event, partial: relabeled(event.partial, alias, target) };
	}
}
