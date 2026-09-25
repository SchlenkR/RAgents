import { useRef, type ReactNode, type RefObject } from "react";
import { XIcon } from "lucide-react";
import { Button, Popover, PopoverContent } from "@ragents/web/ui";

export function ActorPopout({ open, id, label, closeLabel, buttonRef, onClose, width, height, placement = "bottom", focusInput = false, keepMounted = false, role, headerContent, children }: {
  open: boolean;
  id: string;
  label: string;
  closeLabel: string;
  buttonRef: RefObject<HTMLButtonElement | null>;
  onClose: (restoreFocus?: boolean) => void;
  /** Pixel oder die ganze verfügbare Breite neben dem Anker. */
  width: number | "available";
  height: number;
  placement?: "bottom" | "top";
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
    <PopoverContent align="start" anchor={buttonRef} aria-label={label} className="flex min-h-0 min-w-0 flex-col gap-0 overflow-hidden rounded-b-sm p-0 text-[0.76rem] focus:outline-none data-[placement=top]:rounded-t-sm data-[placement=top]:rounded-b-none [&_input[type=checkbox]]:m-0 [&_input[type=checkbox]]:flex-none [&_input[type=checkbox]]:accent-primary" collisionPadding={8} data-surface-scroll="true" dim
      data-placement={placement} id={id} initialFocus={focusInput ? () => panelRef.current?.querySelector("input") ?? true : true} keepMounted={keepMounted}
      ref={panelRef} role={role} side={placement}
      style={{ width: width === "available" ? "var(--available-width)" : width, height, maxWidth: "var(--available-width)", maxHeight: "var(--available-height)" }}>
      <header className="flex flex-none items-center justify-between gap-2 border-b border-border-soft px-2.5 py-2">
        <strong className="shrink-0">{label}</strong>
        {headerContent}
        <Button aria-label={closeLabel} onClick={() => onClose(true)} size="icon-sm" title={closeLabel} variant="ghost"><XIcon /></Button>
      </header>
      {children}
    </PopoverContent>
  </Popover>;
}
