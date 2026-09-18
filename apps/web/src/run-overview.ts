import type { SessionInfo } from "./api";

export interface RunDayGroup {
  date: string;
  label: string;
  sessions: SessionInfo[];
}

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export function groupRunsByActivity(sessions: readonly SessionInfo[], now = new Date()): RunDayGroup[] {
  const today = dayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const groups = new Map<string, RunDayGroup>();
  for (const session of [...sessions].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))) {
    const date = new Date(session.updatedAt);
    const key = dayKey(date);
    const group = groups.get(key) ?? {
      date: key,
      label: key === today ? "Heute" : key === dayKey(yesterday) ? "Gestern" : date.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }),
      sessions: [],
    };
    group.sessions.push(session);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function runActivityNotice(session: SessionInfo, seenRevision: number | undefined): "unseen" | "updated" | undefined {
  if (session.revision === undefined) return undefined;
  if (seenRevision === undefined) return "unseen";
  return session.revision > seenRevision ? "updated" : undefined;
}
