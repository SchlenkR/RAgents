import { StartupNotice } from "@ragents/web/ui";
import type { CanvasStartupState } from "./canvas-startup";

export function CanvasStartup({ state }: { state: CanvasStartupState }) {
  return <div className="pointer-events-none absolute inset-y-0 left-0 grid w-[var(--canvas-visible-width,100%)] place-items-center p-6">
    <StartupNotice state={state} />
  </div>;
}
