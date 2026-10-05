import { useRef, useState } from "react";
import { WandSparklesIcon } from "lucide-react";
import { coreContracts } from "@ragents/host/api/contracts";
import type { RunScriptListing } from "../../../server/src/chat-handler";
import { useAccess } from "../AccessContext";
import { rpc } from "../rpc";
import { StartTile } from "../StartTiles";
import { Button, Popover, PopoverContent, PopoverTrigger, Separator } from "../ui";

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const noticeClass = "px-1 py-1.5 type-body text-muted-foreground";

type Scripts = { readonly kind: "loading" } | { readonly kind: "ready"; readonly scripts: readonly RunScriptListing[] };

/** "Run script" next to the window buttons: the scripts that may join the open run, as Start page items in a pop-out. */
export function RunScriptMenu({ runId }: { runId: string }) {
  const access = useAccess();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState<string>();
  const [error, setError] = useState<string>();
  const [scripts, setScripts] = useState<Scripts>();
  const trigger = useRef<HTMLButtonElement>(null);
  if (!access.can("runs.write")) return null;
  const close = () => { setOpen(false); setScripts(undefined); setError(undefined); };
  const listScripts = () => {
    setOpen(true);
    setScripts({ kind: "loading" });
    setError(undefined);
    void rpc.call(coreContracts.runs.scripts, { runId }).then((listed) => setScripts({ kind: "ready", scripts: listed }))
      .catch((cause: unknown) => { setScripts({ kind: "ready", scripts: [] }); setError(messageOf(cause)); });
  };
  const startScript = (entry: string) => {
    setStarting(entry);
    setError(undefined);
    void rpc.call(coreContracts.runs.startScript, { runId, entry, input: null }).then(close)
      .catch((cause: unknown) => setError(messageOf(cause))).finally(() => setStarting(undefined));
  };
  return <div className="ml-1 flex flex-none items-center gap-2">
    <Separator className="my-2.5" orientation="vertical" />
    <Popover onOpenChange={(next) => { if (next) listScripts(); else close(); }} open={open}>
      <PopoverTrigger ref={trigger} render={<Button aria-label="Run script" className="border-primary/40 text-primary" size="lg" title="Run script" variant="outline" />}>
        <WandSparklesIcon /><span>Run script</span>
      </PopoverTrigger>
      <PopoverContent align="end" alignOffset={8} anchor={() => trigger.current?.closest("header") ?? null} aria-label="Run script"
        className="@container/scripts max-h-[min(70vh,560px)] w-[min(800px,calc(var(--anchor-width)-16px))] gap-2 overflow-auto p-2" collisionPadding={8} dim role="dialog" side="bottom">
        {scripts?.kind === "loading" && <p className={noticeClass}>Loading run scripts ...</p>}
        {scripts?.kind === "ready" && scripts.scripts.length === 0 && !error && <p className={noticeClass}>This profile has no run scripts for you.</p>}
        {scripts?.kind === "ready" && scripts.scripts.length > 0 && <ul aria-label="Run scripts" className="grid grid-cols-1 gap-2 @[480px]/scripts:grid-cols-2">
          {[...scripts.scripts.filter((script) => script.available), ...scripts.scripts.filter((script) => !script.available)].map((script) => <StartTile action="start"
            description={(script.available ? script.description : script.reason) ?? ""} disabled={starting !== undefined || !script.available} fill
            key={script.id} onClick={() => startScript(script.id)} starting={starting === script.id} title={script.title} />)}
        </ul>}
        {error && <p className="px-1 type-body text-destructive" role="alert">{error}</p>}
      </PopoverContent>
    </Popover>
  </div>;
}
