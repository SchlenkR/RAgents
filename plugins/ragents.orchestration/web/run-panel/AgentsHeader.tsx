import { useCallback, useId, useMemo, useRef, useState } from "react";
import { NetworkIcon } from "lucide-react";
import { useAccess } from "@ragents/web/AccessContext";
import type { SessionHeaderContext } from "@ragents/web/PluginRegistry";
import { runViewFrom, type RunActor } from "@ragents/web/run-view";
import { Button } from "@ragents/web/ui";
import { ActorPopout } from "../ActorPopout";
import { ActorGraph } from "./ActorGraph";
import { runPanelActors, selectedRunPanelActor } from "./run-panel-actors";
import { saveRunPanelState, useRunPanelState } from "./run-panel-state";

/** "Agents" in the run's title bar: the addressee pop-out's graph with a title, growing down to the bottom of the window; a click on an actor addresses the chat to it. */
export function AgentsHeader({ session }: SessionHeaderContext) {
  const runId = session.session.id;
  const inspect = useAccess().can("runs.inspect");
  const view = runViewFrom(session.runView);
  const actors = useMemo(() => view ? runPanelActors(view, inspect) : [], [inspect, view]);
  const stored = useRunPanelState(runId);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);
  const selected = view && selectedRunPanelActor(view, actors, stored.actor);
  if (!view || !selected) return null;
  const pick = (actor: RunActor) => {
    saveRunPanelState(runId, { ...stored, actor: actor.id });
    close(true);
  };

  return <>
    <Button aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" aria-label="Agents" className="flex-none self-center" onClick={() => setOpen(!open)} ref={buttonRef} size="lg" title="Show the agents of this run" variant="ghost">
      <NetworkIcon /><span>Agents</span>
    </Button>
    {open && <ActorPopout align="end" buttonRef={buttonRef} closeLabel="Close agents" id={panelId} label="Agents" onClose={close} open role="dialog">
      <ActorGraph actors={actors} onPick={pick} selectedId={selected.id} technical={inspect} view={view} />
    </ActorPopout>}
  </>;
}
