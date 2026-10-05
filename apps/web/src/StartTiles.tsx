import { PlayIcon, PlusIcon, SlidersHorizontalIcon } from "lucide-react";
import type { ConnectionEntry } from "./panel/contract";
import { Spinner } from "./ui";

const NEW_CHAT = { title: "New chat", description: "Empty run; the task takes shape in the chat." };

const tileClass = "group/tile flex h-full w-full min-w-0 flex-col gap-1.5 rounded-[12px] border border-border-soft bg-card p-2.5 text-left"
  + " enabled:hover:border-border enabled:hover:bg-accent/40 focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:not-aria-busy:opacity-60"
  + " aria-busy:border-border aria-busy:bg-accent/40";

/** One Start page item: title, description and a top-right action; run scripts in a run use it too. */
export function StartTile({ title, description, action, standard, disabled, starting = false, fill = false, onClick }: {
  title: string;
  description: string;
  action: "chat" | "start" | "setup";
  /** The template is its server's default. */
  standard?: boolean;
  disabled: boolean;
  /** Its start is under way: the tile stays locked and shows a spinner with "Starting ..." in the action position. */
  starting?: boolean;
  /** Fills its grid cell instead of keeping the Start page's maximum width. */
  fill?: boolean;
  onClick: () => void;
}) {
  return <li className={fill ? "w-full min-w-0" : "w-full max-w-[320px] min-w-0"}>
    <button aria-busy={starting || undefined} aria-label={action === "chat" ? "New chat" : `${action === "setup" ? "Set up" : "Start"} ${title}`}
      className={tileClass} disabled={disabled || starting} data-tile={title} onClick={onClick} type="button">
      <span className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 flex-1 type-item [overflow-wrap:anywhere]" data-slot="start-title">{title}</span>
        {standard && <span className="ml-auto flex-none rounded-sm border border-current px-1 type-caption opacity-70">Default</span>}
        <span className="flex flex-none items-center gap-1 type-meta font-semibold text-muted-foreground group-enabled/tile:group-hover/tile:text-primary group-focus-visible/tile:text-primary group-aria-busy/tile:text-primary"
          data-action={action} data-slot="start-action">
          {starting
            ? <><Spinner aria-hidden className="size-3.5" />Starting ...</>
            : action === "chat" ? <PlusIcon aria-hidden className="size-3.5" />
              : action === "setup" ? <SlidersHorizontalIcon aria-hidden className="size-3.5" />
                : <PlayIcon aria-hidden className="size-3.5" />}
        </span>
      </span>
      <span className="line-clamp-2 type-body text-muted-foreground" data-slot="start-description">{description}</span>
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
        ? <StartTile action={standard.guided ? "setup" : "start"} description={standard.description} disabled={locked} onClick={() => onStart(standard.id)} standard
          starting={starting?.entryId === standard.id} title={standard.title} />
        : onNewChat && <StartTile {...NEW_CHAT} action="chat" disabled={locked} onClick={onNewChat}
          starting={starting !== undefined && starting.entryId === undefined} />}
      {others.map((entry) => <StartTile action={entry.guided ? "setup" : "start"} description={entry.description} disabled={locked} key={entry.id}
        onClick={() => onStart(entry.id)} starting={starting?.entryId === entry.id} title={entry.title} />)}
    </ul>
  </div>;
}
