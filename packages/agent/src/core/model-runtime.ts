import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	type AssistantMessageEventStream,
	type AuthCheck,
	type AuthResult,
	type Context,
	createModels,
	lazyStream,
	type Model,
	type MutableModels,
	type Provider,
	type SimpleStreamOptions,
} from "@ragents/ai";
import { builtinProviders } from "@ragents/ai/providers/all";
import { composeModelProvider, type ProviderConfigInput } from "./provider-composer.ts";

/** A name under which a model of another provider is offered; only the alias is visible to callers. */
export interface ModelAlias {
	readonly alias: string;
	readonly upstream: string;
	readonly model: string;
}

interface AliasRegistration {
	readonly provider: string;
	readonly aliases: ReadonlyMap<string, ModelAlias>;
}

/** The metadata of the target under the alias as id and name, with the alias provider as provider. */
export function aliasedModel(providerId: string, alias: string, target: Model<Api>): Model<Api> {
	return { ...target, id: alias, name: alias, provider: providerId };
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
		this.aliasRegistration = { provider: providerId, aliases: new Map(aliases.map((entry) => [entry.alias, entry])) };
	}

	private aliasModels(): Model<Api>[] {
		const registration = this.aliasRegistration;
		if (!registration) return [];
		return [...registration.aliases.values()].flatMap((entry) => {
			const target = this.models.getModel(entry.upstream, entry.model);
			return target ? [aliasedModel(registration.provider, entry.alias, target)] : [];
		});
	}

	private targetOf(model: Model<Api>): Model<Api> | undefined {
		const registration = this.aliasRegistration;
		if (model.provider !== registration?.provider) return undefined;
		const entry = registration.aliases.get(model.id);
		const target = entry && this.models.getModel(entry.upstream, entry.model);
		if (!target) throw new Error(`Model ${model.provider}/${model.id} is not configured.`);
		return target;
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
