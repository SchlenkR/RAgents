import { useRef, type ReactElement } from "react";
import { ContextMenu } from "@base-ui/react/context-menu";
import { DropdownMenuItem } from "../ui";

export function DockButtonMenu({ children, destination, onMove }: {
  children: ReactElement;
  destination: "header" | "sidebar";
  onMove: () => void;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return <ContextMenu.Root>
    <ContextMenu.Trigger aria-haspopup="menu" onKeyDown={(event) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left, clientY: rect.bottom }));
      requestAnimationFrame(() => popup.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
    }} render={children} />
    <ContextMenu.Portal>
      <ContextMenu.Positioner className="z-[110] outline-none">
        <ContextMenu.Popup className="min-w-32 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none" ref={popup}>
          <DropdownMenuItem onClick={onMove}>Move to {destination}</DropdownMenuItem>
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  </ContextMenu.Root>;
}
