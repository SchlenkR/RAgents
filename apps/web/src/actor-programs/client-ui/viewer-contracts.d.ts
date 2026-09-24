import type { ReactElement } from "react";

export interface TaskItem {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  description?: string;
}

export interface TaskProgressProps {
  title?: string;
  tasks: readonly TaskItem[];
  showProgress?: boolean;
}

export interface DocumentViewerProps {
  title?: string;
  content: string;
  format?: "text" | "markdown" | "code";
  /** Sprache für Code-Hervorhebung; alternativ bestimmt filename die Sprache. */
  language?: string;
  filename?: string;
}

export interface DiffViewerProps {
  title?: string;
  /** Bereits vorliegender Unified-Diff; das Control vergleicht keine Dateien und schreibt nichts. */
  patch: string;
  emptyText?: string;
  /** Sprache für Code-Hervorhebung; alternativ bestimmt filename oder der Pfad im Diff die Sprache. */
  language?: string;
  filename?: string;
}

export declare function TaskProgress(props: TaskProgressProps): ReactElement;
export declare function DocumentViewer(props: DocumentViewerProps): ReactElement;
export declare function DiffViewer(props: DiffViewerProps): ReactElement;
