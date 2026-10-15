import { useMemo, type ReactNode } from "react";
import { QuasselProvider, type QuasselButtonProps, type QuasselComponents, type QuasselPopoverContentProps, type QuasselToggleProps } from "@schlenkr/quassel";
import type { RunUrlResolver } from "../PluginRegistry";
import { useNoNativeTitles } from "../ui/native-title";
import { Button, Card, ImagePreviewGroup, Popover, PopoverContent, StopButton, Toggle } from "../ui";

/** quassel's pop-outs (tool call details) keep its own marker, so ui/quassel.css can style their contents. */
function QuasselPopoverContent({ portalContainer, ...props }: QuasselPopoverContentProps) {
  const root = useNoNativeTitles();
  return <PopoverContent container={portalContainer} data-quassel-popover="" ref={root} {...props} />;
}

function QuasselButton({ title, ...props }: QuasselButtonProps) {
  return <Button aria-description={title} {...props} />;
}

function QuasselToggle({ title, ...props }: QuasselToggleProps) {
  return <Toggle aria-label={title} {...props} />;
}

const components: QuasselComponents = { Button: QuasselButton, Toggle: QuasselToggle, Card, StopButton, Popover, PopoverContent: QuasselPopoverContent };

/** Long code lines wrap in every chat; a narrow chat would otherwise cut them off without a visible scrollbar. */
export const chatCodeBlocks = { wrap: true } as const;

const allowRunLinks = (url: string): boolean => /^flow:(actor|input|turn|subscription|action|artifact)\/.+/.test(url);

/** Every chat building block below renders with the host's UI primitives and keeps the links into a run. */
export function QuasselHost({ children }: { children: ReactNode }) {
  return <QuasselProvider allowUrl={allowRunLinks} components={components}><ImagePreviewGroup>{children}</ImagePreviewGroup></QuasselProvider>;
}

/** Inside a run, Markdown addresses go through the profile's resolver for that run; without one they stay as written. */
export function RunUrls({ children, resolve, runId }: { children: ReactNode; resolve: RunUrlResolver | undefined; runId: string }) {
  const resolveUrl = useMemo(() => resolve && ((url: string) => resolve(runId, url)), [resolve, runId]);
  return <QuasselProvider resolveUrl={resolveUrl}>{children}</QuasselProvider>;
}
