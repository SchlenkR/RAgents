import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeftIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "./button";

export interface ListDetailItem {
  id: string;
  title: string;
  description?: string;
  group?: string;
  icon?: ReactNode;
  meta?: ReactNode;
  tone?: "neutral" | "accent" | "success" | "purple";
}

export interface ListDetailProps {
  label: string;
  items: readonly ListDetailItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  toolbar?: ReactNode;
  detailHeader?: ReactNode;
  children?: ReactNode;
  detailFooter?: ReactNode;
  emptyState?: ReactNode;
  detailLabel?: string;
  className?: string;
}

// Tone und Tonfläche kommen aus data-tone und färben Symbol, Titel und Detailkopf.
const toneVariables = "[--tone:var(--muted-foreground)] [--tone-soft:var(--secondary)] "
  + "data-[tone=accent]:[--tone:var(--primary)] data-[tone=accent]:[--tone-soft:var(--accent)] "
  + "data-[tone=success]:[--tone:var(--success)] data-[tone=success]:[--tone-soft:var(--success-soft)] "
  + "data-[tone=purple]:[--tone:var(--primary)] data-[tone=purple]:[--tone-soft:var(--accent)]";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring/60";

const itemClasses = cn(toneVariables, focusRing,
  "group/item flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-3 text-left",
  "not-disabled:hover:bg-foreground/7 disabled:cursor-default disabled:opacity-55",
  "aria-pressed:border-border-strong aria-pressed:bg-(--tone-soft)");

const paneClasses = "min-h-0 min-w-0 flex-auto overflow-auto overscroll-contain [scrollbar-gutter:stable]";

// Maßgeblich ist die Breite des Bausteins, nicht die des Fensters; CSS und Messung nutzen dieselbe Schwelle.
const narrowWidth = 900;

