import { useId, useMemo, useState } from "react";
import { FolderIcon } from "lucide-react";
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ragents/web/ui";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "@ragents/web/Toolbar";
import type {
  SessionMetadataContext,
  StartOptionBadgeContext,
  StartOptionControlContext,
} from "@ragents/web/PluginRegistry";
import {
  FRESH_WORKSPACE_LABEL,
  isFreshFolder,
  isWorkspaceBinding,
  storedWorkspaceBinding,
  workspaceBindingSummary,
  WORKSPACE_METADATA_ID,
  type FreshWorkspaceLabels,
  type WorkspaceBinding,
  type WorkspaceBindingPresentation,
  type WorkspaceClientInfo,
  type WorkspaceSessionMetadata,
} from "../contract";

export interface BindingChoice {
  value: string;
  label: string;
}

type FolderChoice = "fresh" | "existing";

const SERVER = "server";

const errorClass = "text-[0.75rem] text-destructive";

const labelClass = "text-[0.66rem] font-medium text-muted-foreground";

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const isClientInfo = (value: unknown): value is WorkspaceClientInfo => {
  const raw = value as Record<string, unknown> | null;
  return typeof raw === "object" && raw !== null
    && typeof raw.id === "string" && typeof raw.label === "string"
    && typeof raw.hostname === "string" && typeof raw.platform === "string"
    && Array.isArray(raw.folders) && raw.folders.every((folder) => typeof folder === "string")
    && typeof raw.runsDirectory === "string";
};

const isFreshLabels = (value: unknown): value is FreshWorkspaceLabels => {
  const raw = value as Record<string, unknown> | null;
  return typeof raw === "object" && raw !== null && typeof raw.server === "string"
    && (raw.client === null || typeof raw.client === "string");
};

const presentationFrom = (presentation: unknown, optionId: string): WorkspaceBindingPresentation => {
  const raw = presentation as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || raw.kind !== "workspace-binding"
    || !Array.isArray(raw.clients) || !raw.clients.every(isClientInfo)
    || !isFreshLabels(raw.fresh) || typeof raw.serverFolders !== "boolean") {
    throw new Error(`Die Startoption ${optionId} liefert keine Arbeitsbereich-Darstellung`);
  }
  return { kind: "workspace-binding", clients: raw.clients, fresh: raw.fresh, serverFolders: raw.serverFolders };
};

/** Auch ein eingefrorener Wert aus einem älteren Journal; dieselbe Abbildung wie auf dem Server. */
const bindingFrom = (value: unknown, optionId: string): WorkspaceBinding => {
  const binding = storedWorkspaceBinding(value);
  if (!binding) throw new Error(`Der Wert der Startoption ${optionId} ist keine Arbeitsbereich-Bindung`);
  return binding;
};

const machineOf = (binding: WorkspaceBinding): string => binding.machine === SERVER ? SERVER : binding.machine.client;

const folderOf = (binding: WorkspaceBinding): FolderChoice => isFreshFolder(binding.folder) ? "fresh" : "existing";

const pathOf = (binding: WorkspaceBinding): string => {
  const { folder } = binding;
  return isFreshFolder(folder) ? "" : folder.path;
};

/** Ein neuer Ordner auf einem Arbeitsplatz ist dieselbe Wahl, ob schon mit Pfad eingefroren oder nicht. */
const sameBinding = (left: WorkspaceBinding, right: WorkspaceBinding): boolean =>
  machineOf(left) === machineOf(right) && folderOf(left) === folderOf(right) && pathOf(left) === pathOf(right);

export const workspaceMachineChoices = (
  presentation: WorkspaceBindingPresentation,
  binding: WorkspaceBinding,
): BindingChoice[] => {
  const { machine } = binding;
  const clients = presentation.clients;
  const lost = machine !== SERVER && !clients.some((client) => client.id === machine.client)
    ? [{ value: machine.client, label: `Arbeitsplatz ${machine.label} (nicht verbunden)` }]
    : [];
  return [
    { value: SERVER, label: "Server" },
    ...clients.map((client) => ({ value: client.id, label: `Arbeitsplatz ${client.label}` })),
    ...lost,
  ];
};

