import { useState } from "react";
import { CodeIcon } from "lucide-react";
import { coreContracts } from "@ragents/host/api/contracts";
import type { RunScriptListing } from "../../../server/src/chat-handler";
import { useAccess } from "../AccessContext";
import { ParameterForm, type ParameterValues } from "../ParameterForm";
import { rpc } from "../rpc";
import { StartTile } from "../StartTiles";
import { Button, HeaderDropdown, HeaderLabel, Separator } from "../ui";

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);
const noticeClass = "px-1 py-2 type-body text-muted-foreground";

type Scripts = { readonly kind: "loading" } | { readonly kind: "ready"; readonly scripts: readonly RunScriptListing[] };

/** "Run script" next to the window buttons: the scripts that may join the open run, as Start page items in a pop-out; a script with parameters asks for them there first. */
export function RunScriptMenu({ runId }: { runId: string }) {
  const access = useAccess();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState<string>();
  const [error, setError] = useState<string>();
  const [scripts, setScripts] = useState<Scripts>();
  const [asking, setAsking] = useState<RunScriptListing>();
  if (!access.can("runs.write")) return null;
  const close = () => { setOpen(false); setScripts(undefined); setAsking(undefined); setError(undefined); };
  const listScripts = () => {
    setOpen(true);
    setScripts({ kind: "loading" });
    setError(undefined);
    void rpc.call(coreContracts.runs.scripts, { runId }).then((listed) => setScripts({ kind: "ready", scripts: listed }))
      .catch((cause: unknown) => { setScripts({ kind: "ready", scripts: [] }); setError(messageOf(cause)); });
  };
  const startScript = (entry: string, parameters: ParameterValues) => {
    setStarting(entry);
    setError(undefined);
    void rpc.call(coreContracts.runs.startScript, { runId, entry, parameters }).then(close)
      .catch((cause: unknown) => setError(messageOf(cause))).finally(() => setStarting(undefined));
  };
  const choose = (script: RunScriptListing) => {
    if (Object.keys(script.parameters.properties).length === 0) startScript(script.id, {});
    else {
      setError(undefined);
      setAsking(script);
    }
  };
  return <div className="ml-1 flex flex-none items-center gap-2">
    <Separator className="my-3" orientation="vertical" />
    <HeaderDropdown label="Run script" onOpenChange={(next) => { if (next) listScripts(); else close(); }} open={open}
      trigger={<Button aria-label="Run script" className="flex-none self-center" size="lg" aria-description="Run script" variant="ghost">
        <CodeIcon className="text-primary" /><HeaderLabel>Run script</HeaderLabel>
      </Button>}>
        {scripts?.kind === "loading" && <p className={noticeClass}>Loading run scripts ...</p>}
        {scripts?.kind === "ready" && scripts.scripts.length === 0 && !error && <p className={noticeClass}>This profile has no run scripts for you.</p>}
        {asking && <div className="grid gap-3 px-1">
          <div className="grid gap-1">
            <strong className="type-item">{asking.title}</strong>
            <p className="type-body text-muted-foreground">{asking.description}</p>
          </div>
          <ParameterForm disabled={starting !== undefined} key={asking.id} onCancel={() => { setAsking(undefined); setError(undefined); }}
            onSubmit={(parameters) => startScript(asking.id, parameters)} parameters={asking.parameters} submitLabel={starting === asking.id ? "Starting ..." : "Start"} />
        </div>}
        {!asking && scripts?.kind === "ready" && scripts.scripts.length > 0 && <ul aria-label="Run scripts" className="grid grid-cols-1 gap-2 @[480px]/header-dropdown:grid-cols-2">
          {[...scripts.scripts.filter((script) => script.available), ...scripts.scripts.filter((script) => !script.available)].map((script) => <StartTile action="start"
            description={(script.available ? script.description : script.reason) ?? ""} disabled={starting !== undefined || !script.available} fill
            key={script.id} onClick={() => choose(script)} starting={starting === script.id} title={script.title} />)}
        </ul>}
        {error && <p className="px-1 type-body text-destructive" role="alert">{error}</p>}
    </HeaderDropdown>
  </div>;
}
