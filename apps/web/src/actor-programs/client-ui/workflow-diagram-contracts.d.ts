import type { ReactElement } from "react";
import type { WorkflowDefinition, WorkflowState } from "../../../../server/src/plugin-support/actor-programs/workflow/index";
import type { FlowDiagramProps } from "./flow-diagram-contracts";

export interface WorkflowDiagramProps extends Omit<FlowDiagramProps, "nodes" | "edges"> {
  definition: WorkflowDefinition;
  state: WorkflowState;
}

export declare function WorkflowDiagram(props: WorkflowDiagramProps): ReactElement;
