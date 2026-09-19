import type { AccessContext } from "../access.ts";
import type { RunView } from "../domain/model.ts";
import { DomainError } from "../runtime/domain-error.ts";
import type { CommandContext, Orchestration } from "../runtime/orchestration.ts";
import { SerialQueue } from "../runtime/serial-queue.ts";
import { descendantsOf, RunStopper, stopLineage, type RunStopBoundary, type RunStopOperation } from "../runtime/stop.ts";
import type { HttpRouteContribution } from "../plugin-types.ts";
import { implement, type MethodContribution } from "../rpc/contribution.ts";
import { ARTIFACT_CONTENT_PATH, runContracts } from "./contracts.ts";

export { ARTIFACT_CONTENT_PATH, artifactContentPath } from "./contracts.ts";

export type RunRightsKind = "read" | "write" | "inspect" | "write-inspect";

export type RuntimeMethodOptions = {
  runtime: Orchestration;
  assertAvailable?: () => void;
  assertRunUsable?: (runId: string) => void;
  abortTurns?: RunStopBoundary;
  stopRun?: RunStopOperation;
  /** Prüft die Rechte des Zugriffs für einen Run oder wirft; der Host kennt Sonderfälle wie den globalen Chat. */
  assertRunRights: (access: AccessContext, runId: string, kind: RunRightsKind) => void;
  projectView: (view: RunView, access: AccessContext) => RunView;
  hasRun: (runId: string) => boolean;
};

const activeActorId = (runtime: Orchestration, runId: string, reference: string) => {
  const state = runtime.state(runId);
  const direct = state.actors.get(reference);
  if (direct) return direct.id;
  const wanted = reference.trim().replace(/^@/, "").toLowerCase();
  const sharing = [...state.actors.values()].filter((actor) => actor.handle === wanted);
  const found = sharing.find((actor) => actor.kind === "human" || actor.lifecycle.kind !== "stopped") ?? sharing.at(-1);
  if (!found) throw new DomainError("actor-not-found", `Actor ${reference} does not exist.`, 404);
  return found.id;
};

/** Die Laufzeitmethoden der Engine: Laufansicht, Journal, Warteschlangen, Stopp und Rückfragen. */
export function runtimeMethods(options: RuntimeMethodOptions): MethodContribution[] {
  const { runtime, assertRunRights, projectView } = options;
  const assertAvailable = options.assertAvailable ?? (() => undefined);
  const assertRunUsable = options.assertRunUsable ?? (() => undefined);
  const commands = new SerialQueue();
  const contextOf = (runId: string, body: { commandId: string; correlationId?: string; causationId?: string }): CommandContext => {
    assertRunUsable(runId);
    return {
      commandId: body.commandId,
      actorId: runtime.state(runId).ownerId,
      ...(body.correlationId ? { correlationId: body.correlationId } : {}),
      ...(body.causationId ? { causationId: body.causationId } : {}),
    };
  };
  const mutate = <Result>(work: () => Result) => commands.run(() => {
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
      return runtime.events(runId);
    }),
    implement(runContracts.enqueueInput, (input, { access }) => {
      prepared(access, input.runId, "write-inspect");
      return mutate(() => {
        runtime.enqueueInput(contextOf(input.runId, input), input.runId, { actorId: input.actorId, content: input.content, artifactIds: input.artifactIds ?? [] });
        return projectView(runtime.view(input.runId), access);
      });
    }),
    implement(runContracts.restartActor, (input, { access }) => {
      prepared(access, input.runId, "write-inspect");
      return mutate(() => {
        runtime.restartActor(contextOf(input.runId, input), input.runId, input.actorId, input.reason ?? "Vom Bediener neu gestartet");
        return projectView(runtime.view(input.runId), access);
      });
    }),
    implement(runContracts.stopActor, (input, { access }) => {
      prepared(access, input.runId, "write");
      return mutate(() => {
        const context = contextOf(input.runId, input);
        const actorId = activeActorId(runtime, input.runId, input.actorId);
        const after = runtime.stopActor(context, input.runId, actorId, input.reason);
        const failures = stopLineage(runtime, input.runId, descendantsOf(after, actorId), input.reason,
          (step) => ({ ...context, commandId: `${input.commandId}:${step}` }));
        if (failures.length > 0) throw new AggregateError(failures, `Actor ${actorId} could not be stopped completely.`);
        return projectView(runtime.view(input.runId), access);
      });
    }),
    implement(runContracts.resolveAction, (input, { access }) => {
      prepared(access, input.runId, "write");
      return mutate(() => {
        runtime.resolveAction(contextOf(input.runId, input), input.runId, input.actionId, { decision: input.decision, response: input.response ?? null });
        return projectView(runtime.view(input.runId), access);
      });
    }),
    implement(runContracts.stopAll, async (input, { access }) => {
      prepared(access, input.runId, "write");
      const view = await mutate(() => stopRun(input.runId, input));
      return projectView(view, access);
    }),
  ];
}

/** Artefaktinhalte sind Auslieferung, keine Nachricht: ein GET mit dem Medientyp des Artefakts. */
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
