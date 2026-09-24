import { statSync } from "node:fs";
import path from "node:path";
import { Type } from "typebox";
import { DomainError, type JsonValue, type RunState, type StartOptionContribution } from "@ragents/engine";
import { shellPlatformChapter } from "./shell-platform.js";
import { storedStartOption } from "@ragents/host/ragents/start-option-state.js";
import type { WorkspaceResolver } from "@ragents/host/ragents/workspace-runtime.js";
import {
  freshServerBinding,
  FRESH_WORKSPACE_LABEL,
  isFreshFolder,
  isWorkspaceBinding,
  storedWorkspaceBinding,
  WORKSPACE_BINDING_OPTION_ID,
  workspaceBindingSummary,
  type ExistingWorkspaceFolder,
  type FreshWorkspaceLabels,
  type FreshWorkstationFolder,
  type WorkspaceBinding,
  type WorkspaceBindingPresentation,
  type WorkspaceClientInfo,
  type WorkspaceSessionMetadata,
} from "../contract.js";
import type { WorkspaceClientRegistry } from "./clients.js";

const machineSchema = Type.Union([
  Type.Literal("server"),
  Type.Object({ client: Type.String({ minLength: 8, maxLength: 64 }), label: Type.String() }, { additionalProperties: false }),
]);

const folderSchema = Type.Union([
  Type.Literal("fresh"),
  Type.Object({ path: Type.String({ minLength: 1 }), fresh: Type.Optional(Type.Literal(true)) }, { additionalProperties: false }),
]);

const bindingSchema = Type.Object({ machine: machineSchema, folder: folderSchema }, { additionalProperties: false });

/** Ein Run auf einem Arbeitsplatz mit dessen Kennung, Label und dem Ordner dort; `fresh` trägt dann schon seinen Pfad. */
export type WorkstationBinding = {
  machine: { client: string; label: string };
  folder: ExistingWorkspaceFolder | FreshWorkstationFolder;
};

const insideFolder = (folder: string, candidate: string): boolean => {
  const separator = folder.includes("\\") ? "\\" : "/";
  const root = folder.endsWith(separator) ? folder.slice(0, -separator.length) : folder;
  return candidate === root || candidate.startsWith(root + separator);
};

/** Der Ordner eines Runs unter dem Ordner, in dem ein Arbeitsplatz die neuen Ordner je Run anlegt; mit dessen Trennzeichen. */
export const workstationRunFolder = (runsDirectory: string, runId: string): string => {
  const separator = runsDirectory.includes("\\") ? "\\" : "/";
  const root = runsDirectory.endsWith(separator) ? runsDirectory.slice(0, -separator.length) : runsDirectory;
  return `${root}${separator}${runId}`;
};

/** Die Bindung eines Runs; ohne gespeicherte Wahl der neue Ordner auf dem Server, eine unlesbare sperrt den Run mit Ursache. */
export const bindingOf = (state: RunState | null): WorkspaceBinding => {
  const stored = storedStartOption(state, WORKSPACE_BINDING_OPTION_ID);
  if (stored === undefined) return freshServerBinding();
  const binding = storedWorkspaceBinding(stored);
  if (!binding || (binding.machine !== "server" && binding.folder === "fresh")) {
    throw new Error(`Die gespeicherte Arbeitsbereich-Bindung ist ungültig: ${JSON.stringify(stored)}`);
  }
  return binding;
};

export const isWorkstationBinding = (binding: WorkspaceBinding): binding is WorkstationBinding =>
  binding.machine !== "server" && binding.folder !== "fresh";

/** Ein Run benutzt nur Arbeitsplätze seines Eigentümers, ein Run ohne Eigentümer nur ohne Benutzer angemeldete. */
export const workspaceOwnerOf = (state: RunState | null): string | null => state?.ownerUserId ?? null;

/** Der vorhandene Ordner auf dem Serverrechner, an den der Run gebunden ist; ein neuer Ordner und ein Arbeitsplatz liegen nicht dort. */
export const boundServerDirectory = (state: RunState | null): string | null => {
  const { machine, folder } = bindingOf(state);
  return machine === "server" && folder !== "fresh" ? folder.path : null;
};

/** Ein vorhandener Ordner dieses Servers; dieselbe Prüfung wie beim Wählen der Startoption. */
export const serverDirectoryFolder = (directory: string): ExistingWorkspaceFolder => {
  if (!path.isAbsolute(directory)) throw new DomainError("workspace-path-relative", "Der Ordner muss ein absoluter Pfad sein.", 400);
  const resolved = path.resolve(directory);
  if (!statSync(resolved, { throwIfNoEntry: false })?.isDirectory()) {
    throw new DomainError("workspace-path-missing", `Der Ordner ${resolved} existiert auf dem Server nicht.`, 400);
  }
  return { path: resolved };
};

