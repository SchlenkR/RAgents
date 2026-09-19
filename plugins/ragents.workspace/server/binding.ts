import { statSync } from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { DomainError, type JsonValue, type RunState, type StartOptionContribution } from "@aicontainer/ragents";
import { storedStartOption } from "@aicontainer/server/ragents/start-option-state.js";
import {
  isWorkspaceBinding,
  WORKSPACE_BINDING_OPTION_ID,
  workspaceBindingSummary,
  type WorkspaceBinding,
  type WorkspaceBindingPresentation,
  type WorkspaceSessionMetadata,
} from "../contract.js";
import type { WorkspaceClientRegistry } from "./clients.js";

const bindingSchema = Type.Union([
  Type.Object({ kind: Type.Literal("fresh") }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal("path"), path: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  Type.Object({
    kind: Type.Literal("client"),
    client: Type.String({ minLength: 8, maxLength: 64 }),
    label: Type.String(),
    path: Type.String({ minLength: 1 }),
  }, { additionalProperties: false }),
]);

const insideFolder = (folder: string, candidate: string): boolean => {
  const separator = folder.includes("\\") ? "\\" : "/";
  const root = folder.endsWith(separator) ? folder.slice(0, -separator.length) : folder;
  return candidate === root || candidate.startsWith(root + separator);
};

export const bindingOf = (state: RunState | null): WorkspaceBinding => {
  const stored = storedStartOption(state, WORKSPACE_BINDING_OPTION_ID);
  if (stored === undefined) return { kind: "fresh" };
  if (!isWorkspaceBinding(stored)) throw new Error(`Die gespeicherte Arbeitsbereich-Bindung ist ungültig: ${JSON.stringify(stored)}`);
  return stored;
};

export const sessionMetadataOf = (state: RunState | null): WorkspaceSessionMetadata => {
  const binding = bindingOf(state);
  return { binding, summary: workspaceBindingSummary(binding) };
};

export const workspaceBindingOption = (registry: WorkspaceClientRegistry): StartOptionContribution => ({
  id: WORKSPACE_BINDING_OPTION_ID,
  schema: bindingSchema,
  selectable: () => true,
  defaultValue: () => ({ kind: "fresh" }),
  accept: (value) => {
    if (!isWorkspaceBinding(value)) throw new DomainError("workspace-binding-invalid", "Die Arbeitsbereich-Bindung hat kein gültiges Format.", 400);
    if (value.kind === "fresh") return { kind: "fresh" };
    if (value.kind === "path") {
      if (!path.isAbsolute(value.path)) throw new DomainError("workspace-path-relative", "Der Ordner muss ein absoluter Pfad sein.", 400);
      const resolved = path.resolve(value.path);
      if (!statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
        throw new DomainError("workspace-path-missing", `Der Ordner ${resolved} existiert auf dem Server nicht.`, 400);
      }
      return { kind: "path", path: resolved };
    }
    const client = registry.info(value.client);
    if (!client?.connected) throw new DomainError("workspace-client-disconnected", `Der Arbeitsplatz ${value.label || value.client} ist nicht verbunden.`, 409);
    if (!client.folders.some((folder) => insideFolder(folder, value.path))) {
      throw new DomainError("workspace-client-folder", `Der Arbeitsplatz ${client.label} bietet den Ordner ${value.path} nicht an.`, 400);
    }
    return { kind: "client", client: client.id, label: client.label, path: value.path };
  },
  describe: () => {
    const presentation: WorkspaceBindingPresentation = { kind: "workspace-binding", clients: registry.connected() };
    return presentation as unknown as JsonValue;
  },
});
