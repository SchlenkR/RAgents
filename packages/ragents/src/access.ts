export interface AccessUser {
  readonly id: string;
  readonly label: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}

/** Query parameter under which GET requests without headers (event stream, iframes) pass an access token. */
export const ACCESS_TOKEN_QUERY = "access";

export const isAccessRight = (value: unknown): value is string =>
  typeof value === "string" && (value === "*" || /^[a-z][a-z0-9._:-]*$/.test(value));

export interface AccessSnapshot {
  readonly enabled: boolean;
  readonly user: AccessUser | null;
}

export interface AccessContext extends AccessSnapshot {
  can(right: string): boolean;
}

export const builtinPermissions = [
  { id: "runs.read", description: "View runs, chats, journals and workspaces." },
  { id: "runs.read.all", description: "See and operate the runs of all users, not only your own; a run that only its owner operates can only be read in the journal and stopped, without its workspace." },
  { id: "runs.write", description: "Control existing runs, send messages, start released setups and execute app actions." },
  { id: "runs.create", description: "Create free runs, choose start options and prepare tasks." },
  { id: "runs.inspect", description: "View models, technical run details, journals and program sources." },
  { id: "runs.trace", description: "See thinking and tool steps in the chat with their content and choose their level of detail." },
  { id: "runs.delete", description: "Delete runs and their stored data." },
  { id: "settings.read", description: "View profile, configuration and plugins." },
  { id: "settings.write", description: "Change settings and external access." },
  { id: "models.use", description: "Call models through the model relay of this server." },
  { id: "profile.fetch", description: "Describe and download the client profile of this server." },
] as const;

export const hasRight = (access: AccessSnapshot, right: string): boolean =>
  (!access.enabled && !access.user) || Boolean(access.user?.rights.some((entry) => entry === "*" || entry === right));

export const canStartEntry = (access: AccessSnapshot, entryId: string): boolean =>
  hasRight(access, "runs.write") && (hasRight(access, "runs.create") || Boolean(access.user?.startEntries?.includes(entryId)));

export const createAccessContext = (snapshot: AccessSnapshot): AccessContext => ({
  ...snapshot,
  can: (right) => hasRight(snapshot, right),
});

export const hasWorkstationOwner = (access: AccessSnapshot, local: boolean): boolean =>
  local || (access.enabled && access.user !== null);

export const unrestrictedAccess = createAccessContext({ enabled: false, user: null });

export const accessMode = (access: AccessSnapshot, read: string, write: string): "hidden" | "readonly" | "write" =>
  !hasRight(access, read) ? "hidden" : hasRight(access, write) ? "write" : "readonly";

export const defaultHttpRights = (method: string | undefined): readonly string[] =>
  method === "GET" || method === "HEAD" || method === "OPTIONS"
    ? ["runs.read"] : ["runs.read", "runs.write"];
