import { useState, type FormEvent } from "react";
import { Button, Input, Label } from "../ui";
import type { PanelAction, TargetView } from "./contract";

/** Die Anmeldung einer Umgebung im Dialogkörper: Benutzer und Passwort oder ein Zugangstoken. */
export function LoginForm({ target, mode, busy, send, submitLabel, onCancel }: {
  target: TargetView;
  mode: "password" | "token";
  busy: boolean;
  send: (action: PanelAction) => void;
  submitLabel: string;
  onCancel?: () => void;
}) {
  const [user, setUser] = useState(target.loginUser ?? "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const complete = mode === "token" ? token.trim() !== "" : user.trim() !== "" && password !== "";
  const field = `${target.name}-${mode}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(mode === "token" ? { action: "login", name: target.name, token } : { action: "login", name: target.name, user, password });
  };
  return <form className="grid gap-2.5" onSubmit={submit}>
    {mode === "token"
      ? <div className="grid gap-1.5"><Label htmlFor={`token-${field}`}>Zugangstoken</Label><Input autoComplete="off" disabled={busy} id={`token-${field}`} onChange={(event) => setToken(event.target.value)} type="password" value={token} /></div>
      : <>
        <div className="grid gap-1.5"><Label htmlFor={`user-${field}`}>Benutzer</Label><Input autoComplete="username" disabled={busy} id={`user-${field}`} onChange={(event) => setUser(event.target.value)} value={user} /></div>
        <div className="grid gap-1.5"><Label htmlFor={`password-${field}`}>Passwort</Label><Input autoComplete="current-password" disabled={busy} id={`password-${field}`} onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></div>
      </>}
    {target.problem && <p className="text-[0.75rem] leading-normal text-destructive [overflow-wrap:anywhere]" role="alert">{target.problem}</p>}
    <p className="text-[0.72rem] leading-normal text-muted-foreground">Die Anmeldedaten liegen im Schlüsselspeicher von VS Code; die Umgebung meldet sich danach still an.</p>
    <div className="mt-1 flex flex-wrap justify-end gap-2">
      {onCancel && <Button onClick={onCancel} size="sm" type="button" variant="ghost">Abbrechen</Button>}
      <Button disabled={busy || !complete} size="sm" type="submit">{submitLabel}</Button>
    </div>
  </form>;
}
