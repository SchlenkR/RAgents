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
  /** Der Projektordner auf diesem Serverrechner, an den der Run gebunden ist; null, wenn der Arbeitsbereich in der Session-Ablage liegt. */
  boundDirectory: (runId: string) => string | null;
  /** Prüft einen Ersatzordner, bevor der Import etwas anlegt. */
  assertDirectory: (directory: string) => void;
  /** Bindet den Run auf dem Ziel an einen vorhandenen Ersatzordner. */
  rebind: (runId: string, directory: string) => void;
}

export interface WorkspaceRuntime {
  resolve: (runId: string, emitSystem: (text: string) => void) => Promise<SessionWorkspace>;
  describe: () => WorkspaceRuntimeDescription;
  /** Welcher Art der Arbeitsbereich eines Runs ist: die Kennung des beigesteuerten Arbeitsbereichs oder die seiner Bindung. */
  kindOf: (runId: string) => string;
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

/** Die Art von Arbeitsbereich, die ein Plugin je Run an Stelle des leeren Ordners beisteuert. */
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

export interface WorkspaceResolver {
  optionId?: string;
  kind?: WorkspaceKind;
  resolve: (context: WorkspaceResolverContext) => Promise<WorkspaceResolution>;
  /** Beenden eines Runs im beigesteuerten Arbeitsbereich; `sandbox` beendet dabei die Werkzeuge des Hosts. */
  stopSession?: (runId: string, sandbox: () => Promise<void>) => Promise<void>;
  /** Löschen eines Runs im beigesteuerten Arbeitsbereich, nach dem Beenden. */
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
