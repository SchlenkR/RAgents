import { useState, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { GripVerticalIcon, MenuIcon, RotateCcwIcon } from "lucide-react";
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from "../ui";

const MAX_DIRECT_WINDOWS = 5;
const gripClass = "absolute inset-y-0 left-0 flex cursor-grab items-center text-muted-foreground opacity-0 transition-opacity active:cursor-grabbing group-hover/button:opacity-100 group-focus-visible/button:opacity-100 group-data-[dragging=true]/button:opacity-100 pointer-coarse:opacity-100";
const dropClass = "pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-primary";

export interface DockWindowItem {
  readonly id: string;
  readonly title: string;
  readonly icon: ReactNode;
  readonly visible?: boolean;
  readonly hint?: string;
}

/** The window buttons of a run; `extra` is a direct entry after them, outside the order, hidden only in a narrow run header. */
export function DockWindowActions({ dragging, dropIndex, extra, groupRef, items, onDragStart, onMove, onOpen, onReset }: {
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
  const [open, setOpen] = useState(false);
  const content = (item: DockWindowItem) => <>{item.icon}<span className="min-w-0 truncate">{item.title}</span></>;
  const moveFromKeyboard = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (!onMove || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const button = event.currentTarget;
    onMove(id, event.key === "ArrowLeft" ? -1 : 1);
    // Reordering moves the focused button in the DOM, which drops its focus.
    requestAnimationFrame(() => button.focus());
  };
  const direct = (item: DockWindowItem, index?: number) => <Button aria-keyshortcuts={onMove && index !== undefined ? "Alt+ArrowLeft Alt+ArrowRight" : undefined} aria-label={item.title} aria-pressed={item.visible}
    className={cn("min-w-11 shrink aria-pressed:bg-accent aria-pressed:text-foreground", onDragStart && "relative touch-none data-[dragging=true]:opacity-60", index === undefined && "@max-2xs/run-header:hidden")}
    data-dock-window={onDragStart && index !== undefined ? item.id : undefined} data-dragging={onDragStart ? dragging === item.id : undefined} key={item.id}
    onClick={(event) => { if (!onDragStart || event.detail === 0) onOpen(item.id); }} onKeyDown={index === undefined ? undefined : (event) => moveFromKeyboard(event, item.id)}
    onPointerDown={onDragStart && ((event) => onDragStart(event, item.id))} title={item.hint ?? (item.visible ? item.title : `Show ${item.title}`)} variant="ghost">
    {onDragStart && <span aria-hidden className={gripClass} data-dock-window-grip title={index === undefined ? "Drag to dock" : "Drag to reorder or dock"}><GripVerticalIcon className="size-2.5" strokeWidth={3} /></span>}
    {content(item)}
    {index !== undefined && dropIndex === index && <span aria-hidden className={cn(dropClass, "-left-1")} data-dock-window-drop />}
    {index !== undefined && dropIndex === items.length && index === items.length - 1 && <span aria-hidden className={cn(dropClass, "-right-1")} data-dock-window-drop />}
  </Button>;
  return <div aria-label="Layout actions" className="flex min-w-0 items-center gap-1" ref={groupRef} role="group">
    {items.length > MAX_DIRECT_WINDOWS ? <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={<Button aria-label="All windows" size="icon-lg" title="All windows" variant="ghost" />}><MenuIcon /></PopoverTrigger>
      <PopoverContent align="end" aria-label="All windows" className="max-h-[70vh] w-64 gap-1 overflow-auto p-1" role="menu">
        {items.map((item) => <Button aria-checked={item.visible} className="w-full justify-start aria-checked:bg-accent aria-checked:text-foreground" key={item.id} onClick={() => { onOpen(item.id); setOpen(false); }}
          role={item.visible === undefined ? "menuitem" : "menuitemcheckbox"} variant="ghost">{content(item)}</Button>)}
      </PopoverContent>
    </Popover> : items.map((item, index) => direct(item, index))}
    {extra && direct(extra)}
    {onReset && <Button aria-label="Reset layout" onClick={onReset} size="icon-lg" title="Reset layout" variant="ghost"><RotateCcwIcon /></Button>}
  </div>;
}
