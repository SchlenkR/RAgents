import { Type } from "typebox";
import { openJson } from "@ragents/engine/src/http/contracts";
import { defineChannel, defineOperation } from "@ragents/engine/src/rpc/contract";

export const WORKSPACE_PLUGIN_ID = "ragents.workspace";

export const BROWSE_ROOTS = ["workspace", "files"] as const;
export type BrowseRoot = typeof BROWSE_ROOTS[number];

export interface BrowseEntry {
  name: string;
  kind: "directory" | "file";
  size: number;
  modifiedAt: string;
}

export interface BrowseListing {
  root: BrowseRoot;
  /** Wo die Wurzel liegt; bei einem Arbeitsplatz mit dessen Label. */
  location: string;
  path: string;
  entries: BrowseEntry[];
  truncated: boolean;
}

export type BrowsePreview =
  | { root: BrowseRoot; path: string; size: number; previewable: true; content: string }
  | { root: BrowseRoot; path: string; size: number; previewable: false; reason: string };

export const WORKSPACE_BINDING_OPTION_ID = "ragents.workspace.binding";

export const WORKSPACE_METADATA_ID = "ragents.workspace";

/** Auf welchem Rechner der Arbeitsbereich eines Runs liegt: dem Server oder einem Arbeitsplatz, dessen Label die Bindung festhält. */
export type WorkspaceMachine = "server" | { client: string; label: string };

/** Ein vorhandener Ordner, den der Run weder anlegt noch löscht. */
export type ExistingWorkspaceFolder = {
  path: string;
};

/** Der neue Ordner je Run auf einem Arbeitsplatz; seinen Pfad dort hält die Bindung ab dem Wählen fest. */
export type FreshWorkstationFolder = {
  path: string;
  fresh: true;
};

/** Welcher Ordner: ein neuer je Run oder ein vorhandener; `fresh` auf dem Server legt der Host je Run in seiner Ablage an. */
export type WorkspaceFolder = "fresh" | ExistingWorkspaceFolder | FreshWorkstationFolder;

/** Wo und in welchem Ordner ein Run arbeitet; wird beim Start als Startoption ins Journal eingefroren. */
export type WorkspaceBinding = {
  machine: WorkspaceMachine;
  folder: WorkspaceFolder;
};

export const freshServerBinding = (): WorkspaceBinding => ({ machine: "server", folder: "fresh" });

export const WORKSPACE_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Was ein Arbeitsplatz bei der Anmeldung über sich sagt. */
export interface WorkspaceClientDescription {
  label: string;
  hostname: string;
  platform: string;
  folders: string[];
  /** Wo der Arbeitsplatz die neuen Ordner je Run anlegt, je Run ein Unterordner mit dessen Kennung. */
  runsDirectory: string;
}

export interface WorkspaceClientInfo extends WorkspaceClientDescription {
  id: string;
}

/** Wie der neue Ordner je Run auf jedem Rechner heißt: der leere Ordner oder der Beitrag eines Plugins; null, wo es keinen gibt. */
export interface FreshWorkspaceLabels {
  server: string;
  client: string | null;
}

export interface WorkspaceBindingPresentation {
  kind: "workspace-binding";
  clients: WorkspaceClientInfo[];
  fresh: FreshWorkspaceLabels;
  /** Ob ein vorhandener Ordner des Serverrechners gebunden werden darf. */
  serverFolders: boolean;
}

export interface WorkspaceSessionMetadata {
  binding: WorkspaceBinding;
  summary: string;
}

const clientId = Type.String({ pattern: "^[A-Za-z0-9_-]{8,64}$", description: "Stabile Kennung des Arbeitsplatzes" });

const executorVersion = Type.String({ minLength: 1, maxLength: 64, description: "Stand des Executors, den der Arbeitsplatz mitbringt" });

const clientDescription = {
  label: Type.String({ minLength: 1, maxLength: 120 }),
  hostname: Type.String({ minLength: 1 }),
  platform: Type.String({ minLength: 1 }),
  folders: Type.Array(Type.String({ minLength: 1 }), { maxItems: 32 }),
  runsDirectory: Type.String({ minLength: 1, description: "Absoluter Ordner, unter dem der Arbeitsplatz die neuen Ordner je Run anlegt" }),
};

