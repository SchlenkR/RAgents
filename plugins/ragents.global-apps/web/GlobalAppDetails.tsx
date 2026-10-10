import { useEffect, useState } from "react";
import { Alert, AlertDescription, Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Spinner } from "@ragents/web/ui";
import { rpc } from "@ragents/web/rpc";
import { globalAppsContracts, type GlobalAppDetails as Details } from "../contract";

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const jsonClass = "max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-xs";

export function GlobalAppDetails({ name, revision, writable, onClose }: { name: string; revision: number; writable: boolean; onClose: () => void }) {
  const [details, setDetails] = useState<Details>();
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void rpc.call(globalAppsContracts.read, { name, logLimit: 100 }, { signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return;
      setDetails(next);
      setError(undefined);
    }).catch((caught) => { if (!controller.signal.aborted) setError(errorText(caught)); });
    return () => controller.abort();
  }, [name, revision]);
  const remove = async () => {
    setRemoving(true);
    try { await rpc.call(globalAppsContracts.remove, { name }); onClose(); }
    catch (caught) { setError(errorText(caught)); setRemoving(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent scope="page" size="large" showCloseButton>
      <DialogHeader><DialogTitle>{name}</DialogTitle><DialogDescription>{details?.app.description ?? "Global app details"}</DialogDescription></DialogHeader>
      <DialogBody className="min-w-0 space-y-4">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        {!details ? !error && <p role="status" className="flex items-center gap-2"><Spinner />Loading details...</p> : <>
          <p className="text-sm text-muted-foreground">Triggers: {JSON.stringify(details.definition.triggers ?? {})}. Timeout: {details.timeoutSeconds} seconds.</p>
          {details.sandbox === "process" && <p className="text-sm text-muted-foreground">Process protection is active. File and HTTP permissions are enforced through server capabilities.</p>}
          {details.sandbox === "unavailable" && <p className="text-sm text-muted-foreground">The package has not been activated. Fix the reported cause and register it again.</p>}
          {details.sandbox === "disabled" && <Alert variant="destructive"><AlertDescription>Process protection is disabled. Direct file and network access by this script is unrestricted.</AlertDescription></Alert>}
          <div><h3 className="mb-2 text-sm font-medium">Permissions</h3><pre className={jsonClass}>{JSON.stringify(details.permissions, null, 2)}</pre></div>
          <div><h3 className="mb-2 text-sm font-medium">State</h3><pre className={jsonClass}>{JSON.stringify(details.state, null, 2)}</pre></div>
          <div><h3 className="mb-2 text-sm font-medium">Log</h3>
            {details.log.length ? <ol className="max-h-80 space-y-2 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{details.log.map((line, index) => <li key={`${line.occurrence}:${index}`} className="whitespace-pre-wrap break-all"><span className="text-muted-foreground">{line.at} {line.level}: </span>{line.text}</li>)}</ol> : <p className="text-sm text-muted-foreground">No log yet.</p>}
            {details.droppedLogLines > 0 && <p className="mt-2 text-xs text-muted-foreground">{details.droppedLogLines} earlier log lines omitted.</p>}
          </div>
        </>}
      </DialogBody>
      <DialogFooter>{writable && <Button variant="destructive" disabled={removing} onClick={() => { void remove(); }}>{removing && <Spinner />}Remove</Button>}<Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
