import { DomainError, implement, type MethodContribution } from "@ragents/engine";
import { actorProgramContracts } from "@ragents/host/plugin-support/actor-programs/contract.js";
import type { ActorProgramRuntime } from "./runtime.js";

const MAX_INPUT_BYTES = 64 * 1024;

export interface ActorProgramMethodOptions {
  ensureSession: (runId: string) => void;
  runtime: ActorProgramRuntime;
}

const failed = (cause: unknown, code: string, status: number): DomainError => cause instanceof DomainError
  ? cause
  : new DomainError(code, cause instanceof Error ? cause.message : String(cause), status);

const guarded = <T>(code: string, status: number, work: () => T): T => {
  try {
    return work();
  } catch (cause) {
    throw failed(cause, code, status);
  }
};

const checkedInput = (input: unknown): unknown => {
  if (Buffer.byteLength(JSON.stringify(input ?? null), "utf8") > MAX_INPUT_BYTES)
    throw new DomainError("input-too-large", `Die Aktionseingabe ist größer als ${MAX_INPUT_BYTES} Byte.`, 413);
  return input;
};

export const createActorProgramMethods = (options: ActorProgramMethodOptions): MethodContribution[] => {
  const session = (runId: string, code: string, status: number): void =>
    guarded(code, status, () => options.ensureSession(runId));
  return [
    implement(actorProgramContracts.apps, ({ runId }, { access }) => {
      session(runId, "run-unavailable", 400);
      return {
        apps: options.runtime.apps(runId),
        tools: access.can("runs.inspect") ? options.runtime.runLocalTools(runId) : [],
      };
    }),
    implement(actorProgramContracts.source, async ({ runId, moduleId }) => {
      session(runId, "run-unavailable", 404);
      try {
        return await options.runtime.moduleSource(runId, moduleId);
      } catch (cause) {
        throw failed(cause, "actor-program-unknown", 404);
      }
    }),
    implement(actorProgramContracts.action, ({ runId, appId, revision, actionId, requestId, input }) => {
      session(runId, "run-unavailable", 400);
      return guarded("action-rejected", 400, () => {
        const permit = options.runtime.invocationPermit(runId);
        return options.runtime.startInvocation(runId, appId, revision, actionId, requestId, checkedInput(input), permit);
      });
    }),
    implement(actorProgramContracts.invocation, ({ runId, appId, invocationId }) => {
      session(runId, "run-unavailable", 404);
      return guarded("invocation-unknown", 404, () => options.runtime.invocation(runId, appId, invocationId));
    }),
    implement(actorProgramContracts.function, ({ runId, actorHandle, revision, functionId, requestId, input }) => {
      session(runId, "run-unavailable", 400);
      return guarded("function-rejected", 400, () => {
        const permit = options.runtime.invocationPermit(runId);
        return options.runtime.startFunctionInvocation(runId, actorHandle, revision, functionId, requestId, checkedInput(input), permit);
      });
    }),
    implement(actorProgramContracts.functionInvocation, ({ runId, actorHandle, invocationId }) => {
      session(runId, "run-unavailable", 404);
      return guarded("invocation-unknown", 404, () => options.runtime.invocation(runId, actorHandle, invocationId));
    }),
  ];
};
