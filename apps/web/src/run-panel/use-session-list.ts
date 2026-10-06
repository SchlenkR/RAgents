import { useCallback, useEffect, useRef, useState } from "react";
import { listSessions, type ListedSession } from "../api";
import { coreContracts } from "@ragents/host/api/contracts";
import { rpc } from "../rpc";
import { isRecord } from "../lib/guards";

const POLL_INTERVAL_MS = 5000;

const sameContent = (previous: unknown, next: unknown): boolean => {
  if (Object.is(previous, next)) return true;
  if (Array.isArray(previous) && Array.isArray(next)) {
    return previous.length === next.length && previous.every((value, index) => sameContent(value, next[index]));
  }
  if (!isRecord(previous) || !isRecord(next)) return false;
  const keys = Object.keys(previous);
  return keys.length === Object.keys(next).length
    && keys.every((key) => Object.hasOwn(next, key) && sameContent(previous[key], next[key]));
};

export function shareSessionList(previous: ListedSession[], next: ListedSession[]): ListedSession[] {
  const byId = new Map(previous.map((session) => [session.id, session]));
  const shared = next.map((session) => {
    const current = byId.get(session.id);
    return current && sameContent(current, session) ? current : session;
  });
  return previous.length === shared.length && shared.every((session, index) => session === previous[index]) ? previous : shared;
}

/** The server's run list, live over the ragents.runs channel and reloaded every five seconds as a safety net. */
export function useSessionList(enabled: boolean): { sessions: ListedSession[]; unreachable: boolean; refresh: () => Promise<void> } {
  const [sessions, setSessions] = useState<ListedSession[]>([]);
  const [unreachable, setUnreachable] = useState(false);
  const refreshing = useRef<Promise<void> | undefined>(undefined);
  const requested = useRef(false);
  const refresh = useCallback((): Promise<void> => {
    if (!enabled) return Promise.resolve();
    if (refreshing.current) {
      requested.current = true;
      return refreshing.current;
    }
    const update = async () => {
      do {
        requested.current = false;
        try {
          const next = await listSessions();
          setSessions((previous) => shareSessionList(previous, next));
          setUnreachable(false);
        } catch { setUnreachable(true); }
      } while (requested.current);
    };
    refreshing.current = update().finally(() => { refreshing.current = undefined; });
    return refreshing.current;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const unsubscribe = rpc.subscribe(coreContracts.channels.runs, {}, () => void refresh());
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [enabled, refresh]);

  return { sessions, unreachable, refresh };
}
