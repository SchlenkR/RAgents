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
  /** Language for code highlighting; alternatively filename determines the language. */
  language?: string;
  filename?: string;
}

export interface DiffViewerProps {
  title?: string;
  /** An existing unified diff; the control compares no files and writes nothing. */
  patch: string;
  emptyText?: string;
  /** Language for code highlighting; alternatively filename or the path in the diff determines the language. */
  language?: string;
  filename?: string;
}

export declare function TaskProgress(props: TaskProgressProps): ReactElement;
export declare function DocumentViewer(props: DocumentViewerProps): ReactElement;
export declare function DiffViewer(props: DiffViewerProps): ReactElement;
