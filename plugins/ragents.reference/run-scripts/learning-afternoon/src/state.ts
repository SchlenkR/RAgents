import type { WorkflowState } from "@ragents/workflow";
import { helperSteps } from "./workflow.js";

export interface HelperState {
  id: string;
  label: string;
  task: string;
  status: "waiting" | "working" | "complete" | "error";
  text: string;
  error?: string;
  actorId?: string;
  inputId?: string;
}

export interface LearningState {
  phase: "ready" | "working" | "complete" | "error";
  helpers: HelperState[];
}

export const initialState: LearningState = {
  phase: "ready",
  helpers: helperSteps.map((step, index) => ({ id: step.id, label: `Helfer ${String.fromCharCode(65 + index)}`, task: step.title, status: "waiting", text: "" })),
};

const helperStatuses = { waiting: "pending", working: "active", complete: "done", error: "blocked" } as const;

export function learningWorkflowState(state: LearningState): WorkflowState {
  return { steps: {
    ...Object.fromEntries(state.helpers.map((helper) => [helper.id, {
      status: helperStatuses[helper.status],
      detail: helper.error ?? `${helper.label}: ${helper.task}`,
    }])),
    collect: {
      status: state.phase === "complete" ? "done" : state.phase === "error" ? "blocked" : state.phase === "working" ? "active" : "pending",
      detail: `${state.helpers.filter((helper) => helper.status === "complete").length} von ${state.helpers.length} Ideen gesammelt.`,
    },
  } };
}
