import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { cn, InteractiveItem, Spinner } from "@ragents/web/ui";
import { ActorPopout } from "../ActorPopout";
import { actorAddress, type RunActor, type RunView } from "@ragents/web/run-view";
import { useDockPanelDrag } from "@ragents/web/run-panel/DockWorkspace";
import { selectedRunPanelActor } from "./run-panel-actors";
import { ActorGraph, ActorIcon } from "./ActorGraph";

const chipClass = "flex h-7 min-w-[70px] max-w-[220px] flex-[0_1_auto] items-center gap-0.5 rounded-md text-[0.8rem] font-medium text-muted-foreground";
const pickClass = "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md pr-2 pl-1 aria-expanded:bg-hover aria-expanded:text-hover-foreground";
const backClass = "mr-1 grid size-5 flex-none cursor-pointer place-items-center rounded-full text-muted-foreground [&>svg]:size-3";
const busyClass = "flex h-7 min-w-0 flex-[0_1_auto] cursor-pointer items-center gap-1 rounded-md px-2 text-[0.7rem] text-active";

/** The chat's addressee as a chip in the input bar; the pop-out shows the actors as a graph by creator, including stopped actors, and the x returns to the primary actor. */
export function AddresseeControl({ actors, onSelect, selected, view }: {
  actors: readonly RunActor[];
  onSelect: (actor: RunActor) => void;
  selected: RunActor;
  view: RunView;
}) {
  const drag = useDockPanelDrag();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);
  const primary = selectedRunPanelActor(view, actors, null);
  const back = primary && primary.id !== selected.id ? primary : undefined;
  const working = useMemo(() => actors.filter((actor) => actor.lifecycle?.kind === "running" && actor.id !== primary?.id), [actors, primary?.id]);
  const pick = (actor: RunActor) => {
    onSelect(actor);
    close(true);
  };
  const busyTitle = `${working.length} ${working.length === 1 ? "subagent" : "subagents"} working. Click to show agents`;

  return <>
    <span className={chipClass}>
      <InteractiveItem aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" className={cn(pickClass, back && "pr-1", drag && "touch-none cursor-grab active:cursor-grabbing")}
        onClick={(event) => { if (!drag || event.detail === 0) setOpen(!open); }}
        onPointerDown={drag && ((event) => drag(event, `actor:${selected.id}`, () => setOpen(!open), () => close()))}
        ref={buttonRef} aria-label={`Addressee: @${actorAddress(selected)}. Click to choose another actor`} type="button">
        <ActorIcon actor={selected} className="size-5" view={view} />
        <span className="truncate">@{actorAddress(selected)}</span>
        <ChevronDownIcon aria-hidden className="size-3 flex-none text-muted-foreground" />
      </InteractiveItem>
      {back && <InteractiveItem aria-label={`Back to @${actorAddress(back)}`} className={backClass} onClick={() => onSelect(back)} aria-description={`Back to @${actorAddress(back)}`} type="button"><XIcon aria-hidden /></InteractiveItem>}
    </span>
    {working.length > 0 && <InteractiveItem aria-label={busyTitle} aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" className={busyClass}
      onClick={() => setOpen(!open)} aria-description={busyTitle} type="button">
      <Spinner aria-hidden className="size-3 flex-none" />
      <span className="tabular-nums">{working.length}</span>
    </InteractiveItem>}
    {open && <ActorPopout buttonRef={buttonRef} closeLabel="Close addressee" id={panelId} label="Addressee" onClose={close} open placement="top" role="dialog">
      <ActorGraph actors={actors} onDragStart={() => close()} onPick={pick} selectedId={selected.id} view={view} />
    </ActorPopout>}
  </>;
}
