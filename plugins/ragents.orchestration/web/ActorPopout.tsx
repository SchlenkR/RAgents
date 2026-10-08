import { useRef, type ReactNode, type RefObject } from "react";
import { XIcon } from "lucide-react";
import { Button, Popover, PopoverContent } from "@ragents/web/ui";

/** Sized by its content up to the room beside the anchor, which children read as --popout-body-width and --popout-body-height. */
export function ActorPopout({ open, id, label, closeLabel, buttonRef, onClose, placement = "bottom", align = "start", focusInput = false, keepMounted = false, role, headerContent, children }: {
  open: boolean;
  id: string;
  label: string;
  closeLabel: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus?: boolean) => void;
  placement?: "bottom" | "top";
  /** Which edge of the anchor the pop-out lines up with; "end" opens it towards the left. */
  align?: "start" | "end";
  focusInput?: boolean;
  keepMounted?: boolean;
  role: "dialog" | "region";
  headerContent?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pressedAnchor = (details: { reason: string; event: Event }) =>
    details.reason === "outside-press" && details.event.target instanceof Node && buttonRef.current?.contains(details.event.target) === true;
  return <Popover open={open} onOpenChange={(next, details) => { if (!next && !pressedAnchor(details)) onClose(); }}>
    <PopoverContent align={align} anchor={buttonRef} aria-label={label} className="relative flex w-max max-w-(--available-width) max-h-(--available-height) min-h-0 min-w-0 flex-col gap-0 overflow-hidden p-0 text-[0.76rem] focus:outline-none [--popout-body-width:var(--available-width)] [--popout-header:2.75rem] [--popout-body-height:calc(var(--available-height)_-_var(--popout-header))] [&_input[type=checkbox]]:m-0 [&_input[type=checkbox]]:flex-none [&_input[type=checkbox]]:accent-primary"
      collisionPadding={8} data-surface-scroll="true" data-placement={placement} id={id} initialFocus={focusInput ? () => panelRef.current?.querySelector("input") ?? true : true} keepMounted={keepMounted}
      ref={panelRef} role={role} side={placement}>
      <header className="flex h-(--popout-header) flex-none items-center justify-between gap-2 border-b border-border px-3">
        <strong className="shrink-0">{label}</strong>
        {headerContent}
        <Button aria-label={closeLabel} onClick={() => onClose(true)} size="icon-sm" title={closeLabel} variant="ghost"><XIcon /></Button>
      </header>
      {children}
    </PopoverContent>
  </Popover>;
}