export const clientInfoSchema = Type.Object({
  id: Type.String(),
  ...clientDescription,
}, { additionalProperties: false });

const absolutePath = Type.String({ minLength: 1, description: "Absoluter Pfad im gebundenen Ordner" });

/** Keine Operation eines Moduls: gibt frei, was der Executor des Arbeitsplatzes für den Run hält. */
export const WORKSPACE_CLIENT_STOP_OPERATION = "stop";

/** Die eine Operation, die der Server auf dem Arbeitsplatz ruft; Fortschritt ist der JSON-Wert der Operation, bei Bash { text }. */
export const workspaceClientContracts = {
  execute: defineOperation({
    id: "ragents.workspace.client.execute",
    description: "Eine Operation des Executors auf dem Arbeitsplatz ausführen, etwa ein Werkzeug, eine Dateiabfrage oder die Prozessanzeige; das Ergebnis ist ihr Wert, Fortschritt ihr JSON-Wert. stop gibt frei, was der Arbeitsplatz für den Run hält.",
    implementedBy: "client",
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64, description: "Kennung des Runs" }),
      operation: Type.String({ minLength: 1, maxLength: 64, description: "Name der Operation, etwa read, bash, roslyn_open, files.list oder stop" }),
      toolCallId: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "Nur bei einem Werkzeugaufruf des Modells" })),
      cwd: absolutePath,
      env: Type.Record(Type.String(), Type.String(), { description: "Was der Server beiträgt: Run-Marker und Git-Regeln der Sandbox" }),
      input: Type.Unknown({ description: "Die Eingabe der Operation" }),
    }, { additionalProperties: false }),
    result: Type.Object({ value: Type.Unknown() }, { additionalProperties: false }),
  }),
} as const;

const browseTarget = {
  runId: Type.String({ minLength: 1, maxLength: 64, description: "Kennung des Runs" }),
  root: Type.Union([Type.Literal("workspace"), Type.Literal("files")]),
  path: Type.String({ description: "Pfad unterhalb der Wurzel; leer ist die Wurzel selbst" }),
};

