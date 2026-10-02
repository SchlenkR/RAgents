import type { RunShareAccess, RunSharing } from "@ragents/engine/src/domain/model";
import type { RunListDetail } from "@ragents/engine/src/plugin-types";
import type { RunSharingResult } from "@ragents/host/api/contracts";
import type { RunPanelTheme } from "../run-panel/host-contract";

/** A server of the extension: a RAgents server by address or a local profile that the extension starts itself. */
export type ConnectionKind = "server" | "profile";

export type ConnectionState =
  | { readonly kind: "stopped" }
  | { readonly kind: "starting"; readonly detail?: string }
  | { readonly kind: "connecting" }
  | { readonly kind: "connected" }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "login-required"; readonly mode: "password" | "token" }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/** An environment variable that a profile's configuration requires with env("NAME") without it being set. */
export interface MissingEnvironment {
  readonly variable: string;
  /** The configuration section that needs it, for example a plugin. */
  readonly section: string;
  readonly key: string;
}

export interface ConnectionRun {
  readonly id: string;
  readonly title: string;
  readonly state: "running" | "waiting" | "paused" | "idle" | "ended";
  readonly pendingActions: number;
  readonly notice?: "unseen" | "updated";
  readonly updatedAt: number;
  /** Who created the run; missing for a run created without sign-in. */
  readonly owner?: string;
  /** The list lines of the run metadata, below the title after the owner. */
  readonly details?: readonly RunListDetail[];
  /** Why the server locked the run; the row does not open it, deleting stays possible. */
  readonly locked?: string;
  /** The user may change whom the run is shared with; the row offers "Share ...". */
  readonly canShare?: true;
  /** For a user who may change it: the run is shared with anyone. */
  readonly shared?: true;
  /** For a user who sees the run only through a share: what it permits; such a row is never deleted. */
  readonly sharedAccess?: RunShareAccess;
}

/** The share dialog of a run on Start or Runs; the host loads and saves, the page draws what it gets. */
export interface PanelSharing {
  readonly connection: string;
  readonly runId: string;
  /** What the server returned last; missing while loading and after a failed load. */
  readonly result?: RunSharingResult;
  /** Loading or saving is under way. */
  readonly pending?: true;
  /** Why the server refused the last load or save. */
  readonly error?: string;
}

export interface ConnectionEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: "skill" | "script";
  /** The template group on Start; a run script without its own category is listed under "Run scripts". */
  readonly category: string;
  /** A guide asks questions before the start; the template is then labeled "Set up" instead of "Start". */
  readonly guided?: boolean;
}

/** Where the server points: a local profile, an address, or an address whose distributed profile runs on a local host. */
export type ConnectionRoute =
  | { readonly kind: "profile"; readonly profile: string }
  | { readonly kind: "server"; readonly host: string; readonly localHost: boolean };

export interface ConnectionView {
  readonly name: string;
  readonly kind: ConnectionKind;
  /** Address of the server or path of the profile file. */
  readonly address: string;
  readonly route: ConnectionRoute;
  readonly state: ConnectionState;
  readonly runs: readonly ConnectionRun[];
  readonly entries: readonly ConnectionEntry[];
  /** The template from entries that the plus on the chip uses and that comes first on Start; without it a new run is an empty chat. */
  readonly defaultEntry?: string;
  /** New runs are allowed; without the right only the list remains. */
  readonly canCreate: boolean;
  readonly canDelete?: boolean;
  readonly canCreateFree?: boolean;
  /** The signed-in user, if the server manages users. */
  readonly user?: string;
  /** The most recently tried user name; the sign-in form takes it over. */
  readonly loginUser?: string;
  /** Credentials are stored in the SecretStorage so the extension signs in to the server silently. */
  readonly savedLogin?: boolean;
  /** Error of the last action on this server, directly in its row. */
  readonly problem?: string;
  /** Start or takeover failed because of this environment variable; the row leads from here to the value and the retry. */
  readonly missingEnvironment?: MissingEnvironment;
  /** Extension and server carry a different RAgents version; an error if the workstation is not registered because of it. */
  readonly versionNotice?: ConnectionNotice;
}

export interface ConnectionNotice {
  readonly level: "error" | "warning";
  readonly text: string;
}

/** The four pages of the extension; "run" shows the run panel instead of this page. */
export type PanelPage = "start" | "runs" | "run" | "connections";

/** The pages the panel may switch to itself; openRun leads to the run. */
export const PANEL_PAGES = ["start", "runs", "connections"] as const;

export interface PanelState {
  readonly theme: RunPanelTheme;
  readonly page: PanelPage;
  readonly connections: readonly ConnectionView[];
  /** The profile files in the host folder; the dialog offers them, without a host the list stays empty. */
  readonly profileSuggestions: readonly string[];
  /** The ragents.connections setting is invalid; the page names the reason. */
  readonly problem?: string;
  /** The profile path most recently chosen in the file dialog; the dialog takes it over. */
  readonly pickedProfileFile?: string;
  /** The Runs page starts with the runs of this server; the chip on Start sets it, the title bar does not. */
  readonly runsConnection?: string;
  /** Names from ragents.hostEnvironment without a value in the SecretStorage; the setting applies to all servers, so the list appears once. */
  readonly missingSecrets?: readonly string[];
  /** The open share dialog; without it, none is open. */
  readonly sharing?: PanelSharing;
  /** A short message on Start, such as for a run that left the list because it is no longer shared with the user. */
  readonly notice?: string;
}

