import { FolderOpenIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label, Toggle } from "../ui";
import type { PanelAction, PanelState, TargetKind, TargetView } from "./contract";
import { busyState } from "./target-state";
import { LoginForm } from "./LoginForm";

const PROFILE_FILE = /^ragents\.config\.([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;

/** Eine Profildatei heißt ragents.config.<profil>.ts; ihr Profil ist der Name, den der Dialog vorschlägt. */
export const profileNameOf = (profileFile: string): string =>
  PROFILE_FILE.exec(profileFile.split(/[/\\]/).pop() ?? "")?.[1] ?? "";

const fileNameOf = (profileFile: string): string => profileFile.split(/[/\\]/).pop() ?? profileFile;

function PanelDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <Dialog onOpenChange={(next) => { if (!next) onClose(); }} open>
    <DialogContent className="gap-3" scope="page" size="small">
      <DialogHeader><DialogTitle className="text-[0.95rem] font-semibold">{title}</DialogTitle></DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}

/** Die Sicherheitsfrage vor einer Handlung, die nichts zurücknimmt: Entfernen einer Umgebung, Löschen von Runs. */
export function ConfirmDialog({ title, confirmLabel, onConfirm, onClose, children }: {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return <PanelDialog onClose={onClose} title={title}>
    <p className="text-[0.78rem] leading-normal text-muted-foreground [overflow-wrap:anywhere]">{children}</p>
    <div className="mt-1 flex flex-wrap justify-end gap-2">
      <Button onClick={onClose} size="sm" type="button" variant="ghost">Abbrechen</Button>
      <Button onClick={onConfirm} size="sm" type="button" variant="destructive">{confirmLabel}</Button>
    </div>
  </PanelDialog>;
}

/** Die Anmeldung einer Umgebung, von der Start-Seite wie von der Seite Umgebungen derselbe Dialog. */
export function LoginDialog({ target, onClose, send }: { target: TargetView; onClose: () => void; send: (action: PanelAction) => void }) {
  const demanded = target.state.kind === "login-required" ? target.state.mode : "password";
  const [mode, setMode] = useState<"password" | "token">(demanded);
  useEffect(() => { if (target.state.kind === "connected") onClose(); }, [onClose, target.state.kind]);
  return <PanelDialog onClose={onClose} title={`Anmelden an ${target.name}`}>
    <div aria-label="Art der Anmeldung" className="flex gap-1.5" role="group">
      <Toggle onPressedChange={() => setMode("password")} pressed={mode === "password"} size="sm" variant="outline">Benutzer</Toggle>
      <Toggle onPressedChange={() => setMode("token")} pressed={mode === "token"} size="sm" variant="outline">Zugangstoken</Toggle>
    </div>
    <LoginForm busy={busyState(target)} key={mode} mode={mode} onCancel={onClose} send={send} submitLabel="Anmelden" target={target} />
  </PanelDialog>;
}

/** Anlegen und Bearbeiten einer Umgebung; Bearbeiten schickt update und behält damit die gespeicherten Anmeldedaten. */
export function TargetDialog({ state, target, onClose, send }: {
  state: PanelState;
  target: TargetView | undefined;
  onClose: () => void;
  send: (action: PanelAction) => void;
}) {
  const [kind, setKind] = useState<TargetKind>(target?.kind ?? "server");
  const [name, setName] = useState(target?.name ?? "");
  const [url, setUrl] = useState(target?.kind === "server" ? target.address : "");
  const [profileFile, setProfileFile] = useState(target?.kind === "profile" ? target.address : "");
  const [sent, setSent] = useState<{ name: string; at: PanelState }>();
  const picked = state.pickedProfileFile;
  const settled = sent !== undefined && sent.at !== state;
  useEffect(() => {
    if (!picked) return;
    setKind("profile");
    setProfileFile(picked);
    setName((current) => current.trim() === "" ? profileNameOf(picked) : current);
  }, [picked]);
  useEffect(() => {
    if (!settled || sent === undefined) return;
    if (state.problem !== undefined) setSent(undefined);
    else if (state.targets.some((entry) => entry.name === sent.name)) onClose();
  }, [onClose, sent, settled, state]);
  const takeProfile = (file: string) => {
    setProfileFile(file);
    setName((current) => current.trim() === "" ? profileNameOf(file) : current);
  };
  const value = kind === "server" ? url : profileFile;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSent({ name: name.trim(), at: state });
    if (target === undefined) send(kind === "server" ? { action: "addServer", name, url } : { action: "addProfile", name, profileFile });
    else send(kind === "server"
      ? { action: "updateServer", name: target.name, newName: name, url }
      : { action: "updateProfile", name: target.name, newName: name, profileFile });
  };
  return <PanelDialog onClose={onClose} title={target ? `${target.name} bearbeiten` : "Neue Umgebung"}>
    <form className="grid gap-3" onSubmit={submit}>
      <div aria-label="Art der Umgebung" className="flex gap-1.5" role="group">
        <Toggle onPressedChange={() => setKind("server")} pressed={kind === "server"} size="sm" variant="outline">Server</Toggle>
        <Toggle onPressedChange={() => setKind("profile")} pressed={kind === "profile"} size="sm" variant="outline">Lokales Profil</Toggle>
      </div>
      {kind === "server"
        ? <div className="grid gap-1.5"><Label htmlFor="target-url">Adresse</Label><Input id="target-url" onChange={(event) => setUrl(event.target.value)} placeholder="https://werkstatt.example.com" value={url} /></div>
        : <div className="grid gap-1.5">
          <Label htmlFor="target-profile-file">Profildatei</Label>
          <div className="flex items-center gap-2">
            <Input aria-label="Profildatei" className="min-w-0 flex-1 font-mono text-[0.72rem]" id="target-profile-file" onChange={(event) => setProfileFile(event.target.value)} placeholder="~/repos/RAgents/ragents.config.core.ts" title={profileFile} value={profileFile} />
            <Button className="flex-none" onClick={() => send({ action: "pickProfile" })} size="sm" type="button" variant="secondary"><FolderOpenIcon data-icon="inline-start" />Datei wählen ...</Button>
          </div>
          {state.profileSuggestions.length > 0 && <>
            <p className="text-[0.7rem] leading-normal text-muted-foreground">Im Host-Ordner gefunden, ein Klick übernimmt sie:</p>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
              {state.profileSuggestions.map((file) => <li key={file}>
                <button aria-pressed={profileFile === file} className="flex w-full min-w-0 flex-col gap-0.5 rounded-md border border-border-soft px-2.5 py-1.5 text-left hover:border-border aria-pressed:border-primary aria-pressed:bg-accent" onClick={() => takeProfile(file)} type="button">
                  <strong className="truncate text-[0.75rem] font-semibold">{profileNameOf(file)}</strong>
                  <span className="truncate font-mono text-[0.65rem] text-muted-foreground" title={file}>{fileNameOf(file)}</span>
                </button>
              </li>)}
            </ul>
          </>}
        </div>}
      <div className="grid gap-1.5">
        <Label htmlFor="target-name">Name</Label>
        <Input id="target-name" onChange={(event) => setName(event.target.value)} placeholder={kind === "server" ? "Werkstatt" : "core"} value={name} />
        {kind === "profile" && <span className="text-[0.68rem] text-muted-foreground">aus dem Dateinamen übernommen, überschreibbar</span>}
      </div>
      {state.problem && <p className="text-[0.75rem] leading-normal text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
      <div className="mt-1 flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} size="sm" type="button" variant="ghost">Abbrechen</Button>
        <Button disabled={!name.trim() || !value.trim()} size="sm" type="submit">{target ? "Speichern" : "Anlegen"}</Button>
      </div>
    </form>
  </PanelDialog>;
}
