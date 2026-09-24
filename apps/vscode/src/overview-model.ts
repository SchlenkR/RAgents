import type { ConnectionEntry, ConnectionRoute, ConnectionRun, ConnectionState, ConnectionView, PanelPage, PanelState } from "../../web/src/panel/contract";
import type { RunPanelTheme } from "../../web/src/run-panel/host-contract";
import { connectionAddress, profileNameOf, serverHost } from "./connections";
import type { RunSummary } from "./run-model";
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

const runOf = (run: RunSummary): ConnectionRun => ({
  id: run.id,
  title: run.title,
  state: run.state,
  pendingActions: run.pendingActions,
  updatedAt: run.updatedAt,
  ...(run.problem !== undefined ? { problem: run.problem } : {}),
});

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

/** Ein Server, wie die Übersicht ihn zeigt: Zustand, Zielzeile, seine Runs und seine Vorlagen. */
export const connectionView = (snapshot: ConnectionSnapshot): ConnectionView => ({
  name: snapshot.connection.name,
  kind: snapshot.connection.kind,
  address: connectionAddress(snapshot.connection),
  route: routeOf(snapshot),
  state: stateOf(snapshot.status),
  runs: snapshot.runs.map(runOf),
  entries: snapshot.entries.map(entryOf),
  ...(snapshot.defaultEntry !== undefined ? { defaultEntry: snapshot.defaultEntry } : {}),
  canCreate: snapshot.canCreate,
  ...(snapshot.user !== undefined ? { user: snapshot.user } : {}),
  ...(snapshot.loginUser !== undefined ? { loginUser: snapshot.loginUser } : {}),
  ...(snapshot.savedLogin ? { savedLogin: true } : {}),
  ...(snapshot.problem !== undefined ? { problem: snapshot.problem } : {}),
  ...(snapshot.missingEnvironment !== undefined ? { missingEnvironment: snapshot.missingEnvironment } : {}),
});

export interface PanelInput {
  theme: RunPanelTheme;
  page: PanelPage;
  connections: readonly ConnectionSnapshot[];
  profileSuggestions: readonly string[];
  /** Namen aus ragents.hostEnvironment ohne Wert in der SecretStorage. */
  missingSecrets: readonly string[];
  problem: string | undefined;
  pickedProfileFile: string | undefined;
  runsConnection: string | undefined;
}

/** Der ganze Zustand der Panelseite; sie zeichnet daraus Start, Runs oder Server. */
export const panelState = (input: PanelInput): PanelState => ({
  theme: input.theme,
  page: input.page,
  connections: input.connections.map(connectionView),
  profileSuggestions: [...input.profileSuggestions],
  ...(input.missingSecrets.length > 0 ? { missingSecrets: [...input.missingSecrets] } : {}),
  ...(input.problem !== undefined ? { problem: input.problem } : {}),
  ...(input.pickedProfileFile !== undefined ? { pickedProfileFile: input.pickedProfileFile } : {}),
  ...(input.runsConnection !== undefined ? { runsConnection: input.runsConnection } : {}),
});

/** Wie viele Server gerade verbunden sind; die Statusleiste nennt diese Zahl. */
export const connectedCount = (snapshots: readonly ConnectionSnapshot[]): number =>
  snapshots.filter((snapshot) => snapshot.status.kind === "connected").length;

/** Wartende Eingaben über alle Server hinweg; das Abzeichen am Run-Panel zählt sie. */
export const pendingActions = (snapshots: readonly ConnectionSnapshot[]): number =>
  snapshots.reduce((sum, snapshot) => sum + snapshot.runs.reduce((count, run) => count + run.pendingActions, 0), 0);

/** "Neuer Run" belegt eine Startoption nur vor, wenn die gewählte Vorlage sie nicht selbst festlegt. */
export const preselectable = (entry: StartEntrySummary | undefined, optionId: string): boolean =>
  entry?.fixedStartOptions === undefined || !Object.hasOwn(entry.fixedStartOptions, optionId);

/** Ein Eintrag der Auswahl "Neuer Run": ein Server, dazu eine seiner Vorlagen oder der freie Auftrag. */
export interface NewRunChoice {
  connection: string;
  entryId: string | undefined;
  title: string;
  description: string;
  detail: string | undefined;
}

const kindWord = (entry: StartEntrySummary): string => entry.action === "skill" ? "Skill" : "Run-Script";

/** Die erste Wahl eines Servers: seine Default-Vorlage, sonst der freie Auftrag. */
const firstChoice = (snapshot: ConnectionSnapshot): NewRunChoice => {
  const name = snapshot.connection.name;
  const entry = snapshot.entries.find((candidate) => candidate.id === snapshot.defaultEntry);
  return entry === undefined
    ? { connection: name, entryId: undefined, title: "Neuer Run", description: "ohne Vorlage", detail: undefined }
    : { connection: name, entryId: entry.id, title: entry.title, description: `${kindWord(entry)} \u00b7 Standard`, detail: entry.description };
};

/** Die Server, die neue Runs erlauben, je mit dem freien Auftrag oder ihrem Default zuerst und dann ihren Vorlagen. */
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

/** Auf welchen Server sich ein Befehl bezieht: den gewählten, sonst den einzigen passenden, sonst die Frage. */
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
