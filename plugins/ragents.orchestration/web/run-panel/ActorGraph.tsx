import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDownIcon, CodeIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { Badge, cn, Spinner, SvgEdge, type SvgEdgeProps } from "@ragents/web/ui";
import { actorTone, type RunActor, type RunView } from "@ragents/web/run-view";
import { pendingInputCount } from "./run-panel-actors";
import { addresseeNodeContains, addresseeStatus, addresseeStatusCounts, addresseeStatusWord, addresseeSummaries, addresseeTree, type AddresseeGroupNode, type AddresseeStatus } from "./addressee-tree";
import { actorGraphLayout, actorTimings, clampGraphPan, formatDuration, GRAPH_CARD_HEIGHT, GRAPH_CARD_WIDTH, graphColumns, graphNodeStatus, graphPannable, graphPanTo, graphViewport, type ActorTiming, type GraphSize } from "./actor-graph";

const cardClass = "flex size-full min-w-0 cursor-pointer flex-col justify-center gap-0.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-left text-[0.72rem] text-card-foreground shadow-xs hover:border-primary/50 hover:bg-accent aria-current:border-primary aria-current:bg-[color-mix(in_srgb,var(--color-primary)_10%,var(--color-card))] aria-current:ring-2 aria-current:ring-primary/20 focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:outline-offset-1";
const stackClass = "shadow-[3px_3px_0_-1px_var(--color-card),3px_3px_0_0_var(--color-border)]";
const lineClass = "flex min-w-0 items-center gap-1.5 text-[0.66rem]";
const iconClass: Readonly<Record<string, string>> = {
  agent: "bg-glass-agent",
  primary: "bg-glass-primary",
  script: "bg-glass-script",
  app: "bg-glass-app",
};
const statusClass: Readonly<Record<AddresseeStatus, string>> = {
  running: "text-primary",
  input: "text-warning",
  waiting: "text-muted-foreground",
  stopped: "text-muted-foreground/70",
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

const actorType = (actor: RunActor, technical: boolean) => !technical ? "Agent" : actor.kind === "agent" ? "LLM agent" : "TypeScript actor";
const lower = (text: string) => text.toLocaleLowerCase("en-US");
const waitingInputs = (count: number) => count === 1 ? "1 waiting input" : `${count} waiting inputs`;

export function ActorIcon({ actor, className, view }: { actor: RunActor; className?: string; view: RunView }) {
  const tone = actorTone(view, actor);
  return <span className={cn("grid flex-none place-items-center rounded-full text-foreground [&>svg]:size-3", iconClass[tone], className)}>
    {actor.lifecycle?.kind === "running" ? <Spinner aria-hidden className="size-3" /> : tone === "primary" ? <SparklesIcon /> : actor.kind === "agent" ? <UsersIcon /> : <CodeIcon />}
  </span>;
}

/** The actors of a run top-down by creator, as cards with state, running time and task; as large as the graph up to the pop-out's room, panned by dragging beyond. */
export function ActorGraph({ actors, onPick, selectedId, technical, view }: {
  actors: readonly RunActor[];
  onPick: (actor: RunActor) => void;
  selectedId: string;
  technical: boolean;
  view: RunView;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<GraphSize>();
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | undefined>({ kind: "selected" });
  const [panning, setPanning] = useState(false);
  const summary = useMemo(() => addresseeSummaries(view), [view]);
  const timing = useMemo(() => actorTimings(view), [view]);
  const tree = useMemo(() => addresseeTree(view, actors), [actors, view]);
  const open = useCallback((group: AddresseeGroupNode) => addresseeNodeContains(group, selectedId) !== toggled.has(group.key), [selectedId, toggled]);
  const columns = room === undefined ? undefined : graphColumns(room.width);
  const layout = useMemo(() => columns === undefined ? undefined : actorGraphLayout(tree, open, columns), [columns, open, tree]);
  const viewport = useMemo(() => layout && room && graphViewport(layout, room), [layout, room]);
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
    const measure = () => setRoom((current) => current?.width === element.offsetWidth && current.height === element.offsetHeight ? current : { width: element.offsetWidth, height: element.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!scrollTarget || !layout || !viewport || !element) return;
    if (scrollTarget.kind === "selected") {
      const card = layout.cards.find((entry) => entry.node.kind === "actor" && entry.node.actor.id === selectedId);
      if (card) element.scrollTo(graphPanTo(viewport, card.x + GRAPH_CARD_WIDTH / 2, card.y + GRAPH_CARD_HEIGHT / 2, viewport.width / 2, viewport.height / 2));
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
  }, [layout, scrollTarget, selectedId, viewport]);

  return <div className={cn("no-scrollbar relative min-h-0 min-w-0 flex-none overflow-auto overscroll-contain select-none", pannable && "cursor-grab", panning && "cursor-grabbing **:cursor-grabbing")}
    onKeyDown={stopCentering} onPointerDown={pan} onWheel={stopCentering} ref={scroller} style={viewport && { width: viewport.width, height: viewport.height }}>
    <div aria-hidden className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
      <div className="h-(--popout-body-height) w-(--popout-body-width)" ref={probe} />
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
            style={{ left: card.x, top: card.y, width: GRAPH_CARD_WIDTH, height: GRAPH_CARD_HEIGHT }}>
            {card.node.kind === "actor"
              ? <ActorCard actor={card.node.actor} current={card.node.actor.id === selectedId} onPick={onPick} summary={summary(card.node.actor)} technical={technical} timing={timing(card.node.actor.id)} view={view} />
              : <GroupCard node={card.node} onToggle={toggle} open={open(card.node)} view={view} />}
          </li>)}
        </ul>
      </div>
    </div>}
  </div>;
}

