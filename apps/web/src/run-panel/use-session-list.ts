import { useCallback, useEffect, useRef, useState } from "react";
import { listSessions, type SessionInfo } from "../api";
import { coreContracts } from "@ragents/host/api/contracts";
import { rpc } from "../rpc";

const POLL_INTERVAL_MS = 5000;

/** Die Run-Liste des Servers, live über den Sitzungskanal und als Sicherheitsnetz alle fünf Sekunden neu geladen. */
export function useSessionList(enabled: boolean): { sessions: SessionInfo[]; unreachable: boolean; refresh: () => Promise<void> } {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
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
          setSessions(await listSessions());
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
    const unsubscribe = rpc.subscribe(coreContracts.channels.sessions, {}, () => void refresh());
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => { unsubscribe(); clearInterval(timer); };
  }, [enabled, refresh]);

  return { sessions, unreachable, refresh };
}
