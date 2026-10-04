import type { ListedSession } from "./api";
import type { ConnectionRun } from "./panel/contract";

/** Something is new for the viewer: never viewed, or the journal moved on since the viewer's last view. */
export function runActivityNotice(session: ListedSession): "unseen" | "updated" | undefined {
  if (session.revision === undefined) return undefined;
  if (session.seenRevision === undefined) return "unseen";
  return session.revision > session.seenRevision ? "updated" : undefined;
}

/** One row of the run list, the same in the browser and in VS Code. */
export const connectionRunOf = (session: ListedSession): ConnectionRun => {
  const notice = runActivityNotice(session);
  return {
    id: session.id,
    title: session.title,
    state: session.state,
    pendingActions: session.pendingActions,
    updatedAt: session.updatedAt,
    ...(session.metadata !== undefined ? { metadata: session.metadata } : {}),
    ...(notice !== undefined ? { notice } : {}),
    ...(session.ownerLabel !== undefined ? { owner: session.ownerLabel } : {}),
    ...(session.listDetails !== undefined && session.listDetails.length > 0 ? { details: session.listDetails } : {}),
    ...(session.locked !== undefined ? { locked: session.locked } : {}),
    ...(session.canShare ? { canShare: true } : {}),
    ...(session.shared ? { shared: true } : {}),
    ...(session.sharedAccess !== undefined ? { sharedAccess: session.sharedAccess } : {}),
  };
};
