import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, CodeIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { Badge, cn, Spinner, SvgEdge, type SvgEdgeProps } from "@ragents/web/ui";
import { actorTone, type RunActor, type RunView } from "@ragents/web/run-view";
import { pendingInputCount } from "./run-panel-actors";
import { addresseeNodeContains, addresseeStatus, addresseeStatusCounts, addresseeStatusWord, addresseeSummaries, addresseeTree, type AddresseeGroupNode, type AddresseeStatus } from "./addressee-tree";
import { actorGraphLayout, actorTimings, formatDuration, GRAPH_CARD_HEIGHT, GRAPH_CARD_WIDTH, graphColumns, graphNodeStatus, type ActorTiming } from "./actor-graph";

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

/** On opening the chosen actor is centered; after a group click the group card stays where it was clicked. */
type ScrollTarget = { kind: "selected" } | { kind: "keep"; key: string; left: number; top: number };

const actorType = (actor: RunActor, technical: boolean) => !technical ? "Agent" : actor.kind === "agent" ? "LLM agent" : "TypeScript actor";
const lower = (text: string) => text.toLocaleLowerCase("en-US");
const waitingInputs = (count: number) => count === 1 ? "1 waiting input" : `${count} waiting inputs`;

export function ActorIcon({ actor, className, view }: { actor: RunActor; className?: string; view: RunView }) {
  const tone = actorTone(view, actor);
  return <span className={cn("grid flex-none place-items-center rounded-full text-foreground [&>svg]:size-3", iconClass[tone], className)}>
    {actor.lifecycle?.kind === "running" ? <Spinner aria-hidden className="size-3" /> : tone === "primary" ? <SparklesIcon /> : actor.kind === "agent" ? <UsersIcon /> : <CodeIcon />}
  </span>;
}

/** The actors of a run top-down by creator, as cards with state, running time and task; similar siblings as an expandable group card. */
export function ActorGraph({ actors, onPick, selectedId, technical, view }: {
  actors: readonly RunActor[];
  onPick: (actor: RunActor) => void;
  selectedId: string;
  technical: boolean;
  view: RunView;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number>();
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const [scrollTarget, setScrollTarget] = useState<ScrollTarget | undefined>({ kind: "selected" });
  const summary = useMemo(() => addresseeSummaries(view), [view]);
  const timing = useMemo(() => actorTimings(view), [view]);
  const tree = useMemo(() => addresseeTree(view, actors), [actors, view]);
  const open = useCallback((group: AddresseeGroupNode) => addresseeNodeContains(group, selectedId) !== toggled.has(group.key), [selectedId, toggled]);
  const layout = useMemo(() => columns === undefined ? undefined : actorGraphLayout(tree, open, columns), [columns, open, tree]);
  const statuses = useMemo(() => new Map(layout?.cards.map((card) => [card.key, graphNodeStatus(view, card.node)] as const)), [layout, view]);
  const edges = useMemo(() => [...layout?.edges ?? []].sort((left, right) => edgeLayer[statuses.get(left.target) ?? "waiting"] - edgeLayer[statuses.get(right.target) ?? "waiting"]), [layout, statuses]);
  const toggle = (key: string) => {
    const card = layout?.cards.find((entry) => entry.node.kind === "group" && entry.node.key === key);
    const element = scroller.current;
    if (card && element && canvas.current) setScrollTarget({ kind: "keep", key: card.key, left: canvas.current.offsetLeft + card.x - element.scrollLeft, top: canvas.current.offsetTop + card.y - element.scrollTop });
    setToggled((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setColumns(graphColumns(element.offsetWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = scroller.current;
    const origin = canvas.current;
    if (!scrollTarget || !layout || !element || !origin) return;
    if (scrollTarget.kind === "selected") {
      const card = layout.cards.find((entry) => entry.node.kind === "actor" && entry.node.actor.id === selectedId);
      if (card) element.scrollTo({
        left: origin.offsetLeft + card.x + GRAPH_CARD_WIDTH / 2 - element.clientWidth / 2,
        top: origin.offsetTop + card.y + GRAPH_CARD_HEIGHT / 2 - element.clientHeight / 2,
      });
    } else {
      const card = layout.cards.find((entry) => entry.key === scrollTarget.key);
      if (card) element.scrollTo({ left: origin.offsetLeft + card.x - scrollTarget.left, top: origin.offsetTop + card.y - scrollTarget.top });
    }
    setScrollTarget(undefined);
  }, [layout, scrollTarget, selectedId]);

  return <div className="relative min-h-0 flex-1 overflow-auto overscroll-contain" ref={scroller}>
    {layout && <div className="relative mx-auto" ref={canvas} style={{ width: layout.width, height: layout.height }}>
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
