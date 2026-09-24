import type { AccessSnapshot } from "../../../packages/ragents/src/access";

/** Der Speicher, in dem die Kennung liegt; in der Erweiterung der des Fensters (`workspaceState`). */
export interface IdentityStore {
  get: <T>(key: string) => T | undefined;
  update: (key: string, value: unknown) => Thenable<void>;
}

export const WINDOW_CLIENT_ID_KEY = "ragents.workspaceClientId";

/** Je Fenster eine Kennung, die über Neustarts desselben Fensters gleich bleibt; zwei Fenster verdrängen sich beim Server so nie. */
export const windowClientId = (state: IdentityStore, create: () => string = () => crypto.randomUUID()): string => {
  const stored = state.get<string>(WINDOW_CLIENT_ID_KEY);
  if (stored) return stored;
  const created = create();
  void state.update(WINDOW_CLIENT_ID_KEY, created);
  return created;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Warum sich der Arbeitsplatz bei diesem Server nicht anmeldet; ohne Benutzer nimmt ein Server Arbeitsplätze nur über Loopback an. */
export const workspaceRegistrationRefusal = (access: AccessSnapshot, url: string): string | undefined => {
  if (access.enabled || LOOPBACK_HOSTS.has(new URL(url).hostname)) return undefined;
  return "Arbeitsplatz nicht angemeldet: Dieser Server kennt keine Benutzeranmeldung und nimmt Arbeitsplätze deshalb nur "
    + "über eine Loopback-Verbindung an (etwa http://127.0.0.1 auf seinem eigenen Rechner). Über das Netz braucht er ein Profil mit Benutzern.";
};
