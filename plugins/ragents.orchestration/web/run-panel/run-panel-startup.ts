import { useEffect, useState } from "react";
import type { Message } from "@ragents/web/chat/types";
import type { SurfaceStartupState } from "../surface-startup";

/** So lange überbrückt der Ladezustand eine beendete Arbeit, bis die Run-Ansicht dem Startstatus nachgezogen hat. */
export const STARTUP_SETTLE_MS = 1500;

/** Gesprächsbeiträge und Rückfragen beenden den Aufbau; Systemzeilen und Arbeitsschritte gehören noch zu ihm. */
export const chatShowsContent = (messages: readonly Message[]): boolean => messages.some((message) =>
  message.role === "user" || message.role === "action"
  || (message.role === "assistant" && (message.text.trim() !== "" || (message.attachments?.length ?? 0) > 0)));

/** Der Ladezustand des Run-Panels bis zum ersten Inhalt; danach kommt er für diesen Run nicht wieder. */
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
