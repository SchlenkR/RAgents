import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Badge, Input, Spinner } from "@ragents/web/ui";
import { ActorPopout } from "../ActorPopout";
import type { RunActor, RunView } from "@ragents/web/run-view";
import { pendingInputCount } from "./run-panel-actors";
import { ADDRESSEE_SEARCH_ABOVE, addresseeMatches, addresseeSummaries, addresseeTree } from "./addressee-tree";
import { ActorIcon, AddresseeTree } from "./AddresseeTree";

const chipClass = "flex h-7 min-w-[70px] max-w-[220px] flex-[0_1_auto] cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background pr-2 pl-1 text-[0.72rem] font-semibold text-foreground hover:bg-accent aria-expanded:border-primary focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:outline-offset-1";
const busyClass = "flex h-7 min-w-0 flex-[0_1_auto] cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[0.7rem] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:outline-offset-1";

/** The chat's addressee as a chip in the input bar; the pop-out shows the actors as a tree by creator, including stopped actors. */
export function AddresseeControl({ actors, onSelect, selected, technical, view }: {
  actors: readonly RunActor[];
  onSelect: (actor: RunActor) => void;
  selected: RunActor;
  technical: boolean;
  view: RunView;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);
  const revealSelected = useCallback((element: HTMLDivElement | null) => {
    element?.querySelector("[aria-current=true]")?.scrollIntoView({ block: "nearest" });
  }, []);
  const working = useMemo(() => actors.filter((actor) => actor.lifecycle?.kind === "running" && actor.id !== selected.id), [actors, selected.id]);
  const summary = useMemo(() => addresseeSummaries(view), [view]);
  const searching = query.trim() !== "";
  const tree = useMemo(() => addresseeTree(view, addresseeMatches(view, actors, query, summary)), [actors, query, summary, view]);
  const toggle = useCallback((key: string) => setToggled((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  }), []);
  const pick = (actor: RunActor) => {
    onSelect(actor);
    close(true);
  };
  const busyTitle = working.map((actor) => `@${actor.handle} is working`).join(", ");
  const busyPending = working.length > 0 ? pendingInputCount(view, working[0].id) : 0;
  const treeProps = { onToggle: toggle, openByDefault: searching, selectedId: selected.id, summary, technical, toggled, view };
  const listClass = "px-1.5 py-1";

  return <>
    <button aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" className={chipClass} onClick={() => setOpen(!open)} ref={buttonRef} title={`Addressee: @${selected.handle}. Click to choose another actor`} type="button">
      <ActorIcon actor={selected} className="size-5" view={view} />
      <span className="truncate">@{selected.handle}</span>
      <ChevronDownIcon aria-hidden className="size-3 flex-none text-muted-foreground" />
    </button>
    {working.length > 0 && <button className={busyClass} onClick={() => setOpen(!open)} title={busyTitle} type="button">
      <Spinner aria-hidden className="size-3 flex-none" />
      <span className="truncate in-data-[compact=true]:hidden">@{working[0].handle}</span>
      {busyPending > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.6rem]" variant="secondary">{busyPending}</Badge>}
      {working.length > 1 && <span className="flex-none">+{working.length - 1}</span>}
    </button>}
    {open && <ActorPopout buttonRef={buttonRef} closeLabel="Close addressee" height={460} id={panelId} label="Addressee" onClose={close} open placement="top" role="dialog" width="available">
      {actors.length > ADDRESSEE_SEARCH_ABOVE && <div className="flex-none border-b border-border-soft px-2.5 py-1.5">
        <Input aria-label="Search actors" className="h-7" onChange={(event) => setQuery(event.target.value)} placeholder="Search handle or task ..." type="search" value={query} />
      </div>}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain" ref={revealSelected}>
        <AddresseeTree className={listClass} nodes={tree} onPick={pick} {...treeProps} />
        {searching && tree.length === 0 && <p className="px-3.5 py-2 text-muted-foreground">No actor matches the search.</p>}
      </div>
    </ActorPopout>}
  </>;
}
