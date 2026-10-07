import { useEffect, useState } from "react";
import { coreContracts, type ChatContextUsage as ContextUsage } from "@ragents/host/api/contracts";
import { rpc } from "../rpc";
import { Button, cn, Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "../ui";

const tokenCount = new Intl.NumberFormat("en-US");

export function ContextUsageControl({ usage, error }: { usage: ContextUsage | null | undefined; error?: string }) {
  if (usage === null && !error) return null;
  const current = error ? undefined : usage;
  const fraction = current ? Math.min(current.tokens / current.contextWindow, 1) : 0;
  const percentage = current ? Math.round(current.tokens / current.contextWindow * 100) : 0;
  const nearCompaction = current && current.tokens >= current.compactionThreshold * 0.9;
  const label = current ? `Context usage: ${percentage}%${current.estimated ? " (estimated)" : ""}`
    : error ? "Context usage unavailable" : "Context usage: loading";
  const remaining = current && Math.max(0, current.compactionThreshold - current.tokens);
  return <Popover>
    <PopoverTrigger render={<Button aria-label={label} title={label} size="icon-sm" variant="ghost" />}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className={cn("size-5 -rotate-90", nearCompaction ? "text-warning" : "text-muted-foreground")} fill="none" strokeWidth="2.5">
        <circle cx="12" cy="12" r="9" className="stroke-border-strong" />
        <circle cx="12" cy="12" r="9" pathLength="100" stroke="currentColor" strokeDasharray="100" strokeDashoffset={100 - fraction * 100}
          className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none" />
      </svg>
    </PopoverTrigger>
    <PopoverContent aria-label="Context usage" align="end" side="top" className="w-72 max-w-[calc(100vw_-_2rem)] gap-3 p-4">
      <PopoverHeader>
        <PopoverTitle>Context usage</PopoverTitle>
        <PopoverDescription>{current ? `${percentage}% of the context window` : error ? "Context usage unavailable" : "Loading context usage ..."}</PopoverDescription>
      </PopoverHeader>
      {current && <>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{current.estimated ? "Used (estimated)" : "Used"}</dt><dd className="text-right font-mono tabular-nums">{tokenCount.format(current.tokens)}</dd>
          <dt className="text-muted-foreground">Context window</dt><dd className="text-right font-mono tabular-nums">{tokenCount.format(current.contextWindow)}</dd>
          <dt className="text-muted-foreground">Compaction above</dt><dd className="text-right font-mono tabular-nums">{tokenCount.format(current.compactionThreshold)}</dd>
        </dl>
        <p className={cn("border-t border-border pt-3 text-xs", nearCompaction ? "text-warning" : "text-muted-foreground")}>
          {current.tokens > current.compactionThreshold ? "Compaction threshold reached."
            : `${tokenCount.format(remaining!)} tokens until the compaction threshold.`}
        </p>
        <p className="text-xs text-muted-foreground">Tokens in the active context. Limits of the selected model apply from the next turn.</p>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </PopoverContent>
  </Popover>;
}

export function ChatContextUsage({ runId, actor = "primary", revision = "" }: { runId: string; actor?: string; revision?: string }) {
  const key = JSON.stringify([runId, actor, revision]);
  const [result, setResult] = useState<{ key: string; usage?: ContextUsage | null; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let refreshing = false;
    let pending = false;
    const refresh = async () => {
      if (controller.signal.aborted) return;
      if (refreshing) { pending = true; return; }
      refreshing = true;
      do {
        pending = false;
        try {
          const usage = await rpc.call(coreContracts.chat.contextUsage, { runId, actor }, { signal: controller.signal });
          if (!controller.signal.aborted) setResult({ key, usage });
        } catch (cause) {
          if (!controller.signal.aborted) setResult({ key, error: cause instanceof Error ? cause.message : String(cause) });
        }
      } while (pending && !controller.signal.aborted);
      refreshing = false;
    };
    const nudge = () => {
      if (controller.signal.aborted || scheduled !== undefined) return;
      scheduled = setTimeout(() => { scheduled = undefined; void refresh(); }, 250);
    };
    void refresh();
    const unsubscribe = rpc.subscribe(coreContracts.channels.run, { runId }, nudge, (error) => {
      if (!controller.signal.aborted) setResult({ key, error });
    });
    return () => { controller.abort(); clearTimeout(scheduled); unsubscribe(); };
  }, [actor, key, runId]);
  const current = result?.key === key ? result : undefined;
  return <ContextUsageControl usage={current?.usage} error={current?.error} />;
}
