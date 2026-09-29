import type { ReactNode } from "react";
import { QuasselProvider, type QuasselComponents } from "quassel";
import { Button, Card, Popover, PopoverContent, StopButton, Toggle } from "../ui";

const components: QuasselComponents = { Button, Toggle, Card, StopButton, Popover, PopoverContent };

const allowRunLinks = (url: string): boolean => /^flow:(actor|input|turn|subscription|action|artifact)\/.+/.test(url);

/** Every chat building block below renders with the host's UI primitives and keeps the links into a run. */
export function QuasselHost({ children }: { children: ReactNode }) {
  return <QuasselProvider allowUrl={allowRunLinks} components={components}>{children}</QuasselProvider>;
}
