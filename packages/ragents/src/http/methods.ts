import type { AccessContext } from "../access.ts";
import type { RunPauseRequest, TurnInterruption } from "../agents/scheduler.ts";
import type { RunView } from "../domain/model.ts";
import { DomainError } from "../runtime/domain-error.ts";
import type { CommandContext, Orchestration } from "../runtime/orchestration.ts";
import { addressedActorOf } from "../runtime/guards.ts";
import { KeyedSerialQueue } from "../runtime/serial-queue.ts";
import { RunStopper, type RunStopBoundary, type RunStopOperation } from "../runtime/stop.ts";
import type { HttpRouteContribution } from "../plugin-types.ts";
import { implement, type MethodContribution } from "../rpc/contribution.ts";
import { ARTIFACT_CONTENT_PATH, runContracts } from "./contracts.ts";

export { ARTIFACT_CONTENT_PATH, artifactContentPath } from "./contracts.ts";

/** `stop` requires the rights of `write` but does not operate the run, and is therefore also allowed for a run that only its owner operates. */
export type RunRightsKind = "read" | "write" | "inspect" | "write-inspect" | "stop";

export type RuntimeMethodOptions = {
  runtime: Orchestration;
  assertAvailable?: () => void;
  assertRunUsable?: (runId: string) => void;
  abortTurns?: RunStopBoundary;
  stopRun?: RunStopOperation;
  /** Ends the running turn of one actor and keeps the actor active; without a running turn it does nothing. */
  interruptTurn: (runId: string, actorId: string, interruption: TurnInterruption) => Promise<void>;
  /** Pauses the whole run: run.paused first, then the running turns of all actors end. */
  pauseRun: (runId: string, pause: RunPauseRequest) => Promise<void>;
  /** Checks the rights of the access for a run or throws; the host knows special cases such as the global chat. */
  assertRunRights: (access: AccessContext, runId: string, kind: RunRightsKind) => void;
  projectView: (view: RunView, access: AccessContext) => RunView;
  hasRun: (runId: string) => boolean;
};

const userOf = (access: AccessContext): { userId?: string } => access.user ? { userId: access.user.id } : {};

