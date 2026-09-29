import React, { useMemo } from "react";
import { workflowGraph } from "../../../../server/src/plugin-support/actor-programs/workflow/index";
import { FlowDiagram } from "./FlowDiagram";
import type { WorkflowDiagramProps } from "./workflow-diagram-contracts";

export function WorkflowDiagram({ definition, state, ...props }: WorkflowDiagramProps) {
  const projection = useMemo(() => {
    try { return { graph: workflowGraph(definition, state) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [definition, state]);
  return projection.graph
    ? <FlowDiagram direction="down" viewport="fit-width" {...props} {...projection.graph} />
    : <section aria-label={props.label} className={props.className}><p role="alert">The workflow could not be displayed: {projection.error}</p></section>;
}
