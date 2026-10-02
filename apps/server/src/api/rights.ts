import { DomainError, isShared, sharedAccessOf, type AccessContext, type RunShareAccess, type RunSharing } from "@ragents/engine";
import { assertRights } from "../rpc/dispatcher.js";
import type { RunRightsKind } from "@ragents/engine/src/http/methods";
import type { ListedSharing, RunListScope } from "../chat-handler.js";

export interface GlobalRunPolicy {
  /** Every id reserved for a global coordinator. */
  isCoordinator: (runId: string) => boolean;
  /** A user's coordinator; without sign-in (null) there is exactly one. */
  runIdFor: (userId: string | null) => string;
  read: string;
  write: string;
}

/** The coordinator of an access: without sign-in the one, signed in that of the user, without a user none. */
export const coordinatorRunIdOf = (access: AccessContext, global: GlobalRunPolicy): string | undefined =>
  !access.enabled ? global.runIdFor(null) : access.user ? global.runIdFor(access.user.id) : undefined;

/** The right to see the runs of all users; without it, an access stays with its own and those shared with it. */
export const RUNS_READ_ALL = "runs.read.all";

export interface RunAccessPolicy {
  global: GlobalRunPolicy | undefined;
  /** The user of the run: null for a run without an owner, undefined for a run that does not exist yet. */
  ownerOf: (runId: string) => string | null | undefined;
  /** Whether only the owner operates the run, because a plugin declared it so. */
  ownerOnly: (runId: string) => boolean;
  /** Whom the run is shared with besides its owner; nobody for a run that does not exist. */
  sharing: (runId: string) => RunSharing;
}

/** Rights per run: ordinary runs through runs.*, the coordinators through the rights of their plugin. */
export const runRights = (runId: string, kind: RunRightsKind, global: GlobalRunPolicy | undefined): readonly string[] => {
  if (global?.isCoordinator(runId)) {
    const technical = kind === "inspect" || kind === "write-inspect" ? ["runs.inspect"] : [];
    return kind === "read" || kind === "inspect" ? [global.read, ...technical] : [global.read, global.write, ...technical];
  }
  switch (kind) {
    case "read": return ["runs.read"];
    case "inspect": return ["runs.read", "runs.inspect"];
    case "write": return ["runs.read", "runs.write"];
    case "stop": return ["runs.read", "runs.write"];
    case "write-inspect": return ["runs.read", "runs.write", "runs.inspect"];
  }
};

/** A run belongs to the access: without sign-in there is only one, runs.read.all sees all; a coordinator belongs only to its user. */
export const runOwned = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  policy.global?.isCoordinator(runId)
    ? runId === coordinatorRunIdOf(access, policy.global)
    : !access.enabled || access.can(RUNS_READ_ALL) || policy.ownerOf(runId) === access.user?.id;

/** The access a signed-in user has to a run that does not belong to them, through its sharing alone; a coordinator is never shared. */
export const runSharedAccess = (access: AccessContext, runId: string, policy: RunAccessPolicy): RunShareAccess | undefined =>
  access.enabled && access.user && !policy.global?.isCoordinator(runId) && !runOwned(access, runId, policy)
    ? sharedAccessOf(policy.sharing(runId), access.user.id) : undefined;

/** Visible is a run that belongs to the access and one shared with it. */
export const runVisible = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  runOwned(access, runId, policy) || runSharedAccess(access, runId, policy) !== undefined;

/** Also reachable is an id without a run: it belongs only to whoever creates the run under it; a coordinator id never to anyone else. */
export const runReachable = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  runVisible(access, runId, policy) || (!policy.global?.isCoordinator(runId) && policy.ownerOf(runId) === undefined);

/** A run operated only by its owner admits nobody else, not runs.read.all and not a share. */
const ownerOnlyAdmits = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  !access.enabled || !policy.ownerOnly(runId) || policy.ownerOf(runId) === access.user?.id;

/** A run shared with the access for reading is read, never operated or stopped. */
const runReadOnly = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  runSharedAccess(access, runId, policy) === "read";

/** Operating means writing, starting and answering: never in a run shared for reading, and in a run operated only by its owner only for the owner. */
export const runOperable = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  !runReadOnly(access, runId, policy) && ownerOnlyAdmits(access, runId, policy);

/** The workspace of a run operated only by its owner stays with the owner; only the owner reaches it, even for reading, while everyone who sees the run can still read the journal. */
export const runWorkspaceAccessible = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  ownerOnlyAdmits(access, runId, policy);

export const sharingUnavailable = (): DomainError =>
  new DomainError("sharing-unavailable", "Runs are shared only between the signed-in users of a profile with users.", 409);

