import { FolderIcon, KeyIcon, PencilIcon, PlusIcon, ServerIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Button, EnvironmentStateIcon } from "../ui";
import type { PanelAction, TargetView } from "./contract";
import type { PanelPageProps } from "./page-props";
import { ConfirmDialog, LoginDialog, TargetDialog } from "./PanelDialogs";
import { PanelHeader } from "./PanelHeader";
import { busyState, environmentState, kindLabel, stateDetail } from "./target-state";

const fileNameOf = (address: string): string => address.split(/[/\\]/).pop() ?? address;

/** Ein lokales Profil startet die Erweiterung selbst; nur ein Server kennt Verbinden, Trennen und Anmelden. */
function RowActions({ target, busy, send, onLogin }: {
  target: TargetView;
  busy: boolean;
  send: (action: PanelAction) => void;
  onLogin: (name: string) => void;
}) {
  const state = target.state.kind;
  const profile = target.kind === "profile";
  const missing = target.missingEnvironment;
  if (missing) {
    return <>
      <Button aria-label={`Wert für ${missing.variable} setzen und ${target.name} erneut starten`} disabled={busy}
        onClick={() => send({ action: "setSecret", name: missing.variable, environment: target.name })} size="xs"><KeyIcon data-icon="inline-start" />Wert setzen</Button>
      <Button disabled={busy} onClick={() => send({ action: "retry", name: target.name })} size="xs" variant="secondary">Erneut versuchen</Button>
    </>;
  }
  if (state === "login-required" || state === "forbidden") return <Button disabled={busy} onClick={() => onLogin(target.name)} size="xs" variant="secondary">Anmelden</Button>;
  if (state === "unreachable" || state === "failed") return <Button disabled={busy} onClick={() => send({ action: "retry", name: target.name })} size="xs" variant="secondary">Erneut versuchen</Button>;
  if (profile) return null;
  if (state === "connected") return <Button disabled={busy} onClick={() => send({ action: "disconnect", name: target.name })} size="xs" variant="ghost">Trennen</Button>;
  if (state === "stopped") return <Button disabled={busy} onClick={() => send({ action: "connect", name: target.name })} size="xs" variant="secondary">Verbinden</Button>;
  return null;
}

function TargetRow({ target, send, onEdit, onLogin, onRemove }: {
  target: TargetView;
  send: (action: PanelAction) => void;
  onEdit: (name: string) => void;
  onLogin: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const busy = busyState(target);
  const detail = stateDetail(target) ?? target.problem;
  const profile = target.kind === "profile";
  return <li className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5 border-b border-border-soft px-1 py-2.5 last:border-b-0">
    <span aria-hidden className="grid size-[26px] flex-none place-items-center rounded-md bg-secondary text-muted-foreground">
      {profile ? <FolderIcon className="size-3.5" /> : <ServerIcon className="size-3.5" />}
    </span>
    <span className="min-w-0">
      <span className="flex min-w-0 items-center gap-2">
        <strong className="min-w-0 truncate text-[0.8rem] font-semibold">{target.name}</strong>
        <span className="flex-none text-[0.6rem] uppercase tracking-[0.05em] text-muted-foreground">{kindLabel(target)}</span>
        <EnvironmentStateIcon className="ml-auto" state={environmentState(target)} />
      </span>
      <span className="block truncate font-mono text-[0.68rem] text-muted-foreground" title={target.address}>{profile ? fileNameOf(target.address) : target.address}</span>
    </span>
    {detail && <p className="col-span-2 text-[0.7rem] leading-normal text-destructive [overflow-wrap:anywhere]" role="alert">{detail}</p>}
    <span className="col-span-2 flex flex-wrap items-center gap-1.5">
      <RowActions busy={busy} onLogin={onLogin} send={send} target={target} />
      {target.savedLogin && <Button disabled={busy} onClick={() => send({ action: "logout", name: target.name })} size="xs" variant="ghost">Abmelden</Button>}
      <Button onClick={() => onEdit(target.name)} size="xs" variant="ghost"><PencilIcon data-icon="inline-start" />Bearbeiten</Button>
      <Button aria-label={`${target.name} entfernen`} className="ml-auto" onClick={() => onRemove(target.name)} size="icon-sm" variant="ghost"><Trash2Icon /></Button>
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

/** Die Einrichtung: die Umgebungen als Zeilen, dahinter die Dialoge zum Anlegen, Bearbeiten, Anmelden und Entfernen. */
export function EnvironmentsPage({ state, send }: PanelPageProps) {
  const [dialog, setDialog] = useState<{ kind: "new" } | { kind: "edit"; name: string }>();
  const [login, setLogin] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  const editing = dialog?.kind === "edit" ? state.targets.find((target) => target.name === dialog.name) : undefined;
  const loginTarget = state.targets.find((target) => target.name === login);
  const open = dialog?.kind === "new" || editing !== undefined;
  const missingSecrets = state.missingSecrets ?? [];
  return <div className="grid grid-cols-1 gap-3">
    <PanelHeader send={send} title="Umgebungen" />
    {state.problem && <p className="text-[0.8rem] leading-normal text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
    <section className="grid grid-cols-1 gap-1.5">
      {state.targets.length === 0
        ? <p className="text-[0.85rem] leading-normal text-muted-foreground">Noch keine Umgebung.</p>
        : <ul className="grid grid-cols-1">
          {state.targets.map((target) => <TargetRow key={target.name} onEdit={(name) => setDialog({ kind: "edit", name })} onLogin={setLogin} onRemove={setRemoving} send={send} target={target} />)}
        </ul>}
    </section>
    {missingSecrets.length > 0 && <MissingSecrets names={missingSecrets} send={send} />}
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => setDialog({ kind: "new" })} size="sm"><PlusIcon data-icon="inline-start" />Neue Umgebung</Button>
      <Button aria-label="Einstellung öffnen" onClick={() => send({ action: "settingsFile" })} size="sm" title="Einstellung öffnen (settings.json)" variant="ghost"><SettingsIcon data-icon="inline-start" />settings.json</Button>
    </div>
    {open && <TargetDialog key={editing?.name ?? "neu"} onClose={() => setDialog(undefined)} send={send} state={state} target={editing} />}
    {loginTarget && <LoginDialog onClose={() => setLogin(undefined)} send={send} target={loginTarget} />}
    {removing !== undefined && <ConfirmDialog confirmLabel="Entfernen" onClose={() => setRemoving(undefined)}
      onConfirm={() => { send({ action: "remove", name: removing }); setRemoving(undefined); }} title={`${removing} entfernen?`}>
      Die Umgebung verschwindet aus ragents.connections. Gespeicherte Anmeldedaten gehen dabei verloren. Runs auf dem Server bleiben, wo sie sind.
    </ConfirmDialog>}
  </div>;
}
