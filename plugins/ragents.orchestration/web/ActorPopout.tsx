import { useRef, type ReactNode, type RefObject } from "react";
import { XIcon } from "lucide-react";
import { Button, cn, Popover, PopoverContent } from "@ragents/web/ui";

/** Sized by its content up to the room beside the anchor, which children read as --popout-body-width and --popout-body-height. */
export function ActorPopout({ open, id, label, closeLabel, buttonRef, onClose, placement = "bottom", align = "start", showLabel = true, focusInput = false, keepMounted = false, role, headerContent, children }: {
  open: boolean;
  id: string;
  label: string;
  closeLabel: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus?: boolean) => void;
  placement?: "bottom" | "top";
  /** Which edge of the anchor the pop-out lines up with; "end" opens it towards the left. */
  align?: "start" | "end";
  /** Without the header bar the label only names the pop-out, and the close button sits in its top right corner. */
  showLabel?: boolean;
  focusInput?: boolean;
  keepMounted?: boolean;
  role: "dialog" | "region";
  headerContent?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedAnchor = (details: { reason: string; event: Event }) =>
    details.reason === "outside-press" && details.event.target instanceof Node && buttonRef.current?.contains(details.event.target) === true;
  const close = <Button aria-label={closeLabel} className={cn(!showLabel && "absolute top-1 right-1 z-10 bg-popover/90 shadow-xs")} onClick={() => onClose(true)} size="icon-sm" title={closeLabel} variant="ghost"><XIcon /></Button>;
  return <Popover open={open} onOpenChange={(next, details) => { if (!next && !pressedAnchor(details)) onClose(); }}>
    <PopoverContent align={align} anchor={buttonRef} aria-label={label} className={cn("relative flex w-max max-w-(--available-width) max-h-(--available-height) min-h-0 min-w-0 flex-col gap-0 overflow-hidden rounded-b-sm p-0 text-[0.76rem] focus:outline-none data-[placement=top]:rounded-t-sm data-[placement=top]:rounded-b-none [--popout-body-width:var(--available-width)] [--popout-header:2.75rem] [&_input[type=checkbox]]:m-0 [&_input[type=checkbox]]:flex-none [&_input[type=checkbox]]:accent-primary",
      showLabel ? "[--popout-body-height:calc(var(--available-height)_-_var(--popout-header))]" : "[--popout-body-height:var(--available-height)]")} collisionPadding={8} data-surface-scroll="true" dim
      data-placement={placement} id={id} initialFocus={focusInput ? () => panelRef.current?.querySelector("input") ?? true : true} keepMounted={keepMounted}
      ref={panelRef} role={role} side={placement}>
      {showLabel ? <header className="flex h-(--popout-header) flex-none items-center justify-between gap-2 border-b border-border-soft px-2.5">
        <strong className="shrink-0">{label}</strong>
        {headerContent}
        {close}
      </header> : close}
      {children}
    </PopoverContent>
  </Popover>;
}
