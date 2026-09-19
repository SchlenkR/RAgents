import { useEffect, useMemo, useState } from "react";
import type { JournalEvent } from "../../../packages/ragents/src/domain/events";
import type { WorkspaceTabContext } from "@aicontainer/web/PluginRegistry";
import { SourceCode } from "@aicontainer/web/SourceCode";
import { Alert, AlertDescription, Badge, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@aicontainer/web/ui";
import { runContracts } from "@aicontainer/ragents/src/http/contracts";
import { rpc } from "@aicontainer/web/rpc";
import { executionDuration, executionEventsFrom, executionStatusLabel, filterExecutions, projectExecutions, type ExecutionStatus, type TypeScriptExecution } from "./executions";
import { runViewFrom, type RunView } from "./run-view";

export const EXECUTIONS_TAB_ID = "ragents.orchestration.executions";

export function ExecutionsPanel({ active, session }: WorkspaceTabContext) {
  const view = runViewFrom(session.runView);
  const runId = session.session.id;
  return <RunExecutionsPanel active={active} key={runId} runId={runId} view={view?.id === runId ? view : undefined} />;
}

function RunExecutionsPanel({ active, runId, view }: { active: boolean; runId: string; view: RunView | undefined }) {
  const [journal, setJournal] = useState<{ events: readonly JournalEvent[]; loaded: boolean; loading: boolean; error: string | null }>({ events: [], loaded: false, loading: false, error: null });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ExecutionStatus | "all">("all");
  const statusOptions = [{ value: "all", label: "Alle Status" }, ...(["running", "completed", "failed", "interrupted"] as const).map((value) => ({ value, label: executionStatusLabel(value) }))];
  const [now, setNow] = useState(Date.now);
  const [reload, setReload] = useState(0);
  const revision = view?.revision;

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setJournal((previous) => ({ ...previous, loading: true, error: null }));
    void rpc.call(runContracts.events, { runId }, { signal: controller.signal })
      .then((result) => {
        const events = executionEventsFrom(result, runId);
        if (!controller.signal.aborted) setJournal({ events, loaded: true, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setJournal((previous) => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error) }));
      });
    return () => controller.abort();
  }, [active, runId, revision, reload]);

  const executions = useMemo(() => projectExecutions(journal.events, view), [journal.events, view]);
  const filtered = useMemo(() => filterExecutions(executions, query, status), [executions, query, status]);
  const running = executions.some((execution) => execution.status === "running");
  useEffect(() => {
    if (!active || !running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active, running]);

  return <section aria-label="TypeScript-Ausführungen" className="flex h-full min-h-0 min-w-0 flex-col bg-background text-[0.78rem] text-foreground">
    <header className="px-3.5 pt-3.5 pb-2.5"><h2 className="mb-1.5 text-[0.92rem]">Executions</h2><p className="leading-[1.5] text-muted-foreground">TypeScript-Snippets aller Actors in diesem Run.</p></header>
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border-soft px-3.5 pb-3">
      <Input className="col-span-full" aria-label="Ausführungen durchsuchen" onChange={(event) => setQuery(event.target.value)} placeholder="Actor, Code oder Ergebnis suchen" type="search" value={query} />
      <Select items={statusOptions} value={status} onValueChange={(value) => { if (value !== null) setStatus(value as ExecutionStatus | "all"); }}>
        <SelectTrigger className="min-w-0" aria-label="Ausführungsstatus"><SelectValue /></SelectTrigger>
        <SelectContent>{statusOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
      <span className="self-center text-right text-[0.68rem] text-muted-foreground" role="status">{journal.loading ? (journal.loaded ? "Aktualisiert ..." : "Lädt ...") : journal.loaded ? `${filtered.length} von ${executions.length} Ausführungen` : "Noch nicht geladen"}</span>
    </div>
    {journal.error && <Alert className="mx-3.5 my-2 w-auto" variant="destructive"><AlertDescription className="whitespace-pre-wrap text-destructive [overflow-wrap:anywhere]">{journal.error}{journal.loaded ? " Der zuletzt geladene Stand bleibt sichtbar." : ""}</AlertDescription><Button disabled={!active || journal.loading} onClick={() => setReload((value) => value + 1)} size="sm" variant="ghost">Erneut laden</Button></Alert>}
    <div aria-label="Ausführungen, neueste zuerst" className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-3">
      {journal.loaded && !journal.loading && filtered.length === 0 && <p className="mx-0.5 my-4.5 leading-[1.6] text-muted-foreground">{executions.length === 0 ? "In diesem Run wurde noch kein TypeScript-Snippet ausgeführt." : "Keine Ausführungen passen zu dieser Suche."}</p>}
      {filtered.map((execution) => <ExecutionEntry execution={execution} key={execution.key} now={now} />)}
    </div>
  </section>;
}

const statusBadgeClass: Readonly<Record<string, string>> = {
  running: "bg-background text-info",
  completed: "bg-success-soft text-success",
  failed: "bg-destructive-soft text-destructive",
  interrupted: "bg-warning-soft text-warning",
};

const summaryClass = "relative grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-[7px] pt-3 pr-2.5 pb-2.5 pl-[25px] focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 [&::-webkit-details-marker]:hidden before:absolute before:top-[15px] before:left-2.5 before:size-[5px] before:rotate-[-45deg] before:border-r-[1.5px] before:border-b-[1.5px] before:border-solid before:border-current before:content-['']";

const contentClass = "min-w-0 border-t border-border-soft px-2.5 pb-2.5 [&>h3]:mt-3 [&>h3]:mb-1.5 [&>h3]:text-[0.72rem] [&>h3]:font-[650]";

const sourceClass = "m-0 max-h-[28rem] overflow-auto text-[0.68rem]";

const logClass = "m-0 max-h-[24rem] overflow-auto rounded-sm bg-background p-2 font-mono text-[0.68rem] leading-[1.5] whitespace-pre-wrap [overflow-wrap:anywhere]";

function ExecutionEntry({ execution, now }: { execution: TypeScriptExecution; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const preview = execution.code?.trim().split("\n").find((line) => line.trim()) ?? execution.path ?? "TypeScript-Snippet";
  return <details className="mt-2.5 overflow-hidden rounded-sm border border-border-soft bg-card open:[&>summary]:before:rotate-45" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className={summaryClass}>
      <span className="truncate font-[650]" title={`${execution.actorName} (${execution.actorId})`}>@{execution.actorHandle}</span>
      <Badge className={`h-auto rounded-[5px] px-[5px] py-0.5 text-[0.64rem] ${statusBadgeClass[execution.status] ?? "bg-secondary text-muted-foreground"}`}>{executionStatusLabel(execution.status)}</Badge>
      <span className="col-span-full truncate font-mono text-[0.68rem]" title={preview}>{preview}</span>
      <span className="col-span-full flex flex-wrap justify-between gap-x-3 gap-y-1.5 text-[0.65rem] tabular-nums text-muted-foreground"><time dateTime={execution.startedAt} title={new Date(execution.startedAt).toLocaleString("de-DE")}>{new Date(execution.startedAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><span>{executionDuration(execution, now)}</span></span>
    </summary>
    {expanded && <div className={contentClass}>
      {execution.path && <p className="mt-2.5 grid gap-1 text-[0.68rem] text-muted-foreground"><span>Pfad</span><code className="[overflow-wrap:anywhere]">{execution.path}</code></p>}
      <h3>Code</h3>
      {execution.code !== null ? <SourceCode className={sourceClass} content={execution.code} language="typescript" path={execution.path ?? "snippet.ts"} /> : <p className="text-[0.72rem] leading-[1.5] text-muted-foreground">{execution.path ? "Für diesen Pfadaufruf ist kein historischer Code gespeichert." : "Für diesen Aufruf ist kein historischer Code gespeichert."}</p>}
      {execution.logs.length > 0 && <><h3>Logs</h3><pre className={logClass}>{execution.logs.join("\n")}</pre></>}
      {execution.result !== undefined && <><h3>Ergebnis</h3><SourceCode className={sourceClass} content={JSON.stringify(execution.result, null, 2)} language="json" path="result.json" /></>}
      {execution.error && <><h3>{execution.status === "interrupted" ? "Unterbrechung" : "Fehler"}</h3><pre className={`${logClass} text-destructive`}>{execution.error}</pre></>}
    </div>}
  </details>;
}

export function IconExecutions() {
  return <svg aria-hidden fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15"><path d="m7 7-4 5 4 5m10-10 4 5-4 5M14 4l-4 16" /></svg>;
}