/** Who may change whom a run is shared with: its owner or runs.read.all, with runs.read and runs.write, only with sign-in; an id without a run whoever creates it. */
const sharingRefusal = (access: AccessContext, runId: string, policy: RunAccessPolicy): DomainError | undefined => {
  if (!access.enabled || !access.user) return sharingUnavailable();
  const missing = ["runs.read", "runs.write"].find((right) => !access.can(right));
  if (missing) return new DomainError("access-denied", `The right ${missing} is missing.`, 403);
  if (policy.global?.isCoordinator(runId)) return new DomainError("run-not-shareable", "A global coordinator is not shared.", 409);
  const owner = policy.ownerOf(runId);
  if (owner === null) return new DomainError("run-not-shareable", `Run ${runId} has no signed-in owner and cannot be shared.`, 409);
  if (owner !== undefined && !runOwned(access, runId, policy)) {
    return new DomainError("run-sharing-denied", `Only the owner of run ${runId} or a user with runs.read.all changes whom it is shared with.`, 403);
  }
  return undefined;
};

export const runShareable = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  sharingRefusal(access, runId, policy) === undefined;

/** The signed-in user who changes the sharing, if the access may; otherwise the reason why not. */
export const runSharer = (access: AccessContext, runId: string, policy: RunAccessPolicy): string => {
  const refusal = sharingRefusal(access, runId, policy);
  if (refusal) throw refusal;
  if (!access.user) throw sharingUnavailable();
  return access.user.id;
};

/** What the run list tells the access about sharing: whether it may change it and whether the run is shared, or the access a share gives it. */
const listedSharing = (access: AccessContext, runId: string, policy: RunAccessPolicy): ListedSharing => {
  if (runShareable(access, runId, policy)) return isShared(policy.sharing(runId)) ? { canShare: true, shared: true } : { canShare: true };
  const shared = runSharedAccess(access, runId, policy);
  return shared ? { sharedAccess: shared } : {};
};

/** The run list of an access: visible is what belongs to it or is shared with it, reachable only the workspace it may also read, and the read markers are its own. */
export const runListScope = (access: AccessContext, policy: RunAccessPolicy): RunListScope => ({
  visible: (runId) => runVisible(access, runId, policy),
  workspaceAccessible: (runId) => runWorkspaceAccessible(access, runId, policy),
  operable: (runId) => runOperable(access, runId, policy),
  sharing: (runId) => listedSharing(access, runId, policy),
  userId: access.user?.id ?? null,
});

export const assertRunWorkspaceAccess = (access: AccessContext, runId: string, policy: RunAccessPolicy): void => {
  if (!runWorkspaceAccessible(access, runId, policy)) {
    throw new DomainError(
      "run-workspace-owner-only",
      `Only its owner sees the workspace of run ${runId}; you may read the journal and stop the run.`,
      403,
    );
  }
};

/** Delivery addresses name their run as a separate path segment: /files/runs/<id>/..., /api/plugins/<plugin>/runs/<id>/... */
export const runIdInPath = (pathname: string): string | undefined =>
  /(?:^|\/)runs\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(pathname)?.[1];

/** A foreign run behaves like a nonexistent one: same code, same message, same status. */
export const assertRunReachable = (access: AccessContext, runId: string, policy: RunAccessPolicy): void => {
  if (!runReachable(access, runId, policy)) throw new DomainError("run-not-found", `Run ${runId} does not exist.`, 404);
};

/** A share for reading is no reason to disguise the run; its user learns why nothing operates. */
const assertRunNotReadOnly = (access: AccessContext, runId: string, policy: RunAccessPolicy): void => {
  if (runReadOnly(access, runId, policy)) throw new DomainError("run-read-only", `Run ${runId} is shared with you for reading only.`, 403);
};

/** Whoever may see the run also learns why they may not operate it. */
export const assertRunOperable = (access: AccessContext, runId: string, policy: RunAccessPolicy): void => {
  assertRunNotReadOnly(access, runId, policy);
  if (!ownerOnlyAdmits(access, runId, policy)) {
    throw new DomainError("run-owner-only", `Only its owner operates run ${runId}; you may read and stop it.`, 403);
  }
};

/** Deleting stays with whom the run belongs to; a share never permits it, whatever rights its user has. */
export const assertRunDeletable = (access: AccessContext, runId: string, policy: RunAccessPolicy): void => {
  if (runSharedAccess(access, runId, policy) !== undefined) {
    throw new DomainError("run-delete-denied", `Run ${runId} is shared with you; only its owner or a user with runs.read.all deletes it.`, 403);
  }
};

/** The message layer's check: every contribution with runId must reach the run, one with runs.write must also operate it. */
export const assertRunAccess = (access: AccessContext, runId: string, operates: boolean, policy: RunAccessPolicy): void => {
  assertRunReachable(access, runId, policy);
  if (operates) assertRunOperable(access, runId, policy);
};

/** Stopping needs the rights of writing but no operating, so a run operated only by its owner stops for everyone who sees it; a share for reading never stops it. */
export const assertRunRights = (access: AccessContext, runId: string, kind: RunRightsKind, policy: RunAccessPolicy): void => {
  assertRights(access, runRights(runId, kind, policy.global));
  assertRunReachable(access, runId, policy);
  if (kind === "write" || kind === "write-inspect") assertRunOperable(access, runId, policy);
  if (kind === "stop") assertRunNotReadOnly(access, runId, policy);
};
