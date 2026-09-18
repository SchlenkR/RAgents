import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, CodeIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { Badge, cn, Input, Spinner } from "@aicontainer/web/ui";
import { ActorHeaderModeControl } from "../ActorCanvasControls";
import { ActorPopout } from "../ActorPopout";
import { actorSurface, type RunActor, type RunView } from "../run-view";
import { pendingInputCount } from "./column-actors";

const chipClass = "flex h-7 min-w-[70px] max-w-[220px] flex-[0_1_auto] cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background pr-2 pl-1 text-[0.72rem] font-semibold text-foreground hover:bg-accent aria-expanded:border-primary focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:outline-offset-1";
const busyClass = "flex h-7 min-w-0 flex-[0_1_auto] cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[0.7rem] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:outline-offset-1";
const entryClass = "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent aria-current:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2";
const iconClass: Readonly<Record<string, string>> = {
  agent: "bg-glass-agent",
  primary: "bg-glass-primary",
  script: "bg-glass-script",
  app: "bg-glass-app",
};

const actorType = (actor: RunActor, technical: boolean) => !technical ? "Agent" : actor.kind === "agent" ? "LLM-Agent" : "TypeScript-Actor";
const actorStatus = (actor: RunActor) => actor.lifecycle?.kind === "running" ? "arbeitet" : actor.lifecycle?.kind === "stopped" ? "gestoppt" : "bereit";

export const filterActors = (actors: readonly RunActor[], query: string): RunActor[] => {
  const words = query.trim().toLocaleLowerCase("de-DE").split(/\s+/).filter(Boolean);
  return actors.filter((actor) => words.every((word) => `@${actor.handle} ${actor.displayName}`.toLocaleLowerCase("de-DE").includes(word)));
};

function ActorIcon({ actor, className, view }: { actor: RunActor; className?: string; view: RunView }) {
  const surface = actorSurface(view, actor);
  return <span className={cn("grid flex-none place-items-center rounded-full text-foreground [&>svg]:size-3", iconClass[surface], className)}>
    {actor.lifecycle?.kind === "running" ? <Spinner aria-hidden className="size-3" /> : surface === "primary" ? <SparklesIcon /> : actor.kind === "agent" ? <UsersIcon /> : <CodeIcon />}
  </span>;
}

function ActorEntry({ actor, current, onPick, technical, view }: { actor: RunActor; current: boolean; onPick: () => void; technical: boolean; view: RunView }) {
  const pending = pendingInputCount(view, actor.id);
  return <li>
    <button aria-current={current || undefined} className={entryClass} onClick={onPick} title={`Nachrichten an @${actor.handle} richten`} type="button">
      <ActorIcon actor={actor} className="size-5" view={view} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate font-semibold">@{actor.handle}</span>
        <span className="text-[0.66rem] text-muted-foreground">{actorType(actor, technical)}, {actorStatus(actor)}</span>
      </span>
      {pending > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.6rem]" variant="secondary">{pending}</Badge>}
    </button>
  </li>;
}

/** Der Adressat des Chats als Chip in der Eingabeleiste; das Pop-out listet die sichtbaren Actors, die ausgeblendeten hinter ihrer Zahl. */
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const change = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  }, [onOpenChange]);
  const close = useCallback((restoreFocus = false) => {
    change(false);
    if (restoreFocus) buttonRef.current?.focus({ preventScroll: true });
  }, [change]);
  const working = useMemo(() => [...shown, ...hidden].filter((actor) => actor.lifecycle?.kind === "running" && actor.id !== selected.id), [hidden, selected.id, shown]);
  const hiddenMatches = useMemo(() => filterActors(hidden, query), [hidden, query]);
  const pick = (actor: RunActor, reveal: boolean) => {
    (reveal ? onReveal : onSelect)(actor);
    close(true);
  };
  const busyTitle = working.map((actor) => `@${actor.handle} arbeitet`).join(", ");
  const busyPending = working.length > 0 ? pendingInputCount(view, working[0].id) : 0;
  const listClass = "list-none px-1.5 py-1";

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
    {open && <ActorPopout buttonRef={buttonRef} closeLabel="Adressat schließen" height={400} id={panelId} label="Adressat" onClose={close} open placement="top" role="dialog" width="available">
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <ul className={listClass}>
          {shown.map((actor) => <ActorEntry actor={actor} current={actor.id === selected.id} key={actor.id} onPick={() => pick(actor, false)} technical={technical} view={view} />)}
        </ul>
        {hidden.length > 0 && <div className="border-t border-border-soft">
          <button aria-expanded={hiddenListed} className="flex w-full cursor-pointer items-center justify-between gap-2 px-3.5 py-2 text-left text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2" onClick={() => setHiddenListed((value) => !value)} type="button">
            <span>{hidden.length} ausgeblendete Actors</span>
            <ChevronDownIcon aria-hidden className={cn("size-3.5 flex-none transition-transform", hiddenListed && "rotate-180")} />
          </button>
          {hiddenListed && <>
            {hidden.length > 8 && <div className="px-2.5 pb-1"><Input aria-label="Ausgeblendete Actors durchsuchen" className="h-7" onChange={(event) => setQuery(event.target.value)} placeholder="Handle suchen ..." type="search" value={query} /></div>}
            <ul className={listClass}>
              {hiddenMatches.map((actor) => <ActorEntry actor={actor} current={false} key={actor.id} onPick={() => pick(actor, true)} technical={technical} view={view} />)}
            </ul>
          </>}
        </div>}
      </div>
      <div className="flex flex-none items-stretch border-t border-border-soft"><ActorHeaderModeControl runId={runId} /></div>
    </ActorPopout>}
  </>;
}