function ActorCard({ actor, current, onPick, summary, technical, timing, view }: {
  actor: RunActor;
  current: boolean;
  onPick: (actor: RunActor) => void;
  summary: string | undefined;
  technical: boolean;
  timing: ActorTiming | undefined;
  view: RunView;
}) {
  const pending = pendingInputCount(view, actor.id);
  const status = addresseeStatus(view, actor);
  const name = actor.displayName.trim();
  const named = name !== "" && lower(name) !== lower(actor.handle) && name !== summary ? `, ${name}` : "";
  return <button aria-current={current || undefined} className={cardClass} data-actor-handle={actor.handle} onClick={() => onPick(actor)}
    title={`@${actor.handle}${named}, ${actorType(actor, technical)}, ${addresseeStatusWord(status)}. Address messages to @${actor.handle}`} type="button">
    <span className="flex min-w-0 items-center gap-1.5">
      <ActorIcon actor={actor} className="size-5" view={view} />
      <span className="min-w-0 flex-1 truncate font-semibold">@{actor.handle}</span>
      {pending > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.6rem]" title={waitingInputs(pending)} variant="secondary">{pending}</Badge>}
    </span>
    <span className={lineClass}>
      <span className={cn("min-w-0 truncate", statusClass[status])} data-addressee-status={status}>{addresseeStatusWord(status)}</span>
      {timing?.kind === "running" && <span className="ml-auto flex-none text-primary tabular-nums" data-actor-duration="running" title="Running time of the current turn"><Elapsed since={timing.since} /></span>}
      {timing?.kind === "finished" && <span className="ml-auto flex-none text-muted-foreground tabular-nums" data-actor-duration="finished" title="Duration of the last turn">last turn {formatDuration(timing.milliseconds)}</span>}
    </span>
    <span className="min-w-0 truncate text-[0.66rem] text-muted-foreground">{summary}</span>
  </button>;
}

function GroupCard({ node, onToggle, open, view }: { node: AddresseeGroupNode; onToggle: (key: string) => void; open: boolean; view: RunView }) {
  const actors = node.members.map((member) => member.actor);
  const counts = addresseeStatusCounts(view, actors);
  const running = actors.some((actor) => actor.lifecycle?.kind === "running");
  const pending = actors.reduce((sum, actor) => sum + pendingInputCount(view, actor.id), 0);
  return <button aria-expanded={open} className={cn(cardClass, !open && stackClass)} data-addressee-group={node.label} onClick={() => onToggle(node.key)}
    title={`${node.label}: ${actors.length} similar actors, ${counts}. Click ${open ? "collapses the group" : "shows all"}`} type="button">
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="grid size-5 flex-none place-items-center rounded-full bg-muted text-foreground [&>svg]:size-3">{running ? <Spinner aria-hidden className="size-3" /> : <UsersIcon />}</span>
      <span className="min-w-0 flex-1 truncate font-semibold">{node.label}</span>
      {pending > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.6rem]" title={waitingInputs(pending)} variant="secondary">{pending}</Badge>}
      <ChevronDownIcon aria-hidden className={cn("size-3.5 flex-none text-muted-foreground transition-transform", !open && "-rotate-90")} />
    </span>
    <span className={cn(lineClass, "text-muted-foreground")}>{actors.length} actors</span>
    <span className="min-w-0 truncate text-[0.66rem] text-muted-foreground">{counts}</span>
  </button>;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return formatDuration(now - since);
}
