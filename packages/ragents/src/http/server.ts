import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunView } from "../domain/model.ts";

import { DomainError } from "../runtime/domain-error.ts";
import type { CommandContext, Orchestration } from "../runtime/orchestration.ts";
import { SerialQueue } from "../runtime/serial-queue.ts";
import {
    descendantsOf,
    RunStopper,
    stopLineage,
    type RunStopBoundary,
    type RunStopOperation,
} from "../runtime/stop.ts";
import * as schemas from "./schemas.ts";
import { parseBody } from "./schemas.ts";

export type RuntimeServerOptions = {
    runtime: Orchestration;
    assertAvailable?: () => void;
    assertRunUsable?: (runId: string) => void;
    abortTurns?: RunStopBoundary;
    stopRun?: RunStopOperation;
};

type RouteContext = {
    params: Record<string, string>;
    body: unknown;
    request: IncomingMessage;
    response: ServerResponse;
    projectView: (view: RunView) => RunView;
};

type RouteResult = { status: number; body: unknown } | { handled: true } | undefined;

type Route = {
    method: string;
    segments: readonly string[];
    handle: (context: RouteContext) => Promise<RouteResult> | RouteResult;
};

const json = (response: ServerResponse, status: number, body: unknown) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
};

const readBody = async (request: IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;

    for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;

        if (size > 1_000_000)
            throw new DomainError("body-too-large", "The request body exceeds 1 MB.", 413);

        chunks.push(buffer);
    }

    return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
};

const match = (route: Route, method: string, path: readonly string[]) => {
    if (route.method !== method || route.segments.length !== path.length)
        return null;

    const params: Record<string, string> = {};

    for (const [index, segment] of route.segments.entries()) {
        const actual = path[index];

        if (actual === undefined)
            return null;

        if (segment.startsWith(":"))
            params[segment.slice(1)] = decodeURIComponent(actual);
        else if (segment !== actual)
            return null;
    }

    return params;
};

const activeActorId = (runtime: Orchestration, runId: string, reference: string) => {
    const state = runtime.state(runId);
    const direct = state.actors.get(reference);

    if (direct)
        return direct.id;

    const wanted = reference.trim().replace(/^@/, "").toLowerCase();
    const sharing = [...state.actors.values()].filter((actor) => actor.handle === wanted);
    const found = sharing.find((actor) => actor.kind === "human" || actor.lifecycle.kind !== "stopped")
        ?? sharing.at(-1);

    if (!found)
        throw new DomainError("actor-not-found", `Actor ${reference} does not exist.`, 404);

    return found.id;
};

