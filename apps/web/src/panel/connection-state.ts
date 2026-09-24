import type { ConnectionStateName } from "../ui/state-vocabulary";
import type { ConnectionView, MissingEnvironment } from "./contract";

/** Der Zustand eines Servers im Vokabular der Seiten; ein lokales Profil ist verbunden nicht "verbunden", sondern bereit. */
export const connectionState = (connection: ConnectionView): ConnectionStateName => {
  switch (connection.state.kind) {
    case "stopped": return "stopped";
    case "starting":
    case "connecting": return "starting";
    case "connected": return connection.kind === "profile" ? "ready" : "connected";
    case "unreachable": return "unreachable";
    case "login-required": return "login-required";
    case "forbidden": return "forbidden";
    case "failed": return "failed";
  }
};

/** Warum eine fehlende Umgebungsvariable den Start aufhält: welche, wofür sie das Profil braucht und wohin ihr Wert gehört. */
const missingEnvironmentDetail = (missing: MissingEnvironment): string =>
  `Die Umgebungsvariable ${missing.variable} ist nicht gesetzt; die Konfiguration verlangt sie für ${missing.section}.${missing.key}. `
  + "Hinterlege ihren Wert als Secret in VS Code; er bleibt in der SecretStorage und kommt beim nächsten Start in die Umgebung des Hosts.";

/** Der Grund, der zum Zustand gehört; er steht unter der Zeile des Servers. */
export const stateDetail = (connection: ConnectionView): string | undefined => {
  if (connection.missingEnvironment) return missingEnvironmentDetail(connection.missingEnvironment);
  const state = connection.state;
  if (state.kind === "unreachable" || state.kind === "forbidden" || state.kind === "failed") return state.message;
  return undefined;
};

export const kindLabel = (connection: ConnectionView): string => connection.kind === "profile" ? "lokales Profil" : "Server";

/** Die Zielzeile unter dem Namen: das lokale Profil, der Host des Servers oder der Server, dessen Profil lokal läuft. */
export const routeLabel = (connection: ConnectionView): string => {
  const route = connection.route;
  if (route.kind === "profile") return `lokal \u00b7 ${route.profile}`;
  return route.localHost ? `${route.host} \u00b7 lokal` : route.host;
};

export const busyState = (connection: ConnectionView): boolean => connection.state.kind === "starting" || connection.state.kind === "connecting";
