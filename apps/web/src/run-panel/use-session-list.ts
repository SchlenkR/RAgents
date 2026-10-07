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

/** A contribution the server reports unavailable for one refresh, such as after its timeout, keeps the value an earlier refresh delivered. */
const withKnownMetadata = (previous: ListedSession | undefined, next: ListedSession): ListedSession => {
  const known = previous?.metadata ?? {};
  const kept = Object.keys(next.metadataUnavailable ?? {}).filter((id) => Object.hasOwn(known, id) && !Object.hasOwn(next.metadata ?? {}, id));
  return kept.length === 0 ? next : { ...next, metadata: { ...next.metadata, ...Object.fromEntries(kept.map((id) => [id, known[id]])) } };
};

export function shareSessionList(previous: ListedSession[], next: ListedSession[]): ListedSession[] {
  const byId = new Map(previous.map((session) => [session.id, session]));
  const shared = next.map((listed) => {
    const current = byId.get(listed.id);
    const session = withKnownMetadata(current, listed);
    return current && sameContent(current, session) ? current : session;
  });
  return previous.length === shared.length && shared.every((session, index) => session === previous[index]) ? previous : shared;
}

/** The listed run, or while a refresh briefly misses it the last listed state of the same run. */
export const retainedSession = (sessions: readonly ListedSession[], runId: string | undefined, last: ListedSession | undefined): ListedSession | undefined =>
  (runId === undefined ? undefined : sessions.find((entry) => entry.id === runId)) ?? (last !== undefined && last.id === runId ? last : undefined);

/** Keeps the open run's metadata and the tabs derived from it while the run list briefly misses the run, for example during a reconnect. */
export function useRetainedSession(sessions: readonly ListedSession[], runId: string | undefined): ListedSession | undefined {
  const [last, setLast] = useState<ListedSession>();
  const session = retainedSession(sessions, runId, last);
  if (session !== undefined && session !== last) setLast(session);
  return session;
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
