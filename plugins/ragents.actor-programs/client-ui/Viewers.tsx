import React from "react";
import { Markdown } from "../../../apps/web/src/chat/Markdown";
import { DiffCode } from "../../../apps/web/src/DiffCode";
import { SourceCode } from "../../../apps/web/src/SourceCode";
import { cn, Progress } from "../../../apps/web/src/ui";
import type { DiffViewerProps, DocumentViewerProps, TaskProgressProps } from "./viewer-contracts";

const taskLabels = { pending: "Offen", running: "In Arbeit", done: "Erledigt", error: "Fehlgeschlagen", skipped: "Übersprungen" };
const taskTones = { pending: "text-muted-foreground", running: "text-primary", done: "text-muted-foreground", error: "text-destructive", skipped: "text-muted-foreground" };

export function TaskProgress({ title = "Aufgaben", tasks, showProgress = true }: TaskProgressProps) {
  const completed = tasks.filter((task) => task.status === "done" || task.status === "skipped").length;
  return <section aria-label={title} className="min-w-0 text-sm">
    <h3 className="mb-2 text-[15px] font-semibold">{title}</h3>
    {showProgress && tasks.length > 0 && <div className="mb-2 flex flex-wrap items-center gap-2 text-muted-foreground">
      <Progress aria-label={title} className="min-w-20 flex-1" max={tasks.length} value={completed} />
      <span>{completed} von {tasks.length} abgeschlossen</span>
    </div>}
    {!tasks.length && <p>Noch keine Aufgaben.</p>}
    <ol className="divide-y">{tasks.map((task) => <li className="py-1.5" data-status={task.status} key={task.id}>
      <div className="flex justify-between gap-3"><strong>{task.label}</strong><span className={cn("whitespace-nowrap", taskTones[task.status])}>{taskLabels[task.status]}</span></div>
      {task.description && <p className="mt-1 text-muted-foreground">{task.description}</p>}
    </li>)}</ol>
  </section>;
}

export function DocumentViewer({ title, content, format = "text", language, filename }: DocumentViewerProps) {
  return <section aria-label={title ?? filename ?? "Dokument"} className="min-w-0 text-sm">
    {(title || filename) && <h3 className="mb-2 text-[15px] font-semibold">{title ?? filename}</h3>}
    {format === "markdown" ? <Markdown text={content} />
      : format === "code" ? <SourceCode content={content} language={language} path={filename ?? ""} />
        : <pre className="m-0 font-[inherit] break-words whitespace-pre-wrap">{content}</pre>}
  </section>;
}

export function DiffViewer({ title = "Änderungen", patch, emptyText = "Keine Änderungen.", language, filename }: DiffViewerProps) {
  return <section aria-label={title} className="min-w-0 text-sm">
    <h3 className="mb-2 text-[15px] font-semibold">{title}</h3>
    {!patch ? <p>{emptyText}</p> : <div className="max-w-full overflow-auto rounded-lg border"><DiffCode content={patch} emptyText={emptyText} language={language} path={filename} /></div>}
  </section>;
}
