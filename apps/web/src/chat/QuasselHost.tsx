import { useMemo, type ReactNode } from "react";
import { QuasselProvider, type QuasselComponents } from "quassel";
import type { RunUrlResolver } from "../PluginRegistry";
import { Button, Card, Popover, PopoverContent, StopButton, Toggle } from "../ui";

const components: QuasselComponents = { Button, Toggle, Card, StopButton, Popover, PopoverContent };

const allowRunLinks = (url: string): boolean => /^flow:(actor|input|turn|subscription|action|artifact)\/.+/.test(url);

/** Every chat building block below renders with the host's UI primitives and keeps the links into a run. */
export function QuasselHost({ children }: { children: ReactNode }) {
  return <QuasselProvider allowUrl={allowRunLinks} components={components}>{children}</QuasselProvider>;
}

/** Inside a run, Markdown addresses go through the profile's resolver for that run; without one they stay as written. */
export function RunUrls({ children, resolve, runId }: { children: ReactNode; resolve: RunUrlResolver | undefined; runId: string }) {
  const resolveUrl = useMemo(() => resolve && ((url: string) => resolve(runId, url)), [resolve, runId]);
  return <QuasselProvider resolveUrl={resolveUrl}>{children}</QuasselProvider>;
}
