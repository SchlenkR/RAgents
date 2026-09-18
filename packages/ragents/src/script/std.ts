import { mediatorsDeclarations, createMediators, type MediatorBinding } from "./mediators.ts";

export type ScriptStdBinding = MediatorBinding & {
    readonly turnStartedAt: string;
    readonly idPrefix: string;
};

export const createScriptStd = (binding: ScriptStdBinding) => {
    let issued = 0;

    return {
        now: () => binding.turnStartedAt,
        id: () => `${binding.idPrefix}:${++issued}`,
        mediators: createMediators(binding),
    };
};

export const scriptStdDeclarations = `
${mediatorsDeclarations.trim()}

interface RAgentsStd {
  now(): string;
  id(): string;
  readonly mediators: RAgentsMediators;
}

`;
