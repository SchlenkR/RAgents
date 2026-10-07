import type { ReactNode } from "react";
import { cn } from "cn";

/** What a surface shows while it has no content yet: ongoing work, an error or a calm notice. */
export interface StartupNoticeState {
  kind: "working" | "error" | "waiting" | "stopped";
  title: string;
  detail: string;
}

/** The one loading state for surface, run panel and its start: title, a progress bar while work is running, below it what is happening right now. */
export function StartupNotice({ children, className, state }: { children?: ReactNode; className?: string; state: StartupNoticeState }) {
  return <div aria-live="polite" className={cn("w-[min(360px,100%)] text-center text-foreground", className)} data-startup={state.kind}
    role={state.kind === "error" ? "alert" : "status"}>
    <strong className={state.kind === "error" ? "text-lg font-semibold text-destructive" : "text-lg font-semibold"}>{state.title}</strong>
    {state.kind === "working" && <div aria-label={state.title} className="mx-auto mt-5 h-[5px] overflow-hidden rounded-[5px] bg-border" role="progressbar">
      <span className="block h-full w-[35%] rounded-[inherit] bg-primary animate-progress-sweep motion-reduce:animate-none motion-reduce:mx-auto" />
    </div>}
    <p className="pointer-events-auto mt-3.5 max-h-[calc(var(--ragents-viewport-height,100dvh)*0.3)] overflow-auto text-[0.82rem] leading-[1.6] text-muted-foreground [overflow-wrap:anywhere]">{state.detail}</p>
    {children && <div className="pointer-events-auto mt-4 flex flex-wrap justify-center gap-2">{children}</div>}
  </div>;
}
