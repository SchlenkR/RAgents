import { DomainError, type AccessContext } from "@ragents/engine";
import { assertRights } from "../rpc/dispatcher.js";
import type { RunRightsKind } from "@ragents/engine/src/http/methods";
import type { RunListScope } from "../chat-handler.js";

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

/** The right to see the runs of all users; without it, an access stays with its own. */
export const RUNS_READ_ALL = "runs.read.all";

export interface RunAccessPolicy {
  global: GlobalRunPolicy | undefined;
  /** The user of the run: null for a run without an owner, undefined for a run that does not exist yet. */
  ownerOf: (runId: string) => string | null | undefined;
  /** Whether only the owner operates the run, because a plugin declared it so. */
  ownerOnly: (runId: string) => boolean;
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

/** Also reachable is an id without a run: it belongs only to whoever creates the run under it; a coordinator id never to anyone else. */
export const runReachable = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  runOwned(access, runId, policy) || (!policy.global?.isCoordinator(runId) && policy.ownerOf(runId) === undefined);

/** Operating means writing, starting and answering; a run operated only by its owner is not operated by runs.read.all either. */
export const runOperable = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  !access.enabled || !policy.ownerOnly(runId) || policy.ownerOf(runId) === access.user?.id;

/** The workspace of a run operated only by its owner stays with the owner; only the owner reaches it, even for reading, while everyone who sees the run can still read the journal. */
export const runWorkspaceAccessible = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  runOperable(access, runId, policy);

/** The run list of an access: visible is what belongs to it, reachable only the workspace it may also read. */
export const runListScope = (access: AccessContext, policy: RunAccessPolicy): RunListScope => ({
  visible: (runId) => runOwned(access, runId, policy),
  workspaceAccessible: (runId) => runWorkspaceAccessible(access, runId, policy),
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

/** Whoever may see the run also learns why they may not operate it. */
export const assertRunOperable = (access: AccessContext, runId: string, policy: RunAccessPolicy): void => {
  if (!runOperable(access, runId, policy)) {
    throw new DomainError("run-owner-only", `Only its owner operates run ${runId}; you may read and stop it.`, 403);
  }
};

/** The message layer's check: every contribution with runId must reach the run, one with runs.write must also operate it. */
export const assertRunAccess = (access: AccessContext, runId: string, operates: boolean, policy: RunAccessPolicy): void => {
  assertRunReachable(access, runId, policy);
  if (operates) assertRunOperable(access, runId, policy);
};

export const assertRunRights = (access: AccessContext, runId: string, kind: RunRightsKind, policy: RunAccessPolicy): void => {
  assertRights(access, runRights(runId, kind, policy.global));
  assertRunReachable(access, runId, policy);
  if (kind === "write" || kind === "write-inspect") assertRunOperable(access, runId, policy);
};
