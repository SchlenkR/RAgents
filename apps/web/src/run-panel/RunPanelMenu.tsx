import { useId, useRef, useState } from "react";
import { ExternalLinkIcon, LogOutIcon, MoreVerticalIcon, SettingsIcon } from "lucide-react";
import { useAccess } from "../AccessContext";
import { Button, Popover, PopoverContent } from "../ui";
import { useRunPanelHost } from "./host";

const itemClass = "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2 disabled:cursor-default disabled:opacity-50 [&>svg]:size-4 [&>svg]:flex-none [&>svg]:text-muted-foreground";

/** Das Menü rechts oben im Panel: Einstellungen, Server im Browser und Abmelden hinter einem Knopf. */
export function RunPanelMenu({ onOpenSettings }: { onOpenSettings: () => void }) {
  const host = useRunPanelHost();
  const access = useAccess();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pressedAnchor = (details: { reason: string; event: Event }) =>
    details.reason === "outside-press" && details.event.target instanceof Node && buttonRef.current?.contains(details.event.target) === true;
  const logout = () => {
    if (host.kind === "vscode") { host.requestLogout(); setOpen(false); return; }
    setPending(true);
    setError(undefined);
    void access.logout().then(() => setOpen(false)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setPending(false));
  };
  return <>
    <Button aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" aria-label="Menü des Panels" className="self-center" onClick={() => setOpen((value) => !value)} ref={buttonRef} size="icon-lg" title="Menü" variant="ghost"><MoreVerticalIcon /></Button>
    <Popover onOpenChange={(next, details) => { if (!next && pressedAnchor(details)) return; setOpen(next); }} open={open}>
      <PopoverContent align="end" anchor={buttonRef} aria-label="Menü des Panels" className="w-[220px] gap-0 p-1 text-[0.8rem]" collisionPadding={8} dim id={panelId} role="dialog" side="bottom" sideOffset={4}>
        <button className={itemClass} onClick={() => { setOpen(false); onOpenSettings(); }} type="button"><SettingsIcon />Einstellungen</button>
        {host.kind === "vscode" && <button className={itemClass} onClick={() => { setOpen(false); host.openExternal(new URL("/", window.location.href).toString()); }} type="button"><ExternalLinkIcon />Im Browser öffnen</button>}
        {access.enabled && access.user && <button className={itemClass} disabled={pending} onClick={logout} title={access.user.id} type="button"><LogOutIcon /><span className="grid min-w-0"><span>Abmelden</span><span className="truncate text-[0.68rem] text-muted-foreground">{access.user.label}</span></span></button>}
        {error && <p className="px-2 py-1.5 text-[0.72rem] text-destructive" role="alert">{error}</p>}
      </PopoverContent>
    </Popover>
  </>;
}
