import { useCallback } from "react";
import { createLocalStorageSetting } from "./lib/local-storage-setting";
import { isRecord } from "./lib/guards";

const prefix = "ragents.runReadRevisions:";
export type RunReadRevisions = Readonly<Record<string, number>>;

export function parseRunReadRevisions(raw: string | null): RunReadRevisions {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? Object.fromEntries(Object.entries(value).filter(([, revision]) => Number.isSafeInteger(revision) && (revision as number) >= 0)) as RunReadRevisions : {};
  } catch { return {}; }
}

const setting = createLocalStorageSetting<RunReadRevisions>({
  changeEvent: "ragents:run-read-revisions",
  matchesKey: key => key.startsWith(prefix),
  parse: parseRunReadRevisions,
  serialize: JSON.stringify,
});

export function useRunReadState(userId: string | undefined) {
  const key = `${prefix}${encodeURIComponent(JSON.stringify(userId ?? null))}`;
  const revisions = setting.useValue(key);
  const markViewed = useCallback((runId: string, revision: number) => {
    if (!Number.isSafeInteger(revision) || revision < 0) return;
    const current = parseRunReadRevisions(window.localStorage.getItem(key));
    if (revision <= (current[runId] ?? -1)) return;
    setting.save(key, { ...current, [runId]: revision });
  }, [key]);
  return { revisions, markViewed };
}
