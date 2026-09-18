import {
  runCapabilityBindingHash,
  runCapabilityContractHash,
  type Actor,
  type RunFunction,
  type RunCapabilityDescriptor,
} from "@aicontainer/ragents";

import type { OperationDescriptorPort } from "./operations.js";

export interface ResolvedCapabilityBinding {
  descriptors: readonly RunCapabilityDescriptor[];
  descriptorContractHash: string;
  bindingContractHash: string;
}

const descriptorOf = (capability: {
  id: string;
  label: string;
  description: string;
  schema: RunCapabilityDescriptor["schema"];
  resultSchema: RunCapabilityDescriptor["resultSchema"];
}): RunCapabilityDescriptor => ({
  id: capability.id,
  label: capability.label,
  description: capability.description,
  schema: capability.schema,
  resultSchema: capability.resultSchema,
});

const selected = <T>(
  available: readonly T[],
  capabilityIds: readonly string[],
  idOf: (value: T) => string,
  unavailable: (id: string, names: string) => Error,
): T[] => {
  const byId = new Map(available.map((value) => [idOf(value), value]));
  return capabilityIds.map((id) => {
    const value = byId.get(id);
    if (!value) throw unavailable(id, [...byId.keys()].sort().join(", ") || "keine");
    return value;
  });
};

export const operatorCapabilityBinding = (
  actorId: string,
  operations: readonly OperationDescriptorPort[],
  capabilityIds: readonly string[],
): ResolvedCapabilityBinding => {
  const resolved = selected(
    operations.filter((operation) => operation.operator !== "unavailable"),
    capabilityIds,
    (operation) => operation.id,
    (id, names) => new Error(`Capability ${id} ist für den Bediener nicht verfügbar. Verfügbar sind: ${names}.`),
  );
  const descriptors = resolved.map(descriptorOf);
  return {
    descriptors,
    descriptorContractHash: runCapabilityContractHash(descriptors),
    bindingContractHash: runCapabilityBindingHash({
      principal: { id: actorId, kind: "operator" },
      capabilities: descriptors,
      policies: resolved.map((operation) => ({ id: operation.id, policy: operation.operator })),
    }),
  };
};

export const agentCapabilityBinding = (
  actor: Actor,
  tools: readonly RunFunction[],
  capabilityIds: readonly string[],
  blockedNames: ReadonlySet<string>,
): ResolvedCapabilityBinding => {
  const resolved = selected(
    tools.filter((tool) => !blockedNames.has(tool.name)),
    capabilityIds,
    (tool) => tool.name,
    (id, names) => new Error(
      `Capability ${id} ist für @${actor.handle} nicht verfügbar. Verfügbar sind: ${names}.`,
    ),
  );
  const descriptors = resolved.map((tool) => descriptorOf({ ...tool, id: tool.name }));
  return {
    descriptors,
    descriptorContractHash: runCapabilityContractHash(descriptors),
    bindingContractHash: runCapabilityBindingHash({
      principal: { id: actor.id, kind: actor.kind === "script" ? "script" : "agent", grants: actor.grants },
      capabilities: descriptors,
      policies: descriptors.map((descriptor) => ({ id: descriptor.id, policy: "agent" })),
    }),
  };
};

export const assertSharedDescriptorContract = (
  handlerId: string,
  bindings: readonly ResolvedCapabilityBinding[],
): string => {
  const hashes = new Set(bindings.map((binding) => binding.descriptorContractHash));
  if (hashes.size !== 1) {
    throw new Error(
      `Handler ${handlerId} wird unter Identitäten mit unterschiedlichen Capability-Verträgen verwendet.`,
    );
  }
  const hash = hashes.values().next().value;
  if (!hash) throw new Error(`Handler ${handlerId} besitzt keine gebundene Oberfläche.`);
  return hash;
};
