import { useMemo, useState } from "react";
import { NetworkIcon } from "lucide-react";
import { useAccess } from "@ragents/web/AccessContext";
import type { SessionHeaderContext } from "@ragents/web/PluginRegistry";
import { runViewFrom, type RunActor } from "@ragents/web/run-view";
import { Button, HeaderDropdown } from "@ragents/web/ui";
import { ActorGraph } from "./ActorGraph";
import { runPanelActors, selectedRunPanelActor } from "./run-panel-actors";
import { saveRunPanelState, useRunPanelState } from "./run-panel-state";

/** Choosing an actor in the header graph addresses its chat. */
export function AgentsHeader({ session }: SessionHeaderContext) {
  const runId = session.session.id;
  const inspect = useAccess().can("runs.inspect");
  const view = runViewFrom(session.runView);
  const actors = useMemo(() => view ? runPanelActors(view, inspect) : [], [inspect, view]);
  const stored = useRunPanelState(runId);
  const [open, setOpen] = useState(false);
  const selected = view && selectedRunPanelActor(view, actors, stored.actor);
  if (!view || !selected) return null;
  const pick = (actor: RunActor) => {
    saveRunPanelState(runId, { ...stored, actor: actor.id });
    setOpen(false);
  };

  return <HeaderDropdown label="Agents" onOpenChange={setOpen} open={open}
    trigger={<Button aria-label="Agents" className="flex-none self-center" size="lg" title="Show the agents of this run" variant="ghost">
      <NetworkIcon /><span>Agents</span>
    </Button>}>
      <ActorGraph actors={actors} onPick={pick} selectedId={selected.id} technical={inspect} view={view} />
  </HeaderDropdown>;
}
