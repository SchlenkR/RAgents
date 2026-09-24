import type { PropsWithChildren } from "react";
import { createPortal } from "react-dom";

export function StatusGroup({ children, container, label, order }: PropsWithChildren<{
  container: HTMLElement | null;
  label: string;
  order: number;
}>) {
  return container ? createPortal(
    <div
      aria-label={label}
      className="relative z-[70] flex h-full min-w-0 flex-none items-stretch after:pointer-events-none after:absolute after:top-1.5 after:right-0 after:bottom-1.5 after:w-px after:bg-muted-foreground after:opacity-45 after:content-['']"
      role="group"
      style={{ order }}
    >{children}</div>,
    container,
  ) : null;
}
