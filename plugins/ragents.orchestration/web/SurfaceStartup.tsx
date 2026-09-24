import { StartupNotice } from "@ragents/web/ui";
import type { SurfaceStartupState } from "./surface-startup";

export function SurfaceStartup({ state }: { state: SurfaceStartupState }) {
  return <div className="pointer-events-none absolute inset-y-0 left-0 grid w-[var(--surface-visible-width,100%)] place-items-center p-6">
    <StartupNotice state={state} />
  </div>;
}
