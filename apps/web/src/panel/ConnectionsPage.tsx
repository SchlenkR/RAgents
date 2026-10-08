import { FolderIcon, KeyIcon, PencilIcon, PlusIcon, ServerIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { Button, ConnectionStateIcon } from "../ui";
import { SectionHeading } from "../ui/SectionLabel";
import { busyState, connectionState, kindLabel, stateDetail } from "./connection-state";
import type { ConnectionView, PanelAction } from "./contract";
import type { PanelPageProps } from "./page-props";
import { ConfirmDialog, ConnectionDialog, LoginDialog } from "./PanelDialogs";
import { PanelHeader } from "./PanelHeader";

const fileNameOf = (address: string): string => address.split(/[/\\]/).pop() ?? address;

/** The extension starts a local profile itself; only a server by address knows connect, disconnect, and sign-in. */
function RowActions({ connection, busy, send, onLogin }: {
  connection: ConnectionView;
  busy: boolean;
  send: (action: PanelAction) => void;
  onLogin: (name: string) => void;
}) {
  const state = connection.state.kind;
  const profile = connection.kind === "profile";
  const missing = connection.missingEnvironment;
  if (missing) {
    return <>
      <Button aria-label={`Set value for ${missing.variable} and restart ${connection.name}`} disabled={busy}
        onClick={() => send({ action: "setSecret", name: missing.variable, connection: connection.name })} size="xs"><KeyIcon data-icon="inline-start" />Set value</Button>
      <Button disabled={busy} onClick={() => send({ action: "retry", name: connection.name })} size="xs" variant="secondary">Retry</Button>
    </>;
  }
  if (state === "login-required" || state === "forbidden") return <Button disabled={busy} onClick={() => onLogin(connection.name)} size="xs" variant="secondary">Sign in</Button>;
  if (state === "unreachable" || state === "failed") return <Button disabled={busy} onClick={() => send({ action: "retry", name: connection.name })} size="xs" variant="secondary">Retry</Button>;
  if (profile) return null;
  if (state === "connected") return <Button disabled={busy} onClick={() => send({ action: "disconnect", name: connection.name })} size="xs" variant="ghost">Disconnect</Button>;
  if (state === "stopped") return <Button disabled={busy} onClick={() => send({ action: "connect", name: connection.name })} size="xs" variant="secondary">Connect</Button>;
  return null;
}

function ConnectionRow({ connection, send, onEdit, onLogin, onRemove }: {
  connection: ConnectionView;
  send: (action: PanelAction) => void;
  onEdit: (name: string) => void;
  onLogin: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const busy = busyState(connection);
  const progress = connection.state.kind === "starting" ? connection.state.detail : undefined;
  const detail = stateDetail(connection) ?? connection.problem;
  const notice = connection.versionNotice;
  const profile = connection.kind === "profile";
  return <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-b border-border-soft px-1 py-3 last:border-b-0">
    <span aria-hidden className="grid size-[26px] flex-none place-items-center rounded-md bg-secondary text-muted-foreground">
      {profile ? <FolderIcon className="size-3.5" /> : <ServerIcon className="size-3.5" />}
    </span>
    <span className="min-w-0">
      <span className="flex min-w-0 items-center gap-2">
        <strong className="min-w-0 truncate type-item">{connection.name}</strong>
        <span className="flex-none type-caption text-muted-foreground">{kindLabel(connection)}</span>
        <ConnectionStateIcon className="ml-auto" state={connectionState(connection)} />
      </span>
      <span className="block truncate font-mono type-meta text-muted-foreground" title={connection.address}>{profile ? fileNameOf(connection.address) : connection.address}</span>
    </span>
    {progress && <p className="col-span-2 type-body text-muted-foreground [overflow-wrap:anywhere]" role="status">{progress}</p>}
    {detail && <p className="col-span-2 type-body text-destructive [overflow-wrap:anywhere]" role="alert">{detail}</p>}
    {notice && <p className={cn("col-span-2 type-body [overflow-wrap:anywhere]", notice.level === "error" ? "text-destructive" : "text-warning")} data-notice={notice.level} role={notice.level === "error" ? "alert" : "status"}>{notice.text}</p>}
    <span className="col-span-2 flex flex-wrap items-center gap-2">
      <RowActions busy={busy} connection={connection} onLogin={onLogin} send={send} />
      {connection.savedLogin && <Button disabled={busy} onClick={() => send({ action: "logout", name: connection.name })} size="xs" variant="ghost">Sign out</Button>}
      <Button onClick={() => onEdit(connection.name)} size="xs" variant="ghost"><PencilIcon data-icon="inline-start" />Edit</Button>
      <Button aria-label={`Remove ${connection.name}`} className="ml-auto" onClick={() => onRemove(connection.name)} size="icon-sm" variant="ghost"><Trash2Icon /></Button>
    </span>
  </li>;
}

/** Names from ragents.hostEnvironment with no saved value; without it the local host starts without this environment variable. */
function MissingSecrets({ names, send }: { names: readonly string[]; send: (action: PanelAction) => void }) {
  return <section className="grid grid-cols-1 gap-3">
    <SectionHeading title="Missing values" />
    <p className="type-body text-muted-foreground">
      These names from ragents.hostEnvironment have no value in the SecretStorage; a locally started host does not get the environment variable.
    </p>
    <ul className="grid grid-cols-1">
      {names.map((name) => <li className="flex items-center gap-2 border-b border-border-soft px-1 py-3 last:border-b-0" key={name}>
        <KeyIcon aria-hidden className="size-3.5 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono type-body" title={name}>{name}</span>
        <Button aria-label={`Set value for ${name}`} onClick={() => send({ action: "setSecret", name })} size="xs" variant="secondary">Set value</Button>
      </li>)}
    </ul>
  </section>;
}

/** The setup: the servers as rows, behind them the dialogs to create, edit, sign in, and remove. */
export function ConnectionsPage({ state, send }: PanelPageProps) {
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit"; name: string }>();
  const [login, setLogin] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const editing = dialog?.kind === "edit" ? state.connections.find((connection) => connection.name === dialog.name) : undefined;
  const loginConnection = state.connections.find((connection) => connection.name === login);
  const open = dialog?.kind === "new" || editing !== undefined;
  const missingSecrets = state.missingSecrets ?? [];
  return <div className="grid grid-cols-1 gap-8">
    <div className="grid grid-cols-1 gap-3">
      <PanelHeader send={send} title="Server" />
      {state.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
      <section className="grid grid-cols-1 gap-2">
        {state.connections.length === 0
          ? <p className="type-body text-muted-foreground">No server yet.</p>
          : <ul className="grid grid-cols-1">
            {state.connections.map((connection) => <ConnectionRow connection={connection} key={connection.name} onEdit={(name) => setDialog({ kind: "edit", name })} onLogin={setLogin} onRemove={setRemoving} send={send} />)}
          </ul>}
      </section>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDialog({ kind: "new" })} size="sm"><PlusIcon data-icon="inline-start" />New server</Button>
        <Button aria-label="Open setting" onClick={() => send({ action: "settingsFile" })} size="sm" title="Open setting (settings.json)" variant="ghost"><SettingsIcon data-icon="inline-start" />settings.json</Button>
      </div>
    </div>
    {missingSecrets.length > 0 && <MissingSecrets names={missingSecrets} send={send} />}
    {open && <ConnectionDialog connection={editing} key={editing?.name ?? "new"} onClose={() => setDialog(undefined)} send={send} state={state} />}
    {loginConnection && <LoginDialog connection={loginConnection} onClose={() => setLogin(undefined)} send={send} />}
    {removing !== undefined && <ConfirmDialog confirmLabel="Remove" onClose={() => setRemoving(undefined)}
      onConfirm={() => { send({ action: "remove", name: removing }); setRemoving(undefined); }} title={`Remove ${removing}?`}>
      The server is removed from ragents.connections. Saved credentials are lost. Runs on the server stay where they are.
    </ConfirmDialog>}
  </div>;
}
