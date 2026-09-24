import { ChevronRightIcon, CodeIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { Badge, cn, Spinner } from "@ragents/web/ui";
import { actorTone, type RunActor, type RunView } from "@ragents/web/run-view";
import { pendingInputCount } from "./run-panel-actors";
import { addresseeNodeContains, addresseeStatus, addresseeStatusCounts, addresseeStatusWord, type AddresseeActorNode, type AddresseeGroupNode, type AddresseeNode, type AddresseeStatus } from "./addressee-tree";

const entryClass = "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent aria-current:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2";
const branchClass = "ml-[18px] list-none border-l border-border-soft pl-1";
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

const actorType = (actor: RunActor, technical: boolean) => !technical ? "Agent" : actor.kind === "agent" ? "LLM-Agent" : "TypeScript-Actor";

export function ActorIcon({ actor, className, view }: { actor: RunActor; className?: string; view: RunView }) {
  const tone = actorTone(view, actor);
  return <span className={cn("grid flex-none place-items-center rounded-full text-foreground [&>svg]:size-3", iconClass[tone], className)}>
    {actor.lifecycle?.kind === "running" ? <Spinner aria-hidden className="size-3" /> : tone === "primary" ? <SparklesIcon /> : actor.kind === "agent" ? <UsersIcon /> : <CodeIcon />}
  </span>;
}

export interface AddresseeTreeProps {
  view: RunView;
  selectedId: string;
  technical: boolean;
  summary: (actor: RunActor) => string | undefined;
  /** Gruppen, deren Aufklappzustand der Benutzer gegenüber der Vorgabe umgeschaltet hat. */
  toggled: ReadonlySet<string>;
  /** Offen ohne eigene Wahl, etwa während einer Suche. */
  openByDefault: boolean;
  onToggle: (key: string) => void;
  onPick: (actor: RunActor) => void;
}

/** Der Adressatenbaum: je Actor Handle, Kurzbeschreibung und Zustand, gleichartige Geschwister als aufklappbare Gruppe. */
export function AddresseeTree({ className, nodes, ...props }: AddresseeTreeProps & { className?: string; nodes: readonly AddresseeNode[] }) {
  return <ul className={cn("list-none", className)}>
    {nodes.map((node) => node.kind === "actor"
      ? <ActorBranch key={node.actor.id} node={node} {...props} />
      : <GroupBranch key={node.key} node={node} {...props} />)}
  </ul>;
}

function ActorBranch({ node, ...props }: AddresseeTreeProps & { node: AddresseeActorNode }) {
  return <li>
    <ActorEntry actor={node.actor} {...props} />
    {node.children.length > 0 && <AddresseeTree className={branchClass} nodes={node.children} {...props} />}
  </li>;
}

function ActorEntry({ actor, onPick, selectedId, summary, technical, view }: AddresseeTreeProps & { actor: RunActor }) {
  const pending = pendingInputCount(view, actor.id);
  const status = addresseeStatus(view, actor);
  const description = summary(actor);
  const name = actor.displayName.trim();
  const showName = name !== "" && name.toLocaleLowerCase("de-DE") !== actor.handle.toLocaleLowerCase("de-DE") && name !== description;
  const current = actor.id === selectedId;
  return <button aria-current={current || undefined} className={entryClass} data-actor-handle={actor.handle} onClick={() => onPick(actor)}
    title={`@${actor.handle}, ${actorType(actor, technical)}, ${addresseeStatusWord(status)}. Nachrichten an @${actor.handle} richten`} type="button">
    <ActorIcon actor={actor} className="size-5" view={view} />
    <span className="grid min-w-0 flex-1">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="truncate font-semibold">@{actor.handle}</span>
        {showName && <span className="min-w-0 truncate text-[0.66rem] text-muted-foreground">{name}</span>}
      </span>
      {description && <span className="truncate text-[0.66rem] text-muted-foreground">{description}</span>}
    </span>
    {pending > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.6rem]" variant="secondary">{pending}</Badge>}
    <span className={cn("flex-none text-[0.66rem]", statusClass[status])} data-addressee-status={status}>{addresseeStatusWord(status)}</span>
  </button>;
}

function GroupBranch({ node, ...props }: AddresseeTreeProps & { node: AddresseeGroupNode }) {
  const { onToggle, openByDefault, selectedId, toggled, view } = props;
  const actors = node.members.map((member) => member.actor);
  const open = (openByDefault || addresseeNodeContains(node, selectedId)) !== toggled.has(node.key);
  const counts = addresseeStatusCounts(view, actors);
  const running = actors.some((actor) => actor.lifecycle?.kind === "running");
  const pending = actors.reduce((sum, actor) => sum + pendingInputCount(view, actor.id), 0);
  return <li>
    <button aria-expanded={open} className={entryClass} data-addressee-group={node.label} onClick={() => onToggle(node.key)}
      title={`${node.label}: ${actors.length} gleichartige Actors, ${counts}. Klick ${open ? "klappt die Gruppe zu" : "zeigt alle"}`} type="button">
      <span className="grid size-5 flex-none place-items-center text-muted-foreground">
        <ChevronRightIcon aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-semibold">{node.label}</span>
          <span className="flex-none text-[0.66rem] text-muted-foreground">{actors.length} Actors</span>
        </span>
        <span className="truncate text-[0.66rem] text-muted-foreground">{counts}</span>
      </span>
      {running && <Spinner aria-hidden className="size-3 flex-none text-primary" />}
      {pending > 0 && <Badge className="h-4 min-w-4 px-1 text-[0.6rem]" variant="secondary">{pending}</Badge>}
    </button>
    {open && <ul className={branchClass}>
      {node.members.map((member) => <ActorBranch key={member.actor.id} node={member} {...props} />)}
    </ul>}
  </li>;
}
