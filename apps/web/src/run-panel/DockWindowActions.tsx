import { useCallback, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type Ref } from "react";
import { GripVerticalIcon, RotateCcwIcon } from "lucide-react";
import { BadgeDisplayProvider, Button, cn } from "../ui";
import { DockButtonMenu } from "./DockButtonMenu";
import { useHeaderWindows, useRunHeader } from "./RunHeader";
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
  /** false keeps an action such as "Show app..." a plain button among draggable windows. */
  readonly draggable?: boolean;
}

/** Direct window buttons wrap, with `extras` and reset after them outside the order. */
export function DockWindowActions({ dragging, dropIndex, extras = [], groupRef, items, onDragStart, onMove, onOpen, onReset, onMoveToSidebar }: {
  dragging?: string;
  dropIndex?: number;
  extras?: readonly DockWindowItem[];
  groupRef?: Ref<HTMLDivElement>;
  items: readonly DockWindowItem[];
  onDragStart?: (event: PointerEvent<HTMLElement>, id: string) => void;
  onMove?: (id: string, offset: -1 | 1) => void;
  onOpen: (id: string) => void;
  onReset?: () => void;
  onMoveToSidebar?: (id: string) => void;
}) {
  const header = useRunHeader();
  const [group, setGroup] = useState<HTMLDivElement | null>(null);
  const entries = useMemo(() => [...items.map((item) => item.id), ...extras.map((item) => item.id), ...(onReset ? ["reset"] : [])], [items, extras, onReset]);
  const layout = useHeaderWindows(group, entries);
  const bindGroup = useCallback((element: HTMLDivElement | null) => {
    setGroup(element);
    if (typeof groupRef === "function") return groupRef(element);
    if (groupRef) groupRef.current = element;
  }, [groupRef]);
  const position = (index: number) => header ? { position: "absolute" as const, ...layout?.positions[index], visibility: layout?.positions[index] ? "visible" as const : "hidden" as const } : undefined;
  const content = (item: DockWindowItem) => <>{item.icon}<span className="min-w-0 truncate">{item.title}</span></>;
  const dot = (badge: ReactNode, className: string) => <span className={className}><BadgeDisplayProvider value="dot">{badge}</BadgeDisplayProvider></span>;
  const moveFromKeyboard = (event: KeyboardEvent<HTMLElement>, id: string) => {
    if (!onMove || !event.altKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const button = event.currentTarget;
    onMove(id, event.key === "ArrowLeft" ? -1 : 1);
    // Reordering moves the focused button in the DOM, which drops its focus.
    requestAnimationFrame(() => button.focus());
  };
  const windowButton = (item: DockWindowItem, index?: number, slot = index ?? items.length) => {
    const drag = item.draggable === false ? undefined : onDragStart;
    return <Button aria-keyshortcuts={onMove && index !== undefined ? "Alt+ArrowLeft Alt+ArrowRight" : undefined} aria-label={item.title} aria-pressed={item.visible}
      className={cn("min-w-11 max-w-full flex-none", header && "pointer-events-auto w-max max-w-[min(16rem,100%)] transition-colors", (drag || item.badge !== undefined) && "relative", drag && "touch-none data-[dragging=true]:opacity-60")}
      data-header-window style={position(slot)}
      data-dock-window={drag && index !== undefined ? item.id : undefined} data-dragging={drag ? dragging === item.id : undefined} key={item.id}
      onClick={(event) => { if (!drag || event.detail === 0) onOpen(item.id); }} onKeyDown={index === undefined ? undefined : (event) => moveFromKeyboard(event, item.id)}
      onPointerDown={drag && ((event) => drag(event, item.id))} title={item.hint ?? (item.visible ? item.title : `Show ${item.title}`)} variant="ghost">
      {drag && <span aria-hidden className={gripClass} data-dock-window-grip title={index === undefined ? "Drag to dock" : "Drag to reorder or dock"}><GripVerticalIcon className="size-2.5" strokeWidth={3} /></span>}
      {content(item)}
      {item.badge !== undefined && dot(item.badge, "absolute top-0.5 right-0.5")}
      {index !== undefined && dropIndex === index && <span aria-hidden className={cn(dropClass, "-left-1")} data-dock-window-drop />}
      {index !== undefined && dropIndex === items.length && index === items.length - 1 && <span aria-hidden className={cn(dropClass, "-right-1")} data-dock-window-drop />}
    </Button>;
  };
  return <div aria-label="Layout actions" className={header ? "pointer-events-none relative w-full min-w-0" : "flex min-w-0 max-w-full flex-wrap items-center gap-1"} ref={bindGroup} role="group" style={header ? { height: layout?.height ?? header.bounds.height } : undefined}>
    {items.map((item, index) => onMoveToSidebar
      ? <DockButtonMenu destination="sidebar" key={item.id} onMove={() => onMoveToSidebar(item.id)}>{windowButton(item, index)}</DockButtonMenu>
      : windowButton(item, index))}
    {extras.map((item, index) => windowButton(item, undefined, items.length + index))}
    {onReset && <Button aria-label="Reset layout" className={header ? "pointer-events-auto transition-colors" : undefined} data-header-window onClick={onReset} size="icon-lg" style={position(items.length + extras.length)} title="Reset layout" variant="ghost"><RotateCcwIcon /></Button>}
  </div>;
}