/** Controlled grouped selection with a detail page and a return path on narrow screens. */
export function ListDetail({ label, items, selectedId, onSelect, disabled = false, toolbar,
  detailHeader, children, detailFooter, emptyState, detailLabel = "Details", className }: ListDetailProps) {
  const prefix = useId();
  const rootRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusRequest = useRef<{ target: "detail" | "list"; id: string } | null>(null);
  const [narrowDetailId, setNarrowDetailId] = useState<string>();
  const [isNarrow, setNarrow] = useState(false);
  const groups = new Map<string, ListDetailItem[]>();
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id.trim() || ids.has(item.id)) throw new Error("ListDetail-Einträge benötigen eindeutige, nicht leere IDs.");
    ids.add(item.id);
    const key = item.group ?? "";
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const selected = items.find((item) => item.id === selectedId);
  const showNarrowDetail = selected !== undefined && narrowDetailId === selected.id;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) throw new Error("ListDetail benötigt sein Wurzelelement für die Breitenmessung.");
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width < narrowWidth;
      setNarrow(next);
      if (!next) setNarrowDetailId(undefined);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    if (request.target === "detail" && (!showNarrowDetail || selected?.id !== request.id)) return;
    const target = request.target === "detail" ? detailRef.current : buttons.current.get(request.id) ?? listRef.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [narrowDetailId, selected?.id, showNarrowDetail]);

  const choose = (id: string) => {
    if (isNarrow) {
      focusRequest.current = { target: "detail", id };
      setNarrowDetailId(id);
    }
    onSelect(id);
  };
  const returnToList = () => {
    if (!selected) return;
    focusRequest.current = { target: "list", id: selected.id };
    setNarrowDetailId(undefined);
  };

  return <section aria-label={label} className={cn("group/list-detail @container/list-detail flex min-h-0 min-w-0 flex-auto flex-col", className)}
    data-detail={showNarrowDetail} ref={rootRef}>
    {toolbar !== undefined && <div className="flex flex-none flex-wrap items-center gap-2.5 pb-4.5 @max-[900px]/list-detail:group-data-[detail=true]/list-detail:hidden">{toolbar}</div>}
    <div className="grid min-h-0 min-w-0 flex-auto grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] grid-rows-[minmax(0,1fr)] gap-6 @max-[900px]/list-detail:grid-cols-[minmax(0,1fr)] @max-[900px]/list-detail:gap-0">
      <div aria-label={label} className={cn(paneClasses, focusRing, "pt-0.5 pr-1.5 pb-3 @max-[900px]/list-detail:group-data-[detail=true]/list-detail:hidden")}
        ref={listRef} role="region" tabIndex={-1}>
        {items.length === 0 ? <div className="p-6 text-[0.8rem] leading-relaxed text-muted-foreground">{emptyState ?? <p>Keine Einträge vorhanden.</p>}</div>
          : [...groups].map(([group, entries], groupIndex) => <section aria-labelledby={group ? `${prefix}-group-${groupIndex}` : undefined} className="not-first:mt-4.5" key={group}>
            {group && <h3 className="mx-2 mb-2 flex items-center gap-2.5 text-[0.67rem] font-bold tracking-[0.04em] text-muted-foreground" id={`${prefix}-group-${groupIndex}`}>
              {group}<span className="font-mono text-[0.63rem] opacity-80" aria-label={`${entries.length} Einträge`}>{entries.length}</span>
            </h3>}
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 *:min-w-0">
              {entries.map((item) => <li key={item.id}>
                <button aria-controls={`${prefix}-detail`} aria-pressed={item.id === selectedId}
                  className={itemClasses} data-tone={item.tone ?? "neutral"} disabled={disabled}
                  onClick={() => choose(item.id)} ref={(element) => { if (element) buttons.current.set(item.id, element); else buttons.current.delete(item.id); }} type="button">
                  {item.icon !== undefined && <span className="flex h-9 w-8 flex-none items-center justify-center rounded-sm border border-border-soft bg-(--tone-soft) text-(--tone) data-[tone=accent]:border-l-[3px] data-[tone=accent]:[border-left-color:var(--tone)] data-[tone=purple]:rounded-[10px_10px_10px_3px]" aria-hidden="true" data-tone={item.tone ?? "neutral"}>{item.icon}</span>}
                  <span className="flex min-w-0 flex-1 flex-col gap-1"><span className="text-[0.77rem] font-semibold leading-snug [overflow-wrap:anywhere] group-aria-pressed/item:font-bold group-aria-pressed/item:text-(--tone)">{item.title}</span>
                    {item.description && <span className="overflow-hidden text-[0.67rem] leading-[1.45] text-ellipsis whitespace-nowrap text-muted-foreground">{item.description}</span>}
                  </span>
                  {item.meta !== undefined && <span className="max-w-[30%] flex-none text-[0.62rem] leading-snug text-muted-foreground [overflow-wrap:anywhere] @max-[900px]/list-detail:max-w-[24%] @max-[900px]/list-detail:text-[0.6rem]">{item.meta}</span>}
                  <ChevronDownIcon className="flex-none -rotate-90 text-muted-foreground" size={14} />
                </button>
              </li>)}
            </ul>
          </section>)}
      </div>
      <section aria-label={detailLabel} className={cn(toneVariables, focusRing,
        "flex max-h-full min-h-0 min-w-0 flex-col self-stretch overflow-hidden rounded-panel border border-border bg-card",
        "@max-[900px]/list-detail:hidden @max-[900px]/list-detail:group-data-[detail=true]/list-detail:flex")}
        data-tone={selected?.tone ?? "neutral"}
        id={`${prefix}-detail`} ref={detailRef} tabIndex={-1}>
        {selected ? <>
          <div className="hidden flex-none border-b border-border-soft px-3.5 py-2.5 @max-[900px]/list-detail:flex"><Button aria-label="Zur Auswahl" className="rounded-full" onClick={returnToList} size="icon" variant="outline"><ArrowLeftIcon /></Button></div>
          {detailHeader !== undefined && <header className="flex-none border-b border-border-soft bg-(--tone-soft) px-6 py-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 @max-[900px]/list-detail:p-4.5">{detailHeader}</header>}
          <div aria-label={`${detailLabel}: Inhalt`} className={cn(paneClasses, focusRing, "flex-1 px-6 py-6 text-[0.8rem] leading-[1.7] [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 @max-[900px]/list-detail:p-4.5")} role="region" tabIndex={0}>{children}</div>
          {detailFooter !== undefined && <footer className="flex flex-none flex-wrap items-center gap-2.5 border-t border-border-soft px-6 py-4 @max-[900px]/list-detail:px-4.5 @max-[900px]/list-detail:py-3.5">{detailFooter}</footer>}
        </> : <div className="p-6 text-[0.8rem] leading-relaxed text-muted-foreground"><p>{items.length ? "Wähle einen Eintrag, um die Details zu sehen." : "Keine Auswahl verfügbar."}</p></div>}
      </section>
    </div>
  </section>;
}
