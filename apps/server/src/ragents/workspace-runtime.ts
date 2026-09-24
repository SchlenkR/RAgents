import { serviceToken, type JsonValue, type WorkspaceToolNaming } from "@ragents/engine";
import type { ResolvedWorkspaceRoot, SessionIdent } from "@ragents/workspace-executor";

export interface SessionWorkspace {
  cwd: string;
  /** Beschreibt den aufgelösten Arbeitsbereich in Worten; wird Kapitel im Systemprompt jedes Actors mit Arbeitsbereichswerkzeugen. */
  description?: string;
  /** Heimatordner, nur lesbare Wurzeln und Konto der Sandbox, wenn der Arbeitsbereich sie selbst bestimmt. */
  hostSandbox?: { home: string; readOnlyRoots: readonly ResolvedWorkspaceRoot[]; ident?: SessionIdent };
  gitEnv?: NodeJS.ProcessEnv;
  gitConfig?: ReadonlyArray<readonly [string, string]>;
  extraEnv?: NodeJS.ProcessEnv;
  currentRoot: () => Promise<string>;
  runOperation: <T>(operation: () => Promise<T>) => Promise<T>;
}

export interface WorkspaceRuntimeDescription {
  mode: string;
  directoryPattern: string;
}

/** Umzug eines Runs auf einen anderen Server: was seine Bindung dort bedeutet und wie das Ziel sie ersetzt. */
export interface WorkspaceTransfer {
  /** Der vorhandene Ordner auf diesem Serverrechner, an den der Run gebunden ist; null bei einem neuen Ordner je Run oder einem Arbeitsplatz. */
  boundDirectory: (runId: string) => string | null;
  /** Prüft einen Ersatzordner, bevor der Import etwas anlegt. */
  assertDirectory: (directory: string) => void;
  /** Bindet den Run auf dem Ziel an einen vorhandenen Ersatzordner. */
  rebind: (runId: string, directory: string) => void;
}

/** Wo und in welchem Ordner ein Run arbeitet, getrennt beantwortet; ein Ablauf fragt beides, nie einen Mischwert. */
export interface WorkspacePlacement {
  machine: "server" | "client";
  folder: "fresh" | "existing";
  /** Die Kennung der Art (`WorkspaceKind.id`), wenn ein Beitrag den neuen Ordner gestellt hat. */
  kind?: string;
}

export interface WorkspaceRuntime {
  resolve: (runId: string, emitSystem: (text: string) => void) => Promise<SessionWorkspace>;
  describe: () => WorkspaceRuntimeDescription;
  /** Die eine Stelle, an der ein Ablauf zentral fragt, wo und in welchem Ordner ein Run arbeitet. */
  placementOf: (runId: string) => WorkspacePlacement;
  toolNaming?: WorkspaceToolNaming;
  transfer?: WorkspaceTransfer;
}

export const workspaceRuntimeToken = serviceToken<WorkspaceRuntime>("ragents.workspace-runtime");

export interface WorkspaceResolverContext {
  runId: string;
  directory: string;
  choice: JsonValue | null;
  emitSystem: (text: string) => void;
}

/** Was ein Beitrag zum Arbeitsbereich eines Runs liefert; was er weglässt, ergänzt das Arbeitsbereich-Plugin. */
export interface WorkspaceResolution extends Partial<Omit<SessionWorkspace, "cwd">> {
  cwd: string;
}

/** Die Art von Arbeitsbereich, die ein Plugin je Run auf dem Server an Stelle des leeren Ordners beisteuert. */
export interface WorkspaceKind {
  /** Kennung, an der ein Ablauf den Arbeitsbereich eines Runs erkennt. */
  id: string;
  /** Kurzform für Startoption und Sitzungsdaten, etwa "Worktree je Run". */
  label: string;
  /** Ob daneben ein Ordner des Serverrechners gebunden werden darf; ein Arbeitsbereich mit eigenen Rechten schließt ihn aus. */
  serverFolders: boolean;
  /** Wo die Ordner je Run liegen, wenn nicht in der Ablage des Arbeitsbereich-Plugins; nur zur Anzeige. */
  directoryPattern?: string;
}

/** Ein Schritt beim Anlegen oder Wegräumen des neuen Ordners auf einem Arbeitsplatz: eine Operation des Executors dort, im Ordner des Runs. */
export interface WorkspaceFolderStep {
  operation: string;
  input: JsonValue;
}

export interface WorkstationFolderContext {
  runId: string;
  /** Der Ordner des Runs auf dem Arbeitsplatz. */
  path: string;
  label: string;
  choice: JsonValue | null;
}

/** Wie ein Beitrag den neuen Ordner je Run auf einem Arbeitsplatz stellt; der Executor dort legt ihn leer an, die Schritte füllen ihn. */
export interface WorkstationFolder {
  /** Kurzform für Startoption und Sitzungsdaten, etwa "Git-Worktree je Run". */
  label: string;
  /** Laufen der Reihe nach, einmal nach dem Anlegen; scheitert einer, räumt der Host den Ordner wieder weg. */
  prepare: (context: WorkstationFolderContext) => readonly WorkspaceFolderStep[];
  /** Laufen vor dem Wegräumen des Ordners, etwa um einen Worktree aus seinem Repository auszutragen. */
  release?: (context: WorkstationFolderContext) => readonly WorkspaceFolderStep[];
  /** Beschreibt den Ordner im Systemprompt; ohne Angabe der neue, zunächst leere Ordner. */
  description?: (context: WorkstationFolderContext) => string;
}

export interface WorkspaceResolver {
  optionId?: string;
  kind?: WorkspaceKind;
  /** Den neuen Ordner je Run gibt es mit einem Beitrag auf einem Arbeitsplatz nur, wenn er ihn dort stellt. */
  workstation?: WorkstationFolder;
  resolve: (context: WorkspaceResolverContext) => Promise<WorkspaceResolution>;
  /** Beenden eines Runs im beigesteuerten Arbeitsbereich auf dem Server; `sandbox` beendet dabei die Werkzeuge des Hosts. */
  stopSession?: (runId: string, sandbox: () => Promise<void>) => Promise<void>;
  /** Löschen eines Runs im beigesteuerten Arbeitsbereich auf dem Server, nach dem Beenden. */
  deleteSession?: (runId: string) => Promise<void>;
}

export const workspaceResolverToken = serviceToken<WorkspaceResolver>("ragents.workspace-resolver");

export interface GitWorkspaceView {
  branch: (runId: string) => Promise<string | undefined>;
  changes: (runId: string) => Promise<unknown>;
  /** previousPath nennt die Quelle einer Umbenennung aus der Änderungsliste; nur so paart Git sie ohne die ganze Liste. */
  file: (runId: string, filePath: string, view: "diff" | "current", previousPath?: string) => Promise<unknown>;
}

export const gitWorkspaceViewToken = serviceToken<GitWorkspaceView>("ragents.git-workspace-view");
