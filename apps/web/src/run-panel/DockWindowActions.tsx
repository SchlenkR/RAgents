import { Fragment, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { ChevronDownIcon, GripVerticalIcon, MenuIcon, RotateCcwIcon } from "lucide-react";
import { BadgeDisplayProvider, Button, cn, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui";

const MAX_DIRECT_WINDOWS = 5;
// Run header widths below which the buttons would lose their labels beside the other header actions, by number of direct entries.
const NARROW_HEADER = [
  ["@max-md/run-header:hidden", "@max-md/run-header:inline-flex"],
  ["@max-lg/run-header:hidden", "@max-lg/run-header:inline-flex"],
  ["@max-xl/run-header:hidden", "@max-xl/run-header:inline-flex"],
  ["@max-2xl/run-header:hidden", "@max-2xl/run-header:inline-flex"],
  ["@max-3xl/run-header:hidden", "@max-3xl/run-header:inline-flex"],
  ["@max-4xl/run-header:hidden", "@max-4xl/run-header:inline-flex"],
] as const;
const gripClass = "absolute inset-y-0 left-0 flex cursor-grab items-center text-muted-foreground opacity-0 transition-opacity active:cursor-grabbing group-hover/button:opacity-100 group-focus-visible/button:opacity-100 group-data-[dragging=true]/button:opacity-100 pointer-coarse:opacity-100";
const dropClass = "pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-primary";

export interface DockWindowItem {
  readonly id: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly visible?: boolean;
  readonly hint?: string;
  /** A marker such as a workspace tab's Badge, drawn as a dot like on a rail button. */
  readonly badge?: ReactNode;
}

/** The window buttons of a run with `extra`, a direct entry after them outside the order; where they do not fit, one "All windows" menu named after `active` holds them all. */
export function DockWindowActions({ active, dragging, dropIndex, extra, groupRef, items, onDragStart, onMove, onOpen, onReset }: {
  active?: DockWindowItem;
  dragging?: string;
  dropIndex?: number;
  extra?: DockWindowItem;
  groupRef?: Ref<HTMLDivElement>;
  items: readonly DockWindowItem[];
  onDragStart?: (event: PointerEvent<HTMLElement>, id: string) => void;
  onMove?: (id: string, offset: -1 | 1) => void;
  onOpen: (id: string) => void;
  onReset?: () => void;
}) {
  const direct = items.length <= MAX_DIRECT_WINDOWS;
  const entries = Math.min(items.length + (extra ? 1 : 0), NARROW_HEADER.length);
  const [hideButtons, showMenu] = NARROW_HEADER[Math.max(entries, 1) - 1];
  const content = (item: DockWindowItem) => <>{item.icon}<span className="min-w-0 truncate">{item.title}</span></>;
  const dot = (badge: ReactNode, className: string) => <span className={className}><BadgeDisplayProvider value="dot">{badge}</BadgeDisplayProvider></span>;
  const entry = (item: DockWindowItem) => <>{content(item)}{item.badge !== undefined && dot(item.badge, "ml-auto")}</>;
  const badges = items.flatMap((item) => item.badge === undefined ? [] : [<Fragment key={item.id}>{item.badge}</Fragment>]);
  const moveFromKeyboard = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (!onMove || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const button = event.currentTarget;
    onMove(id, event.key === "ArrowLeft" ? -1 : 1);
    // Reordering moves the focused button in the DOM, which drops its focus.
    requestAnimationFrame(() => button.focus());
  };
  const windowButton = (item: DockWindowItem, index?: number) => <Button aria-keyshortcuts={onMove && index !== undefined ? "Alt+ArrowLeft Alt+ArrowRight" : undefined} aria-label={item.title} aria-pressed={item.visible}
    className={cn("min-w-11 shrink", (onDragStart || item.badge !== undefined) && "relative", onDragStart && "touch-none data-[dragging=true]:opacity-60")}
    data-dock-window={onDragStart && index !== undefined ? item.id : undefined} data-dragging={onDragStart ? dragging === item.id : undefined} key={item.id}
    onClick={(event) => { if (!onDragStart || event.detail === 0) onOpen(item.id); }} onKeyDown={index === undefined ? undefined : (event) => moveFromKeyboard(event, item.id)}
    onPointerDown={onDragStart && ((event) => onDragStart(event, item.id))} title={item.hint ?? (item.visible ? item.title : `Show ${item.title}`)} variant="ghost">
    {onDragStart && <span aria-hidden className={gripClass} data-dock-window-grip title={index === undefined ? "Drag to dock" : "Drag to reorder or dock"}><GripVerticalIcon className="size-2.5" strokeWidth={3} /></span>}
    {content(item)}
    {item.badge !== undefined && dot(item.badge, "absolute top-0.5 right-0.5")}
    {index !== undefined && dropIndex === index && <span aria-hidden className={cn(dropClass, "-left-1")} data-dock-window-drop />}
    {index !== undefined && dropIndex === items.length && index === items.length - 1 && <span aria-hidden className={cn(dropClass, "-right-1")} data-dock-window-drop />}
  </Button>;
  return <div aria-label="Layout actions" className="flex min-w-0 items-center gap-1" ref={groupRef} role="group">
    {direct && <div className={cn("contents", hideButtons)}>
      {items.map((item, index) => windowButton(item, index))}
      {extra && windowButton(extra)}
      {onReset && <Button aria-label="Reset layout" onClick={onReset} size="icon-lg" title="Reset layout" variant="ghost"><RotateCcwIcon /></Button>}
    </div>}
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button aria-label={active ? `All windows, ${active.title}` : "All windows"} className={cn("relative min-w-11 shrink", direct && "hidden", direct && showMenu)} title="All windows" variant="ghost" />}>
        {active?.icon ?? <MenuIcon />}<span className="min-w-0 truncate">{active?.title ?? "All windows"}</span><ChevronDownIcon className="size-3.5 text-muted-foreground" />
        {badges.length > 0 && dot(badges, "absolute top-0.5 right-0.5 grid *:col-start-1 *:row-start-1")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" aria-label="All windows" className="w-64">
        {items.map((item) => item.visible === undefined
          ? <DropdownMenuItem key={item.id} onClick={() => onOpen(item.id)}>{entry(item)}</DropdownMenuItem>
          : <DropdownMenuCheckboxItem checked={item.visible} closeOnClick key={item.id} onClick={() => onOpen(item.id)}>{entry(item)}</DropdownMenuCheckboxItem>)}
        {(extra || onReset) && <DropdownMenuSeparator />}
        {extra && <DropdownMenuItem onClick={() => onOpen(extra.id)} title={extra.hint}>{content(extra)}</DropdownMenuItem>}
        {onReset && <DropdownMenuItem onClick={onReset}><RotateCcwIcon />Reset layout</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
