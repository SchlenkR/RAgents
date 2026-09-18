import React, { useId } from "react";
import { cn } from "../../../apps/web/src/ui";
import type { AppLayoutProps, GridProps, LayoutGap, StackProps } from "./layout-contracts";

const gaps: Record<LayoutGap, string> = { small: "gap-1.5", normal: "gap-3", large: "gap-5" };

export function AppLayout({ title, description, actions, children, fill = false }: AppLayoutProps) {
  const titleId = useId();
  return <section aria-labelledby={title ? titleId : undefined} className={cn("flex min-w-0 flex-col gap-4 p-4 text-sm break-words [#root>&]:p-0", fill && "h-full min-h-0")} data-fill={fill}>
    {(title || description) && <header className="flex min-w-0 flex-none flex-col gap-1">
      {title && <h1 className="text-xl leading-tight font-semibold" id={titleId}>{title}</h1>}
      {description && <div className="text-muted-foreground">{description}</div>}
    </header>}
    <div className={cn("min-w-0", fill && "-m-1 min-h-0 flex-1 overflow-auto p-1 [scrollbar-gutter:stable]")}>{children}</div>
    {actions && <footer className="flex min-w-0 flex-none flex-wrap items-center gap-2">{actions}</footer>}
  </section>;
}

export function Stack({ children, gap = "normal", direction = "column" }: StackProps) {
  return <div className={cn("flex min-w-0 *:max-w-full *:min-w-0", gaps[gap], direction === "row" ? "flex-row flex-wrap items-center" : "flex-col")}>{children}</div>;
}

export function Grid({ children, columns = 2, gap = "normal" }: GridProps) {
  return <div className="@container min-w-0">
    <div className={cn("grid grid-cols-1 items-start *:max-w-full *:min-w-0 @[520px]:grid-cols-2", gaps[gap], columns === 3 && "@[760px]:grid-cols-3")}>{children}</div>
  </div>;
}
