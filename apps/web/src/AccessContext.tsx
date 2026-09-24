import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ComponentType, type PropsWithChildren } from "react";
import { createAccessContext, unrestrictedAccess, type AccessContext as UserAccess, type AccessSnapshot } from "../../../packages/ragents/src/access";
import { accessSnapshotFrom, observeAccessExpiry } from "./access-session";
import { errorFrom } from "./lib/http";
import { ToolbarCopy, ToolbarItem, ToolbarLabel, ToolbarText } from "./Toolbar";
import { Button, Card, cn, Input } from "./ui";

const screenClasses = "grid min-h-dvh place-items-center p-6";
const cardWidthClasses = "w-[min(100%,380px)]";
const cardClasses = "gap-0 p-8 shadow-pop max-sm:p-6";
const fieldClasses = "mb-5 grid gap-2 text-[0.85rem] font-semibold";

interface AccessValue extends UserAccess {
  logout: () => Promise<void>;
}

export const AccessContext = createContext<AccessValue>({ ...unrestrictedAccess, logout: async () => {} });
export const useAccess = () => useContext(AccessContext);

/** Die ganzseitige Karte für Anmeldung und Startfehler, auch vom Einstieg in main.tsx verwendet. */
export function AccessScreen({ children }: PropsWithChildren) {
  return <main className={screenClasses}><Card className={cn(cardWidthClasses, cardClasses)}>{children}</Card></main>;
}

export interface LoginProps {
  onLogin: (snapshot: AccessSnapshot) => void;
}

/** Login ersetzt das Anmeldeformular, wenn ein Host die Anmeldung selbst führt (VS-Code-Erweiterung). */
export function AccessGate({ children, Login: LoginComponent = Login }: PropsWithChildren<{ Login?: ComponentType<LoginProps> }>) {
  const [snapshot, setSnapshot] = useState<AccessSnapshot>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const original = window.fetch;
    window.fetch = observeAccessExpiry(original.bind(window), window.location.origin, () => {
      setSnapshot((current) => current?.enabled ? { enabled: true, user: null } : current);
    });
    setError(undefined);
    void fetch("/api/access", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw await errorFrom(response, "Die Anmeldung konnte nicht geladen werden.");
      const next = accessSnapshotFrom(await response.json());
      if (!controller.signal.aborted) setSnapshot(next);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { controller.abort(); window.fetch = original; };
  }, [retry]);
  useEffect(() => {
    if (!snapshot?.enabled) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void fetch("/api/access", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) return;
        const next = accessSnapshotFrom(await response.json());
        setSnapshot((current) => current?.user?.id === next.user?.id ? current : next);
      }).catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [snapshot?.enabled]);
  const logout = useCallback(async () => {
    const response = await fetch("/api/access/logout", { method: "POST" });
    if (!response.ok) throw await errorFrom(response, "Abmelden fehlgeschlagen.");
    setSnapshot({ enabled: true, user: null });
  }, []);
  const access = useMemo(() => ({ ...createAccessContext(snapshot ?? { enabled: true, user: null }), logout }), [snapshot, logout]);
  if (!snapshot) return <AccessScreen>
    <h1 className="my-3 text-[1.5rem]">RAgents</h1>
    {error ? <><p className="mb-6 leading-normal" role="alert">{error}</p><Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Erneut laden</Button></>
      : <p className="mb-6 leading-normal" role="status">Anmeldung wird geprüft ...</p>}
  </AccessScreen>;
  return <AccessContext.Provider value={access}>
    {snapshot.enabled && !snapshot.user ? <LoginComponent onLogin={setSnapshot} /> : children}
  </AccessContext.Provider>;
}

function Login({ onLogin }: LoginProps) {
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return <main className={screenClasses}><form className={cardWidthClasses} onSubmit={(event) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(undefined);
    void fetch("/api/access/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id.trim(), password }),
    }).then(async (response) => {
      if (!response.ok) throw await errorFrom(response, "Anmeldung fehlgeschlagen.");
      const next = accessSnapshotFrom(await response.json());
      if (next.enabled && !next.user) throw new Error("Der Server hat die Anmeldung nicht bestätigt.");
      setPassword("");
      onLogin(next);
    }).catch((cause: unknown) => {
      setPassword("");
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => setPending(false));
  }}><Card className={cardClasses}>
    <span className="text-sm font-semibold text-muted-foreground">RAgents</span>
    <h1 className="my-3 text-[1.5rem]">Einloggen</h1>
    <p className="mb-6 leading-normal text-muted-foreground">Melde dich mit deinem Benutzerkonto für diese Werkstatt an.</p>
    <label className={fieldClasses}>Benutzer<Input autoComplete="username" autoFocus disabled={pending} name="username" onChange={(event) => setId(event.target.value)} required value={id} /></label>
    <label className={fieldClasses}>Passwort<Input autoComplete="current-password" disabled={pending} name="password" onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label>
    {error && <p className="mb-6 text-destructive" role="alert">{error}</p>}
    <Button className="w-full" disabled={pending || !id.trim() || !password} type="submit">{pending ? "Anmeldung läuft ..." : "Einloggen"}</Button>
  </Card></form></main>;
}

export function UserMenu() {
  const access = useAccess();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (!access.enabled || !access.user) return null;
  return <div className="flex flex-none items-stretch text-sm">
    <ToolbarItem as="button" aria-label={`${access.user.label} abmelden`} className="max-w-[160px] max-sm:max-w-[100px]" disabled={pending} title={access.user.id} type="button" onClick={() => {
      setPending(true); setError(undefined);
      void access.logout().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setPending(false));
    }}><ToolbarCopy><ToolbarLabel className="normal-case [overflow-wrap:anywhere]">{access.user.label}</ToolbarLabel><ToolbarText>Abmelden</ToolbarText></ToolbarCopy></ToolbarItem>
    {error && <ToolbarItem className="text-destructive" role="alert">{error}</ToolbarItem>}
  </div>;
}
