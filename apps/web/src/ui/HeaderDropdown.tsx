import { useState, type ComponentProps, type ReactElement, type ReactNode, type Ref } from "react";
import { XIcon } from "lucide-react";
import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

type DropdownAnchor = HTMLElement | { contextElement: HTMLElement; getBoundingClientRect: () => DOMRect };
// The whole header stays bright and usable, so every header control looks and works alike; only what lies below it dims.
const belowHeader = "absolute inset-x-0 top-full bottom-auto h-screen";

export function HeaderDropdown({ open, onOpenChange, label, trigger, anchor, children, id, initialFocus, keepMounted, role = "dialog", variant = "default", width = "header", ref }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  trigger?: ReactElement;
  anchor?: () => DropdownAnchor | null;
  children: ReactNode;
  id?: string;
  initialFocus?: ComponentProps<typeof PopoverContent>["initialFocus"];
  keepMounted?: boolean;
  role?: "dialog" | "region";
  variant?: "default" | "chat";
  /** "header" takes the width of the header it hangs from; "content" keeps a readable column. */
  width?: "header" | "content";
  ref?: Ref<HTMLDivElement>;
}) {
  const [button, setButton] = useState<HTMLButtonElement | null>(null);
  const element = () => {
    const target = anchor?.() ?? button;
    return target && "contextElement" in target ? target.contextElement : target;
  };
  const boundary = () => {
    const target = anchor?.() ?? button;
    if (variant === "chat") return target;
    return target && "contextElement" in target ? target : target?.closest("header") ?? target;
  };
  const header = element()?.closest("header") ?? undefined;
  const side = (): "start" | "end" => {
    if (variant === "chat") return "start";
    const target = button ?? element();
    if (!target) return "end";
    const bounds = target.getBoundingClientRect();
    const frame = target.closest("header")?.getBoundingClientRect();
    return bounds.left + bounds.width / 2 < (frame?.left ?? 0) + (frame?.width ?? window.innerWidth) / 2 ? "start" : "end";
  };
  return <Popover modal={false} onOpenChange={(next, details) => {
    const target = anchor?.();
    if (!trigger && target instanceof HTMLElement && details.reason === "outside-press" && details.event.target instanceof Node && target.contains(details.event.target)) return;
    onOpenChange(next);
  }} open={open}>
    {trigger && <PopoverTrigger ref={setButton} render={trigger} />}
    <PopoverContent align={side()} alignOffset={variant === "chat" ? 0 : 8} anchor={boundary} aria-label={label}
      className={`@container/header-dropdown min-h-0 min-w-0 max-h-(--header-dropdown-height) gap-2 overflow-hidden rounded-none p-[8px] [--popout-body-width:100cqw] [--popout-body-height:calc(var(--header-dropdown-height)_-_3.25rem)] ${variant === "chat"
        ? "h-(--header-dropdown-height) w-[min(800px,var(--available-width))] [--header-dropdown-height:min(max(80vh,320px),var(--available-height))]"
        : `${width === "content" ? "w-[min(800px,max(320px,calc(var(--anchor-width)-16px)),var(--available-width))]" : "w-[min(max(320px,calc(var(--anchor-width)-16px)),var(--available-width))]"} [--header-dropdown-height:min(70vh,560px,var(--available-height))]`}`}
      collisionAvoidance={variant === "chat" ? { side: "none", align: "shift" } : undefined}
      backdropClassName={header ? belowHeader : undefined} collisionPadding={8} container={header} data-slot="header-dropdown" dim
      finalFocus={trigger ? undefined : () => element() ?? true}
      id={id} initialFocus={initialFocus} keepMounted={keepMounted} ref={ref} role={role} side="bottom">
      <div className="flex h-7 flex-none items-center justify-between gap-2">
        <strong className="min-w-0 truncate type-item">{label}</strong>
        <Button aria-label={`Close ${label.toLowerCase()}`} onClick={() => onOpenChange(false)} size="icon-sm" variant="ghost"><XIcon /></Button>
      </div>
      <div className={`flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto [overflow-wrap:anywhere] ${variant === "chat" ? "flex-1" : ""}`}>
        {children}
      </div>
    </PopoverContent>
  </Popover>;
}
