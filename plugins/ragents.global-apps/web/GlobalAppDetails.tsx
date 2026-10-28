import { useEffect, useState } from "react";
import { Alert, AlertDescription, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Spinner } from "@ragents/web/ui";
import { rpc } from "@ragents/web/rpc";
import { actorProgramContracts, type ActorProgramStatus } from "@ragents/host/plugin-support/actor-programs/contract";
import { globalAppsContracts, type GlobalAppSummary } from "../contract";

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const jsonClass = "max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-sm";

export function GlobalAppDetails({ app, runId, revision, writable, onClose }: { app: GlobalAppSummary; runId: string; revision: number; writable: boolean; onClose: () => void }) {
  const [details, setDetails] = useState<ActorProgramStatus>();
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void rpc.call(actorProgramContracts.status, { runId, actorId: app.actorId, logLimit: 100 }, { signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return;
      setDetails(next);
      setError(undefined);
    }).catch((caught) => { if (!controller.signal.aborted) setError(errorText(caught)); });
    return () => controller.abort();
  }, [app.actorId, runId, revision]);
  const remove = async () => {
    setRemoving(true);
    try { await rpc.call(globalAppsContracts.remove, { name: app.name }); onClose(); }
    catch (caught) { setError(errorText(caught)); setRemoving(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent scope="page" size="large" showCloseButton>
      <DialogHeader><DialogTitle>{app.name}</DialogTitle><DialogDescription>{app.description || "Global app details"}</DialogDescription></DialogHeader>
      <DialogBody className="min-w-0 space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {!details ? !error && <p role="status" className="flex items-center gap-2"><Spinner />Loading details...</p> : <>
          <p className="text-base text-muted-foreground">Triggers: {JSON.stringify(details.triggers)}. Timeout: {details.triggers.timeoutSeconds ?? 30} seconds.</p>
          {details.sandbox === "process" && <p className="text-base text-muted-foreground">Process protection is active. File and HTTP permissions are enforced through server capabilities.</p>}
          {details.sandbox === "disabled" && <Alert variant="destructive"><AlertDescription>Process protection is disabled. Direct file and network access by this script is unrestricted.</AlertDescription></Alert>}
          <div><h3 className="mb-2 text-base font-medium">Permissions</h3><pre className={jsonClass}>{JSON.stringify(details.permissions, null, 2)}</pre></div>
          <div><h3 className="mb-2 text-base font-medium">State</h3><pre className={jsonClass}>{JSON.stringify(details.state, null, 2)}</pre></div>
          <div><h3 className="mb-2 text-base font-medium">Log</h3>
            {details.log.length ? <ol className="max-h-80 space-y-2 overflow-auto rounded-md bg-muted p-3 font-mono text-sm">{details.log.map((line, index) => <li key={`${line.at}:${index}`} className="whitespace-pre-wrap break-all"><span className="text-muted-foreground">{line.at} {line.level}: </span>{line.text}</li>)}</ol> : <p className="text-base text-muted-foreground">No log yet.</p>}
            {details.droppedLogLines > 0 && <p className="mt-2 text-sm text-muted-foreground">{details.droppedLogLines} earlier log lines omitted.</p>}
          </div>
        </>}
      </DialogBody>
      <DialogFooter>{writable && <Button variant="destructive" disabled={removing} onClick={() => { void remove(); }}>{removing && <Spinner />}Remove</Button>}<Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
