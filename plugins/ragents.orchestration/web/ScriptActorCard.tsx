import { useState } from "react";
import { SourceCode } from "@aicontainer/web/SourceCode";
import { CodeXmlIcon } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@aicontainer/web/ui";
import { materialHeadClass, materialIconClass, materialRuleClass, materialTitleClass } from "./MaterialBody";
import type { RunActor } from "./run-view";

const stateBarClass: Readonly<Record<string, string>> = {
  running: "bg-primary animate-fade-pulse motion-reduce:animate-none",
  done: "bg-success",
  failed: "bg-destructive",
};

export function ScriptActorCard({ actor, state, stateLabel, inputCount, onSelect }: {
  actor: RunActor;
  state: string;
  stateLabel: string;
  inputCount: number;
  onSelect: () => void;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  return <>
    <div className={`${materialHeadClass} flex-none`}>
      <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4"
        onClick={onSelect} title={`Details von @${actor.handle} öffnen`} type="button">
        <span className={`${materialIconClass} font-mono text-[10px] font-bold leading-none tracking-[.04em]`} aria-label="TypeScript">TS</span>
        <span className={materialTitleClass}>@{actor.handle}</span>
      </button>
      <Button className="flex-none gap-1.5 rounded-[3px] text-[11px]" size="sm" variant="ghost" disabled={actor.source === undefined}
        title={actor.source === undefined ? "Kein Quelltext in der Laufansicht vorhanden" : `Skript von @${actor.handle} anzeigen`}
        aria-label={`Skript von @${actor.handle} anzeigen`} onClick={() => setSourceOpen(true)}>
        <CodeXmlIcon />
        Skript
      </Button>
    </div>
    <div className={`relative mx-3 flex items-center justify-between gap-3 border-t py-2 text-[11px] leading-4 text-muted-foreground ${materialRuleClass}`}>
      <span className="flex items-center gap-[7px]">
        <span aria-hidden="true" className={`h-2.5 w-[5px] ${stateBarClass[state] ?? "bg-muted-foreground"}`} />
        {stateLabel}
      </span>
      <span title="An diesen Actor zugestellte Eingaben">{inputCount} {inputCount === 1 ? "Eingabe" : "Eingaben"}</span>
    </div>
    {sourceOpen && actor.source !== undefined && <Dialog open onOpenChange={(open) => { if (!open) setSourceOpen(false); }}>
      <DialogContent scope="run" size="wide">
        <DialogHeader>
          <DialogTitle>Skript von @{actor.handle}</DialogTitle>
          <DialogDescription>TypeScript</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] overflow-auto overscroll-contain" role="region"
          aria-label={`TypeScript-Quelltext von @${actor.handle}`} tabIndex={0}>
          <SourceCode className="m-0 overflow-visible" content={actor.source} language="typescript" path={`${actor.handle}.ts`} />
        </DialogBody>
      </DialogContent>
    </Dialog>}
  </>;
}
