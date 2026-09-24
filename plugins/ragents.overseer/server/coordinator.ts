import { createHash } from "node:crypto";
import { DomainError, type AccessContext } from "@ragents/engine";

const PREFIX = "overseer-";
/** Die Kennung des früheren gemeinsamen Koordinators: bleibt reserviert, gehört aber keinem Zugang. */
export const SHARED_OVERSEER_RUN_ID = "overseer";

/** Der Koordinator eines Benutzers; ohne Anmeldung (null) gibt es genau einen. */
export const coordinatorRunId = (userId: string | null): string =>
  userId === null ? `${PREFIX}single` : `${PREFIX}${createHash("sha256").update(userId).digest("hex").slice(0, 24)}`;

export const isCoordinatorRunId = (runId: string): boolean => runId === SHARED_OVERSEER_RUN_ID || runId.startsWith(PREFIX);

/** Der Koordinator des Aufrufers: ohne Anmeldung der eine, sonst der des angemeldeten Benutzers. */
export const coordinatorRunIdOf = (access: AccessContext): string => {
  if (!access.enabled) return coordinatorRunId(null);
  if (!access.user) throw new DomainError("login-required", "Bitte melde dich an.", 401);
  return coordinatorRunId(access.user.id);
};
