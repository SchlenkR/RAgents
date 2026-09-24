import { SquareIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "cn";
import { Button } from "./button";
import { Spinner } from "./spinner";

/** Die eine Stopp-Glyphe: ein gefülltes rotes Quadrat; ein Zustandssymbol trägt sie nie. */
export function StopGlyph({ className, ...props }: Omit<ComponentProps<typeof SquareIcon>, "fill">) {
  return <SquareIcon aria-hidden className={cn("text-destructive", className)} fill="currentColor" {...props} />;
}

const stopButtonClass = "text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/20";

/** Jeder Stopp-Knopf sieht gleich aus: die Glyphe als Symbol, das Wort im Tooltip, rot in Ruhe und beim Hover. */
export function StopButton({ label, busy = false, className, title, ...props }: Omit<ComponentProps<typeof Button>, "children" | "variant"> & {
  label: string;
  busy?: boolean;
}) {
  return <Button aria-busy={busy || undefined} aria-label={label} className={cn(stopButtonClass, className)} title={title ?? label} variant="ghost" {...props}>
    {busy ? <Spinner /> : <StopGlyph />}
  </Button>;
}
