import { createHash } from "node:crypto";
import { DomainError, type AccessContext } from "@ragents/engine";

const PREFIX = "overseer-";
/** The id of the former shared coordinator: stays reserved but belongs to no access. */
export const SHARED_OVERSEER_RUN_ID = "overseer";

/** A user's coordinator; without sign-in (null) there is exactly one. */
export const coordinatorRunId = (userId: string | null): string =>
  userId === null ? `${PREFIX}single` : `${PREFIX}${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;

export const isCoordinatorRunId = (runId: string): boolean => runId === SHARED_OVERSEER_RUN_ID || runId.startsWith(PREFIX);

/** The caller's coordinator: without sign-in the single one, otherwise the signed-in user's. */
export const coordinatorRunIdOf = (access: AccessContext): string => {
  if (!access.enabled) return coordinatorRunId(null);
  if (!access.user) throw new DomainError("login-required", "Please sign in.", 401);
  return coordinatorRunId(access.user.id);
};
