import { cn } from "cn";
import { interactionStyle } from "./ui/interaction";
import { createElement, type ComponentProps } from "react";

const toolbarItemClass = "flex flex-none items-center gap-2 self-stretch min-h-header max-w-[220px] px-3 py-1.5 border-r border-border text-left text-[0.72rem] leading-tight text-foreground no-underline [&>svg]:flex-none";
const toolbarButtonClass = cn(interactionStyle, "cursor-pointer active:not-disabled:bg-hover disabled:cursor-not-allowed");

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
  return <span className={cn("type-caption text-muted-foreground", className)} {...props} />;
}

export function ToolbarText({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("line-clamp-2 whitespace-normal [overflow-wrap:anywhere]", className)} {...props} />;
}