/** The state comes from the extension, first embedded in the page, then as a message. */
export interface PanelStateMessage {
  readonly type: "ragents.panel.state";
  readonly state: PanelState;
}

/** What the panel page sends to the extension. */
export type PanelAction =
  | { readonly action: "page"; readonly page: (typeof PANEL_PAGES)[number]; readonly connection?: string }
  | { readonly action: "settingsFile" }
  | { readonly action: "pickProfile" }
  | { readonly action: "showOutput" }
  | { readonly action: "addServer"; readonly name: string; readonly url: string }
  | { readonly action: "addProfile"; readonly name: string; readonly profileFile: string }
  | { readonly action: "updateServer"; readonly name: string; readonly newName: string; readonly url: string }
  | { readonly action: "updateProfile"; readonly name: string; readonly newName: string; readonly profileFile: string }
  | { readonly action: "remove" | "connect" | "disconnect" | "logout" | "startProfile" | "stopProfile" | "retry"; readonly name: string }
  /** The name of an environment variable, not of a server: the extension asks for the value and puts it into the SecretStorage.
   * With connection the name first goes into ragents.hostEnvironment, and this server then restarts. */
  | { readonly action: "setSecret"; readonly name: string; readonly connection?: string }
  | { readonly action: "login"; readonly name: string; readonly user: string; readonly password: string }
  | { readonly action: "login"; readonly name: string; readonly token: string }
  | { readonly action: "openRun"; readonly name: string; readonly runId: string }
  | { readonly action: "deleteRuns"; readonly name: string; readonly runIds: readonly string[] }
  /** Start shows it as starting until the next state; the host also sends one when the start opens no run. */
  | { readonly action: "newRun"; readonly name: string; readonly entryId?: string }
  /** Opens the share dialog of a run; the host loads its sharing into PanelState.sharing. */
  | { readonly action: "openSharing"; readonly name: string; readonly runId: string }
  /** Replaces the whole sharing of a run; on success the host closes the dialog, otherwise it shows the refusal in it. */
  | { readonly action: "share"; readonly name: string; readonly runId: string; readonly sharing: RunSharing }
  | { readonly action: "closeSharing" };

export type PanelActionMessage = PanelAction & { readonly type: "ragents.panel" };

const text = (value: unknown, key: string): boolean => typeof (value as Record<string, unknown>)[key] === "string";

const isShareAccess = (value: unknown): boolean => value === "read" || value === "write";

const isSharing = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const { everyone, users } = value as { everyone?: unknown; users?: unknown };
  return (everyone === null || isShareAccess(everyone)) && Array.isArray(users) && users.every((user: unknown) =>
    typeof user === "object" && user !== null && text(user, "userId") && isShareAccess((user as { access?: unknown }).access));
};

export const isPanelActionMessage = (value: unknown): value is PanelActionMessage => {
  if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "ragents.panel") return false;
  switch ((value as { action?: unknown }).action) {
    case "page": return (PANEL_PAGES as readonly unknown[]).includes((value as { page?: unknown }).page)
      && ((value as { connection?: unknown }).connection === undefined || text(value, "connection"));
    case "settingsFile": case "pickProfile": case "showOutput": return true;
    case "addServer": return text(value, "name") && text(value, "url");
    case "addProfile": return text(value, "name") && text(value, "profileFile");
    case "updateServer": return text(value, "name") && text(value, "newName") && text(value, "url");
    case "updateProfile": return text(value, "name") && text(value, "newName") && text(value, "profileFile");
    case "remove": case "connect": case "disconnect": case "logout": case "startProfile": case "stopProfile": case "retry": return text(value, "name");
    case "setSecret": return text(value, "name") && ((value as { connection?: unknown }).connection === undefined || text(value, "connection"));
    case "login": return text(value, "name") && (text(value, "token") || (text(value, "user") && text(value, "password")));
    case "openRun": return text(value, "name") && text(value, "runId");
    case "deleteRuns": {
      const runIds = (value as { runIds?: unknown }).runIds;
      return text(value, "name") && Array.isArray(runIds) && runIds.every((runId) => typeof runId === "string");
    }
    case "newRun": return text(value, "name") && ((value as { entryId?: unknown }).entryId === undefined || text(value, "entryId"));
    case "openSharing": return text(value, "name") && text(value, "runId");
    case "share": return text(value, "name") && text(value, "runId") && isSharing((value as { sharing?: unknown }).sharing);
    case "closeSharing": return true;
    default: return false;
  }
};

export const isPanelStateMessage = (value: unknown): value is PanelStateMessage =>
  typeof value === "object" && value !== null && (value as { type?: unknown }).type === "ragents.panel.state"
  && typeof (value as { state?: unknown }).state === "object";
