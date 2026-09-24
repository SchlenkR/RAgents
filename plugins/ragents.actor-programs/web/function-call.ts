import type { RunAppInvocation, ActorProgramsApi, RunScriptTool } from "./api";
import type { JsonValue } from "./bridge";

const waitForPoll = (signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  signal.throwIfAborted();
  const finish = (): void => { signal.removeEventListener("abort", abort); resolve(); };
  const timer = setTimeout(finish, 350);
  const abort = (): void => { clearTimeout(timer); reject(signal.reason); };
  signal.addEventListener("abort", abort, { once: true });
});

export const invokeActorFunction = async (
  api: ActorProgramsApi,
  runId: string,
  tool: Pick<RunScriptTool, "actorHandle" | "functionId" | "revision">,
  input: JsonValue,
  signal: AbortSignal,
  changed: (invocation: RunAppInvocation) => void,
): Promise<RunAppInvocation> => {
  let invocation = await api.invokeFunction(runId, tool.actorHandle, tool.revision, tool.functionId, crypto.randomUUID().replaceAll("-", ""), input, signal);
  changed(invocation);
  while (invocation.status === "queued" || invocation.status === "running") {
    await waitForPoll(signal);
    invocation = await api.functionInvocation(runId, tool.actorHandle, invocation.id, signal);
    changed(invocation);
  }
  return invocation;
};
