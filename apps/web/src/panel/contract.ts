import type { RunPanelTheme } from "../run-panel/host-contract";

/** Eine Umgebung der Erweiterung: ein RAgents-Server oder ein lokales Profil, das sie selbst startet. */
export type TargetKind = "server" | "profile";

export type TargetState =
  | { readonly kind: "stopped" }
  | { readonly kind: "starting"; readonly detail?: string }
  | { readonly kind: "connecting" }
  | { readonly kind: "connected" }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "login-required"; readonly mode: "password" | "token" }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

/** Eine Umgebungsvariable, die die Konfiguration eines Profils mit env("NAME") verlangt, ohne dass sie gesetzt ist. */
export interface MissingEnvironment {
  readonly variable: string;
  /** Die Sektion der Konfiguration, die sie braucht, etwa ein Plugin. */
  readonly section: string;
  readonly key: string;
}

export interface TargetRun {
  readonly id: string;
  readonly title: string;
  readonly state: "running" | "waiting" | "idle" | "ended";
  readonly pendingActions: number;
  readonly updatedAt: number;
  /** Die Erweiterung konnte die Laufansicht nicht lesen; die Zeile nennt den Grund. */
  readonly problem?: string;
}

export interface TargetEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: "skill" | "script";
  /** Die Gruppe der Kachelansicht; ein Run-Script ohne eigene Kategorie steht unter "Run-Scripts". */
  readonly category: string;
  /** Ein Leitfaden fragt vor dem Start nach; die Kachel heißt dann "Einrichten" statt "Starten". */
  readonly guided?: boolean;
}

/** Wohin die Umgebung geht: ein lokales Profil, ein Server oder ein Server, dessen verteiltes Profil auf einem lokalen Host läuft. */
export type TargetRoute =
  | { readonly kind: "profile"; readonly profile: string }
  | { readonly kind: "server"; readonly host: string; readonly localHost: boolean };

export interface TargetView {
  readonly name: string;
  readonly kind: TargetKind;
  /** Adresse des Servers oder Pfad der Profildatei. */
  readonly address: string;
  readonly route: TargetRoute;
  readonly state: TargetState;
  readonly runs: readonly TargetRun[];
  readonly entries: readonly TargetEntry[];
  /** Die Vorlage aus entries, die das Plus am Chip und die erste Kachel nehmen; ohne sie ist ein neuer Run ein leerer Chat. */
  readonly defaultEntry?: string;
  /** Neue Runs sind erlaubt; ohne das Recht bleibt nur die Liste. */
  readonly canCreate: boolean;
  /** Der angemeldete Benutzer, sofern der Server Benutzer führt. */
  readonly user?: string;
  /** Die zuletzt versuchte Kennung; das Anmeldeformular übernimmt sie. */
  readonly loginUser?: string;
  /** Anmeldedaten liegen in der SecretStorage, damit die Umgebung sich still anmeldet. */
  readonly savedLogin?: boolean;
  /** Fehler der letzten Aktion an dieser Umgebung, direkt in ihrer Zeile. */
  readonly problem?: string;
  /** Start oder Übernahme scheiterten an dieser Umgebungsvariablen; die Zeile führt von hier zum Wert und zum neuen Versuch. */
  readonly missingEnvironment?: MissingEnvironment;
}

/** Die vier Seiten der Erweiterung; "run" zeigt das Run-Panel statt dieser Seite. */
export type PanelPage = "start" | "runs" | "run" | "environments";

/** Die Seiten, auf die das Panel selbst umschalten darf; zum Run führt openRun. */
export const PANEL_PAGES = ["start", "runs", "environments"] as const;

export interface PanelState {
  readonly theme: RunPanelTheme;
  readonly page: PanelPage;
  readonly targets: readonly TargetView[];
  /** Die Profildateien im Host-Ordner; der Dialog bietet sie an, ohne Host bleibt die Liste leer. */
  readonly profileSuggestions: readonly string[];
  /** Die Einstellung ragents.connections ist fehlerhaft; die Seite nennt den Grund. */
  readonly problem?: string;
  /** Der zuletzt über den Dateidialog gewählte Profilpfad; der Dialog übernimmt ihn. */
  readonly pickedProfileFile?: string;
  /** Die Seite Runs beginnt mit den Runs dieser Umgebung; der Chip auf Start setzt sie, die Titelzeile nicht. */
  readonly runsEnvironment?: string;
  /** Namen aus ragents.hostEnvironment ohne Wert in der SecretStorage; die Einstellung gilt für alle Umgebungen, darum steht die Liste einmal. */
  readonly missingSecrets?: readonly string[];
}

