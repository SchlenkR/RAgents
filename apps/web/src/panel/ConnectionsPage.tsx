import { FolderIcon, KeyIcon, PencilIcon, PlusIcon, ServerIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button, ConnectionStateIcon } from "../ui";
import { busyState, connectionState, kindLabel, stateDetail } from "./connection-state";
import type { ConnectionView, PanelAction } from "./contract";
import type { PanelPageProps } from "./page-props";
import { ConfirmDialog, ConnectionDialog, LoginDialog } from "./PanelDialogs";
import { PanelHeader } from "./PanelHeader";

const fileNameOf = (address: string): string => address.split(/[/\\]/).pop() ?? address;

/** Ein lokales Profil startet die Erweiterung selbst; nur ein Server per Adresse kennt Verbinden, Trennen und Anmelden. */
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
      <Button aria-label={`Wert für ${missing.variable} setzen und ${connection.name} erneut starten`} disabled={busy}
        onClick={() => send({ action: "setSecret", name: missing.variable, connection: connection.name })} size="xs"><KeyIcon data-icon="inline-start" />Wert setzen</Button>
      <Button disabled={busy} onClick={() => send({ action: "retry", name: connection.name })} size="xs" variant="secondary">Erneut versuchen</Button>
    </>;
  }
  if (state === "login-required" || state === "forbidden") return <Button disabled={busy} onClick={() => onLogin(connection.name)} size="xs" variant="secondary">Anmelden</Button>;
  if (state === "unreachable" || state === "failed") return <Button disabled={busy} onClick={() => send({ action: "retry", name: connection.name })} size="xs" variant="secondary">Erneut versuchen</Button>;
  if (profile) return null;
  if (state === "connected") return <Button disabled={busy} onClick={() => send({ action: "disconnect", name: connection.name })} size="xs" variant="ghost">Trennen</Button>;
  if (state === "stopped") return <Button disabled={busy} onClick={() => send({ action: "connect", name: connection.name })} size="xs" variant="secondary">Verbinden</Button>;
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
  const detail = stateDetail(connection) ?? connection.problem;
  const profile = connection.kind === "profile";
  return <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 border-b border-border-soft px-1 py-2.5 last:border-b-0">
    <span aria-hidden className="grid size-[26px] flex-none place-items-center rounded-md bg-secondary text-muted-foreground">
      {profile ? <FolderIcon className="size-3.5" /> : <ServerIcon className="size-3.5" />}
    </span>
    <span className="min-w-0">
      <span className="flex min-w-0 items-center gap-2">
        <strong className="min-w-0 truncate text-[0.8rem] font-semibold">{connection.name}</strong>
        <span className="flex-none text-[0.6rem] uppercase tracking-[0.05em] text-muted-foreground">{kindLabel(connection)}</span>
        <ConnectionStateIcon className="ml-auto" state={connectionState(connection)} />
      </span>
      <span className="block truncate font-mono text-[0.68rem] text-muted-foreground" title={connection.address}>{profile ? fileNameOf(connection.address) : connection.address}</span>
    </span>
    {detail && <p className="col-span-2 text-[0.7rem] leading-normal text-destructive [overflow-wrap:anywhere]" role="alert">{detail}</p>}
    <span className="col-span-2 flex flex-wrap items-center gap-1.5">
      <RowActions busy={busy} connection={connection} onLogin={onLogin} send={send} />
      {connection.savedLogin && <Button disabled={busy} onClick={() => send({ action: "logout", name: connection.name })} size="xs" variant="ghost">Abmelden</Button>}
      <Button onClick={() => onEdit(connection.name)} size="xs" variant="ghost"><PencilIcon data-icon="inline-start" />Bearbeiten</Button>
      <Button aria-label={`${connection.name} entfernen`} className="ml-auto" onClick={() => onRemove(connection.name)} size="icon-sm" variant="ghost"><Trash2Icon /></Button>
    </span>
  </li>;
}

/** Namen aus ragents.hostEnvironment, zu denen kein Wert gespeichert ist; ohne ihn startet der lokale Host ohne diese Umgebungsvariable. */
function MissingSecrets({ names, send }: { names: readonly string[]; send: (action: PanelAction) => void }) {
  return <section className="grid grid-cols-1 gap-1.5">
    <h2 className="text-[0.66rem] font-bold uppercase tracking-[0.06em] text-muted-foreground">Fehlende Werte</h2>
    <p className="text-[0.7rem] leading-normal text-muted-foreground">
      Zu diesen Namen aus ragents.hostEnvironment liegt kein Wert in der SecretStorage; ein lokal gestarteter Host bekommt die Umgebungsvariable nicht.
    </p>
    <ul className="grid grid-cols-1">
      {names.map((name) => <li className="flex items-center gap-2 border-b border-border-soft px-1 py-2.5 last:border-b-0" key={name}>
        <KeyIcon aria-hidden className="size-3.5 flex-none text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[0.72rem]" title={name}>{name}</span>
        <Button aria-label={`Wert für ${name} setzen`} onClick={() => send({ action: "setSecret", name })} size="xs" variant="secondary">Wert setzen</Button>
      </li>)}
    </ul>
  </section>;
}

/** Die Einrichtung: die Server als Zeilen, dahinter die Dialoge zum Anlegen, Bearbeiten, Anmelden und Entfernen. */
export function ConnectionsPage({ state, send }: PanelPageProps) {
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit"; name: string }>();
  const [login, setLogin] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const editing = dialog?.kind === "edit" ? state.connections.find((connection) => connection.name === dialog.name) : undefined;
  const loginConnection = state.connections.find((connection) => connection.name === login);
  const open = dialog?.kind === "new" || editing !== undefined;
  const missingSecrets = state.missingSecrets ?? [];
  return <div className="grid grid-cols-1 gap-3">
    <PanelHeader send={send} title="Server" />
    {state.problem && <p className="text-[0.8rem] leading-normal text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    <section className="grid grid-cols-1 gap-1.5">
      {state.connections.length === 0
        ? <p className="text-[0.85rem] leading-normal text-muted-foreground">Noch kein Server.</p>
        : <ul className="grid grid-cols-1">
          {state.connections.map((connection) => <ConnectionRow connection={connection} key={connection.name} onEdit={(name) => setDialog({ kind: "edit", name })} onLogin={setLogin} onRemove={setRemoving} send={send} />)}
        </ul>}
    </section>
    {missingSecrets.length > 0 && <MissingSecrets names={missingSecrets} send={send} />}
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => setDialog({ kind: "new" })} size="sm"><PlusIcon data-icon="inline-start" />Neuer Server</Button>
      <Button aria-label="Einstellung öffnen" onClick={() => send({ action: "settingsFile" })} size="sm" title="Einstellung öffnen (settings.json)" variant="ghost"><SettingsIcon data-icon="inline-start" />settings.json</Button>
    </div>
    {open && <ConnectionDialog connection={editing} key={editing?.name ?? "neu"} onClose={() => setDialog(undefined)} send={send} state={state} />}
    {loginConnection && <LoginDialog connection={loginConnection} onClose={() => setLogin(undefined)} send={send} />}
    {removing !== undefined && <ConfirmDialog confirmLabel="Entfernen" onClose={() => setRemoving(undefined)}
      onConfirm={() => { send({ action: "remove", name: removing }); setRemoving(undefined); }} title={`${removing} entfernen?`}>
      Der Server verschwindet aus ragents.connections. Gespeicherte Anmeldedaten gehen dabei verloren. Runs auf dem Server bleiben, wo sie sind.
    </ConfirmDialog>}
  </div>;
}
