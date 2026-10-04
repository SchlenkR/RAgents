import type { ConnectionEntry, ConnectionRoute, ConnectionState, ConnectionView, PanelPage, PanelSharing, PanelState } from "../../web/src/panel/contract";
import type { RunPanelTheme } from "../../web/src/run-panel/host-contract";
import { connectionRunOf } from "../../web/src/run-overview";
import { connectionAddress, profileNameOf, serverHost } from "./connections";
import type { ConnectionSnapshot, SessionStatus } from "./sessions";
import type { StartEntrySummary } from "./store";

const stateOf = (status: SessionStatus): ConnectionState => {
  switch (status.kind) {
    case "stopped": return { kind: "stopped" };
    case "starting": return status.detail === undefined ? { kind: "starting" } : { kind: "starting", detail: status.detail };
    case "failed": return { kind: "failed", message: status.message };
    case "connecting": return { kind: "connecting" };
    case "connected": return { kind: "connected" };
    case "unreachable": return { kind: "unreachable", message: status.message };
    case "forbidden": return { kind: "forbidden", message: status.message };
    case "login-required": return { kind: "login-required", mode: status.tokenGate ? "token" : "password" };
  }
};

const entryOf = (entry: StartEntrySummary): ConnectionEntry => ({
  id: entry.id,
  title: entry.title,
  description: entry.description,
  kind: entry.action,
  category: entry.category,
  ...(entry.guide !== undefined ? { guided: true } : {}),
});

const routeOf = (snapshot: ConnectionSnapshot): ConnectionRoute => snapshot.connection.kind === "profile"
  ? { kind: "profile", profile: profileNameOf(snapshot.connection.profileFile) }
  : { kind: "server", host: serverHost(snapshot.connection.url), localHost: snapshot.localHost };

/** A server as the overview shows it: state, target line, its runs, and its templates. */
export const connectionView = (snapshot: ConnectionSnapshot): ConnectionView => ({
  name: snapshot.connection.name,
  kind: snapshot.connection.kind,
  address: connectionAddress(snapshot.connection),
  route: routeOf(snapshot),
  state: stateOf(snapshot.status),
  runs: snapshot.runs.map(connectionRunOf),
  entries: snapshot.entries.map(entryOf),
  ...(snapshot.defaultEntry !== undefined ? { defaultEntry: snapshot.defaultEntry } : {}),
  canCreate: snapshot.canCreate,
  ...(snapshot.user !== undefined ? { user: snapshot.user } : {}),
  ...(snapshot.loginUser !== undefined ? { loginUser: snapshot.loginUser } : {}),
  ...(snapshot.savedLogin ? { savedLogin: true } : {}),
  ...(snapshot.problem !== undefined ? { problem: snapshot.problem } : {}),
  ...(snapshot.missingEnvironment !== undefined ? { missingEnvironment: snapshot.missingEnvironment } : {}),
  ...(snapshot.versionNotice !== undefined ? { versionNotice: { level: snapshot.versionNotice.level, text: snapshot.versionNotice.text } } : {}),
});

export interface PanelInput {
  theme: RunPanelTheme;
  page: PanelPage;
  connections: readonly ConnectionSnapshot[];
  profileSuggestions: readonly string[];
  /** Names from ragents.hostEnvironment without a value in the SecretStorage. */
  missingSecrets: readonly string[];
  problem: string | undefined;
  pickedProfileFile: string | undefined;
  /** The open share dialog of a run, with what the server returned or refused. */
  sharing?: PanelSharing;
  /** A short message on Start, such as for a run that is no longer shared with the user. */
  notice?: string;
}

/** The whole state of the panel page; it draws Start, Runs, or Server from it. */
export const panelState = (input: PanelInput): PanelState => ({
  theme: input.theme,
  page: input.page,
  connections: input.connections.map(connectionView),
  profileSuggestions: [...input.profileSuggestions],
  ...(input.missingSecrets.length > 0 ? { missingSecrets: [...input.missingSecrets] } : {}),
  ...(input.problem !== undefined ? { problem: input.problem } : {}),
  ...(input.pickedProfileFile !== undefined ? { pickedProfileFile: input.pickedProfileFile } : {}),
  ...(input.sharing !== undefined ? { sharing: input.sharing } : {}),
  ...(input.notice !== undefined ? { notice: input.notice } : {}),
});

/** How many servers are currently connected; the status bar shows this number. */
export const connectedCount = (snapshots: readonly ConnectionSnapshot[]): number =>
  snapshots.filter((snapshot) => snapshot.status.kind === "connected").length;

/** Waiting inputs of the supplied environments. */
export const pendingActions = (snapshots: readonly ConnectionSnapshot[]): number =>
  snapshots.reduce((sum, snapshot) => sum + snapshot.runs.reduce((count, run) => count + run.pendingActions, 0), 0);

/** "New run" presets a start option only if the selected template does not fix it itself. */
export const preselectable = (entry: StartEntrySummary | undefined, optionId: string): boolean =>
  entry?.fixedStartOptions === undefined || !Object.hasOwn(entry.fixedStartOptions, optionId);

/** An entry of the "New run" picker: a server, plus one of its templates or the free task. */
export interface NewRunChoice {
  connection: string;
  entryId: string | undefined;
  title: string;
  description: string;
  detail: string | undefined;
}

const kindWord = (entry: StartEntrySummary): string => entry.action === "skill" ? "Skill" : "Run script";

/** The first choice of a server: its default template, otherwise the free task. */
const firstChoice = (snapshot: ConnectionSnapshot): NewRunChoice => {
  const name = snapshot.connection.name;
  const entry = snapshot.entries.find((candidate) => candidate.id === snapshot.defaultEntry);
  return entry === undefined
    ? { connection: name, entryId: undefined, title: "New run", description: "no template", detail: undefined }
    : { connection: name, entryId: entry.id, title: entry.title, description: `${kindWord(entry)} \u00b7 Default`, detail: entry.description };
};

/** The servers that allow new runs, each with the free task or its default first and then its templates. */
export const newRunChoices = (snapshots: readonly ConnectionSnapshot[]): Array<{ group: string; choices: NewRunChoice[] }> =>
  snapshots
    .filter((snapshot) => snapshot.status.kind === "connected" && snapshot.canCreate)
    .map((snapshot) => ({
      group: snapshot.connection.name,
      choices: [
        firstChoice(snapshot),
        ...snapshot.entries.filter((entry) => entry.id !== snapshot.defaultEntry).map((entry) => ({
          connection: snapshot.connection.name,
          entryId: entry.id,
          title: entry.title,
          description: kindWord(entry),
          detail: entry.description,
        })),
      ],
    }));

/** Which server a command refers to: the selected one, otherwise the only matching one, otherwise the question. */
export const resolveConnection = (
  snapshots: readonly ConnectionSnapshot[],
  selected: string | undefined,
  matches: (snapshot: ConnectionSnapshot) => boolean,
): { kind: "connection"; name: string } | { kind: "ask"; candidates: readonly ConnectionSnapshot[] } | { kind: "none" } => {
  const chosen = snapshots.find((snapshot) => snapshot.connection.name === selected);
  if (chosen && matches(chosen)) return { kind: "connection", name: chosen.connection.name };
  const candidates = snapshots.filter(matches);
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "connection", name: candidates[0]!.connection.name };
  return { kind: "ask", candidates };
};
