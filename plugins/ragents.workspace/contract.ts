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

/** Wo der Arbeitsbereich eines Runs liegt; wird beim Start als Startoption ins Journal eingefroren. */
export type WorkspaceBinding =
  | { kind: "fresh" }
  | { kind: "path"; path: string }
  | { kind: "client"; client: string; label: string; path: string };

export const WORKSPACE_BINDING_KINDS = ["fresh", "path", "client"] as const;

export const WORKSPACE_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** Was ein Arbeitsplatz bei der Anmeldung über sich sagt. */
export interface WorkspaceClientDescription {
  label: string;
  hostname: string;
  platform: string;
  folders: string[];
}

export interface WorkspaceClientInfo extends WorkspaceClientDescription {
  id: string;
}

export interface WorkspaceBindingPresentation {
  kind: "workspace-binding";
  clients: WorkspaceClientInfo[];
  /** Wie der Arbeitsbereich je Run heißt: der leere Ordner oder der Beitrag eines Plugins. */
  freshLabel: string;
  /** Ob ein Ordner des Serverrechners gebunden werden darf. */
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

export const isWorkspaceBinding = (value: unknown): value is WorkspaceBinding => {
  if (typeof value !== "object" || value === null) return false;
  const raw = value as Record<string, unknown>;
  if (raw.kind === "fresh") return true;
  if (raw.kind === "path") return typeof raw.path === "string" && raw.path.length > 0;
  if (raw.kind === "client") {
    return typeof raw.client === "string" && WORKSPACE_CLIENT_ID_PATTERN.test(raw.client)
      && typeof raw.label === "string" && typeof raw.path === "string" && raw.path.length > 0;
  }
  return false;
};

export const FRESH_WORKSPACE_LABEL = "Leerer Ordner je Run";

export const workspaceBindingSummary = (binding: WorkspaceBinding, freshLabel = FRESH_WORKSPACE_LABEL): string => {
  switch (binding.kind) {
    case "fresh": return freshLabel;
    case "path": return binding.path;
    case "client": return `${binding.label}: ${binding.path}`;
  }
};
