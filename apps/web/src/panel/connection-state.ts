import type { ConnectionStateName } from "../ui/state-vocabulary";
import type { ConnectionView, MissingEnvironment } from "./contract";

/** The state of a server in the vocabulary of the pages; a connected local profile is not "connected" but ready. */
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

/** Why a missing environment variable holds up the start: which one, what the profile needs it for, and where its value belongs. */
const missingEnvironmentDetail = (missing: MissingEnvironment): string =>
  `The environment variable ${missing.variable} is not set; the configuration requires it for ${missing.section}.${missing.key}. `
  + "Store its value as a secret in VS Code; it stays in the SecretStorage and goes into the host's environment on the next start.";

/** The reason that belongs to the state; it appears below the server's row. */
export const stateDetail = (connection: ConnectionView): string | undefined => {
  if (connection.missingEnvironment) return missingEnvironmentDetail(connection.missingEnvironment);
  const state = connection.state;
  if (state.kind === "unreachable" || state.kind === "forbidden" || state.kind === "failed") return state.message;
  return undefined;
};

export const kindLabel = (connection: ConnectionView): string => connection.kind === "profile" ? "local profile" : "server";

/** The route line below the name: the local profile, the server's host, or the server whose profile runs locally. */
export const routeLabel = (connection: ConnectionView): string => {
  const route = connection.route;
  if (route.kind === "profile") return `local \u00b7 ${route.profile}`;
  return route.localHost ? `${route.host} \u00b7 local` : route.host;
};

export const busyState = (connection: ConnectionView): boolean => connection.state.kind === "starting" || connection.state.kind === "connecting";
