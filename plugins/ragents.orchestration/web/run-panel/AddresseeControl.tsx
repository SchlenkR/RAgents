import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Badge, cn, Input, Spinner } from "@ragents/web/ui";
import { ActorHeaderModeControl } from "../ActorSurfaceControls";
import { ActorPopout } from "../ActorPopout";
import type { RunActor, RunView } from "@ragents/web/run-view";
import { pendingInputCount } from "./run-panel-actors";
import { ADDRESSEE_SEARCH_ABOVE, addresseeMatches, addresseeSummaries, addresseeTree } from "./addressee-tree";
import { ActorIcon, AddresseeTree } from "./AddresseeTree";

const chipClass = "flex h-7 min-w-[70px] max-w-[220px] flex-[0_1_auto] cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background pr-2 pl-1 text-[0.72rem] font-semibold text-foreground hover:bg-accent aria-expanded:border-primary focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:outline-offset-1";
const busyClass = "flex h-7 min-w-0 flex-[0_1_auto] cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[0.7rem] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:outline-offset-1";

/** Der Adressat des Chats als Chip in der Eingabeleiste; das Pop-out zeigt die Actors als Baum nach Erzeuger, die ausgeblendeten hinter ihrer Zahl. */
export function AddresseeControl({ hidden, onOpenChange, onReveal, onSelect, runId, selected, shown, technical, view }: {
  hidden: readonly RunActor[];
  onOpenChange: (open: boolean) => void;
  onReveal: (actor: RunActor) => void;
  onSelect: (actor: RunActor) => void;
  runId: string;
  selected: RunActor;
  shown: readonly RunActor[];
  technical: boolean;
  view: RunView;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hiddenListed, setHiddenListed] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const change = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  }, [onOpenChange]);
  const close = useCallback((restoreFocus = false) => {
    change(false);
    setQuery("");
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, [change]);
  const revealSelected = useCallback((element: HTMLDivElement | null) => {
    element?.querySelector("[aria-current=true]")?.scrollIntoView({ block: "nearest" });
  }, []);
  const working = useMemo(() => [...shown, ...hidden].filter((actor) => actor.lifecycle?.kind === "running" && actor.id !== selected.id), [hidden, selected.id, shown]);
  const summary = useMemo(() => addresseeSummaries(view), [view]);
  const searching = query.trim() !== "";
  const shownTree = useMemo(() => addresseeTree(view, addresseeMatches(view, shown, query, summary)), [query, shown, summary, view]);
  const hiddenMatches = useMemo(() => addresseeMatches(view, hidden, query, summary), [hidden, query, summary, view]);
  const hiddenTree = useMemo(() => addresseeTree(view, hiddenMatches), [hiddenMatches, view]);
  const hiddenOpen = hiddenListed || (searching && hiddenMatches.length > 0);
  const toggle = useCallback((key: string) => setToggled((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  }), []);
  const pick = (actor: RunActor, reveal: boolean) => {
    (reveal ? onReveal : onSelect)(actor);
    close(true);
  };
  const busyTitle = working.map((actor) => `@${actor.handle} arbeitet`).join(", ");
  const busyPending = working.length > 0 ? pendingInputCount(view, working[0].id) : 0;
  const treeProps = { onToggle: toggle, openByDefault: searching, selectedId: selected.id, summary, technical, toggled, view };
  const listClass = "px-1.5 py-1";

  return <>
    <button aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" className={chipClass} onClick={() => change(!open)} ref={buttonRef} title={`Adressat: @${selected.handle}. Klick wählt einen anderen Actor`} type="button">
      <ActorIcon actor={selected} className="size-5" view={view} />
      <span className="truncate">@{selected.handle}</span>
      <ChevronDownIcon aria-hidden className="size-3 flex-none text-muted-foreground" />
    </button>
    {working.length > 0 && <button className={busyClass} onClick={() => change(!open)} title={busyTitle} type="button">
      <Spinner aria-hidden className="size-3 flex-none" />
      <span className="truncate in-data-[compact=true]:hidden">@{working[0].handle}</span>
      {busyPending > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.6rem]" variant="secondary">{busyPending}</Badge>}
      {working.length > 1 && <span className="flex-none">+{working.length - 1}</span>}
    </button>}
    {open && <ActorPopout buttonRef={buttonRef} closeLabel="Adressat schließen" height={460} id={panelId} label="Adressat" onClose={close} open placement="top" role="dialog" width="available">
      {shown.length + hidden.length > ADDRESSEE_SEARCH_ABOVE && <div className="flex-none border-b border-border-soft px-2.5 py-1.5">
        <Input aria-label="Actors durchsuchen" className="h-7" onChange={(event) => setQuery(event.target.value)} placeholder="Handle oder Aufgabe suchen ..." type="search" value={query} />
      </div>}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain" ref={revealSelected}>
        <AddresseeTree className={listClass} nodes={shownTree} onPick={(actor) => pick(actor, false)} {...treeProps} />
        {searching && shownTree.length === 0 && hiddenMatches.length === 0 && <p className="px-3.5 py-2 text-muted-foreground">Kein Actor passt zur Suche.</p>}
        {hidden.length > 0 && (!searching || hiddenMatches.length > 0) && <div className="border-t border-border-soft">
          <button aria-expanded={hiddenOpen} className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2 text-left text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2" onClick={() => setHiddenListed(!hiddenOpen)} type="button">
            <span>{hidden.length} ausgeblendete Actors</span>
            <ChevronDownIcon aria-hidden className={cn("size-3.5 flex-none transition-transform", hiddenOpen && "rotate-180")} />
          </button>
          {hiddenOpen && <AddresseeTree className={listClass} nodes={hiddenTree} onPick={(actor) => pick(actor, true)} {...treeProps} />}
        </div>}
      </div>
      <div className="flex flex-none items-stretch border-t border-border-soft"><ActorHeaderModeControl runId={runId} /></div>
    </ActorPopout>}
  </>;
}
