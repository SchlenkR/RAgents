import { SquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "cn";
import { Button } from "./button";
import { Spinner } from "./spinner";

/** The one stop glyph: a filled red square; a state icon never carries it. */
export function StopGlyph({ className, ...props }: Omit<ComponentProps<typeof SquareIcon>, "fill">) {
  return <SquareIcon aria-hidden className={cn("text-destructive", className)} fill="currentColor" {...props} />;
}

const stopButtonClass = "text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20";

/** Every stop button looks the same: the glyph as the icon, the word in the tooltip, red at rest and on hover. */
export function StopButton({ label, busy = false, className, title, ...props }: Omit<ComponentProps<typeof Button>, "children" | "variant"> & {
  label: string;
  busy?: boolean;
}) {
  return <Button aria-busy={busy || undefined} aria-label={label} className={cn(stopButtonClass, className)} title={title ?? label} variant="ghost" {...props}>
    {busy ? <Spinner /> : <StopGlyph />}
  </Button>;
}
