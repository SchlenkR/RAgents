import { Type } from "typebox";
import { openJson } from "@aicontainer/ragents/src/http/contracts";
import { defineChannel, defineOperation } from "@aicontainer/ragents/src/rpc/contract";

export const WORKSPACE_PLUGIN_ID = "ragents.workspace";

export const BROWSE_ROOTS = ["workspace", "files"] as const;
export type BrowseRoot = typeof BROWSE_ROOTS[number];

export const BROWSE_ENTRY_LIMIT = 500;
export const BROWSE_PREVIEW_LIMIT = 256 * 1024;

export interface BrowseEntry {
  name: string;
  kind: "directory" | "file";
  size: number;
  modifiedAt: string;
}

export interface BrowseListing {
  root: BrowseRoot;
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
  connected: boolean;
  sameMachine: boolean;
}

export interface WorkspaceBindingPresentation {
  kind: "workspace-binding";
  clients: WorkspaceClientInfo[];
}

export interface WorkspaceSessionMetadata {
  binding: WorkspaceBinding;
  summary: string;
}

const clientId = Type.String({ pattern: "^[A-Za-z0-9_-]{8,64}$", description: "Stabile Kennung des Arbeitsplatzes" });

const clientDescription = {
  label: Type.String({ minLength: 1, maxLength: 120 }),
  hostname: Type.String({ minLength: 1 }),
  platform: Type.String({ minLength: 1 }),
  folders: Type.Array(Type.String({ minLength: 1 }), { maxItems: 32 }),
};

export const clientInfoSchema = Type.Object({
  id: Type.String(),
  ...clientDescription,
  connected: Type.Boolean(),
  sameMachine: Type.Boolean(),
}, { additionalProperties: false });

const absolutePath = Type.String({ minLength: 1, description: "Absoluter Pfad im gebundenen Ordner" });

/** Der Server ruft diese Operationen auf dem Arbeitsplatz; exec meldet Ausgabe als Fortschritt mit { base64 }. */
export const workspaceClientContracts = {
  readFile: defineOperation({
    id: "ragents.workspace.client.readFile",
    description: "Eine Datei des Arbeitsplatzes lesen; der Inhalt kommt als Base64.",
    implementedBy: "client",
    input: Type.Object({ path: absolutePath }, { additionalProperties: false }),
    result: Type.Object({ base64: Type.String() }, { additionalProperties: false }),
  }),
  writeFile: defineOperation({
    id: "ragents.workspace.client.writeFile",
    description: "Eine Datei des Arbeitsplatzes schreiben (UTF-8).",
    implementedBy: "client",
    input: Type.Object({ path: absolutePath, content: Type.String() }, { additionalProperties: false }),
    result: Type.Null(),
  }),
  access: defineOperation({
    id: "ragents.workspace.client.access",
    description: "Prüfen, ob eine Datei lesbar oder schreibbar ist; scheitert mit Ursache.",
    implementedBy: "client",
    input: Type.Object({ path: absolutePath, mode: Type.Union([Type.Literal("read"), Type.Literal("write")]) }, { additionalProperties: false }),
    result: Type.Null(),
  }),
  mkdir: defineOperation({
    id: "ragents.workspace.client.mkdir",
    description: "Ein Verzeichnis samt Eltern anlegen.",
    implementedBy: "client",
    input: Type.Object({ path: absolutePath }, { additionalProperties: false }),
    result: Type.Null(),
  }),
  exec: defineOperation({
    id: "ragents.workspace.client.exec",
    description: "Einen Befehl in /bin/bash ausführen; Ausgabe kommt als Fortschritt { base64 }, das Ergebnis ist der Exit-Code, null bei Abbruch.",
    implementedBy: "client",
    input: Type.Object({
      command: Type.String(),
      cwd: absolutePath,
      env: Type.Record(Type.String(), Type.String()),
      timeoutSeconds: Type.Number({ minimum: 1 }),
    }, { additionalProperties: false }),
    result: Type.Object({ exitCode: Type.Union([Type.Integer(), Type.Null()]) }, { additionalProperties: false }),
  }),
} as const;

export const workspaceClientOutputSchema = Type.Object({ base64: Type.String() }, { additionalProperties: false });

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
      description: "Angemeldete Arbeitsplätze mit Verbindungsstand.",
      rights: ["runs.read"],
      input: Type.Object({}, { additionalProperties: false }),
      result: Type.Array(clientInfoSchema),
    }),
    register: defineOperation({
      id: "ragents.workspace.clients.register",
      description: "Einen Arbeitsplatz anmelden oder seine Ordner erneuern; die Verbindung dieser Anfrage wird sein Rückweg und braucht einen Ereignisstrom.",
      rights: ["runs.write"],
      input: Type.Object({ id: clientId, ...clientDescription }, { additionalProperties: false }),
      result: clientInfoSchema,
    }),
    unregister: defineOperation({
      id: "ragents.workspace.clients.unregister",
      description: "Einen Arbeitsplatz abmelden; offene Aufträge scheitern.",
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

export const workspaceBindingSummary = (binding: WorkspaceBinding): string => {
  switch (binding.kind) {
    case "fresh": return "Leerer Ordner je Run";
    case "path": return binding.path;
    case "client": return `${binding.label}: ${binding.path}`;
  }
};