/** The runtime methods of the engine: run view, journal, queues, interrupt, pause, stop and questions. */
export function runtimeMethods(options: RuntimeMethodOptions): MethodContribution[] {
  const { runtime, assertRunRights, projectView } = options;
  const assertAvailable = options.assertAvailable ?? (() => undefined);
  const assertRunUsable = options.assertRunUsable ?? (() => undefined);
  const commands = new KeyedSerialQueue();
  const contextOf = (runId: string, body: { commandId: string; correlationId?: string; causationId?: string }): CommandContext => {
    assertRunUsable(runId);
    return {
      commandId: body.commandId,
      actorId: runtime.state(runId).ownerId,
      ...(body.correlationId ? { correlationId: body.correlationId } : {}),
      ...(body.causationId ? { causationId: body.causationId } : {}),
    };
  };
  const mutate = <Result>(runId: string, work: () => Result) => commands.run(runId, () => {
    assertAvailable();
    return work();
  });
  const localStopper = new RunStopper({
    runtime,
    primaryActorId: (view) => view.primaryActorId,
    ...(options.abortTurns ? { stopExternal: options.abortTurns } : {}),
  });
  const stopRun = options.stopRun ?? localStopper.stop;
  const prepared = (access: AccessContext, runId: string, kind: RunRightsKind) => {
    assertAvailable();
    assertRunRights(access, runId, kind);
    assertRunUsable(runId);
  };

  return [
    implement(runContracts.view, ({ runId, at }, { access }) => {
      prepared(access, runId, "read");
      if (!options.hasRun(runId)) return null;
      return projectView(at === undefined ? runtime.view(runId) : runtime.viewAt(runId, at), access);
    }),
    implement(runContracts.events, ({ runId }, { access }) => {
      prepared(access, runId, "inspect");
      return runtime.publicEvents(runId);
    }),
    implement(runContracts.enqueueInput, (input, { access }) => {
      prepared(access, input.runId, "write-inspect");
      return mutate(input.runId, () => {
        runtime.enqueueInput(contextOf(input.runId, input), input.runId, {
          actorId: input.actorId, content: input.content, artifactIds: input.artifactIds ?? [], origin: "human", ...userOf(access),
        });
        return projectView(runtime.view(input.runId), access);
      });
    }),
    implement(runContracts.restartActor, (input, { access }) => {
      prepared(access, input.runId, "write-inspect");
      return mutate(input.runId, () => {
        const actorId = addressedActorOf(runtime.state(input.runId).actors.values(), input.actorId).id;
        runtime.restartActor(contextOf(input.runId, input), input.runId, actorId, input.reason ?? "Restarted by the operator");
        return projectView(runtime.view(input.runId), access);
      });
    }),
    implement(runContracts.stopActor, (input, { access }) => {
      prepared(access, input.runId, "stop");
      return mutate(input.runId, () => {
        const actorId = addressedActorOf(runtime.state(input.runId).actors.values(), input.actorId).id;
        return projectView(runtime.stopActor(contextOf(input.runId, input), input.runId, actorId, input.reason), access);
      });
    }),
    implement(runContracts.interruptTurn, async (input, { access }) => {
      prepared(access, input.runId, "stop");
      const actorId = addressedActorOf(runtime.state(input.runId).actors.values(), input.actorId).id;
      await options.interruptTurn(input.runId, actorId, {
        context: contextOf(input.runId, input),
        reason: input.reason ?? "Turn interrupted by the operator",
      });
      return projectView(runtime.view(input.runId), access);
    }),
    implement(runContracts.pause, async (input, { access }) => {
      prepared(access, input.runId, "stop");
      await options.pauseRun(input.runId, {
        context: contextOf(input.runId, input),
        reason: input.reason ?? "Paused by the operator",
        ...userOf(access),
      });
      return projectView(runtime.view(input.runId), access);
    }),
    implement(runContracts.resume, (input, { access }) => {
      prepared(access, input.runId, "write");
      return mutate(input.runId, () => projectView(runtime.resumeRun(contextOf(input.runId, input), input.runId, userOf(access)), access));
    }),
    implement(runContracts.resolveAction, (input, { access }) => {
      prepared(access, input.runId, "write");
      return mutate(input.runId, () => {
        runtime.resolveAction(contextOf(input.runId, input), input.runId, input.actionId, { decision: input.decision, result: input.result ?? null });
        return projectView(runtime.view(input.runId), access);
      });
    }),
    implement(runContracts.stopAll, async (input, { access }) => {
      prepared(access, input.runId, "stop");
      const view = await mutate(input.runId, () => stopRun(input.runId, input));
      return projectView(view, access);
    }),
  ];
}

/** Artifact contents are delivery, not a message: a GET with the media type of the artifact. */
export function artifactContentRoute(options: Pick<RuntimeMethodOptions, "runtime" | "assertAvailable" | "assertRunUsable" | "assertRunRights">): HttpRouteContribution {
  return {
    id: "ragents.runs.artifact-content",
    requiredRights: [],
    isApiPath: (pathname) => ARTIFACT_CONTENT_PATH.test(pathname),
    matches: (request, url) => request.method === "GET" && ARTIFACT_CONTENT_PATH.test(url.pathname),
    handle: ({ response, url, access }) => {
      const match = url.pathname.match(ARTIFACT_CONTENT_PATH)!;
      const runId = decodeURIComponent(match[1]!);
      const artifactId = decodeURIComponent(match[2]!);
      try {
        options.assertAvailable?.();
        options.assertRunRights(access, runId, "read");
        options.assertRunUsable?.(runId);
        const { artifact, content } = options.runtime.artifactContent(runId, artifactId, options.runtime.state(runId).ownerId);
        response.writeHead(200, {
          "content-type": artifact.mediaType,
          "content-length": String(content.byteLength),
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.title)}`,
          "x-content-type-options": "nosniff",
        });
        response.end(content);
      } catch (error) {
        const status = error instanceof DomainError ? error.status : 500;
        response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error), ...(error instanceof DomainError ? { code: error.code } : {}) }));
      }
    },
  };
}