/** Die Bash eines Runs läuft auf dem Executor seiner Bindung; der Prompt nennt deshalb dessen Plattform, nicht die des Servers. */
export const executorShellChapter = (registry: WorkspaceClientRegistry, owner: string | null, binding: WorkspaceBinding): string => {
  const { machine } = binding;
  if (machine === "server") return shellPlatformChapter(process.platform);
  const client = registry.info(owner, machine.client);
  return client
    ? shellPlatformChapter(client.platform as NodeJS.Platform)
    : `## Shell platform\n\nThe workstation ${machine.label} that holds this project is not registered right now, `
      + "so the platform of its shell is unknown; the workspace tools fail until it connects again.";
};

/** Wo die Wurzel eines Runs liegt, in Worten: bei einem Arbeitsplatz mit dessen Label, sonst der Pfad selbst. */
export const workspaceLocation = (binding: WorkspaceBinding, location: string): string =>
  binding.machine === "server" ? location : `Arbeitsplatz ${binding.machine.label}: ${location}`;

/** Den neuen Ordner je Run stellt der Beitrag, sobald es einen gibt; auf einem Arbeitsplatz nur, wenn er es dort ausdrücklich kann. */
export const freshLabels = (contribution: WorkspaceResolver | undefined): FreshWorkspaceLabels => ({
  server: contribution?.kind?.label ?? FRESH_WORKSPACE_LABEL,
  client: contribution ? contribution.workstation?.label ?? null : FRESH_WORKSPACE_LABEL,
});

export const sessionMetadataOf = (state: RunState | null, contribution: WorkspaceResolver | undefined): WorkspaceSessionMetadata => {
  const binding = bindingOf(state);
  return { binding, summary: workspaceBindingSummary(binding, freshLabels(contribution)) };
};

const unsupported = (message: string): DomainError => new DomainError("workspace-binding-unsupported", message, 400);

/** Ein Arbeitsplatz des Handelnden, der den Ordner anbietet; ein neuer Ordner je Run bekommt dort seinen Pfad unter dessen Ordner für Runs. */
const workstationBinding = (
  client: WorkspaceClientInfo,
  folder: WorkspaceBinding["folder"],
  runId: string,
  labels: FreshWorkspaceLabels,
): WorkstationBinding => {
  const machine = { client: client.id, label: client.label };
  if (isFreshFolder(folder)) {
    if (labels.client === null) {
      throw unsupported(`Einen neuen Ordner je Run gibt es hier nur auf dem Server (${labels.server}); wähle dort einen oder einen vorhandenen Ordner des Arbeitsplatzes.`);
    }
    return { machine, folder: { path: workstationRunFolder(client.runsDirectory, runId), fresh: true } };
  }
  if (!client.folders.some((offered) => insideFolder(offered, folder.path))) {
    throw new DomainError("workspace-client-folder", `Der Arbeitsplatz ${client.label} bietet den Ordner ${folder.path} nicht an.`, 400);
  }
  return { machine, folder: { path: folder.path } };
};

export const workspaceBindingOption = (
  registry: WorkspaceClientRegistry,
  contribution: () => WorkspaceResolver | undefined,
): StartOptionContribution => ({
  id: WORKSPACE_BINDING_OPTION_ID,
  schema: bindingSchema,
  selectable: () => true,
  defaultValue: () => freshServerBinding(),
  accept: (value, { runId, userId }) => {
    if (!isWorkspaceBinding(value)) throw new DomainError("workspace-binding-invalid", "Die Arbeitsbereich-Bindung hat kein gültiges Format.", 400);
    const labels = freshLabels(contribution());
    const { machine, folder } = value;
    if (machine === "server") {
      if (folder === "fresh") return freshServerBinding();
      if ("fresh" in folder) throw new DomainError("workspace-binding-invalid", "Einen neuen Ordner je Run legt auf dem Server der Host an; er hat keinen gewählten Pfad.", 400);
      if (!(contribution()?.kind?.serverFolders ?? true)) {
        throw unsupported(`Ein vorhandener Ordner auf dem Serverrechner ist hier keine Bindung; wähle ${labels.server} oder einen Arbeitsplatz.`);
      }
      return { machine, folder: serverDirectoryFolder(folder.path) };
    }
    const client = registry.info(userId, machine.client);
    if (!client) throw new DomainError("workspace-client-disconnected", `Der Arbeitsplatz ${machine.label || machine.client} ist nicht verbunden.`, 409);
    return workstationBinding(client, folder, runId, labels);
  },
  describe: (_value, { userId }) => {
    const presentation: WorkspaceBindingPresentation = {
      kind: "workspace-binding",
      clients: registry.list(userId),
      fresh: freshLabels(contribution()),
      serverFolders: contribution()?.kind?.serverFolders ?? true,
    };
    return presentation as unknown as JsonValue;
  },
  ownerOnly: (value) => {
    const binding = storedWorkspaceBinding(value);
    return binding !== undefined && binding.machine !== "server";
  },
});
