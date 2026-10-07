import { useState } from "react";
import { CircleHelpIcon, ExternalLinkIcon, LogOutIcon, SettingsIcon } from "lucide-react";
import { useAccess } from "../AccessContext";
import { AppearanceQuickSwitch } from "../AppearanceControls";
import { Button } from "../ui";
import { useRunPanelHost } from "./host";

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

/** The panel's own actions at the top right: Appearance, Settings, Help, the server in the browser for VS Code, and sign-out. */
export function RunPanelActions({ onOpenSettings, onOpenHelp }: { onOpenSettings: () => void; onOpenHelp?: () => void }) {
  const host = useRunPanelHost();
  const access = useAccess();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const logout = () => {
    if (host.kind === "vscode") { host.requestLogout(); return; }
    setPending(true);
    setError(undefined);
    void access.logout().catch((cause: unknown) => setError(messageOf(cause))).finally(() => setPending(false));
  };
  return <>
    {access.can("settings.read") && <AppearanceQuickSwitch />}
    {access.can("settings.read") && <Button aria-label="Settings" className="self-center" onClick={onOpenSettings} size="icon-lg" title="Settings" variant="ghost"><SettingsIcon /></Button>}
    {onOpenHelp && access.can("runs.inspect") && <Button aria-label="Help" className="self-center" onClick={onOpenHelp} size="icon-lg" title="Help" variant="ghost"><CircleHelpIcon /></Button>}
    {host.kind === "vscode" && <Button aria-label="Open in browser" className="self-center" onClick={() => host.openExternal(new URL("/", window.location.href).toString())} size="icon-lg" title="Open in browser" variant="ghost"><ExternalLinkIcon /></Button>}
    {access.enabled && access.user && <Button aria-label={`Sign out ${access.user.label}`} className="self-center" disabled={pending} onClick={logout} size="icon-lg" title={`Sign out ${access.user.label}`} variant="ghost"><LogOutIcon /></Button>}
    {error && <span className="max-w-40 self-center truncate type-body text-destructive" role="alert" title={error}>{error}</span>}
  </>;
}
