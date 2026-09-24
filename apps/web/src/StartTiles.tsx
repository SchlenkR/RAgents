import { BookIcon, ChevronRightIcon, CodeIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { ConnectionEntry } from "./panel/contract";

const NEW_CHAT = { category: "Ohne Vorlage", title: "Neuer Chat", description: "Leerer Run, der Auftrag entsteht im Chat." };

const sectionClass = "flex items-baseline gap-2 text-[0.66rem] font-bold uppercase tracking-[0.06em] text-muted-foreground";
const countClass = "font-mono text-[0.62rem] font-normal tracking-normal opacity-80";
const tileClass = "group/tile flex h-full min-w-0 flex-col gap-1.5 rounded-[12px] border border-border-soft bg-card p-2.5 text-left [--tone:var(--primary)]"
  + " enabled:hover:border-border enabled:hover:bg-accent/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/60 disabled:opacity-60";
const entryIcon = (entry: ConnectionEntry): ReactNode => entry.kind === "skill"
  ? <BookIcon aria-hidden className="size-3.5" />
  : <CodeIcon aria-hidden className="size-3.5" />;

/** Die Überschrift eines Abschnitts der Startseite, mit Zahl und rechts einer Aktion. */
export function StartSection({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-2">
    <h2 className={sectionClass}>{title}{count !== undefined && <span className={countClass}>{count}</span>}</h2>
    {children}
  </div>;
}

function Tile({ category, title, description, icon, standard, guided, disabled, onClick }: {
  category: string;
  title: string;
  description: string;
  icon: ReactNode;
  /** Die Vorlage ist der Default ihres Servers. */
  standard?: boolean;
  guided?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return <li className="min-w-0">
    <button className={tileClass} disabled={disabled} onClick={onClick} title={title} type="button">
      <span className="flex min-w-0 items-center gap-1.5 text-(--tone)">
        {icon}
        <span className="truncate text-[0.58rem] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{category}</span>
        {standard && <span className="ml-auto flex-none rounded-sm border border-current px-1 text-[0.52rem] font-semibold uppercase tracking-[0.06em] leading-[1.5] opacity-70">Standard</span>}
      </span>
      <span className="text-[0.76rem] font-semibold leading-snug [overflow-wrap:anywhere]">{title}</span>
      <span className="line-clamp-2 text-[0.66rem] leading-[1.45] text-muted-foreground">{description}</span>
      <span className="mt-auto flex items-center gap-0.5 pt-1.5 text-[0.62rem] font-semibold text-(--tone) opacity-50 group-enabled/tile:group-hover/tile:opacity-100">
        {guided ? "Einrichten" : "Starten"}<ChevronRightIcon aria-hidden className="size-3" />
      </span>
    </button>
  </li>;
}

/** Wie viele Kacheln StartTiles zeigt: die Vorlagen, ohne Standard-Vorlage dazu Neuer Chat. */
export const startTileCount = (entries: readonly ConnectionEntry[], defaultEntry: string | undefined, newChat: boolean): number =>
  entries.length + (defaultEntry === undefined && newChat ? 1 : 0);

/** Die Vorlagen eines Servers als Kacheln, die Standard-Vorlage oder Neuer Chat zuerst: Start in VS Code und die Startauswahl im Browser. */
export function StartTiles({ entries, defaultEntry, label, disabled = false, onNewChat, onStart }: {
  entries: readonly ConnectionEntry[];
  defaultEntry?: string;
  label: string;
  disabled?: boolean;
  /** Ohne sie fehlt die Kachel Neuer Chat. */
  onNewChat?: () => void;
  onStart: (entryId: string) => void;
}) {
  const standard = entries.find((entry) => entry.id === defaultEntry);
  const others = entries.filter((entry) => entry.id !== defaultEntry);
  return <ul aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(182px,1fr))] gap-2">
    {standard
      ? <Tile category={standard.category} description={standard.description} disabled={disabled} guided={standard.guided} icon={entryIcon(standard)} onClick={() => onStart(standard.id)} standard title={standard.title} />
      : onNewChat && <Tile {...NEW_CHAT} disabled={disabled} icon={<PlusIcon aria-hidden className="size-3.5" />} onClick={onNewChat} />}
    {others.map((entry) => <Tile category={entry.category} description={entry.description} disabled={disabled} guided={entry.guided} icon={entryIcon(entry)} key={entry.id}
      onClick={() => onStart(entry.id)} title={entry.title} />)}
  </ul>;
}