export function runtimeRoutes(options: RuntimeServerOptions) {
    const { runtime } = options;
    const assertAvailable = options.assertAvailable ?? (() => undefined);
    const assertRunUsable = options.assertRunUsable ?? (() => undefined);
    const commands = new SerialQueue();
    const contextOf = (
        runId: string,
        body: { commandId: string; correlationId?: string; causationId?: string },
    ): CommandContext => {
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

    const routes: Route[] = [
        {
            method: "GET",
            segments: ["api", "runs", ":runId"],
            handle: ({ params, request, projectView }) => {
                const runId = params.runId ?? "";
                const at = new URL(request.url ?? "/", "http://localhost").searchParams.get("at");

                return { status: 200, body: projectView(at ? runtime.viewAt(runId, Number(at)) : runtime.view(runId)) };
            },
        },
        {
            method: "GET",
            segments: ["api", "runs", ":runId", "events"],
            handle: ({ params }) => ({ status: 200, body: runtime.events(params.runId ?? "") }),
        },
        {
            method: "POST",
            segments: ["api", "runs", ":runId", "actors", ":actorId", "inputs"],
            handle: async ({ params, body }) => {
                const runId = params.runId ?? "";
                const input = parseBody(schemas.enqueueActorInputBody, body);

                return {
                    status: 201,
                    body: await mutate(() => runtime.enqueueInput(contextOf(runId, input), runId, {
                        actorId: params.actorId ?? "",
                        content: input.content,
                        artifactIds: input.artifactIds ?? [],
                    })),
                };
            },
        },
        {
            method: "POST",
            segments: ["api", "runs", ":runId", "actors", ":actorId", "restart"],
            handle: async ({ params, body, projectView }) => {
                const runId = params.runId ?? "";
                const input = parseBody(schemas.optionalReasonBody, body);

                return {
                    status: 200,
                    body: await mutate(() => {
                        const context = contextOf(runId, input);
                        const reason = input.reason ?? "Vom Bediener neu gestartet";

                        runtime.restartActor(context, runId, params.actorId ?? "", reason);

                        return projectView(runtime.view(runId));
                    }),
                };
            },
        },
        {
            method: "POST",
            segments: ["api", "runs", ":runId", "actors", ":actorId", "stop"],
            handle: async ({ params, body, projectView }) => {
                const runId = params.runId ?? "";
                const input = parseBody(schemas.reasonBody, body);

                return {
                    status: 200,
                    body: await mutate(() => {
                        const context = contextOf(runId, input);
                        const actorId = activeActorId(runtime, runId, params.actorId ?? "");
                        const after = runtime.stopActor(context, runId, actorId, input.reason);
                        const failures = stopLineage(
                            runtime,
                            runId,
                            descendantsOf(after, actorId),
                            input.reason,
                            (step) => ({ ...context, commandId: `${input.commandId}:${step}` }),
                        );

                        if (failures.length > 0)
                            throw new AggregateError(failures, `Actor ${actorId} could not be stopped completely.`);

                        return projectView(runtime.view(runId));
                    }),
                };
            },
        },
        {
            method: "POST",
            segments: ["api", "runs", ":runId", "actions", ":actionId", "resolve"],
            handle: async ({ params, body }) => {
                const runId = params.runId ?? "";
                const input = parseBody(schemas.resolveActionBody, body);

                return {
                    status: 200,
                    body: await mutate(() => runtime.resolveAction(
                        contextOf(runId, input),
                        runId,
                        params.actionId ?? "",
                        { decision: input.decision, response: input.response ?? null },
                    )),
                };
            },
        },
        {
            method: "GET",
            segments: ["api", "runs", ":runId", "artifacts", ":artifactId", "content"],
            handle: ({ params, response }) => {
                const runId = params.runId ?? "";
                const { artifact, content } = runtime.artifactContent(
                    runId,
                    params.artifactId ?? "",
                    runtime.state(runId).ownerId,
                );
                response.writeHead(200, {
                    "content-type": artifact.mediaType,
                    "content-length": String(content.byteLength),
                    "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.title)}`,
                    "x-content-type-options": "nosniff",
                });
                response.end(content);

                return { handled: true };
            },
        },
        {
            method: "POST",
            segments: ["api", "runs", ":runId", "stop-all"],
            handle: async ({ params, body, projectView }) => {
                const runId = params.runId ?? "";
                const input = parseBody(schemas.reasonBody, body);

                return { status: 200, body: projectView(await mutate(() => stopRun(runId, input))) };
            },
        },
    ];

    return async (request: IncomingMessage, response: ServerResponse, prefix = "", projectView: (view: RunView) => RunView = (view) => view): Promise<boolean> => {
        const url = new URL(request.url ?? "/", "http://localhost");

        if (prefix && !url.pathname.startsWith(prefix))
            return false;

        const pathname = prefix ? url.pathname.slice(prefix.length) || "/" : url.pathname;
        const method = request.method ?? "GET";
        const path = pathname.split("/").filter(Boolean);

        try {
            for (const route of routes) {
                const params = match(route, method, path);

                if (!params)
                    continue;

                assertAvailable();

                if (params.runId)
                    assertRunUsable(params.runId);

                const body = method === "GET" ? {} : await readBody(request);
                const result = await route.handle({ params, body, request, response, projectView });

                if (result && "handled" in result)
                    return true;

                if (result) {
                    json(response, result.status, result.body);

                    return true;
                }

                return true;
            }

            if (!prefix) {
                json(response, 404, { error: "not-found", message: "The requested resource does not exist." });

                return true;
            }

            return false;
        } catch (error) {
            if (error instanceof DomainError)
                json(response, error.status, { error: error.code, message: error.message });
            else if (error instanceof SyntaxError)
                json(response, 400, { error: "invalid-json", message: error.message });
            else {
                console.error(error);
                json(response, 500, { error: "internal-error", message: "The runtime failed to process the request." });
            }

            return true;
        }
    };
}
