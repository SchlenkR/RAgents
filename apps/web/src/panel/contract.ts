import type { RunPanelTheme } from "../run-panel/host-contract";

/** Ein Server der Erweiterung: ein RAgents-Server per Adresse oder ein lokales Profil, das sie selbst startet. */
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

/** Eine Umgebungsvariable, die die Konfiguration eines Profils mit env("NAME") verlangt, ohne dass sie gesetzt ist. */
export interface MissingEnvironment {
  readonly variable: string;
  /** Die Sektion der Konfiguration, die sie braucht, etwa ein Plugin. */
  readonly section: string;
  readonly key: string;
}

export interface ConnectionRun {
  readonly id: string;
  readonly title: string;
  readonly state: "running" | "waiting" | "idle" | "ended";
  readonly pendingActions: number;
  readonly updatedAt: number;
  /** Die Erweiterung konnte die Run-Ansicht nicht lesen; die Zeile nennt den Grund. */
  readonly problem?: string;
}

export interface ConnectionEntry {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly kind: "skill" | "script";
  /** Die Gruppe der Vorlagen auf Start; ein Run-Script ohne eigene Kategorie steht unter "Run-Scripts". */
  readonly category: string;
  /** Ein Leitfaden fragt vor dem Start nach; die Vorlage heißt dann "Einrichten" statt "Starten". */
  readonly guided?: boolean;
}

/** Wohin der Server geht: ein lokales Profil, eine Adresse oder eine Adresse, deren verteiltes Profil auf einem lokalen Host läuft. */
export type ConnectionRoute =
  | { readonly kind: "profile"; readonly profile: string }
  | { readonly kind: "server"; readonly host: string; readonly localHost: boolean };

export interface ConnectionView {
  readonly name: string;
  readonly kind: ConnectionKind;
  /** Adresse des Servers oder Pfad der Profildatei. */
  readonly address: string;
  readonly route: ConnectionRoute;
  readonly state: ConnectionState;
  readonly runs: readonly ConnectionRun[];
  readonly entries: readonly ConnectionEntry[];
  /** Die Vorlage aus entries, die das Plus am Chip nimmt und die auf Start zuerst steht; ohne sie ist ein neuer Run ein leerer Chat. */
  readonly defaultEntry?: string;
  /** Neue Runs sind erlaubt; ohne das Recht bleibt nur die Liste. */
  readonly canCreate: boolean;
  /** Der angemeldete Benutzer, sofern der Server Benutzer führt. */
  readonly user?: string;
  /** Die zuletzt versuchte Kennung; das Anmeldeformular übernimmt sie. */
  readonly loginUser?: string;
  /** Anmeldedaten liegen in der SecretStorage, damit sich die Erweiterung still am Server anmeldet. */
  readonly savedLogin?: boolean;
  /** Fehler der letzten Aktion an diesem Server, direkt in seiner Zeile. */
  readonly problem?: string;
  /** Start oder Übernahme scheiterten an dieser Umgebungsvariablen; die Zeile führt von hier zum Wert und zum neuen Versuch. */
  readonly missingEnvironment?: MissingEnvironment;
}

/** Die vier Seiten der Erweiterung; "run" zeigt das Run-Panel statt dieser Seite. */
export type PanelPage = "start" | "runs" | "run" | "connections";

/** Die Seiten, auf die das Panel selbst umschalten darf; zum Run führt openRun. */
export const PANEL_PAGES = ["start", "runs", "connections"] as const;

export interface PanelState {
  readonly theme: RunPanelTheme;
  readonly page: PanelPage;
  readonly connections: readonly ConnectionView[];
  /** Die Profildateien im Host-Ordner; der Dialog bietet sie an, ohne Host bleibt die Liste leer. */
  readonly profileSuggestions: readonly string[];
  /** Die Einstellung ragents.connections ist fehlerhaft; die Seite nennt den Grund. */
  readonly problem?: string;
  /** Der zuletzt über den Dateidialog gewählte Profilpfad; der Dialog übernimmt ihn. */
  readonly pickedProfileFile?: string;
  /** Die Seite Runs beginnt mit den Runs dieses Servers; der Chip auf Start setzt ihn, die Titelzeile nicht. */
  readonly runsConnection?: string;
  /** Namen aus ragents.hostEnvironment ohne Wert in der SecretStorage; die Einstellung gilt für alle Server, darum steht die Liste einmal. */
  readonly missingSecrets?: readonly string[];
}

/** Der Zustand kommt von der Erweiterung, zuerst eingebettet in die Seite, danach als Nachricht. */
export interface PanelStateMessage {
  readonly type: "ragents.panel.state";
  readonly state: PanelState;
}

/** Was die Panelseite an die Erweiterung schickt. */
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
  /** Der Name einer Umgebungsvariablen, nicht der eines Servers: die Erweiterung fragt den Wert ab und legt ihn in die SecretStorage.
   * Mit connection kommt der Name zuerst in ragents.hostEnvironment, und dieser Server startet danach erneut. */
  | { readonly action: "setSecret"; readonly name: string; readonly connection?: string }
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
    default: return false;
  }
};

export const isPanelStateMessage = (value: unknown): value is PanelStateMessage =>
  typeof value === "object" && value !== null && (value as { type?: unknown }).type === "ragents.panel.state"
  && typeof (value as { state?: unknown }).state === "object";
