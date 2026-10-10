import type { ComponentProps } from "react";
import { cn } from "cn";

/** The small uppercase group label above a section; extra content is pushed to the opposite end. */
export function SectionLabel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-between type-label text-muted-foreground", className)} {...props} />;
}

/** A page section's heading in the same label style. */
export function SectionHeading({ title, className }: { title: string; className?: string }) {
  return <div className={cn("flex items-baseline gap-2", className)}>
    <h2 className="min-w-0 truncate type-label text-muted-foreground">{title}</h2>
  </div>;
}
