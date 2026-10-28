import { useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDownIcon, CodeIcon, CodeXmlIcon, UsersIcon } from "lucide-react";
import { Badge, cn, InteractiveItem, RobotHeadIcon, RunStateIcon, Spinner, SvgEdge, type SvgEdgeProps } from "@ragents/web/ui";
import { actorAddress, actorTone, type RunActor, type RunView } from "@ragents/web/run-view";
import { useDockPanelDrag } from "@ragents/web/run-panel/DockWorkspace";
import { useProgramSlot } from "../program-slot";
import { pendingInputCount } from "./run-panel-actors";
import { addresseeNodeContains, addresseeStatusCounts, addresseeSummaries, addresseeTree, type AddresseeGroupNode, type AddresseeStatus } from "./addressee-tree";
import { actorGraphLayout, clampGraphPan, GRAPH_CARD_HEIGHT, GRAPH_CARD_WIDTH, graphActorState, graphColumns, graphNodeStatus, graphPannable, graphPanTo, graphViewport, type GraphSize } from "./actor-graph";

const cardClass = "flex size-full min-w-0 cursor-pointer flex-col justify-center gap-1 rounded-lg border border-border bg-card text-left text-sm text-card-foreground shadow-xs [&>span]:shrink-0";
const stackClass = "shadow-[3px_3px_0_-1px_var(--color-card),3px_3px_0_0_var(--color-border)]";
const lineClass = "flex min-w-0 items-center gap-2 text-sm";
const iconClass: Readonly<Record<string, string>> = {
  agent: "bg-glass-agent",
  primary: "bg-glass-primary",
  script: "bg-glass-script",
  app: "bg-glass-app",
};
const edgeStyle: Readonly<Record<AddresseeStatus, Pick<SvgEdgeProps, "active" | "tone">>> = {
  running: { tone: "accent", active: true },
  input: { tone: "warning" },
  waiting: { tone: "neutral" },
  stopped: { tone: "neutral" },
};
/** Edges into working actors are drawn last, so the shared line from the creator shows them. */
const edgeLayer: Readonly<Record<AddresseeStatus, number>> = { stopped: 0, waiting: 1, input: 2, running: 3 };

/** A press that moves less than this many pixels stays a click. */
const PAN_THRESHOLD = 5;

/** The chosen actor stays centered until the user pans; after a group click the group card stays where it was on screen. */
type ScrollTarget = { kind: "selected" } | { kind: "keep"; key: string; x: number; y: number };

/** The element's client rectangle and the CSS zoom of the page, which scales client coordinates but not the layout. */
const clientFrame = (element: HTMLElement) => {
  const bounds = element.getBoundingClientRect();
  return { bounds, zoom: bounds.width / element.offsetWidth || 1 };
};

const waitingInputs = (count: number) => count === 1 ? "1 waiting input" : `${count} waiting inputs`;

export function ActorIcon({ actor, className, view }: { actor: RunActor; className?: string; view: RunView }) {
  const tone = actorTone(view, actor);
  return <span className={cn("grid flex-none place-items-center rounded-full text-foreground [&>svg]:size-3", iconClass[tone], className)}>
    {actor.lifecycle?.kind === "running" ? <Spinner aria-hidden className="size-3" /> : tone === "primary" ? <RobotHeadIcon /> : actor.kind === "script" ? <CodeIcon /> : <UsersIcon />}
  </span>;
}

