import { statSync } from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { DomainError, type JsonValue, type RunState, type StartOptionContribution } from "@ragents/engine";
import { shellPlatformChapter } from "./shell-platform.js";
import { storedStartOption } from "@ragents/host/ragents/start-option-state.js";
import type { WorkspaceKind } from "@ragents/host/ragents/workspace-runtime.js";
import {
  FRESH_WORKSPACE_LABEL,
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

/** Ein Run benutzt nur Arbeitsplätze seines Eigentümers, ein Run ohne Eigentümer nur ohne Benutzer angemeldete. */
export const workspaceOwnerOf = (state: RunState | null): string | null => state?.ownerUserId ?? null;

/** Der Ordner auf dem Serverrechner, an den der Run gebunden ist; `fresh` und `client` liegen nicht dort. */
export const boundServerDirectory = (state: RunState | null): string | null => {
  const binding = bindingOf(state);
  return binding.kind === "path" ? binding.path : null;
};

/** Ein vorhandener Ordner dieses Servers als Bindung; dieselbe Prüfung wie beim Wählen der Startoption. */
export const serverDirectoryBinding = (directory: string): Extract<WorkspaceBinding, { kind: "path" }> => {
  if (!path.isAbsolute(directory)) throw new DomainError("workspace-path-relative", "Der Ordner muss ein absoluter Pfad sein.", 400);
  const resolved = path.resolve(directory);
  if (!statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    throw new DomainError("workspace-path-missing", `Der Ordner ${resolved} existiert auf dem Server nicht.`, 400);
  }
  return { kind: "path", path: resolved };
};

/** Die Bash eines Runs läuft auf dem Executor seiner Bindung; der Prompt nennt deshalb dessen Plattform, nicht die des Servers. */
export const executorShellChapter = (registry: WorkspaceClientRegistry, owner: string | null, binding: WorkspaceBinding): string => {
  if (binding.kind !== "client") return shellPlatformChapter(process.platform);
  const client = registry.info(owner, binding.client);
  return client
    ? shellPlatformChapter(client.platform as NodeJS.Platform)
    : `## Shell platform\n\nThe workstation ${binding.label} that holds this project is not registered right now, `
      + "so the platform of its shell is unknown; the workspace tools fail until it connects again.";
};

/** Wo die Wurzel eines Runs liegt, in Worten: bei einem Arbeitsplatz mit dessen Label, sonst der Pfad selbst. */
export const workspaceLocation = (binding: WorkspaceBinding, location: string): string =>
  binding.kind === "client" ? `Arbeitsplatz ${binding.label}: ${location}` : location;

export const sessionMetadataOf = (state: RunState | null, kind?: WorkspaceKind): WorkspaceSessionMetadata => {
  const binding = bindingOf(state);
  return { binding, summary: workspaceBindingSummary(binding, kind?.label) };
};

/** Die Art `fresh` gehört dem Beitrag, sobald einer den Arbeitsbereich stellt; er entscheidet auch über Ordner des Servers. */
export const workspaceBindingOption = (
  registry: WorkspaceClientRegistry,
  kind: () => WorkspaceKind | undefined,
): StartOptionContribution => ({
  id: WORKSPACE_BINDING_OPTION_ID,
  schema: bindingSchema,
  selectable: () => true,
  defaultValue: () => ({ kind: "fresh" }),
  accept: (value, { userId }) => {
    if (!isWorkspaceBinding(value)) throw new DomainError("workspace-binding-invalid", "Die Arbeitsbereich-Bindung hat kein gültiges Format.", 400);
    if (value.kind === "fresh") return { kind: "fresh" };
    if (value.kind === "path" && !(kind()?.serverFolders ?? true)) {
      throw new DomainError(
        "workspace-binding-unsupported",
        `Ein Ordner auf dem Serverrechner ist hier keine Bindung; wähle ${kind()?.label ?? FRESH_WORKSPACE_LABEL} oder einen Arbeitsplatz.`,
        400,
      );
    }
    if (value.kind === "path") return serverDirectoryBinding(value.path);
    const client = registry.info(userId, value.client);
    if (!client) throw new DomainError("workspace-client-disconnected", `Der Arbeitsplatz ${value.label || value.client} ist nicht verbunden.`, 409);
    if (!client.folders.some((folder) => insideFolder(folder, value.path))) {
      throw new DomainError("workspace-client-folder", `Der Arbeitsplatz ${client.label} bietet den Ordner ${value.path} nicht an.`, 400);
    }
    return { kind: "client", client: client.id, label: client.label, path: value.path };
  },
  describe: (_value, { userId }) => {
    const presentation: WorkspaceBindingPresentation = {
      kind: "workspace-binding",
      clients: registry.list(userId),
      freshLabel: kind()?.label ?? FRESH_WORKSPACE_LABEL,
      serverFolders: kind()?.serverFolders ?? true,
    };
    return presentation as unknown as JsonValue;
  },
  ownerOnly: (value) => isWorkspaceBinding(value) && value.kind === "client",
});
