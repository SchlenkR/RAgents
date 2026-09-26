import type { TSchema } from "typebox";

import { assertJsonValue, type JsonValue } from "../domain/json.ts";
import { canonicalTypeScriptBuildContract, typeScriptBuildContractHash } from "./build-contract.ts";
import { typeScriptTypesFromSchema } from "./schema.ts";

export const runContextApiVersion = 1;

export type RunInvocationKind = "input" | "tool" | "snippet" | "app-action" | "event" | "schedule";
export type RunPrincipalKind = "agent" | "script" | "operator" | "service";

export interface RunCapabilityDescriptor {
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly schema: TSchema;
    readonly resultSchema: TSchema;
}

export interface RunCapabilityPrincipalBinding {
    readonly id: string;
    readonly kind: RunPrincipalKind;
    readonly grants?: readonly unknown[];
}

export interface RunCapabilityPolicyBinding {
    readonly id: string;
    readonly policy: string;
}

export const runCapabilityContract = (capabilities: readonly RunCapabilityDescriptor[]): string =>
    canonicalTypeScriptBuildContract({
        apiVersion: runContextApiVersion,
        capabilities: [...capabilities]
            .sort((left, right) => left.id.localeCompare(right.id))
            .map((capability) => ({
                id: capability.id,
                schema: capability.schema,
                resultSchema: capability.resultSchema,
            })),
    });

export const runCapabilityContractHash = (capabilities: readonly RunCapabilityDescriptor[]): string =>
    typeScriptBuildContractHash(runCapabilityContract(capabilities));

export const runCapabilityBindingHash = (binding: {
    readonly principal: RunCapabilityPrincipalBinding;
    readonly capabilities: readonly RunCapabilityDescriptor[];
    readonly policies?: readonly RunCapabilityPolicyBinding[];
}): string => typeScriptBuildContractHash(canonicalTypeScriptBuildContract({
    apiVersion: runContextApiVersion,
    principal: {
        id: binding.principal.id,
        kind: binding.principal.kind,
        grants: binding.principal.grants ?? [],
    },
    capabilities: [...binding.capabilities]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((capability) => ({
            id: capability.id,
            schema: capability.schema,
            resultSchema: capability.resultSchema,
        })),
    policies: [...binding.policies ?? []]
        .sort((left, right) => left.id.localeCompare(right.id)),
}));

export interface RunCapabilityPort {
    readonly descriptors: () => readonly RunCapabilityDescriptor[];
    readonly call: (name: string, input: JsonValue) => Promise<JsonValue>;
}

export interface RunStatePort {
    readonly read: () => unknown;
    readonly replace: (value: unknown) => void;
}

export interface RunContextBinding {
    readonly runId: string;
    readonly invocationId: string;
    readonly invocationKind: RunInvocationKind;
    readonly principal: {
        readonly id: string;
        readonly kind: RunPrincipalKind;
    };
    readonly state: RunStatePort;
    readonly capabilities: RunCapabilityPort;
    readonly log: (value: unknown) => void;
    readonly signal: AbortSignal;
}

const requiredName = (value: unknown): string => {
    if (typeof value !== "string" || !value.trim()) throw new Error("Capability name must be a non-empty string.");
    return value;
};

export const createRunContext = (binding: RunContextBinding) => ({
    run: { id: binding.runId },
    invocation: { id: binding.invocationId, kind: binding.invocationKind },
    principal: { ...binding.principal },
    state: {
        read: () => structuredClone(binding.state.read()),
        replace: (value: unknown) => {
            assertJsonValue(value, "Run state");
            binding.state.replace(structuredClone(value));
        },
    },
    functions: Object.freeze(Object.fromEntries(binding.capabilities.descriptors().map(({ id: name }) => [name,
        (input: JsonValue = {}) => {
            binding.signal.throwIfAborted();
            assertJsonValue(input, `Capability ${requiredName(name)} input`);
            return binding.capabilities.call(requiredName(name), input);
        },
    ]))),
    signal: binding.signal,
    log: (value: unknown) => binding.log(value),
    throwIfAborted: () => binding.signal.throwIfAborted(),
});

