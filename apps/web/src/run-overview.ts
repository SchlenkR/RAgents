import type { SessionInfo } from "./api";

export function runActivityNotice(session: SessionInfo, seenRevision: number | undefined): "unseen" | "updated" | undefined {
  if (session.revision === undefined) return undefined;
  if (seenRevision === undefined) return "unseen";
  return session.revision > seenRevision ? "updated" : undefined;
}
