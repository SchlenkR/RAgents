import type { AccessProjectionContribution, JsonValue } from "@ragents/engine";
import { ACTOR_INVOCATIONS_STATE_ID, ACTOR_PROGRAMS_STATE_ID } from "@ragents/host/plugin-support/actor-programs/contract.js";

const record = (value: JsonValue | undefined): Record<string, JsonValue | undefined> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;

/** Ohne runs.inspect bleiben von einem Programm Name, Actor und Ansichten; Quellen, Funktionen und Verzeichnisse fehlen. */
const visibleProgram = (state: JsonValue): JsonValue => {
  const program = record(record(state)?.program);
  if (!program) return state;
  const views = Array.isArray(program.views) ? program.views.map((value) => {
    const view = record(value);
    return view ? { id: view.id, key: view.key, title: view.title, visible: view.visible, placements: view.placements } : value;
  }) : [];
  return {
    version: 1,
    program: {
      name: program.name,
      title: program.title,
      actorId: program.actorId,
      actorHandle: program.actorHandle,
      revision: program.revision,
      views,
    },
  };
};

export const actorProgramAccessProjections: readonly AccessProjectionContribution[] = [
  { id: ACTOR_PROGRAMS_STATE_ID, state: (entry) => visibleProgram(entry.state), chatEvent: () => undefined },
  { id: ACTOR_INVOCATIONS_STATE_ID, state: (entry) => ({ version: 1, revision: entry.updatedAt }), chatEvent: () => undefined },
];