export interface RunContextDeclarationsOptions {
    readonly stateType: string;
    readonly capabilities: readonly RunCapabilityDescriptor[];
    readonly program: string;
}

/** The types of the given functions as `RAgentsCapabilityMap`, without the declarations of the context around them. */
export const runCapabilityDeclarations = (capabilities: readonly RunCapabilityDescriptor[]): string => {
    const seen = new Set<string>();
    const declarations: string[] = [];
    const sorted = [...capabilities].sort((left, right) => left.id.localeCompare(right.id));
    const uses = new Map<object, number>();
    for (const capability of sorted) for (const schema of [capability.schema, capability.resultSchema]) uses.set(schema, (uses.get(schema) ?? 0) + 1);
    const shared = new Map<object, string>();
    const typeOf = (schema: RunCapabilityDescriptor["schema"], prefix: string): string => {
        const existing = shared.get(schema);
        if (existing) return existing;
        const rendered = typeScriptTypesFromSchema(schema, prefix);
        declarations.push(...rendered.declarations);
        if ((uses.get(schema) ?? 0) < 2) return rendered.type;
        const name = `RAgentsShared${shared.size}`;
        shared.set(schema, name);
        declarations.push(`type ${name} = ${rendered.type};`);
        return name;
    };
    const fields = sorted.map((capability, index) => {
        if (!capability.id.trim()) throw new Error("A capability declaration has no id.");
        if (seen.has(capability.id)) throw new Error(`Capability ${capability.id} is declared more than once.`);
        seen.add(capability.id);
        const input = typeOf(capability.schema, `RAgentsCapability${index}Input`);
        const output = typeOf(capability.resultSchema, `RAgentsCapability${index}Output`);
        return [
            `  readonly ${JSON.stringify(capability.id)}: {`,
            `    readonly input: ${input};`,
            `    readonly output: ${output};`,
            "  };",
        ].join("\n");
    });

    const map = fields.length > 0 ? `{\n${fields.join("\n")}\n}` : "{}";
    return `${declarations.join("\n")}${declarations.length > 0 ? "\n\n" : ""}type RAgentsCapabilityMap = ${map};`;
};

/** The declarations of the context itself, the same for every function selection. */
export const runContextFrameDeclarations = (stateType: string, program: string): string => `interface RAgentsRunState<State> {
  read(): State;
  replace(value: State): void;
}

type RAgentsRunInput<Input> = {} extends Input ? [input?: Input] : [input: Input];

type RAgentsRunFunctions<Capabilities> = {
  readonly [Name in keyof Capabilities]: (
    ...args: RAgentsRunInput<Capabilities[Name] extends { readonly input: infer Input } ? Input : never>
  ) => Promise<Capabilities[Name] extends { readonly output: infer Output } ? Output : never>;
};

interface RAgentsRunContext<State, Capabilities> {
  readonly run: { readonly id: string };
  readonly actor: { readonly id: string; readonly handle: string };
  readonly invocation: {
    readonly id: string;
    readonly kind: "input" | "tool" | "snippet" | "app-action" | "event" | "schedule";
  };
  readonly principal: {
    readonly id: string;
    readonly kind: "agent" | "script" | "operator" | "service";
  };
  readonly signal: AbortSignal;
  readonly state: RAgentsRunState<State>;
  readonly functions: RAgentsRunFunctions<Capabilities>;
  log(value: unknown): void;
  throwIfAborted(): void;
}

type RunContext = RAgentsRunContext<${stateType}, RAgentsCapabilityMap>;

${program.trim()}
`;

export const createRunContextDeclarations = (options: RunContextDeclarationsOptions): string =>
    `${runCapabilityDeclarations(options.capabilities)}\n\n${runContextFrameDeclarations(options.stateType, options.program)}`;
