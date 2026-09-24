import { isThinkingLevel, resolveExecution, type CatalogModel, type ModelCatalog, type ModelSelection, type Orchestration, type RunState } from "@ragents/engine";
import type { CoordinatorDescriptor } from "./product-runtime.js";
import { storedModel, storedThinking } from "./start-option-state.js";

export const isRunCoordinator = (runtime: Orchestration, runId: string, actorId: string): boolean =>
  runtime.events(runId).some((event) => event.type === "agent.spawned"
    && event.payload.agentId === actorId && /(?:^|:)coordinator:[^:]+:\d+$/.test(event.commandId));

export interface CoordinatorModelChoice {
  readonly model: string | undefined;
  readonly thinking: string | undefined;
}

export const storedModelChoice = (state: RunState | null): CoordinatorModelChoice => ({ model: storedModel(state), thinking: storedThinking(state) });

/** Das Modell eines Turns des Run-Koordinators: die Modellwahl des Runs, ohne sie das beim Anlegen. */
export const coordinatorSelection = (
  catalog: ModelCatalog & { readonly modelList: readonly CatalogModel[] },
  coordinator: Pick<CoordinatorDescriptor, "handle" | "profile">,
  choice: CoordinatorModelChoice,
  spawned: ModelSelection,
): ModelSelection => {
  if (!choice.model) return spawned;
  const execution = resolveExecution(catalog, {
    profile: coordinator.profile,
    model: choice.model,
    ...(isThinkingLevel(choice.thinking) ? { thinking: choice.thinking } : {}),
  }, coordinator.handle, catalog.modelList);
  if (execution.driver.kind !== "agent") throw new Error(`Das Profil ${coordinator.profile} des Koordinators hat keine Modelllaufzeit`);
  return execution.driver.config;
};
