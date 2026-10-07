import { useState, type FormEvent } from "react";
import { Button, Input, Label } from "../ui";
import type { ConnectionView, PanelAction } from "./contract";

/** Signing in to a server in the dialog body: user and password or an access token. */
export function LoginForm({ connection, mode, busy, send, submitLabel, onCancel }: {
  connection: ConnectionView;
  mode: "password" | "token";
  busy: boolean;
  send: (action: PanelAction) => void;
  submitLabel: string;
  onCancel?: () => void;
}) {
  const [user, setUser] = useState(connection.loginUser ?? "");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const complete = mode === "token" ? token.trim() !== "" : user.trim() !== "" && password !== "";
  const field = `${connection.name}-${mode}`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(mode === "token" ? { action: "login", name: connection.name, token } : { action: "login", name: connection.name, user, password });
  };
  return <form className="grid gap-3" onSubmit={submit}>
    {mode === "token"
      ? <div className="grid gap-2"><Label htmlFor={`token-${field}`}>Access token</Label><Input autoComplete="off" disabled={busy} id={`token-${field}`} onChange={(event) => setToken(event.target.value)} type="password" value={token} /></div>
      : <>
        <div className="grid gap-2"><Label htmlFor={`user-${field}`}>User</Label><Input autoComplete="username" disabled={busy} id={`user-${field}`} onChange={(event) => setUser(event.target.value)} value={user} /></div>
        <div className="grid gap-2"><Label htmlFor={`password-${field}`}>Password</Label><Input autoComplete="current-password" disabled={busy} id={`password-${field}`} onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></div>
      </>}
    {connection.problem && <p className="type-body text-destructive [overflow-wrap:anywhere]" role="alert">{connection.problem}</p>}
    <p className="type-body text-muted-foreground">The credentials are stored in the VS Code secret storage; the extension then signs in to the server silently.</p>
    <div className="mt-1 flex flex-wrap justify-end gap-2">
      {onCancel && <Button onClick={onCancel} size="sm" type="button" variant="ghost">Cancel</Button>}
      <Button disabled={busy || !complete} size="sm" type="submit">{submitLabel}</Button>
    </div>
  </form>;
}
