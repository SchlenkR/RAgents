import { checkedSharing, DomainError, type RunSharing } from "@ragents/engine";
import type { RunSharingResult } from "./api/contracts.js";

/** A user of the profile as the sharing names them. */
export interface ShareableUser {
  readonly id: string;
  readonly label: string;
}

/** The sharing with display names, and the users the run can be shared with: everyone of the profile but its owner. */
export const sharingResultOf = (sharing: RunSharing, ownerUserId: string | null, users: readonly ShareableUser[]): RunSharingResult => {
  const labels = new Map(users.map((user) => [user.id, user.label]));
  return {
    sharing: {
      everyone: sharing.everyone,
      users: sharing.users.map((user) => ({ userId: user.userId, label: labels.get(user.userId) ?? user.userId, access: user.access })),
    },
    users: users.filter((user) => user.id !== ownerUserId).map((user) => ({ id: user.id, label: user.label })),
  };
};

/** Only users of the profile, and one the current sharing still names although the profile no longer has them; then the engine's rules. */
export const checkedProfileSharing = (sharing: RunSharing, ownerUserId: string | null, current: RunSharing, users: readonly ShareableUser[]): RunSharing => {
  const known = new Set([...users.map((user) => user.id), ...current.users.map((user) => user.userId)]);
  const unknown = sharing.users.find((user) => !known.has(user.userId));
  if (unknown) {
    const valid = users.filter((user) => user.id !== ownerUserId).map((user) => user.id).join(", ") || "none";
    throw new DomainError("share-user-unknown", `${unknown.userId} is not a user of this profile; users to share with: ${valid}.`, 400);
  }
  return checkedSharing(sharing, ownerUserId);
};
