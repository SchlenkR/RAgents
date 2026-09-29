import { createLocalStorageSetting } from "@ragents/web/lib/local-storage-setting";
import type { RunActor } from "@ragents/web/run-view";

export const ACTOR_HEADER_MODES = ["all", "active", "visible", "agent", "script"] as const;
export type ActorHeaderMode = typeof ACTOR_HEADER_MODES[number];
export const ACTOR_HEADER_MODE_LABELS: Record<ActorHeaderMode, string> = {
  all: "All",
  active: "Active",
  visible: "Visible",
  agent: "LLM agents",
  script: "TypeScript",
};

export const actorHeaderStorageKey = (runId: string) => `ragents.orchestration.actor-header:v2:${runId}`;

export function parseActorHeaderMode(raw: string | null): ActorHeaderMode {
  if (raw === null) return "visible";
  if (ACTOR_HEADER_MODES.some((mode) => mode === raw)) return raw as ActorHeaderMode;
  throw new Error("The stored actor display is invalid. Allowed are all, active, visible, agent and script.");
}

export const actorOnStage = (actor: RunActor, primaryActorId: string | null | undefined, stage: ReadonlySet<string>) =>
  actor.id === primaryActorId || stage.has(`@${actor.handle}`);

export const actorVisibleInHeader = (actor: RunActor, mode: ActorHeaderMode, onStage: boolean) =>
  actor.kind !== "human" && (mode === "all" || (mode === "active" ? actor.lifecycle?.kind !== "stopped" : mode === "visible" ? onStage : actor.kind === mode));

const setting = createLocalStorageSetting({
  changeEvent: "ragents-actor-header-change",
  matchesKey: (key) => key.startsWith("ragents.orchestration.actor-header:"),
  parse: parseActorHeaderMode,
  serialize: (mode: ActorHeaderMode) => mode,
});

export function useActorHeaderMode(runId: string): ActorHeaderMode {
  return setting.useValue(actorHeaderStorageKey(runId));
}

export function saveActorHeaderMode(runId: string, mode: ActorHeaderMode) {
  setting.save(actorHeaderStorageKey(runId), mode);
}