/** Actors by creator, filling a panel or growing within a pop-out, with panning when the cards exceed the available room. */
export function ActorGraph({ actors, fill = false, onDragStart, onPick, selectedId, view }: {
  actors: readonly RunActor[];
  fill?: boolean;
  onDragStart?: () => void;
  onPick: (actor: RunActor) => void;
  selectedId: string;
  view: RunView;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const cardProbe = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(GRAPH_CARD_HEIGHT);
  const [room, setRoom] = useState<GraphSize>();
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | undefined>({ kind: "selected" });
  const [panning, setPanning] = useState(false);
  const summary = useMemo(() => addresseeSummaries(view), [view]);
  const tree = useMemo(() => addresseeTree(view, actors), [actors, view]);
  const open = useCallback((group: AddresseeGroupNode) => addresseeNodeContains(group, selectedId) !== toggled.has(group.key), [selectedId, toggled]);
  const columns = room === undefined ? undefined : graphColumns(room.width);
  const layout = useMemo(() => columns === undefined ? undefined : actorGraphLayout(tree, open, columns, cardHeight), [cardHeight, columns, open, tree]);
  const viewport = useMemo(() => layout && room && graphViewport(layout, room, fill), [fill, layout, room]);
  const pannable = viewport !== undefined && graphPannable(viewport);
  const statuses = useMemo(() => new Map(layout?.cards.map((card) => [card.key, graphNodeStatus(view, card.node)] as const)), [layout, view]);
  const edges = useMemo(() => [...layout?.edges ?? []].sort((left, right) => edgeLayer[statuses.get(left.target) ?? "waiting"] - edgeLayer[statuses.get(right.target) ?? "waiting"]), [layout, statuses]);
  const stopCentering = () => setScrollTarget((current) => current?.kind === "selected" ? undefined : current);
  const toggle = (key: string) => {
    const card = layout?.cards.find((entry) => entry.node.kind === "group" && entry.node.key === key);
    const element = scroller.current;
    if (card && element && viewport) {
      const { bounds, zoom } = clientFrame(element);
      setScrollTarget({ kind: "keep", key: card.key, x: bounds.left + (viewport.left + card.x - element.scrollLeft) * zoom, y: bounds.top + (viewport.top + card.y - element.scrollTop) * zoom });
    }
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const pan = (event: ReactPointerEvent<HTMLDivElement>) => {
    stopCentering();
    const element = scroller.current;
    if (event.button !== 0 || event.pointerType === "touch" || !element || !viewport || !pannable) return;
    const start = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
    const { zoom } = clientFrame(element);
    const pointerId = event.pointerId;
    let moved = false;
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const dx = next.clientX - start.x;
      const dy = next.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
      if (!moved) {
        moved = true;
        setPanning(true);
        element.setPointerCapture(pointerId);
      }
      element.scrollTo(clampGraphPan(viewport, { left: start.left - dx / zoom, top: start.top - dy / zoom }));
    };
    const end = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (!moved) return;
      setPanning(false);
      // The click that ends a pan must not pick the card the pan started on.
      const swallow = (click: MouseEvent) => { click.stopPropagation(); click.preventDefault(); };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  useLayoutEffect(() => {
    const element = probe.current;
    if (!element) return;
    const measure = () => {
      setRoom((current) => current?.width === element.offsetWidth && current.height === element.offsetHeight ? current : { width: element.offsetWidth, height: element.offsetHeight });
      if (cardProbe.current) setCardHeight(cardProbe.current.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (cardProbe.current) observer.observe(cardProbe.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!scrollTarget || !layout || !viewport || !element) return;
    if (scrollTarget.kind === "selected") {
      const card = layout.cards.find((entry) => entry.node.kind === "actor" && entry.node.actor.id === selectedId);
      if (card) element.scrollTo(graphPanTo(viewport, card.x + GRAPH_CARD_WIDTH / 2, card.y + cardHeight / 2, viewport.width / 2, viewport.height / 2));
      return;
    }
    const card = layout.cards.find((entry) => entry.key === scrollTarget.key);
    if (card) {
      const keep = () => {
        const { bounds, zoom } = clientFrame(element);
        element.scrollTo(graphPanTo(viewport, card.x, card.y, (scrollTarget.x - bounds.left) / zoom, (scrollTarget.y - bounds.top) / zoom));
      };
      keep();
      // The pop-out moves to fit its new size only after this; its first resize notification comes after that.
      const settled = new ResizeObserver(() => {
        settled.disconnect();
        keep();
      });
      settled.observe(element);
    }
    setScrollTarget(undefined);
  }, [cardHeight, layout, scrollTarget, selectedId, viewport]);

  return <div className={cn("no-scrollbar relative min-h-0 min-w-0 overflow-auto overscroll-contain select-none", fill ? "size-full flex-1" : "flex-none", pannable && "cursor-grab", panning && "cursor-grabbing **:cursor-grabbing")}
    onKeyDown={stopCentering} onPointerDown={pan} onWheel={stopCentering} ref={scroller} style={!fill && viewport ? { width: viewport.width, height: viewport.height } : undefined}>
    <div aria-hidden className={cn("pointer-events-none invisible absolute top-0 left-0 overflow-hidden", fill ? "size-full" : "size-0")}>
      <div className={fill ? "size-full" : "h-(--popout-body-height) w-(--popout-body-width)"} ref={probe} />
      <div ref={cardProbe} style={{ height: `${GRAPH_CARD_HEIGHT / 16}rem` }} />
    </div>
    {layout && viewport && <div className="relative" style={{ width: viewport.scrollWidth, height: viewport.scrollHeight }}>
      <div className="absolute" style={{ left: viewport.left, top: viewport.top, width: layout.width, height: layout.height }}>
        {layout.frames.map((frame) => <div aria-hidden className="absolute rounded-xl border border-border-soft bg-muted/50" data-graph-frame={frame.key} key={frame.key}
          style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }} />)}
        <svg aria-hidden className="pointer-events-none absolute inset-0" height={layout.height} width={layout.width}>
          {edges.map((edge) => <SvgEdge arrow="none" d={edge.path} key={edge.key} {...edgeStyle[statuses.get(edge.target) ?? "waiting"]} />)}
        </svg>
        <ul aria-label="Actors by creator" className="list-none">
          {layout.cards.map((card) => <li className="absolute" data-graph-node={card.key} data-graph-parent={card.parentKey ?? undefined} key={card.key}
            style={{ left: card.x, top: card.y, width: GRAPH_CARD_WIDTH, height: cardHeight }}>
            {card.node.kind === "actor"
              ? <ActorCard actor={card.node.actor} current={card.node.actor.id === selectedId} onDragStart={onDragStart} onPick={onPick} summary={summary(card.node.actor)} view={view} />
              : <GroupCard node={card.node} onToggle={toggle} open={open(card.node)} view={view} />}
          </li>)}
        </ul>
      </div>
    </div>}
  </div>;
}

function ActorCard({ actor, current, onDragStart, onPick, summary, view }: {
  actor: RunActor;
  current: boolean;
  onDragStart?: () => void;
  onPick: (actor: RunActor) => void;
  summary: string | undefined;
  view: RunView;
}) {
  const drag = useDockPanelDrag();
  const programs = useProgramSlot();
  const script = actor.kind === "script";
  const program = script && programs?.runId === view.id ? programs.summary(view, actor.id) : undefined;
  const facts = program ? `${program.functionCount} function${program.functionCount === 1 ? "" : "s"}, ${program.viewCount} view${program.viewCount === 1 ? "" : "s"}` : "Program definition unavailable";
  const state = graphActorState(view, actor);
  const label = actor.lifecycle?.kind === "stopped" ? "stopped" : state === "waiting" ? "waiting for input" : state;
  return <InteractiveItem aria-current={current || undefined} aria-label={script ? `${label} @${actorAddress(actor)} ${actor.displayName} ${program?.name ?? ""} ${facts}` : undefined}
    className={cn(cardClass, "p-2", script && "relative gap-0.5 rounded-none border-dashed border-border-strong pt-6", drag && "touch-none cursor-grab active:cursor-grabbing")}
    data-actor-handle={actorAddress(actor)} data-actor-kind={actor.kind}
    onClick={(event) => { if (!drag || event.detail === 0) onPick(actor); }}
    onPointerDown={drag && ((event) => { event.stopPropagation(); drag(event, `actor:${actor.id}`, () => onPick(actor), onDragStart); })}
    aria-description={`Address messages to @${actorAddress(actor)}`} type="button">
    {script && <span aria-hidden className="absolute inset-x-0 top-0 flex h-5 items-center gap-1 border-b border-border-strong/50 bg-glass-script px-2 text-sm font-medium text-foreground" data-actor-program-band>
      <CodeXmlIcon className="size-3 flex-none" />TypeScript
    </span>}
    <span className="flex min-w-0 items-center gap-2">
      <span aria-label={label} className="flex flex-none items-center" data-actor-state={state} role="img" aria-description={label}>
        <span aria-hidden className="flex"><RunStateIcon className="pointer-events-none" state={state} /></span>
      </span>
      <span className="min-w-0 flex-1 truncate font-semibold" data-actor-name aria-label={script ? actor.displayName : undefined}>{script ? actor.displayName : `@${actorAddress(actor)}`}</span>
    </span>
    {script ? <>
      {program && <span className="min-w-0 truncate font-mono text-sm text-muted-foreground" data-actor-program aria-label={program.name}>{program.name}</span>}
      <span className="min-w-0 truncate text-sm text-muted-foreground" data-actor-description aria-label={facts}>{facts}</span>
    </> : summary && <span className="line-clamp-3 min-w-0 text-sm wrap-anywhere whitespace-pre-line text-muted-foreground" data-actor-description aria-label={summary}>{summary}</span>}
  </InteractiveItem>;
}

function GroupCard({ node, onToggle, open, view }: { node: AddresseeGroupNode; onToggle: (key: string) => void; open: boolean; view: RunView }) {
  const actors = node.members.map((member) => member.actor);
  const counts = addresseeStatusCounts(view, actors);
  const running = actors.some((actor) => actor.lifecycle?.kind === "running");
  const pending = actors.reduce((sum, actor) => sum + pendingInputCount(view, actor.id), 0);
  return <InteractiveItem aria-expanded={open} className={cn(cardClass, "px-3 py-2", !open && stackClass)} data-addressee-group={node.label} onClick={() => onToggle(node.key)}
    aria-label={`${node.label}: ${actors.length} similar actors, ${counts}. Click ${open ? "collapses the group" : "shows all"}`} type="button">
    <span className="flex min-w-0 items-center gap-2">
      <span className="grid size-5 flex-none place-items-center rounded-full bg-muted text-foreground [&>svg]:size-3">{running ? <Spinner aria-hidden className="size-3" /> : <UsersIcon />}</span>
      <span className="min-w-0 flex-1 truncate font-semibold">{node.label}</span>
      {pending > 0 && <Badge className="h-4 min-w-4 px-1 text-sm" aria-label={waitingInputs(pending)} tone="warning">{pending}</Badge>}
      <ChevronDownIcon aria-hidden className={cn("size-3.5 flex-none text-muted-foreground transition-transform", !open && "-rotate-90")} />
    </span>
    <span className={cn(lineClass, "text-muted-foreground")}>{actors.length} actors</span>
    <span className="min-w-0 truncate text-sm text-muted-foreground">{counts}</span>
  </InteractiveItem>;
}
