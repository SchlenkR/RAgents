import type { ComponentProps, ReactNode } from "react";
import { cn } from "cn";

/** The small uppercase group label above a section; extra content is pushed to the opposite end. */
export function SectionLabel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-between type-label text-muted-foreground", className)} {...props} />;
}

/** A page section's heading in the same label style: the count next to the title, an action at the opposite end. */
export function SectionHeading({ title, count, children }: { title: string; count?: number; children?: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-2">
    <h2 className="flex items-baseline gap-2 type-label text-muted-foreground">{title}{count !== undefined && <span className="font-mono type-meta opacity-80">{count}</span>}</h2>
    {children}
  </div>;
}
