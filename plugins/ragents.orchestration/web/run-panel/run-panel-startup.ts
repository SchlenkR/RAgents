import { useEffect, useState } from "react";
import type { Message } from "quassel/events";
import type { SurfaceStartupState } from "../surface-startup";

/** How long the loading state bridges finished work until the run view has caught up with the start status. */
export const STARTUP_SETTLE_MS = 1500;

/** Conversation messages and questions end the setup; system lines and work steps still belong to it. */
export const chatShowsContent = (messages: readonly Message[]): boolean => messages.some((message) =>
  message.role === "user" || message.role === "action"
  || (message.role === "assistant" && (message.text.trim() !== "" || (message.attachments?.length ?? 0) > 0)));

/** The run panel's loading state until the first content; afterwards it does not return for this run. */
export function useRunPanelStartup(state: SurfaceStartupState | undefined, connected: boolean, content: boolean): SurfaceStartupState | undefined {
  const [contentSeen, setContentSeen] = useState(content);
  const [held, setHeld] = useState<SurfaceStartupState>();
  const working = connected && state?.kind === "working" ? state : undefined;
  const title = working?.title;
  const detail = working?.detail;
  useEffect(() => { if (content) setContentSeen(true); }, [content]);
  useEffect(() => {
    if (title !== undefined && detail !== undefined) {
      setHeld({ kind: "working", title, detail });
      return;
    }
    const timer = window.setTimeout(() => setHeld(undefined), STARTUP_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [detail, title]);
  return content || contentSeen ? undefined : state ?? held;
}