/** Die Anmeldung eines Arbeitsplatzes bindet die aufrufende Verbindung; über sie ruft der Server zurück. */
export const workspaceContracts = {
  browse: {
    list: defineOperation({
      id: "ragents.workspace.browse.list",
      description: "Ein Verzeichnis im Arbeitsverzeichnis oder in der Dateiablage eines Runs auflisten.",
      rights: ["runs.read", "runs.inspect"],
      input: Type.Object(browseTarget, { additionalProperties: false }),
      result: openJson<BrowseListing>("BrowseListing"),
    }),
    preview: defineOperation({
      id: "ragents.workspace.browse.preview",
      description: "Eine Datei als Text vorschauen; zu große und binäre Dateien nennen stattdessen den Grund.",
      rights: ["runs.read", "runs.inspect"],
      input: Type.Object(browseTarget, { additionalProperties: false }),
      result: openJson<BrowsePreview>("BrowsePreview"),
    }),
  },
  channels: {
    browse: defineChannel({
      id: "ragents.workspace.browse",
      description: "Meldet jede Änderung unterhalb der beobachteten Wurzel eines Runs.",
      rights: ["runs.read", "runs.inspect"],
      params: Type.Object({ runId: browseTarget.runId, root: browseTarget.root }, { additionalProperties: false }),
      message: Type.Object({ changed: Type.Literal(true) }, { additionalProperties: false }),
    }),
  },
  clients: {
    list: defineOperation({
      id: "ragents.workspace.clients.list",
      description: "Die angemeldeten Arbeitsplätze des Aufrufers; fremde erscheinen auch mit runs.read.all nicht.",
      rights: ["runs.read"],
      input: Type.Object({}, { additionalProperties: false }),
      result: Type.Array(clientInfoSchema),
    }),
    register: defineOperation({
      id: "ragents.workspace.clients.register",
      description: "Einen Arbeitsplatz anmelden oder seine Ordner erneuern; die Verbindung dieser Anfrage wird sein Rückweg und braucht einen Ereignisstrom.",
      rights: ["runs.write"],
      input: Type.Object({ id: clientId, ...clientDescription, executor: executorVersion }, { additionalProperties: false }),
      result: clientInfoSchema,
    }),
    unregister: defineOperation({
      id: "ragents.workspace.clients.unregister",
      description: "Einen eigenen Arbeitsplatz abmelden; offene Aufträge scheitern.",
      rights: ["runs.write"],
      input: Type.Object({ id: clientId }, { additionalProperties: false }),
      result: Type.Null(),
    }),
  },
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const hasExactly = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

const isMachine = (value: unknown): value is WorkspaceMachine =>
  value === "server" || (isRecord(value) && hasExactly(value, ["client", "label"])
    && typeof value.client === "string" && WORKSPACE_CLIENT_ID_PATTERN.test(value.client) && typeof value.label === "string");

const isFolder = (value: unknown): value is WorkspaceFolder => {
  if (value === "fresh") return true;
  if (!isRecord(value) || typeof value.path !== "string" || value.path.length === 0) return false;
  return hasExactly(value, ["path"]) || (hasExactly(value, ["path", "fresh"]) && value.fresh === true);
};

/** Einen neuen Ordner mit Pfad gibt es nur auf einem Arbeitsplatz; auf dem Server legt ihn der Host selbst an. */
export const isWorkspaceBinding = (value: unknown): value is WorkspaceBinding =>
  isRecord(value) && hasExactly(value, ["machine", "folder"]) && isMachine(value.machine) && isFolder(value.folder)
  && !(value.machine === "server" && typeof value.folder === "object" && "fresh" in value.folder);

export const isFreshFolder = (folder: WorkspaceFolder): folder is "fresh" | FreshWorkstationFolder =>
  folder === "fresh" || "fresh" in folder;

/** Die Form vor der Trennung von Rechner und Ordner, `{ kind: "fresh" | "path" | "client" }`, eindeutig in der heutigen. */
const fromKind = (value: Record<string, unknown>): unknown => {
  switch (value.kind) {
    case "fresh": return hasExactly(value, ["kind"]) ? freshServerBinding() : undefined;
    case "path": return hasExactly(value, ["kind", "path"]) ? { machine: "server", folder: { path: value.path } } : undefined;
    case "client": return hasExactly(value, ["kind", "client", "label", "path"])
      ? { machine: { client: value.client, label: value.label }, folder: { path: value.path } }
      : undefined;
    default: return undefined;
  }
};

/** Die gespeicherte Bindung; ältere, unveränderliche Journale tragen die Form mit `kind`, und nur hier wird sie abgebildet. */
export const storedWorkspaceBinding = (value: unknown): WorkspaceBinding | undefined => {
  if (isWorkspaceBinding(value)) return value;
  const mapped = isRecord(value) && Object.hasOwn(value, "kind") ? fromKind(value) : undefined;
  return isWorkspaceBinding(mapped) ? mapped : undefined;
};

export const FRESH_WORKSPACE_LABEL = "Leerer Ordner je Run";

/** Wie der neue Ordner je Run auf dem Rechner der Bindung heißt; ohne Beitrag dort der leere Ordner. */
const freshLabelOf = (binding: WorkspaceBinding, labels: FreshWorkspaceLabels): string =>
  (binding.machine === "server" ? labels.server : labels.client) ?? FRESH_WORKSPACE_LABEL;

export const workspaceBindingSummary = (binding: WorkspaceBinding, labels: FreshWorkspaceLabels): string => {
  const { machine, folder } = binding;
  const fresh = freshLabelOf(binding, labels);
  const where = folder === "fresh" ? fresh : "fresh" in folder ? `${folder.path} (${fresh})` : folder.path;
  return machine === "server" ? where : `${machine.label}: ${where}`;
};
