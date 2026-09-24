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
  isWorkspaceBinding,
  workspaceBindingSummary,
  WORKSPACE_METADATA_ID,
  type WorkspaceBinding,
  type WorkspaceBindingPresentation,
  type WorkspaceClientInfo,
  type WorkspaceSessionMetadata,
} from "../contract";

export interface BindingChoice {
  value: string;
  label: string;
}

const errorClass = "text-[0.75rem] text-destructive";

const labelClass = "text-[0.66rem] font-medium text-muted-foreground";

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const isClientInfo = (value: unknown): value is WorkspaceClientInfo => {
  const raw = value as Record<string, unknown> | null;
  return typeof raw === "object" && raw !== null
    && typeof raw.id === "string" && typeof raw.label === "string"
    && typeof raw.hostname === "string" && typeof raw.platform === "string"
    && Array.isArray(raw.folders) && raw.folders.every((folder) => typeof folder === "string");
};

const presentationFrom = (presentation: unknown, optionId: string): WorkspaceBindingPresentation => {
  const raw = presentation as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || raw.kind !== "workspace-binding"
    || !Array.isArray(raw.clients) || !raw.clients.every(isClientInfo)
    || typeof raw.freshLabel !== "string" || typeof raw.serverFolders !== "boolean") {
    throw new Error(`Die Startoption ${optionId} liefert keine Arbeitsbereich-Darstellung`);
  }
  return { kind: "workspace-binding", clients: raw.clients, freshLabel: raw.freshLabel, serverFolders: raw.serverFolders };
};

const bindingFrom = (value: unknown, optionId: string): WorkspaceBinding => {
  if (!isWorkspaceBinding(value)) {
    throw new Error(`Der Wert der Startoption ${optionId} ist keine Arbeitsbereich-Bindung`);
  }
  return value;
};

const selectionOf = (binding: WorkspaceBinding): string => binding.kind === "client" ? binding.client : binding.kind;

const pathOf = (binding: WorkspaceBinding): string => binding.kind === "fresh" ? "" : binding.path;

const sameBinding = (left: WorkspaceBinding, right: WorkspaceBinding): boolean => {
  if (left.kind === "fresh") return right.kind === "fresh";
  if (left.kind === "path") return right.kind === "path" && right.path === left.path;
  return right.kind === "client" && right.client === left.client
    && right.label === left.label && right.path === left.path;
};

export const workspaceBindingChoices = (
  presentation: WorkspaceBindingPresentation,
  binding: WorkspaceBinding,
): BindingChoice[] => {
  const clients = presentation.clients;
  const lost = binding.kind === "client" && !clients.some((client) => client.id === binding.client)
    ? [{ value: binding.client, label: `Arbeitsplatz ${binding.label} (nicht verbunden)` }]
    : [];
  return [
    { value: "fresh", label: presentation.freshLabel },
    ...(presentation.serverFolders ? [{ value: "path", label: "Ordner auf dem Server" }] : []),
    ...clients.map((client) => ({ value: client.id, label: `Arbeitsplatz ${client.label}` })),
    ...lost,
  ];
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
  const [selection, setSelection] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const pathId = useId();
  const parsed = useMemo(() => parse(option), [option]);
  if ("message" in parsed) return <p className={errorClass} role="alert">{parsed.message}</p>;
  const { presentation, binding } = parsed;

  const choices = workspaceBindingChoices(presentation, binding);
  const kind = selection ?? selectionOf(binding);
  const path = draft ?? pathOf(binding);
  const client = presentation.clients.find((entry) => entry.id === kind);
  const folders = client?.folders.map((folder) => ({ value: folder, label: folder })) ?? [];

  const bindingOf = (nextKind: string, nextPath: string): WorkspaceBinding | undefined => {
    if (nextKind === "fresh") return { kind: "fresh" };
    if (nextPath === "") return undefined;
    if (nextKind === "path") return { kind: "path", path: nextPath };
    const label = presentation.clients.find((entry) => entry.id === nextKind)?.label
      ?? (binding.kind === "client" && binding.client === nextKind ? binding.label : nextKind);
    return { kind: "client", client: nextKind, label, path: nextPath };
  };

  const commit = (nextKind: string, nextPath: string) => {
    const next = bindingOf(nextKind, nextPath);
    if (next && !sameBinding(next, binding)) void setValue(next);
  };

  const chooseKind = (next: string) => {
    const offered = presentation.clients.find((entry) => entry.id === next)?.folders[0] ?? "";
    const nextPath = path === "" ? offered : path;
    setSelection(next);
    setDraft(nextPath);
    commit(next, nextPath);
  };

  const chooseFolder = (folder: string) => {
    setDraft(folder);
    commit(kind, folder);
  };

  return (
    <div className="flex w-full flex-col items-start gap-2">
      <span className="text-[0.72rem] font-semibold text-muted-foreground">Arbeitsbereich</span>
      <div className="flex w-full flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <span className={labelClass}>Art</span>
          <Select disabled={disabled} items={choices} onValueChange={(next) => { if (next !== null) chooseKind(next); }} value={kind}>
            <SelectTrigger aria-label="Art des Arbeitsbereichs" className="min-w-0 max-w-full" size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>{choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {kind !== "fresh" && (
          <div className="flex min-w-[15rem] flex-1 flex-col gap-1">
            <Label className={labelClass} htmlFor={pathId}>Absoluter Pfad</Label>
            <Input
              className="h-7 text-sm"
              disabled={disabled}
              id={pathId}
              onBlur={() => commit(kind, path)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") commit(kind, path); }}
              placeholder="/Users/name/projekt"
              value={path}
            />
          </div>
        )}
        {folders.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className={labelClass}>Angebotener Ordner</span>
            <Select disabled={disabled} items={folders} onValueChange={(folder) => { if (folder !== null) chooseFolder(folder); }} value={folders.some((folder) => folder.value === path) ? path : null}>
              <SelectTrigger aria-label="Angebotener Ordner" className="min-w-0 max-w-full" size="sm"><SelectValue placeholder="Übernehmen" /></SelectTrigger>
              <SelectContent>{folders.map((folder) => <SelectItem key={folder.value} value={folder.value}>{folder.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
      </div>
      {error && <p className={errorClass} role="alert">{error}</p>}
    </div>
  );
}

const freshLabelOf = (presentation: unknown): string => {
  const raw = presentation as Record<string, unknown> | null;
  return typeof raw === "object" && raw !== null && typeof raw.freshLabel === "string" ? raw.freshLabel : FRESH_WORKSPACE_LABEL;
};

export function WorkspaceBindingBadge({ option }: StartOptionBadgeContext) {
  if (!option.locked) return null;
  let binding: WorkspaceBinding;
  try {
    binding = bindingFrom(option.value, option.id);
  } catch (cause) {
    return <ToolbarItem title={messageOf(cause)}><ToolbarText>Arbeitsbereich unlesbar</ToolbarText></ToolbarItem>;
  }
  const summary = workspaceBindingSummary(binding, freshLabelOf(option.presentation));
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
    if (metadata.binding.kind === "fresh") return null;
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
