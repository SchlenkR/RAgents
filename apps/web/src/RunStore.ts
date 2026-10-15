import { useEffect, useState } from "react";
import { coreContracts } from "@ragents/host/api/contracts";
import { getActorConversations, getRunView } from "./api";
import type { Message } from "@schlenkr/quassel/events";
import { rpc } from "./rpc";
import { refreshOnChange } from "./lib/refresh-on-change";

export interface RunStoreState {
  error: string | undefined;
  view: unknown;
  conversations: Record<string, Message[]> | undefined;
}

export function useRunStore(sessionId: string, enabled = true, includeConversations = false): RunStoreState {
  const [view, setView] = useState<unknown>();
  const [error, setError] = useState<string>();
  const [conversations, setConversations] = useState<Record<string, Message[]>>();

  useEffect(() => {
    setView(undefined);
    setError(undefined);
    setConversations(undefined);
    if (!enabled) return;
    return subscribeRunView(sessionId, setView, setError, includeConversations ? setConversations : undefined);
  }, [enabled, includeConversations, sessionId]);

  return { error, view, conversations };
}

export function subscribeRunView(
  sessionId: string,
  setView: (view: unknown) => void,
  setError: (error: string | undefined) => void,
  setConversations?: (conversations: Record<string, Message[]> | undefined) => void,
): () => void {
  let disposed = false;
  const refresh = refreshOnChange(async () => {
    try {
      const next = await getRunView(sessionId);
      if (disposed || document.visibilityState === "hidden") return;
      if (setConversations) {
        const conversations = next === undefined ? undefined : await getActorConversations(sessionId);
        if (disposed) return;
        setConversations(conversations);
      }
      setView(next);
      setError(undefined);
    } catch (caught) {
      if (!disposed) setError(caught instanceof Error ? caught.message : String(caught));
    }
  });
  const unsubscribe = rpc.subscribe(coreContracts.channels.run, { runId: sessionId }, (message) => {
    if (disposed) return;
    if (message.kind === "ready") setError(undefined);
    refresh.nudge();
  }, () => {
    if (!disposed) setError("The run's live stream is unreachable");
  });
  return () => {
    if (disposed) return;
    disposed = true;
    refresh.dispose();
    unsubscribe();
  };
}
