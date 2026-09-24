import { useEffect, useState } from "react";
import { coreContracts } from "@ragents/host/api/contracts";
import { getActorConversations, getRunView } from "./api";
import type { Message } from "./chat/types";
import { rpc } from "./rpc";

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
  let refreshing = false;
  let pending = false;
  const refresh = async () => {
    if (disposed) return;
    if (refreshing) {
      pending = true;
      return;
    }
    refreshing = true;
    do {
      pending = false;
      try {
        const next = await getRunView(sessionId);
        if (disposed) return;
        if (setConversations) {
          const conversations = next === undefined ? undefined : await getActorConversations(sessionId);
          if (disposed) return;
          setConversations(conversations);
        }
        setView(next);
        setError(undefined);
      } catch (caught) {
        if (disposed) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    } while (pending);
    refreshing = false;
  };
  void refresh();
  let scheduled: number | undefined;
  const nudge = () => {
    if (disposed || scheduled !== undefined) return;
    scheduled = window.setTimeout(() => {
      scheduled = undefined;
      void refresh();
    }, 250);
  };
  const unsubscribe = rpc.subscribe(coreContracts.channels.run, { runId: sessionId }, (message) => {
    if (disposed) return;
    if (message.kind === "ready") setError(undefined);
    nudge();
  }, () => {
    if (!disposed) setError("Der Live-Stream des Runs ist nicht erreichbar");
  });
  return () => {
    if (disposed) return;
    disposed = true;
    if (scheduled !== undefined) window.clearTimeout(scheduled);
    unsubscribe();
  };
}
