import { useId, useRef, useState } from "react";
import { ChevronLeftIcon, ExternalLinkIcon, LogOutIcon, MoreVerticalIcon, PlayIcon, SettingsIcon } from "lucide-react";
import { coreContracts } from "@ragents/host/api/contracts";
import type { RunScriptListing } from "../../../server/src/chat-handler";
import { useAccess } from "../AccessContext";
import { rpc } from "../rpc";
import { Button, Popover, PopoverContent } from "../ui";
import { useRunPanelHost } from "./host";

const itemClass = "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring/60 focus-visible:-outline-offset-2 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent [&>svg]:size-4 [&>svg]:flex-none [&>svg]:text-muted-foreground";

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

type Scripts = { readonly kind: "loading" } | { readonly kind: "ready"; readonly scripts: readonly RunScriptListing[] };

/** The menu at the top right of the panel: settings, run scripts for the open run, server in the browser, and sign-out behind one button. */
export function RunPanelMenu({ onOpenSettings, runId }: { onOpenSettings: () => void; runId?: string }) {
  const host = useRunPanelHost();
  const access = useAccess();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [scripts, setScripts] = useState<Scripts>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pressedAnchor = (details: { reason: string; event: Event }) =>
    details.reason === "outside-press" && details.event.target instanceof Node && buttonRef.current?.contains(details.event.target) === true;
  const close = () => { setOpen(false); setScripts(undefined); setError(undefined); };
  const logout = () => {
    if (host.kind === "vscode") { host.requestLogout(); setOpen(false); return; }
    setPending(true);
    setError(undefined);
    void access.logout().then(() => setOpen(false)).catch((cause: unknown) => setError(messageOf(cause))).finally(() => setPending(false));
  };
  const listScripts = (run: string) => {
    setScripts({ kind: "loading" });
    setError(undefined);
    void rpc.call(coreContracts.runs.scripts, { runId: run }).then((listed) => setScripts({ kind: "ready", scripts: listed }))
      .catch((cause: unknown) => { setScripts({ kind: "ready", scripts: [] }); setError(messageOf(cause)); });
  };
  const startScript = (run: string, entry: string) => {
    setPending(true);
    setError(undefined);
    void rpc.call(coreContracts.runs.startScript, { runId: run, entry, input: null }).then(close)
      .catch((cause: unknown) => setError(messageOf(cause))).finally(() => setPending(false));
  };
  const scriptRun = runId !== undefined && access.can("runs.write") ? runId : undefined;
  return <>
    <Button aria-controls={open ? panelId : undefined} aria-expanded={open} aria-haspopup="dialog" aria-label="Panel menu" className="self-center" onClick={() => (open ? close() : setOpen(true))} ref={buttonRef} size="icon-lg" title="Menu" variant="ghost"><MoreVerticalIcon /></Button>
    <Popover onOpenChange={(next, details) => { if (!next && pressedAnchor(details)) return; if (next) setOpen(true); else close(); }} open={open}>
      <PopoverContent align="end" anchor={buttonRef} aria-label="Panel menu" className="w-[260px] gap-0 p-1 text-[0.8rem]" collisionPadding={8} dim id={panelId} role="dialog" side="bottom">
        {scripts && scriptRun !== undefined ? <>
          <button className={itemClass} onClick={() => { setScripts(undefined); setError(undefined); }} type="button"><ChevronLeftIcon />Run script</button>
          <div aria-label="Run scripts" className="grid max-h-[50vh] overflow-auto border-t border-border-soft pt-1" role="list">
            {scripts.kind === "loading" && <p className="px-2 py-1.5 text-muted-foreground">Loading run scripts ...</p>}
            {scripts.kind === "ready" && scripts.scripts.length === 0 && !error && <p className="px-2 py-1.5 text-muted-foreground">This profile has no run scripts for you.</p>}
            {scripts.kind === "ready" && scripts.scripts.map((script) => <button className={itemClass} disabled={pending || !script.available} key={script.id}
              onClick={() => startScript(scriptRun, script.id)} role="listitem" title={script.reason ?? script.description} type="button">
              <span className="grid min-w-0"><span className="truncate">{script.title}</span>
                <span className="line-clamp-2 text-[0.68rem] text-muted-foreground">{script.available ? script.description : script.reason}</span></span>
            </button>)}
          </div>
        </> : <>
          <button className={itemClass} onClick={() => { close(); onOpenSettings(); }} type="button"><SettingsIcon />Settings</button>
          {scriptRun !== undefined && <button className={itemClass} onClick={() => listScripts(scriptRun)} type="button"><PlayIcon />Run script</button>}
          {host.kind === "vscode" && <button className={itemClass} onClick={() => { close(); host.openExternal(new URL("/", window.location.href).toString()); }} type="button"><ExternalLinkIcon />Open in browser</button>}
          {access.enabled && access.user && <button className={itemClass} disabled={pending} onClick={logout} title={access.user.id} type="button"><LogOutIcon /><span className="grid min-w-0"><span>Sign out</span><span className="truncate text-[0.68rem] text-muted-foreground">{access.user.label}</span></span></button>}
        </>}
        {error && <p className="px-2 py-1.5 text-[0.72rem] text-destructive" role="alert">{error}</p>}
      </PopoverContent>
    </Popover>
  </>;
}
