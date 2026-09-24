import type { ComponentProps } from "react";
import { cn } from "cn";

/** The small uppercase group label above a section; extra content is pushed to the opposite end. */
export function SectionLabel({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center justify-between text-[0.62rem] font-bold uppercase tracking-[0.07em] text-muted-foreground", className)} {...props} />;
}
