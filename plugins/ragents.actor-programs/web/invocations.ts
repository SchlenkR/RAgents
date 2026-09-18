import type { ActorProgramsApi, RunApp, RunAppInvocation } from "./api";

type InvocationTarget = { invocationId: string } & (
  | { kind: "app"; appId: string }
  | { kind: "function"; actorHandle: string }
);

export const activeActorInvocations = (apps: readonly RunApp[], includeFunctions = true): InvocationTarget[] => {
  const appIds = new Set(apps.map((app) => app.id));
  const active = new Map<string, InvocationTarget>();
  for (const app of apps) for (const invocation of app.invocations) {
    if (invocation.status === "queued" || invocation.status === "running") {
      if (!includeFunctions && !appIds.has(invocation.appId)) continue;
      active.set(`${invocation.actorId}/${invocation.id}`, appIds.has(invocation.appId)
        ? { kind: "app", appId: invocation.appId, invocationId: invocation.id }
        : { kind: "function", actorHandle: invocation.actorHandle, invocationId: invocation.id });
    }
  }
  return [...active.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, target]) => target);
};

export const readActorInvocation = (
  api: ActorProgramsApi,
  runId: string,
  target: InvocationTarget,
  signal?: AbortSignal,
): Promise<RunAppInvocation> => target.kind === "app"
  ? api.invocation(runId, target.appId, target.invocationId, signal)
  : api.functionInvocation(runId, target.actorHandle, target.invocationId, signal);

export const invocationTime = (invocation: RunAppInvocation): number => {
  const raw = invocation.status === "queued"
    ? invocation.createdAt
    : invocation.status === "running"
      ? invocation.startedAt
      : invocation.finishedAt;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
};

export const latestInvocation = (app: RunApp): RunAppInvocation | undefined =>
  app.invocations.reduce<RunAppInvocation | undefined>((latest, invocation) =>
    !latest || invocationTime(invocation) >= invocationTime(latest) ? invocation : latest, undefined);
