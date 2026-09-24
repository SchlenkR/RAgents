import { createLocalStorageSetting } from "@ragents/web/lib/local-storage-setting";
import type { RunActor } from "@ragents/web/run-view";

export const ACTOR_HEADER_MODES = ["all", "active", "visible", "agent", "script"] as const;
export type ActorHeaderMode = typeof ACTOR_HEADER_MODES[number];
export const ACTOR_HEADER_MODE_LABELS: Record<ActorHeaderMode, string> = {
  all: "Alle",
  active: "Aktive",
  visible: "Sichtbare",
  agent: "LLM-Agenten",
  script: "TypeScript",
};

export const actorHeaderStorageKey = (runId: string) => `ragents.orchestration.actor-header:v2:${runId}`;

export function parseActorHeaderMode(raw: string | null): ActorHeaderMode {
  if (raw === null) return "visible";
  if (ACTOR_HEADER_MODES.some((mode) => mode === raw)) return raw as ActorHeaderMode;
  throw new Error("Die gespeicherte Actor-Anzeige ist ungültig. Erlaubt sind all, active, visible, agent und script.");
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
