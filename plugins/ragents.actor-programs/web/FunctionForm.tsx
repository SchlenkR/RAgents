import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAccess } from "@ragents/web/AccessContext";
import { Badge, Button, cn, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from "@ragents/web/ui";
import type { SessionContext } from "@ragents/web/PluginRegistry";
import type { RunAppInvocation, RunScriptTool } from "./api";
import { HostConfirmation, pendingConfirmationFor, useActorPrograms } from "./AppsPanel";
import { invokeActorFunction } from "./function-call";
import { actorFunctionInput } from "./function-input";

const optionalBoolean = [{ value: "", label: "Not passed" }, { value: "true", label: "Yes" }, { value: "false", label: "No" }];

export function FunctionForm({ session, tool, detail = false }: {
  session: SessionContext;
  tool: RunScriptTool;
  detail?: boolean;
}) {
  const writable = useAccess().can("runs.write");
  const { api, refresh, runId } = useActorPrograms();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [invocation, setInvocation] = useState<RunAppInvocation>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controllerRef.current?.abort(), []);
  const confirmation = invocation ? pendingConfirmationFor(session, { invocations: [invocation] }) : undefined;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (controllerRef.current || !writable) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(undefined);
    setInvocation(undefined);
    try {
      const input = actorFunctionInput(tool.parameters, new FormData(event.currentTarget));
      setBusy(true);
      await invokeActorFunction(api, runId, tool, input, controller.signal, (current) => {
        if (!controller.signal.aborted) setInvocation(current);
      });
      if (!controller.signal.aborted) await refresh();
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (controllerRef.current === controller) controllerRef.current = undefined;
    }
  };

  const status = confirmation ? "Confirmation required"
    : invocation?.status === "queued" ? "Waiting for execution"
      : invocation?.status === "running" ? "Function running"
        : invocation?.status === "succeeded" ? "Executed"
          : invocation?.status === "cancelled" ? "Cancelled"
            : invocation?.status === "failed" ? "Failed"
              : busy ? "Sending call" : undefined;
  const failure = error ?? (invocation?.status === "failed" || invocation?.status === "cancelled" ? invocation.error : undefined);

  return (
    <div className="grid min-w-0 gap-2.5">
      <form aria-label={`Call ${tool.name}`} className={cn("grid", detail ? "gap-3.5" : "gap-2")} onSubmit={(event) => void submit(event)}>
        {tool.parameters.length === 0 && detail && <p>This function needs no parameters.</p>}
        {tool.parameters.map((parameter) => (
          <label className={cn("grid gap-[3px] font-[650] text-foreground [&_small]:text-[0.61rem] [&_small]:font-normal [&_small]:text-muted-foreground",
            detail ? "text-[0.8rem]" : "text-[0.68rem]",
            parameter.type === "boolean" && parameter.required && "grid-cols-[auto_minmax(0,1fr)] items-center gap-x-1.5 [&_small]:col-start-2")} key={parameter.name}>
            {parameter.type === "boolean" && parameter.required && <input aria-description={parameter.description} className="m-0 accent-primary" disabled={!writable || busy} name={parameter.name} type="checkbox" />}
            <span>{parameter.name}{parameter.required ? " *" : ""}{detail && <small className="ml-2">{parameter.type}{parameter.required ? "" : " (optional)"}</small>}</span>
            {parameter.type === "boolean"
              ? !parameter.required && <Select defaultValue="" disabled={!writable || busy} items={optionalBoolean} name={parameter.name}>
                  <SelectTrigger aria-label={parameter.name} className="w-full font-normal"><SelectValue /></SelectTrigger>
                  <SelectContent>{optionalBoolean.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              : parameter.type === "json" || parameter.type === "string[]" || parameter.type === "number[]" || detail && parameter.type === "string"
                ? <Textarea aria-description={parameter.description} className="min-h-8 resize-y font-normal" disabled={!writable || busy} name={parameter.name} placeholder={parameter.description} required={parameter.required} rows={2} />
                : <Input
                    aria-description={parameter.description}
                    className="font-normal"
                    disabled={!writable || busy}
                    name={parameter.name}
                    placeholder={parameter.description}
                    required={parameter.required}
                    step={parameter.type === "integer" ? "1" : parameter.type === "number" ? "any" : undefined}
                    type={parameter.type === "integer" || parameter.type === "number" ? "number" : "text"}
                  />}
            {(detail || parameter.type === "boolean") && <small>{parameter.description}</small>}
            {parameter.type === "json" && <small>Enter as JSON.</small>}
            {parameter.type === "number[]" && <small>Enter as a JSON list, e.g. [1, 2, 3].</small>}
            {parameter.type === "string[]" && <small>One entry per line or as a JSON list.</small>}
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!writable || busy} type="submit">{busy ? "Running ..." : "Run"}</Button>
          {status && <Badge role="status" tone={confirmation ? "warning" : invocation?.status === "succeeded" ? "success" : invocation?.status === "failed" ? "danger" : invocation?.status === "running" ? "active" : invocation?.status === "queued" ? "info" : "neutral"}>{status}</Badge>}
        </div>
      </form>
      {confirmation && <HostConfirmation action={confirmation} key={confirmation.id} session={session} />}
      {failure && <p className="text-destructive [overflow-wrap:anywhere]" role="alert">{failure}</p>}
      {invocation?.status === "succeeded" && !error && (
        <section aria-label="Result" className="grid min-w-0 gap-2">
          <h3>Result</h3>
          <pre className="max-h-[320px] overflow-auto rounded-md border border-border-soft bg-card p-2.5 text-[0.75rem] whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{typeof invocation.result === "string" ? invocation.result : JSON.stringify(invocation.result, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
