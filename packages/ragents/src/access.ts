export interface AccessUser {
  readonly id: string;
  readonly label: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}

/** Abfrageparameter, unter dem GET-Abrufe ohne Header (Ereignisstrom, iframes) einen Zugangstoken mitgeben. */
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
  { id: "runs.read", description: "Runs, Chats, Journale und Arbeitsbereiche ansehen." },
  { id: "runs.read.all", description: "Die Runs aller Benutzer sehen und bedienen, nicht nur die eigenen; einen Run, den nur sein Eigentümer bedient, nur im Journal lesen und stoppen, ohne seinen Arbeitsbereich." },
  { id: "runs.write", description: "Vorhandene Runs steuern, Nachrichten senden, freigegebene Setups starten und App-Aktionen ausführen." },
  { id: "runs.create", description: "Freie Runs erstellen, Startoptionen wählen und Aufträge vorbereiten." },
  { id: "runs.inspect", description: "Modelle, technische Laufdetails, Journale und Programmquellen ansehen." },
  { id: "runs.trace", description: "Denk- und Werkzeugschritte im Chat mit Inhalt sehen und ihren Detailgrad wählen." },
  { id: "runs.delete", description: "Runs und ihre gespeicherten Daten löschen." },
  { id: "settings.read", description: "Profil, Konfiguration und Erweiterungen ansehen." },
  { id: "settings.write", description: "Einstellungen und externen Zugang ändern." },
  { id: "models.use", description: "Modelle über das Modell-Relay dieses Servers aufrufen." },
  { id: "profile.fetch", description: "Das Client-Profil dieses Servers beschreiben und herunterladen." },
] as const;

export const hasRight = (access: AccessSnapshot, right: string): boolean =>
  (!access.enabled && !access.user) || Boolean(access.user?.rights.some((entry) => entry === "*" || entry === right));

export const canStartEntry = (access: AccessSnapshot, entryId: string): boolean =>
  hasRight(access, "runs.write") && (hasRight(access, "runs.create") || Boolean(access.user?.startEntries?.includes(entryId)));

export const createAccessContext = (snapshot: AccessSnapshot): AccessContext => ({
  ...snapshot,
  can: (right) => hasRight(snapshot, right),
});

export const unrestrictedAccess = createAccessContext({ enabled: false, user: null });

export const accessMode = (access: AccessSnapshot, read: string, write: string): "hidden" | "readonly" | "write" =>
  !hasRight(access, read) ? "hidden" : hasRight(access, write) ? "write" : "readonly";

export const defaultHttpRights = (method: string | undefined): readonly string[] =>
  method === "GET" || method === "HEAD" || method === "OPTIONS"
    ? ["runs.read"] : ["runs.read", "runs.write"];