/** Der Zustand kommt von der Erweiterung, zuerst eingebettet in die Seite, danach als Nachricht. */
export interface PanelStateMessage {
  readonly type: "ragents.panel.state";
  readonly state: PanelState;
}

/** Was die Panelseite an die Erweiterung schickt. */
export type PanelAction =
  | { readonly action: "page"; readonly page: (typeof PANEL_PAGES)[number]; readonly environment?: string }
  | { readonly action: "settingsFile" }
  | { readonly action: "pickProfile" }
  | { readonly action: "showOutput" }
  | { readonly action: "addServer"; readonly name: string; readonly url: string }
  | { readonly action: "addProfile"; readonly name: string; readonly profileFile: string }
  | { readonly action: "updateServer"; readonly name: string; readonly newName: string; readonly url: string }
  | { readonly action: "updateProfile"; readonly name: string; readonly newName: string; readonly profileFile: string }
  | { readonly action: "remove" | "connect" | "disconnect" | "logout" | "startProfile" | "stopProfile" | "retry"; readonly name: string }
  /** Der Name einer Umgebungsvariablen, nicht der einer Umgebung: die Erweiterung fragt den Wert ab und legt ihn in die SecretStorage.
   * Mit environment kommt der Name zuerst in ragents.hostEnvironment, und diese Umgebung startet danach erneut. */
  | { readonly action: "setSecret"; readonly name: string; readonly environment?: string }
  | { readonly action: "login"; readonly name: string; readonly user: string; readonly password: string }
  | { readonly action: "login"; readonly name: string; readonly token: string }
  | { readonly action: "openRun"; readonly name: string; readonly runId: string }
  | { readonly action: "deleteRuns"; readonly name: string; readonly runIds: readonly string[] }
  | { readonly action: "newRun"; readonly name: string; readonly entryId?: string };

export type PanelActionMessage = PanelAction & { readonly type: "ragents.panel" };

const text = (value: unknown, key: string): boolean => typeof (value as Record<string, unknown>)[key] === "string";

export const isPanelActionMessage = (value: unknown): value is PanelActionMessage => {
  if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "ragents.panel") return false;
  switch ((value as { action?: unknown }).action) {
    case "page": return (PANEL_PAGES as readonly unknown[]).includes((value as { page?: unknown }).page)
      && ((value as { environment?: unknown }).environment === undefined || text(value, "environment"));
    case "settingsFile": case "pickProfile": case "showOutput": return true;
    case "addServer": return text(value, "name") && text(value, "url");
    case "addProfile": return text(value, "name") && text(value, "profileFile");
    case "updateServer": return text(value, "name") && text(value, "newName") && text(value, "url");
    case "updateProfile": return text(value, "name") && text(value, "newName") && text(value, "profileFile");
    case "remove": case "connect": case "disconnect": case "logout": case "startProfile": case "stopProfile": case "retry": return text(value, "name");
    case "setSecret": return text(value, "name") && ((value as { environment?: unknown }).environment === undefined || text(value, "environment"));
    case "login": return text(value, "name") && (text(value, "token") || (text(value, "user") && text(value, "password")));
    case "openRun": return text(value, "name") && text(value, "runId");
    case "deleteRuns": {
      const runIds = (value as { runIds?: unknown }).runIds;
      return text(value, "name") && Array.isArray(runIds) && runIds.every((runId) => typeof runId === "string");
    }
    case "newRun": return text(value, "name") && ((value as { entryId?: unknown }).entryId === undefined || text(value, "entryId"));
    default: return false;
  }
};

export const isPanelStateMessage = (value: unknown): value is PanelStateMessage =>
  typeof value === "object" && value !== null && (value as { type?: unknown }).type === "ragents.panel.state"
  && typeof (value as { state?: unknown }).state === "object";
