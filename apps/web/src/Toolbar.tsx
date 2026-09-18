import { cn } from "cn";
import { createElement, type ComponentProps } from "react";

const toolbarItemClass = "flex flex-none items-center gap-2 self-stretch min-h-header max-w-[220px] px-3 py-1.5 border-r border-border text-left text-[0.72rem] leading-tight text-foreground no-underline [&>svg]:flex-none";
const toolbarButtonClass = "cursor-pointer hover:not-disabled:bg-accent aria-expanded:bg-accent aria-pressed:bg-accent aria-expanded:text-primary aria-pressed:text-primary active:not-disabled:bg-accent active:not-disabled:text-primary aria-expanded:shadow-[inset_0_2px_5px_color-mix(in_srgb,var(--foreground)_25%,transparent),inset_0_-2px_0_var(--primary)] aria-pressed:shadow-[inset_0_2px_5px_color-mix(in_srgb,var(--foreground)_25%,transparent),inset_0_-2px_0_var(--primary)] focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-3 disabled:opacity-50 disabled:cursor-not-allowed";

interface ToolbarItemProps extends ComponentProps<"button"> {
  as?: "button" | "a" | "span" | "div";
  href?: string;
}

/** One cell of the header toolbar: full bar height, right separator, hover and pressed states for buttons and links. */
export function ToolbarItem({ as = "span", className, ...props }: ToolbarItemProps) {
  const interactive = as === "button" || as === "a";
  return createElement(as, { className: cn(toolbarItemClass, interactive && toolbarButtonClass, className), ...props });
}

export function ToolbarCopy({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("flex min-w-0 flex-col gap-0.5", className)} {...props} />;
}

export function ToolbarLabel({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("font-mono text-[0.58rem] font-medium uppercase tracking-[0.05em] text-muted-foreground", className)} {...props} />;
}

export function ToolbarText({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("line-clamp-2 whitespace-normal [overflow-wrap:anywhere]", className)} {...props} />;
}
