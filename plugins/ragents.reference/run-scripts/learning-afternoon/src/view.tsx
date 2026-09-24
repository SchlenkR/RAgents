import React from "react";
import { Button, WorkflowDiagram } from "@ragents/client/ui";
import { learningWorkflowState, type LearningState } from "./state.js";
import { learningWorkflow } from "./workflow.js";

export interface LearningAfternoonProps {
  state: LearningState;
  onStart?: (() => void) | undefined;
  pending?: boolean | undefined;
  error?: string | undefined;
  preview?: boolean;
}

const phaseLabels = { ready: "Ready", working: "The helpers are working", complete: "Both ideas are ready", error: "Finished with an error" };
const rowClass = "flex items-center justify-between gap-2.5";
const noteClass = "text-xs text-muted-foreground";

export function LearningAfternoonView({ state, onStart, pending, error, preview }: LearningAfternoonProps) {
  const entries = state.helpers.filter((helper) => helper.status === "complete");
  return (
    <main className="min-h-full bg-background text-base **:min-w-0 **:[overflow-wrap:anywhere]">
      <header className={`${rowClass} flex-wrap`}>
        <div><p className={`mb-1.5 ${noteClass}`}>Two helpers, one collection</p><h1 className="text-[1.55rem] leading-[1.2] font-semibold">{learningWorkflow.title}</h1></div>
        <span className={`shrink-0 ${noteClass}`}>{entries.length} / {state.helpers.length} ideas</span>
      </header>
      <p className="mt-3.5 mb-5">One idea each for an afternoon with primary-school children: explore together and test knowledge through play.</p>
      {preview && <p className={`mb-4 ${noteClass}`}>Preview with example ideas. No recorded AI responses.</p>}
      <WorkflowDiagram definition={learningWorkflow} state={learningWorkflowState(state)} label="Learning afternoon workflow" direction="down" viewport="fit-width" />
      <section className="mt-5 rounded-lg border border-border bg-card p-4" aria-label="Shared result list">
        <div className={`${rowClass} flex-wrap`}><h2 className="text-base font-semibold">Shared result list</h2><span className={noteClass}>Collected automatically</span></div>
        {entries.length === 0 ? <p className="py-5 text-sm text-muted-foreground">Completed ideas appear here.</p> : <ol className="mt-3 grid gap-3">
          {entries.map((helper) => <li className="border-t border-border pt-3" key={helper.id}><strong className={noteClass}>{helper.label}</strong><p className="mt-1.5 whitespace-pre-wrap">{helper.text}</p></li>)}
        </ol>}
      </section>
      <footer className={`${rowClass} mt-4 min-h-9 flex-wrap`}>
        <p className={noteClass} role="status">{pending ? "Sending tasks" : phaseLabels[state.phase]}</p>
        {state.phase === "ready" && <Button onClick={onStart} disabled={pending || !onStart}>Collect ideas</Button>}
      </footer>
      {error && <p className="mt-2 text-destructive" role="alert">{error}</p>}
    </main>
  );
}
