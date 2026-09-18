import type { CanvasStartupState } from "./canvas-startup";

export function CanvasStartup({ state }: { state: CanvasStartupState }) {
  return <div className="pointer-events-none absolute inset-y-0 left-0 grid w-[var(--canvas-visible-width,100%)] place-items-center p-6"
    role={state.kind === "error" ? "alert" : "status"} aria-live="polite">
    <div className="w-[min(360px,100%)] text-center text-foreground">
      <strong className={state.kind === "error" ? "text-lg font-semibold text-destructive" : "text-lg font-semibold"}>{state.title}</strong>
      {state.kind === "working" && <div className="mx-auto mt-5 h-[5px] overflow-hidden rounded-[5px] bg-border" role="progressbar" aria-label={state.title}>
        <span className="block h-full w-[35%] rounded-[inherit] bg-primary animate-progress-sweep motion-reduce:animate-none motion-reduce:mx-auto" />
      </div>}
      <p className="pointer-events-auto mt-3.5 max-h-[30vh] overflow-auto text-[0.82rem] leading-[1.6] text-muted-foreground [overflow-wrap:anywhere]">{state.detail}</p>
    </div>
  </div>;
}
