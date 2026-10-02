import { FolderOpenIcon } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Label, Toggle } from "../ui";
import { busyState } from "./connection-state";
import type { ConnectionKind, ConnectionView, PanelAction, PanelState } from "./contract";
import { LoginForm } from "./LoginForm";

const PROFILE_FILE = /^ragents\.config\.([a-z0-9]+(?:-[a-z0-9]+)*)\.ts$/;

/** A profile file is named ragents.config.<profile>.ts; its profile is the name the dialog suggests. */
export const profileNameOf = (profileFile: string): string =>
  PROFILE_FILE.exec(profileFile.split(/[/\\]/).pop() ?? "")?.[1] ?? "";

const fileNameOf = (profileFile: string): string => profileFile.split(/[/\\]/).pop() ?? profileFile;

function PanelDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <Dialog onOpenChange={(next) => { if (!next) onClose(); }} open>
    <DialogContent className="gap-3" scope="page" size="small">
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      {children}
    </DialogContent>
  </Dialog>;
}

/** The confirmation before an action that cannot be undone: removing a server, deleting runs. */
export function ConfirmDialog({ title, confirmLabel, onConfirm, onClose, children }: {
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return <PanelDialog onClose={onClose} title={title}>
    <p className="type-body text-muted-foreground [overflow-wrap:anywhere]">{children}</p>
    <div className="mt-1 flex flex-wrap justify-end gap-2">
      <Button onClick={onClose} size="sm" type="button" variant="ghost">Cancel</Button>
      <Button onClick={onConfirm} size="sm" type="button" variant="destructive">{confirmLabel}</Button>
    </div>
  </PanelDialog>;
}

/** Signing in to a server, the same dialog from the Start page and from the Server page. */
export function LoginDialog({ connection, onClose, send }: { connection: ConnectionView; onClose: () => void; send: (action: PanelAction) => void }) {
  const demanded = connection.state.kind === "login-required" ? connection.state.mode : "password";
  const [mode, setMode] = useState<"password" | "token">(demanded);
  useEffect(() => { if (connection.state.kind === "connected") onClose(); }, [onClose, connection.state.kind]);
  return <PanelDialog onClose={onClose} title={`Sign in to ${connection.name}`}>
    <div aria-label="Sign-in method" className="flex gap-1.5" role="group">
      <Toggle onPressedChange={() => setMode("password")} pressed={mode === "password"} size="sm" variant="outline">User</Toggle>
      <Toggle onPressedChange={() => setMode("token")} pressed={mode === "token"} size="sm" variant="outline">Access token</Toggle>
    </div>
    <LoginForm busy={busyState(connection)} connection={connection} key={mode} mode={mode} onCancel={onClose} send={send} submitLabel="Sign in" />
  </PanelDialog>;
}

/** Creating and editing a server; editing sends update and so keeps the saved credentials. */
export function ConnectionDialog({ state, connection, onClose, send }: {
  state: PanelState;
  connection: ConnectionView | undefined;
  onClose: () => void;
  send: (action: PanelAction) => void;
}) {
  const [kind, setKind] = useState<ConnectionKind>(connection?.kind ?? "server");
  const [name, setName] = useState(connection?.name ?? "");
  const [url, setUrl] = useState(connection?.kind === "server" ? connection.address : "");
  const [profileFile, setProfileFile] = useState(connection?.kind === "profile" ? connection.address : "");
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
    else if (state.connections.some((entry) => entry.name === sent.name)) onClose();
  }, [onClose, sent, settled, state]);
  const takeProfile = (file: string) => {
    setProfileFile(file);
    setName((current) => current.trim() === "" ? profileNameOf(file) : current);
  };
  const value = kind === "server" ? url : profileFile;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSent({ name: name.trim(), at: state });
    if (connection === undefined) send(kind === "server" ? { action: "addServer", name, url } : { action: "addProfile", name, profileFile });
    else send(kind === "server"
      ? { action: "updateServer", name: connection.name, newName: name, url }
      : { action: "updateProfile", name: connection.name, newName: name, profileFile });
  };
  return <PanelDialog onClose={onClose} title={connection ? `Edit ${connection.name}` : "New server"}>
    <form className="grid gap-3" onSubmit={submit}>
      <div aria-label="Server type" className="flex gap-1.5" role="group">
        <Toggle onPressedChange={() => setKind("server")} pressed={kind === "server"} size="sm" variant="outline">Server</Toggle>
        <Toggle onPressedChange={() => setKind("profile")} pressed={kind === "profile"} size="sm" variant="outline">Local profile</Toggle>
      </div>
      {kind === "server"
        ? <div className="grid gap-1.5"><Label htmlFor="connection-url">Address</Label><Input id="connection-url" onChange={(event) => setUrl(event.target.value)} placeholder="https://workshop.example.com" value={url} /></div>
        : <div className="grid gap-1.5">
          <Label htmlFor="connection-profile-file">Profile file</Label>
          <div className="flex items-center gap-2">
            <Input aria-label="Profile file" className="min-w-0 flex-1 font-mono text-xs" id="connection-profile-file" onChange={(event) => setProfileFile(event.target.value)} placeholder="~/repos/RAgents/ragents.config.core.ts" title={profileFile} value={profileFile} />
            <Button className="flex-none" onClick={() => send({ action: "pickProfile" })} size="sm" type="button" variant="secondary"><FolderOpenIcon data-icon="inline-start" />Choose file ...</Button>
          </div>
          {state.profileSuggestions.length > 0 && <>
            <p className="type-body text-muted-foreground">Found in the host folder, click one to use it:</p>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1.5">
              {state.profileSuggestions.map((file) => <li key={file}>
                <button aria-pressed={profileFile === file} className="flex w-full min-w-0 flex-col gap-0.5 rounded-md border border-border-soft px-2.5 py-1.5 text-left hover:border-border aria-pressed:border-primary aria-pressed:bg-accent" onClick={() => takeProfile(file)} type="button">
                  <strong className="truncate type-item">{profileNameOf(file)}</strong>
                  <span className="truncate font-mono type-meta text-muted-foreground" title={file}>{fileNameOf(file)}</span>
                </button>
              </li>)}
            </ul>
          </>}
        </div>}
      <div className="grid gap-1.5">
        <Label htmlFor="connection-name">Name</Label>
        <Input id="connection-name" onChange={(event) => setName(event.target.value)} placeholder={kind === "server" ? "Workshop" : "core"} value={name} />
        {kind === "profile" && <span className="type-meta text-muted-foreground">taken from the file name, can be changed</span>}
      </div>
      {state.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{state.problem}</p>}
      <div className="mt-1 flex flex-wrap justify-end gap-2">
        <Button onClick={onClose} size="sm" type="button" variant="ghost">Cancel</Button>
        <Button disabled={!name.trim() || !value.trim()} size="sm" type="submit">{connection ? "Save" : "Create"}</Button>
      </div>
    </form>
  </PanelDialog>;
}
