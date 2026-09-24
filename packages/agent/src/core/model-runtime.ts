import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type AuthCheck,
	type AuthResult,
	type Context,
	createModels,
	type Model,
	type MutableModels,
	type Provider,
	type SimpleStreamOptions,
} from "@ragents/ai";
import { builtinProviders } from "@ragents/ai/providers/all";
import { composeModelProvider, type ProviderConfigInput } from "./provider-composer.ts";

/** The built-in providers plus the ones registered at runtime; a key comes from the registration or the environment. */
export class ModelRuntime {
	private readonly models: MutableModels = createModels();
	private readonly builtins: ReadonlyMap<string, Provider>;
	private readonly registrations = new Map<string, ProviderConfigInput>();

	private constructor() {
		this.builtins = new Map(builtinProviders().map((provider) => [provider.id, provider]));
		for (const provider of this.builtins.values()) this.models.setProvider(provider);
	}

	static create(): ModelRuntime {
		return new ModelRuntime();
	}

	getModels(providerId?: string): readonly Model<Api>[] {
		return this.models.getModels(providerId);
	}

	getModel(providerId: string, modelId: string): Model<Api> | undefined {
		return this.models.getModel(providerId, modelId);
	}

	checkAuth(providerId: string): Promise<AuthCheck | undefined> {
		return this.models.checkAuth(providerId);
	}

	getAuth(model: Model<Api>): Promise<AuthResult | undefined> {
		return this.models.getAuth(model);
	}

	streamSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
		return this.models.streamSimple(model, context, options);
	}

	completeSimple(model: Model<Api>, context: Context, options?: SimpleStreamOptions): Promise<AssistantMessage> {
		return this.models.completeSimple(model, context, options);
	}

	/** A repeated registration keeps the earlier values it does not set; an invalid one throws and changes nothing. */
	registerProvider(providerId: string, config: ProviderConfigInput): void {
		const effective: ProviderConfigInput = {
			...this.registrations.get(providerId),
			...Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
		};
		this.models.setProvider(composeModelProvider(providerId, this.builtins.get(providerId), effective));
		this.registrations.set(providerId, effective);
	}
}
