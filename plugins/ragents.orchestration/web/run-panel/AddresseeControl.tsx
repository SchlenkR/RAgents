import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { Badge, cn, InteractiveItem, Spinner } from "@ragents/web/ui";
import { ActorPopout } from "../ActorPopout";
import { actorAddress, type RunActor, type RunView } from "@ragents/web/run-view";
import { pendingInputCount, selectedRunPanelActor } from "./run-panel-actors";
import { ActorGraph, ActorIcon } from "./ActorGraph";

const chipClass = "flex h-7 min-w-[70px] max-w-[220px] flex-[0_1_auto] items-center gap-0.5 rounded-md text-[0.8rem] font-medium text-muted-foreground";
const pickClass = "flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md pr-2 pl-1 aria-expanded:bg-hover aria-expanded:text-hover-foreground";
const backClass = "mr-1 grid size-5 flex-none cursor-pointer place-items-center rounded-full text-muted-foreground [&>svg]:size-3";
const busyClass = "flex h-7 min-w-0 flex-[0_1_auto] cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[0.7rem] text-active";

/** The chat's addressee as a chip in the input bar; the pop-out shows the actors as a graph by creator, including stopped actors, and the x returns to the primary actor. */
export function AddresseeControl({ actors, onSelect, selected, technical, view }: {
  actors: readonly RunActor[];
  onSelect: (actor: RunActor) => void;
  selected: RunActor;
  technical: boolean;
  view: RunView;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);
  const primary = selectedRunPanelActor(view, actors, null);
  const back = primary && primary.id !== selected.id ? primary : undefined;
  const working = useMemo(() => actors.filter((actor) => actor.lifecycle?.kind === "running" && actor.id !== selected.id), [actors, selected.id]);
  const pick = (actor: RunActor) => {
    onSelect(actor);
    close(true);
  };
  const busyTitle = working.map((actor) => `@${actorAddress(actor)} is working`).join(", ");
  const busyPending = working.length > 0 ? pendingInputCount(view, working[0].id) : 0;

  return <>
    <span className={chipClass}>
      <InteractiveItem aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" className={cn(pickClass, back && "pr-1")} onClick={() => setOpen(!open)} ref={buttonRef} title={`Addressee: @${actorAddress(selected)}. Click to choose another actor`} type="button">
        <ActorIcon actor={selected} className="size-5" view={view} />
        <span className="truncate">@{actorAddress(selected)}</span>
        <ChevronDownIcon aria-hidden className="size-3 flex-none text-muted-foreground" />
      </InteractiveItem>
      {back && <InteractiveItem aria-label={`Back to @${actorAddress(back)}`} className={backClass} onClick={() => onSelect(back)} title={`Back to @${actorAddress(back)}`} type="button"><XIcon aria-hidden /></InteractiveItem>}
    </span>
    {working.length > 0 && <InteractiveItem className={busyClass} onClick={() => setOpen(!open)} title={busyTitle} type="button">
      <Spinner aria-hidden className="size-3 flex-none" />
      <span className="truncate in-data-[compact=true]:hidden">@{actorAddress(working[0])}</span>
      {busyPending > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.6rem]" tone="warning">{busyPending}</Badge>}
      {working.length > 1 && <span className="flex-none">+{working.length - 1}</span>}
    </InteractiveItem>}
    {open && <ActorPopout buttonRef={buttonRef} closeLabel="Close addressee" id={panelId} label="Addressee" onClose={close} open placement="top" role="dialog">
      <ActorGraph actors={actors} onPick={pick} selectedId={selected.id} technical={technical} view={view} />
    </ActorPopout>}
  </>;
}
