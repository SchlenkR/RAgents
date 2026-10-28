import React from "react";
import { Markdown } from "@schlenkr/quassel";
import { QuasselHost } from "../../chat/QuasselHost";
import { DiffCode } from "../../DiffCode";
import { codeScrollbarClass } from "../../highlighting";
import { SourceCode } from "../../SourceCode";
import { Badge, Progress, type BadgeTone } from "../../ui";
import type { DiffViewerProps, DocumentViewerProps, TaskProgressProps } from "./viewer-contracts";

const taskLabels = { pending: "Pending", running: "In progress", done: "Done", error: "Failed", skipped: "Skipped" };
const taskTones: Record<keyof typeof taskLabels, BadgeTone> = { pending: "info", running: "active", done: "success", error: "danger", skipped: "neutral" };

export function TaskProgress({ title = "Tasks", tasks, showProgress = true }: TaskProgressProps) {
  const completed = tasks.filter((task) => task.status === "done" || task.status === "skipped").length;
  return <section aria-label={title} className="min-w-0 text-base" data-slot="task-progress">
    <h3 className="mb-2 text-lg font-semibold">{title}</h3>
    {showProgress && tasks.length > 0 && <div className="mb-2 flex flex-wrap items-center gap-2 text-muted-foreground">
      <Progress aria-label={title} className="min-w-20 flex-1" max={tasks.length} value={completed} />
      <span>{completed} of {tasks.length} completed</span>
    </div>}
    {!tasks.length && <p>No tasks yet.</p>}
    <ol className="divide-y">{tasks.map((task) => <li className="py-2" data-status={task.status} key={task.id}>
      <div className="flex justify-between gap-3"><strong>{task.label}</strong><Badge tone={taskTones[task.status]}>{taskLabels[task.status]}</Badge></div>
      {task.description && <p className="mt-1 text-muted-foreground">{task.description}</p>}
    </li>)}</ol>
  </section>;
}

export function DocumentViewer({ title, content, format = "text", language, filename }: DocumentViewerProps) {
  return <section aria-label={title ?? filename ?? "Document"} className="min-w-0 text-base" data-slot="document-viewer">
    {(title || filename) && <h3 className="mb-2 text-lg font-semibold">{title ?? filename}</h3>}
    {format === "markdown" ? <QuasselHost><div><Markdown text={content} /></div></QuasselHost>
      : format === "code" ? <div className={`max-w-full overflow-auto rounded-lg border border-border bg-background ${codeScrollbarClass}`}><SourceCode content={content} language={language} path={filename ?? ""} /></div>
        : <pre className="m-0 font-[inherit] break-words whitespace-pre-wrap">{content}</pre>}
  </section>;
}

export function DiffViewer({ title = "Changes", patch, emptyText = "No changes.", language, filename }: DiffViewerProps) {
  return <section aria-label={title} className="min-w-0 text-base" data-slot="diff-viewer">
    <h3 className="mb-2 text-lg font-semibold">{title}</h3>
    {!patch ? <p>{emptyText}</p> : <div className="max-w-full overflow-auto rounded-lg border border-border bg-background"><DiffCode content={patch} emptyText={emptyText} language={language} path={filename} /></div>}
  </section>;
}
