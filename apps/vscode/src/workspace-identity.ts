import type { AccessSnapshot } from "../../../packages/ragents/src/access";

/** The storage that holds the identifier; in the extension, that of the window (`workspaceState`). */
export interface IdentityStore {
  get: <T>(key: string) => T | undefined;
  update: (key: string, value: unknown) => Thenable<void>;
}

export const WINDOW_CLIENT_ID_KEY = "ragents.workspaceClientId";

/** One identifier per window that stays the same across restarts of the same window; this way two windows never displace each other at the server. */
export const windowClientId = (state: IdentityStore, create: () => string = () => crypto.randomUUID()): string => {
  const stored = state.get<string>(WINDOW_CLIENT_ID_KEY);
  if (stored) return stored;
  const created = create();
  void state.update(WINDOW_CLIENT_ID_KEY, created);
  return created;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Why the workspace does not register with this server; without users, a server accepts workspaces only over loopback. */
export const workspaceRegistrationRefusal = (access: AccessSnapshot, url: string): string | undefined => {
  if (access.enabled || LOOPBACK_HOSTS.has(new URL(url).hostname)) return undefined;
  return "Workspace not registered: This server has no user sign-in and therefore accepts workspaces only "
    + "over a loopback connection (e.g. http://127.0.0.1 on its own machine). Over the network, it needs a profile with users.";
};
