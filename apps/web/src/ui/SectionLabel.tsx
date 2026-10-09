import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";

/** The small uppercase group label above a section; extra content is pushed to the opposite end. */
export function SectionLabel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-between type-label text-muted-foreground", className)} {...props} />;
}

/** A page section's heading in the same label style: the count next to the title, an action at the opposite end; a hidden title stays for screen readers. */
export function SectionHeading({ title, count, titleHidden = false, className, children }: {
  title: string;
  count?: number;
  titleHidden?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return <div className={cn("flex items-baseline justify-between gap-2", titleHidden && "justify-end", className)}>
    <h2 className={cn("min-w-0 truncate type-label text-muted-foreground", titleHidden && "sr-only")}>{title}{count !== undefined && <span className="ml-2 type-meta tabular-nums">{count}</span>}</h2>
    {children}
  </div>;
}
