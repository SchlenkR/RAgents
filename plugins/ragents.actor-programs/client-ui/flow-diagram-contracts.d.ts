import type { ReactElement } from "react";

export interface FlowDiagramProps {
  nodes: readonly {
    id: string;
    label: string;
    detail?: string;
    status?: "pending" | "active" | "done" | "blocked";
    running?: boolean;
    items?: readonly { label: string; status?: "pending" | "active" | "done" | "blocked" | "skipped"; detail?: string }[];
    kind?: "actor" | "agent" | "service";
    actions?: readonly { id: string; label: string; disabled?: boolean; primary?: boolean }[];
  }[];
  edges: readonly { id?: string; source: string; target: string; label?: string; kind?: "return"; status?: "pending" | "active" | "done" | "blocked" }[];
  label: string;
  /** "star" places the first node in the middle and the others around it. */
  layout?: "layered" | "star";
  direction?: "right" | "down";
  className?: string;
  height?: number;
  detailLevel?: "full" | "summary";
  /** "fit" scales the diagram into the available width and height. */
  viewport?: "interactive" | "fit-width" | "fit";
  onAction?: (nodeId: string, actionId: string) => void;
}

export declare function FlowDiagram(props: FlowDiagramProps): ReactElement;
