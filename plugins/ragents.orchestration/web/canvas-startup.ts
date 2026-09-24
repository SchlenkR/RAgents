import type { ChatStartupStatus } from "@ragents/host/chat-events";
import type { StartupNoticeState } from "@ragents/web/ui";
import { isPendingRunActorInput, type RunView } from "@ragents/web/run-view";

export type CanvasStartupState = StartupNoticeState;

export function canvasStartupState({ view, startup, connected, running, error }: {
  view: RunView | undefined;
  startup: ChatStartupStatus | undefined;
  connected: boolean;
  running: boolean;
  error: string | undefined;
}): CanvasStartupState | undefined {
  if (startup?.status === "failed") return { kind: "error", title: "Der Run konnte nicht vorbereitet werden", detail: startup.message };
  if (error) return { kind: "error", title: "Der Run-Status ist nicht erreichbar", detail: error };
  if (startup?.status === "preparing") return { kind: "working", title: "Run wird vorbereitet", detail: startup.message };
  const actors = view?.actors.filter((actor) => actor.kind !== "human") ?? [];
  const activeActors = actors.filter((actor) => actor.lifecycle?.kind !== "stopped");
  if (actors.length && !activeActors.length) return { kind: "stopped", title: "Der Run wurde gestoppt", detail: "Es wird keine weitere Arbeit ausgeführt." };
  if (view?.actions.some((action) => action.status === "pending")) return {
    kind: "waiting", title: "Deine Eingabe wird benötigt", detail: "Im Chat wartet eine Aktion auf Deine Eingabe.",
  };
  const activeIds = new Set(activeActors.map((actor) => actor.id));
  const working = running || activeActors.some((actor) => actor.lifecycle?.kind === "running")
    || view?.turns.some((turn) => activeIds.has(turn.actorId) && turn.status === "running")
    || view?.inputs.some((input) => activeIds.has(input.actorId) && isPendingRunActorInput(input));
  if (working) return { kind: "working", title: "Der Run wird eingerichtet", detail: "Die Oberfläche wird aufgebaut. Die Elemente erscheinen automatisch." };
  const failed = activeActors.map((actor) => view?.turns.filter((turn) => turn.actorId === actor.id).at(-1))
    .find((turn) => turn?.status === "failed" || turn?.status === "interrupted");
  if (failed) return { kind: "error", title: "Der Aufbau wurde angehalten", detail: failed.reason || "Der letzte Arbeitsschritt konnte nicht abgeschlossen werden." };
  if (!connected) return { kind: "working", title: "Run wird geladen", detail: "Die Verbindung zum Run wird hergestellt." };
  return undefined;
}
