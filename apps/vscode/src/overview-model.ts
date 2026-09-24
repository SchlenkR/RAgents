import type { PanelPage, PanelState, TargetEntry, TargetRoute, TargetRun, TargetState, TargetView } from "../../web/src/panel/contract";
import type { RunPanelTheme } from "../../web/src/run-panel/host-contract";
import { connectionAddress, profileNameOf, serverHost } from "./connections";
import type { RunSummary } from "./run-model";
import type { SessionStatus, TargetSnapshot } from "./sessions";
import type { StartEntrySummary } from "./store";

const targetState = (status: SessionStatus): TargetState => {
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

const targetRun = (run: RunSummary): TargetRun => ({
  id: run.id,
  title: run.title,
  state: run.state,
  pendingActions: run.pendingActions,
  updatedAt: run.updatedAt,
  ...(run.problem !== undefined ? { problem: run.problem } : {}),
});

const targetEntry = (entry: StartEntrySummary): TargetEntry => ({
  id: entry.id,
  title: entry.title,
  description: entry.description,
  kind: entry.action,
  category: entry.category,
  ...(entry.guide !== undefined ? { guided: true } : {}),
});

const targetRoute = (snapshot: TargetSnapshot): TargetRoute => snapshot.connection.kind === "profile"
  ? { kind: "profile", profile: profileNameOf(snapshot.connection.profileFile) }
  : { kind: "server", host: serverHost(snapshot.connection.url), localHost: snapshot.localHost };

/** Eine Umgebung, wie die Übersicht sie zeigt: Zustand, Ziel, ihre Runs und ihre Startvorlagen. */
export const targetView = (snapshot: TargetSnapshot): TargetView => ({
  name: snapshot.connection.name,
  kind: snapshot.connection.kind,
  address: connectionAddress(snapshot.connection),
  route: targetRoute(snapshot),
  state: targetState(snapshot.status),
  runs: snapshot.runs.map(targetRun),
  entries: snapshot.entries.map(targetEntry),
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
  targets: readonly TargetSnapshot[];
  profileSuggestions: readonly string[];
  /** Namen aus ragents.hostEnvironment ohne Wert in der SecretStorage. */
  missingSecrets: readonly string[];
  problem: string | undefined;
  pickedProfileFile: string | undefined;
  runsEnvironment: string | undefined;
}

/** Der ganze Zustand der Panelseite; sie zeichnet daraus Start, Runs oder Umgebungen. */
export const panelState = (input: PanelInput): PanelState => ({
  theme: input.theme,
  page: input.page,
  targets: input.targets.map(targetView),
  profileSuggestions: [...input.profileSuggestions],
  ...(input.missingSecrets.length > 0 ? { missingSecrets: [...input.missingSecrets] } : {}),
  ...(input.problem !== undefined ? { problem: input.problem } : {}),
  ...(input.pickedProfileFile !== undefined ? { pickedProfileFile: input.pickedProfileFile } : {}),
  ...(input.runsEnvironment !== undefined ? { runsEnvironment: input.runsEnvironment } : {}),
});

/** Wie viele Umgebungen gerade verbunden sind; die Statusleiste nennt diese Zahl. */
export const connectedTargets = (targets: readonly TargetSnapshot[]): number =>
  targets.filter((target) => target.status.kind === "connected").length;

/** Wartende Eingaben über alle Umgebungen hinweg; das Abzeichen am Run-Panel zählt sie. */
export const pendingActions = (targets: readonly TargetSnapshot[]): number =>
  targets.reduce((sum, target) => sum + target.runs.reduce((count, run) => count + run.pendingActions, 0), 0);

/** "Neuer Run" belegt eine Startoption nur vor, wenn die gewählte Vorlage sie nicht selbst festlegt. */
export const preselectable = (entry: StartEntrySummary | undefined, optionId: string): boolean =>
  entry?.fixedStartOptions === undefined || !Object.hasOwn(entry.fixedStartOptions, optionId);

/** Ein Eintrag der Auswahl "Neuer Run": eine Umgebung, dazu eine ihrer Vorlagen oder der freie Auftrag. */
export interface NewRunChoice {
  target: string;
  entryId: string | undefined;
  title: string;
  description: string;
  detail: string | undefined;
}

const kindWord = (entry: StartEntrySummary): string => entry.action === "skill" ? "Skill" : "Run-Script";

/** Die erste Wahl einer Umgebung: ihr Default-Einstieg, sonst der freie Auftrag. */
const firstChoice = (target: TargetSnapshot): NewRunChoice => {
  const name = target.connection.name;
  const entry = target.entries.find((candidate) => candidate.id === target.defaultEntry);
  return entry === undefined
    ? { target: name, entryId: undefined, title: "Neuer Run", description: "ohne Vorlage", detail: undefined }
    : { target: name, entryId: entry.id, title: entry.title, description: `${kindWord(entry)} \u00b7 Standard`, detail: entry.description };
};

/** Die Umgebungen, die neue Runs erlauben, je mit dem freien Auftrag oder ihrem Default zuerst und dann ihren Vorlagen. */
export const newRunChoices = (targets: readonly TargetSnapshot[]): Array<{ group: string; choices: NewRunChoice[] }> =>
  targets
    .filter((target) => target.status.kind === "connected" && target.canCreate)
    .map((target) => ({
      group: target.connection.name,
      choices: [
        firstChoice(target),
        ...target.entries.filter((entry) => entry.id !== target.defaultEntry).map((entry) => ({
          target: target.connection.name,
          entryId: entry.id,
          title: entry.title,
          description: kindWord(entry),
          detail: entry.description,
        })),
      ],
    }));

/** Auf welche Umgebung sich ein Befehl bezieht: die gewählte, sonst die einzige passende, sonst die Frage. */
export const resolveTarget = (
  targets: readonly TargetSnapshot[],
  selected: string | undefined,
  matches: (target: TargetSnapshot) => boolean,
): { kind: "target"; name: string } | { kind: "ask"; candidates: readonly TargetSnapshot[] } | { kind: "none" } => {
  const chosen = targets.find((target) => target.connection.name === selected);
  if (chosen && matches(chosen)) return { kind: "target", name: chosen.connection.name };
  const candidates = targets.filter(matches);
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "target", name: candidates[0]!.connection.name };
  return { kind: "ask", candidates };
};
