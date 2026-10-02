import { sameSharing, type RunShareAccess, type RunSharing } from "@ragents/engine/src/domain/model";
import type { RunSharingResult } from "@ragents/host/api/contracts";
import type { SessionInfo } from "./api";
import type { PanelSharing } from "./panel/contract";

export type { RunShareAccess, RunSharing, RunSharingResult };

export const SHARE_ACCESS_LABELS: Readonly<Record<RunShareAccess, string>> = { read: "Can view", write: "Can operate" };

export const REVOKED_SHARE_NOTICE = "This run is no longer available to you.";

/** The sharing as the dialog edits it: the server's, without display names. */
export const sharingOf = (result: RunSharingResult): RunSharing => ({
  everyone: result.sharing.everyone,
  users: result.sharing.users.map(({ userId, access }) => ({ userId, access })),
});

export const withEveryone = (sharing: RunSharing, everyone: RunShareAccess | null): RunSharing => ({ everyone, users: sharing.users });

/** Changes the access of a shared user; a user not shared with yet joins at the end. */
export const withUser = (sharing: RunSharing, userId: string, access: RunShareAccess): RunSharing => ({
  everyone: sharing.everyone,
  users: sharing.users.some((user) => user.userId === userId)
    ? sharing.users.map((user) => user.userId === userId ? { userId, access } : user)
    : [...sharing.users, { userId, access }],
});

export const withoutUser = (sharing: RunSharing, userId: string): RunSharing => ({
  everyone: sharing.everyone,
  users: sharing.users.filter((user) => user.userId !== userId),
});

/** The users the picker still offers: the profile's users the run can be shared with, without those already named. */
export const addableUsers = (result: RunSharingResult, sharing: RunSharing): RunSharingResult["users"] =>
  result.users.filter((user) => !sharing.users.some((entry) => entry.userId === user.id));

/** The server's display name of a shared user, for a newly added one that of the candidate, otherwise the id. */
export const sharedUserLabel = (result: RunSharingResult, userId: string): string =>
  result.sharing.users.find((user) => user.userId === userId)?.label ?? result.users.find((user) => user.id === userId)?.label ?? userId;

export const sharingChanged = (result: RunSharingResult, sharing: RunSharing): boolean => !sameSharing(sharingOf(result), sharing);

/** What the sharee indicator says in the run list and the run header. */
export const sharedWithYouLabel = (access: RunShareAccess): string =>
  access === "read" ? "Shared with you - view only" : "Shared with you - can operate";

/** Why the chat input is disabled for a viewer who does not operate the run. */
export const readOnlyReason = (session: SessionInfo): string =>
  session.sharedAccess === "read" ? "Shared with you for viewing only"
    : session.operable === false ? "Only its owner operates this run"
      : "Read access to this run";

/** Loads and saves a run's sharing; every host brings its own transport. */
export interface SharingClient {
  load: (runId: string) => Promise<RunSharingResult>;
  save: (runId: string, sharing: RunSharing) => Promise<RunSharingResult>;
}

/** Where a host keeps its open share dialog. */
export interface SharingStore {
  get: () => PanelSharing | undefined;
  set: (next: PanelSharing | undefined) => void;
}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const isDialogOf = (sharing: PanelSharing | undefined, connection: string, runId: string): sharing is PanelSharing =>
  sharing?.connection === connection && sharing.runId === runId;

/** Opens the dialog and loads the sharing; an answer for a dialog closed or replaced meanwhile is dropped. */
export const openSharing = async (connection: string, runId: string, client: SharingClient, store: SharingStore): Promise<void> => {
  store.set({ connection, runId, pending: true });
  try {
    const result = await client.load(runId);
    if (isDialogOf(store.get(), connection, runId)) store.set({ connection, runId, result });
  } catch (cause) {
    if (isDialogOf(store.get(), connection, runId)) store.set({ connection, runId, error: messageOf(cause) });
  }
};

/** Saves the whole sharing: success closes the dialog, a refusal stays in it; without an open dialog of the run, the refusal goes to the caller. */
export const saveSharing = async (connection: string, runId: string, sharing: RunSharing, client: SharingClient, store: SharingStore): Promise<void> => {
  const opened = store.get();
  if (!isDialogOf(opened, connection, runId)) {
    await client.save(runId, sharing);
    return;
  }
  const kept = opened.result ? { result: opened.result } : {};
  store.set({ connection, runId, ...kept, pending: true });
  try {
    await client.save(runId, sharing);
    if (isDialogOf(store.get(), connection, runId)) store.set(undefined);
  } catch (cause) {
    if (isDialogOf(store.get(), connection, runId)) store.set({ connection, runId, ...kept, error: messageOf(cause) });
  }
};
