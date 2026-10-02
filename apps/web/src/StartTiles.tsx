import { BookIcon, ChevronRightIcon, CodeIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ConnectionEntry } from "./panel/contract";
import { Spinner } from "./ui";

const NEW_CHAT = { category: "No template", title: "New chat", description: "Empty run; the task takes shape in the chat." };

const tileClass = "group/tile flex h-full w-full min-w-0 flex-col gap-1.5 rounded-[12px] border border-border-soft bg-card p-2.5 text-left [--tone:var(--primary)]"
  + " enabled:hover:border-border enabled:hover:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60 disabled:not-aria-busy:opacity-60"
  + " aria-busy:border-border aria-busy:bg-accent/40";
const entryIcon = (entry: ConnectionEntry): ReactNode => entry.kind === "skill"
  ? <BookIcon aria-hidden className="size-3.5" />
  : <CodeIcon aria-hidden className="size-3.5" />;

/** One Start page item: category, title, description and the start hint; run scripts in a run use it too. */
export function StartTile({ category, title, description, icon, standard, guided, disabled, starting = false, fill = false, onClick }: {
  category: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** The template is its server's default. */
  standard?: boolean;
  guided?: boolean;
  disabled: boolean;
  /** Its start is under way: the tile stays locked and shows a spinner with "Starting ..." instead of the start hint. */
  starting?: boolean;
  /** Fills its grid cell instead of keeping the Start page's maximum width. */
  fill?: boolean;
  onClick: () => void;
}) {
  return <li className={fill ? "w-full min-w-0" : "w-full max-w-[320px] min-w-0"}>
    <button aria-busy={starting || undefined} className={tileClass} disabled={disabled || starting} data-tile={title} onClick={onClick} type="button">
      <span className="flex min-w-0 items-center gap-1.5 text-(--tone)">
        {icon}
        <span className="truncate type-caption text-muted-foreground">{category}</span>
        {standard && <span className="ml-auto flex-none rounded-sm border border-current px-1 type-caption opacity-70">Default</span>}
      </span>
      <span className="type-item [overflow-wrap:anywhere]">{title}</span>
      <span className="line-clamp-2 type-body text-muted-foreground">{description}</span>
      <span className="mt-auto flex items-center gap-0.5 pt-1.5 type-meta font-semibold text-(--tone) opacity-50 group-enabled/tile:group-hover/tile:opacity-100 group-aria-busy/tile:opacity-100">
        {starting
          ? <><Spinner aria-hidden className="mr-0.5 size-3" />Starting ...</>
          : <>{guided ? "Set up" : "Start"}<ChevronRightIcon aria-hidden className="size-3" /></>}
      </span>
    </button>
  </li>;
}

/** How many tiles StartTiles shows: the templates, plus New chat when there is no default template. */
export const startTileCount = (entries: readonly ConnectionEntry[], defaultEntry: string | undefined, newChat: boolean): number =>
  entries.length + (defaultEntry === undefined && newChat ? 1 : 0);

/** A server's templates as tiles, the default template or New chat first: Start in VS Code and the start selection in the browser. */
export function StartTiles({ entries, defaultEntry, label, disabled = false, starting, onNewChat, onStart }: {
  entries: readonly ConnectionEntry[];
  defaultEntry?: string;
  label: string;
  disabled?: boolean;
  /** The start under way in this list, New chat without entryId; it locks every tile. */
  starting?: { readonly entryId?: string };
  /** Without it the New chat tile is missing. */
  onNewChat?: () => void;
  onStart: (entryId: string) => void;
}) {
  const standard = entries.find((entry) => entry.id === defaultEntry);
  const others = entries.filter((entry) => entry.id !== defaultEntry);
  const locked = disabled || starting !== undefined;
  return <div className="@container/templates min-w-0">
    <ul aria-label={label} className="grid grid-cols-1 gap-2 @[240px]/templates:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
      {standard
        ? <StartTile category={standard.category} description={standard.description} disabled={locked} guided={standard.guided} icon={entryIcon(standard)} onClick={() => onStart(standard.id)} standard
          starting={starting?.entryId === standard.id} title={standard.title} />
        : onNewChat && <StartTile {...NEW_CHAT} disabled={locked} icon={<PlusIcon aria-hidden className="size-3.5" />} onClick={onNewChat}
          starting={starting !== undefined && starting.entryId === undefined} />}
      {others.map((entry) => <StartTile category={entry.category} description={entry.description} disabled={locked} guided={entry.guided} icon={entryIcon(entry)} key={entry.id}
        onClick={() => onStart(entry.id)} starting={starting?.entryId === entry.id} title={entry.title} />)}
    </ul>
  </div>;
}
