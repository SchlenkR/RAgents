import { PlusIcon, Trash2Icon } from "lucide-react";
import { cn } from "cn";
import { Button, Empty, Spinner } from "./ui";
import type { SessionInfo } from "./api";
import { groupRunsByActivity, runActivityNotice } from "./run-overview";
import type { RunReadRevisions } from "./run-read-state";
import type { PluginRegistry } from "./PluginRegistry";

interface SessionListProps {
  sessions: SessionInfo[];
  seenRevisions?: RunReadRevisions;
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
  registry: PluginRegistry;
  selectMode: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelected: (id: string) => void;
  /** Mit Handler steht "Neuer Run" als erste Karte in der Liste statt als Knopf daneben. */
  onCreate?: () => void;
}

const createCardClass = "flex min-h-[148px] min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-border-strong text-[0.9rem] font-semibold text-muted-foreground hover:border-primary hover:bg-[color-mix(in_srgb,var(--primary)_6%,var(--background))] hover:text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2";
const gridClass = "grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] items-stretch gap-3";

const formatTimestamp = (time: number): string => {
  const date = new Date(time);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
};

/** Running, unread and resting runs differ only in their accent colour; the card layout stays the same. */
const tones = {
  running: {
    card: "border-[color-mix(in_srgb,var(--info)_55%,var(--border))]",
    head: "border-t-info bg-info/8",
    text: "text-info",
  },
  unread: {
    card: "border-[color-mix(in_srgb,var(--primary)_55%,var(--border))]",
    head: "border-t-primary bg-primary/8",
    text: "text-primary",
  },
  idle: {
    card: "border-border",
    head: "border-t-muted-foreground bg-muted-foreground/8",
    text: "text-muted-foreground",
  },
} as const;

export function SessionList({
  sessions,
  seenRevisions = {},
  activeId,
  onSelect,
  onDelete,
  registry,
  selectMode,
  selectedIds,
  onToggleSelected,
  onCreate,
}: SessionListProps) {
  const createCard = onCreate && !selectMode && <li className="flex min-w-0">
    <button className={createCardClass} onClick={onCreate} type="button"><PlusIcon aria-hidden className="size-5" />Neuer Run</button>
  </li>;
  if (sessions.length === 0) {
    return createCard
      ? <ul className={gridClass}>{createCard}</ul>
      : <Empty className="py-16 text-[0.9rem] text-muted-foreground">Noch keine Runs.</Empty>;
  }
  return (
    <div className="grid gap-6.5">
      {groupRunsByActivity(sessions).map((group, index) => <section key={group.date} aria-label={group.label}>
        <h3 className="mb-3 flex items-center gap-2.5 text-[0.85rem] after:flex-1 after:border-t after:border-border-soft after:content-['']">
          <time dateTime={group.date}>{group.label}</time><span className="text-[0.7rem] font-normal text-muted-foreground">{group.sessions.length}</span>
        </h3>
        <ul className={gridClass}>
          {index === 0 && createCard}
          {group.sessions.map((session) => {
            const notice = runActivityNotice(session, seenRevisions[session.id]);
            const tone = tones[session.running ? "running" : notice ? "unread" : "idle"];
            const picked = session.id === activeId || (selectMode && selectedIds.has(session.id));
            return (
              <li
                className={cn(
                  "relative flex min-w-0 rounded-[12px] border bg-background",
                  picked
                    ? "border-primary bg-[color-mix(in_srgb,var(--primary)_8%,var(--background))]"
                    : cn(tone.card, "hover:border-muted-foreground hover:bg-[color-mix(in_srgb,var(--primary)_3%,var(--background))]"),
                )}
                key={session.id}
              >
                {selectMode && (
                  <input
                    aria-label={`${session.title} zum Löschen auswählen`}
                    checked={selectedIds.has(session.id)}
                    className="absolute top-[17px] left-3.5 z-1 flex-none cursor-pointer accent-primary"
                    onChange={() => onToggleSelected(session.id)}
                    type="checkbox"
                  />
                )}
                <button
                  aria-current={session.id === activeId ? "true" : undefined}
                  aria-pressed={selectMode ? selectedIds.has(session.id) : undefined}
                  className={cn(
                    "flex min-h-[148px] min-w-0 flex-1 cursor-pointer flex-col items-stretch gap-2.5 rounded-[11px] px-4 pb-4 text-left focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2",
                    selectMode && "pl-9",
                  )}
                  onClick={() => (selectMode ? onToggleSelected(session.id) : onSelect(session.id))}
                  type="button"
                >
                  <span className={cn("-mx-4 flex flex-col gap-2.5 rounded-t-[11px] border-t-[3px] px-4 pt-3.5 pb-3", tone.head, selectMode && "-ml-9 pl-9")}>
                    <span className="pr-6 text-[0.9rem] leading-[1.45] font-semibold [overflow-wrap:anywhere]" title={session.title}>{session.title}</span>
                    <span className="flex min-h-[18px] flex-wrap items-center gap-x-3.5 gap-y-1.5">
                      <span className={cn("flex items-center gap-[7px] text-[0.75rem]", tone.text)}>
                        {session.running ? <Spinner aria-hidden className="size-3" /> : <span aria-hidden className="size-[7px] flex-none rounded-full bg-current" />}
                        {session.running ? "Läuft" : session.id === activeId ? "Geöffnet" : "Ruhend"}
                      </span>
                      {notice && <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-semibold text-primary" title={notice === "updated" ? "Neue Journal-Aktivität seit Deinem letzten Ansehen dieses Runs" : "In diesem Browser noch nicht angesehen"}>
                        <span aria-hidden className="size-[7px] flex-none rounded-full bg-current" />{notice === "updated" ? "Neue Aktivität" : "Nicht angesehen"}
                      </span>}
                    </span>
                  </span>
                  {registry.sessionMetadata.map(({ id, Metadata }) => (
                    <Metadata key={id} placement="list" session={session} />
                  ))}
                  <span className="mt-auto grid gap-0.5 text-muted-foreground">
                    {session.createdAt !== undefined && <span className="text-[0.7rem] tabular-nums">Erstellt <time dateTime={new Date(session.createdAt).toISOString()}>
                      {new Date(session.createdAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </time></span>}
                    <span className="text-[0.7rem] tabular-nums">Letzte Aktivität {formatTimestamp(session.updatedAt)}</span>
                  </span>
                </button>
                {!selectMode && onDelete && (
                  <Button aria-label={`${session.title} löschen`} className="absolute top-2.5 right-2.5 text-destructive hover:bg-destructive/12 hover:text-destructive" onClick={() => onDelete(session.id)} size="icon-sm" title={`${session.title} löschen`} variant="ghost">
                    <Trash2Icon />
                  </Button>
                )}
              </li>
          ); })}
        </ul>
      </section>)}
    </div>
  );
}