/** Auf dem Server gibt es den neuen Ordner immer, einen vorhandenen nur ohne Beitrag, der ihn ausschließt; auf einem Arbeitsplatz umgekehrt. */
export const workspaceFolderChoices = (presentation: WorkspaceBindingPresentation, machine: string): BindingChoice[] => {
  const existing = { value: "existing", label: "Vorhandener Ordner" };
  if (machine === SERVER) {
    return [{ value: "fresh", label: presentation.fresh.server }, ...(presentation.serverFolders ? [existing] : [])];
  }
  return [...(presentation.fresh.client === null ? [] : [{ value: "fresh", label: presentation.fresh.client }]), existing];
};

export const workspaceMetadataFrom = (value: unknown): WorkspaceSessionMetadata | undefined => {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || typeof raw.summary !== "string" || !isWorkspaceBinding(raw.binding)) {
    return undefined;
  }
  return { binding: raw.binding, summary: raw.summary };
};

const parse = (option: StartOptionControlContext["option"]) => {
  try {
    return {
      presentation: presentationFrom(option.presentation, option.id),
      binding: bindingFrom(option.value, option.id),
    };
  } catch (cause) {
    return { message: messageOf(cause) };
  }
};

export function WorkspaceBindingControl({ disabled, error, option, setValue }: StartOptionControlContext) {
  const [machineDraft, setMachine] = useState<string | undefined>(undefined);
  const [folderDraft, setFolder] = useState<FolderChoice | undefined>(undefined);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const pathId = useId();
  const parsed = useMemo(() => parse(option), [option]);
  if ("message" in parsed) return <p className={errorClass} role="alert">{parsed.message}</p>;
  const { presentation, binding } = parsed;

  const machine = machineDraft ?? machineOf(binding);
  const folder = folderDraft ?? folderOf(binding);
  const path = draft ?? pathOf(binding);
  const machines = workspaceMachineChoices(presentation, binding);
  const folderChoices = workspaceFolderChoices(presentation, machine);
  const client = presentation.clients.find((entry) => entry.id === machine);
  const offered = folder === "existing" ? client?.folders.map((entry) => ({ value: entry, label: entry })) ?? [] : [];

  const bindingOf = (nextMachine: string, nextFolder: FolderChoice, nextPath: string): WorkspaceBinding | undefined => {
    const label = presentation.clients.find((entry) => entry.id === nextMachine)?.label
      ?? (binding.machine !== SERVER && binding.machine.client === nextMachine ? binding.machine.label : nextMachine);
    const where = nextMachine === SERVER ? SERVER : { client: nextMachine, label };
    if (nextFolder === "fresh") return { machine: where, folder: "fresh" };
    return nextPath === "" ? undefined : { machine: where, folder: { path: nextPath } };
  };

  const commit = (nextMachine: string, nextFolder: FolderChoice, nextPath: string) => {
    const next = bindingOf(nextMachine, nextFolder, nextPath);
    if (next && !sameBinding(next, binding)) void setValue(next);
  };

  const chooseMachine = (next: string) => {
    const available = workspaceFolderChoices(presentation, next).map((choice) => choice.value as FolderChoice);
    const nextFolder = available.includes(folder) ? folder : available[0]!;
    const nextPath = path === "" ? presentation.clients.find((entry) => entry.id === next)?.folders[0] ?? "" : path;
    setMachine(next);
    setFolder(nextFolder);
    setDraft(nextPath);
    commit(next, nextFolder, nextPath);
  };

  const chooseFolder = (next: FolderChoice) => {
    const nextPath = path === "" ? client?.folders[0] ?? "" : path;
    setFolder(next);
    setDraft(nextPath);
    commit(machine, next, nextPath);
  };

  const chooseOffered = (next: string) => {
    setDraft(next);
    commit(machine, folder, next);
  };

  return (
    <div className="flex w-full flex-col items-start gap-2">
      <span className="text-[0.72rem] font-semibold text-muted-foreground">Arbeitsbereich</span>
      <div className="flex w-full flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <span className={labelClass}>Rechner</span>
          <Select disabled={disabled} items={machines} onValueChange={(next) => { if (next !== null) chooseMachine(next); }} value={machine}>
            <SelectTrigger aria-label="Rechner des Arbeitsbereichs" className="min-w-0 max-w-full" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>{machines.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <span className={labelClass}>Ordner</span>
          <Select disabled={disabled} items={folderChoices} onValueChange={(next) => { if (next !== null) chooseFolder(next as FolderChoice); }} value={folder}>
            <SelectTrigger aria-label="Ordner des Arbeitsbereichs" className="min-w-0 max-w-full" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>{folderChoices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {folder === "existing" && (
          <div className="flex min-w-[15rem] flex-1 flex-col gap-1">
            <Label className={labelClass} htmlFor={pathId}>Absoluter Pfad</Label>
            <Input
              className="h-7 text-sm"
              disabled={disabled}
              id={pathId}
              onBlur={() => commit(machine, folder, path)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") commit(machine, folder, path); }}
              placeholder="/Users/name/projekt"
              value={path}
            />
          </div>
        )}
        {offered.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Angebotener Ordner</span>
            <Select disabled={disabled} items={offered} onValueChange={(next) => { if (next !== null) chooseOffered(next); }} value={offered.some((entry) => entry.value === path) ? path : null}>
              <SelectTrigger aria-label="Angebotener Ordner" className="min-w-0 max-w-full" size="sm"><SelectValue placeholder="Übernehmen" /></SelectTrigger>
              <SelectContent>{offered.map((entry) => <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </div>
      {error && <p className={errorClass} role="alert">{error}</p>}
    </div>
  );
}

const freshLabelsOf = (presentation: unknown): FreshWorkspaceLabels => {
  const raw = presentation as Record<string, unknown> | null;
  return typeof raw === "object" && raw !== null && isFreshLabels(raw.fresh) ? raw.fresh : { server: FRESH_WORKSPACE_LABEL, client: FRESH_WORKSPACE_LABEL };
};

export function WorkspaceBindingBadge({ option }: StartOptionBadgeContext) {
  if (!option.locked) return null;
  let binding: WorkspaceBinding;
  try {
    binding = bindingFrom(option.value, option.id);
  } catch (cause) {
    return <ToolbarItem title={messageOf(cause)}><ToolbarText>Arbeitsbereich unlesbar</ToolbarText></ToolbarItem>;
  }
  const summary = workspaceBindingSummary(binding, freshLabelsOf(option.presentation));
  return (
    <ToolbarItem title={`Arbeitsbereich: ${summary}`}>
      <ToolbarCopy><ToolbarLabel>Arbeitsbereich</ToolbarLabel><ToolbarText>{summary}</ToolbarText></ToolbarCopy>
    </ToolbarItem>
  );
}

export function WorkspaceMetadata({ placement, session }: SessionMetadataContext) {
  const metadata = workspaceMetadataFrom(session.metadata?.[WORKSPACE_METADATA_ID]);
  if (!metadata) return null;
  if (placement === "list") {
    const { machine, folder } = metadata.binding;
    if (machine === "server" && folder === "fresh") return null;
    return (
      <span className="flex max-w-full items-center gap-1.5 overflow-hidden pl-px text-xs text-muted-foreground" title={`Arbeitsbereich: ${metadata.summary}`}>
        <FolderIcon aria-hidden className="size-3 flex-none" />
        <span className="truncate">{metadata.summary}</span>
      </span>
    );
  }
  return (
    <ToolbarItem title={`Arbeitsbereich: ${metadata.summary}`}>
      <FolderIcon aria-hidden className="size-3.5" />
      <ToolbarCopy><ToolbarLabel>Arbeitsbereich</ToolbarLabel><ToolbarText>{metadata.summary}</ToolbarText></ToolbarCopy>
    </ToolbarItem>
  );
}
