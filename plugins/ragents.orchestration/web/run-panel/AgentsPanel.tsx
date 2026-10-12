import { useMemo } from "react";
import { useAccess } from "@ragents/web/AccessContext";
import type { WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { runViewFrom } from "@ragents/web/run-view";
import { ActorGraph } from "./ActorGraph";
import { runPanelActors, selectedRunPanelActor } from "./run-panel-actors";
import { saveRunPanelState, useRunPanelState } from "./run-panel-state";

export const AGENTS_TAB_ID = "ragents.orchestration.agents";

export function AgentsPanel({ session }: WorkspaceTabContext) {
  const runId = session.session.id;
  const inspect = useAccess().can("runs.inspect");
  const view = runViewFrom(session.runView);
  const actors = useMemo(() => view ? runPanelActors(view, inspect) : [], [inspect, view]);
  const stored = useRunPanelState(runId);
  const selected = view && selectedRunPanelActor(view, actors, stored.actor);
  if (!view || !selected) return null;
  return <ActorGraph actors={actors} fill onPick={(actor) => saveRunPanelState(runId, { ...stored, actor: actor.id })}
    selectedId={selected.id} technical={inspect} view={view} />;
}
