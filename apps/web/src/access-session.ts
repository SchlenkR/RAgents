import type { AccessSnapshot } from "../../../packages/ragents/src/access";

export function accessSnapshotFrom(value: unknown): AccessSnapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid user configuration");
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.enabled !== "boolean") throw new Error("Invalid sign-in mode");
  if (snapshot.user === null) return { enabled: snapshot.enabled, user: null };
  const user = snapshot.user as Record<string, unknown> | undefined;
  if (!user || typeof user.id !== "string" || typeof user.label !== "string"
    || !Array.isArray(user.rights) || !user.rights.every((right) => typeof right === "string")
    || (user.startEntries !== undefined && (!Array.isArray(user.startEntries)
      || !user.startEntries.every((entry) => typeof entry === "string" && entry.length > 0)))) {
    throw new Error("Invalid signed-in user");
  }
  return { enabled: snapshot.enabled, user: { id: user.id, label: user.label, rights: user.rights,
    ...(user.startEntries !== undefined ? { startEntries: user.startEntries as string[] } : {}) } };
}

/** The paths the server puts behind sign-in; all UI data flows through /rpc and /rpc/stream. */
const PROTECTED_PATH = /^\/(?:api|rpc|files)(?:\/|$)/;

export function observeAccessExpiry(request: typeof fetch, origin: string, onExpired: () => void): typeof fetch {
  return async (input, init) => {
    const response = await request(input, init);
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, origin);
    if (response.status === 401 && url.origin === origin && !url.pathname.startsWith("/api/access/")
      && PROTECTED_PATH.test(url.pathname)) onExpired();
    return response;
  };
}
