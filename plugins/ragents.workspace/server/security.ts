import { Type } from "typebox";
import { DomainError, type AccessContext, type JsonValue, type RunState, type StartOptionContribution } from "@ragents/engine";
import { storedStartOption } from "@ragents/host/ragents/start-option-state.js";
import { WORKSPACE_SANDBOX_OPTION_ID } from "../contract.js";
import type { RunSecurityPolicy } from "./contract.js";

export const securityPolicyFor = (force: boolean, access: AccessContext, state: RunState | null): RunSecurityPolicy => {
  const choice = storedStartOption(state, WORKSPACE_SANDBOX_OPTION_ID);
  if (choice !== undefined && typeof choice !== "boolean") {
    throw new DomainError("workspace-sandbox-invalid", "The stored sandbox choice must be true or false.", 409);
  }
  return { restricted: force || !access.can("*") || choice === true };
};

export const sandboxStartOption = (
  force: boolean,
  accessFor: (userId: string | null) => AccessContext,
  stateFor: (runId: string) => RunState | null,
): StartOptionContribution => ({
  id: WORKSPACE_SANDBOX_OPTION_ID,
  schema: Type.Boolean(),
  selectable: () => true,
  defaultValue: ({ runId, userId }) => {
    const state = stateFor(runId);
    return force || !accessFor(state ? state.ownerUserId : userId).can("*");
  },
  accept: (value, { userId }) => {
    if (typeof value !== "boolean") throw new DomainError("workspace-sandbox-invalid", "The sandbox choice must be true or false.", 400);
    if (!value && (force || !accessFor(userId).can("*"))) {
      throw new DomainError("workspace-sandbox-required", "The server or your permissions require the sandbox.", 403);
    }
    return value;
  },
  describe: (_value, { runId, userId }): JsonValue => {
    const state = stateFor(runId);
    return { kind: "process-sandbox", forced: force || !accessFor(state ? state.ownerUserId : userId).can("*") };
  },
});
