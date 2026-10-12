import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { ModelRuntime } from "@ragents/agent";

import { resolveExecution, StaticModelCatalog, type CatalogModel } from "../src/agents/catalog.ts";
import { LiveBus } from "../src/agents/live.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { FixedWorkspaces } from "../src/agents/workspaces.ts";
import { RunStopper } from "../src/runtime/stop.ts";
import { thinkingLevels } from "../src/domain/driver.ts";
import { AgentLoopDriver } from "../src/drivers/agent.ts";
import { deferred, postTo, setupRun, type Deferred } from "./support.ts";

const MODEL_ID = "acme/streaming";
const PARTIAL = "Partial answer";
const REASON = "Stopped in the chat";

type Transport = "OpenRouter" | "OpenAI-compatible";

type Phase = "before the first byte" | "while streaming";

/** One request as the provider saw it; cut means the client closed the connection before the response ended. */
type Exchange = {
    path: string;
    finished: boolean;
    cutByClient: boolean;
    cut: Deferred;
};

const within = async <T>(operation: Promise<T>, what: string, timeoutMs = 3_000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            operation,
            new Promise<T>((_, rejectPromise) => {
                timer = setTimeout(() => rejectPromise(new Error(`${what} did not happen within ${timeoutMs} ms.`)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer)
            clearTimeout(timer);
    }
};

const chunk = (delta: object, finishReason: string | null = null) => `data: ${JSON.stringify({
    id: "response-1",
    object: "chat.completion.chunk",
    created: 1,
    model: MODEL_ID,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
})}\n\n`;

/** A streaming chat-completions endpoint: it keeps the first response open and answers every later request completely. */
const providerEndpoint = async (t: TestContext, phase: Phase) => {
    const exchanges: Exchange[] = [];
    const received = deferred();
    const server = createServer(async (request, response) => {
        const exchange: Exchange = { path: request.url ?? "", finished: false, cutByClient: false, cut: deferred() };
        exchanges.push(exchange);
        response.on("finish", () => { exchange.finished = true; });
        response.on("close", () => {
            if (response.writableEnded)
                return;

            exchange.cutByClient = true;
            exchange.cut.resolve();
        });
        for await (const _chunk of request) {}

        if (exchanges.length > 1) {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.end(`${chunk({ role: "assistant", content: "Done." }, "stop")}data: [DONE]\n\n`);
            return;
        }

        if (phase === "while streaming") {
            response.writeHead(200, { "content-type": "text/event-stream" });
            response.write(chunk({ role: "assistant", content: PARTIAL }));
        }

        received.resolve();
    });

    try {
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM")
            throw error;

        return null;
    }

    t.after(() => new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => error ? reject(error) : resolve());
    }));
    const address = server.address();
    assert.ok(address && typeof address === "object");

    return { exchanges, received, origin: `http://127.0.0.1:${address.port}`, disconnect: () => server.closeAllConnections() };
};

/** The model runtime as the server builds it: the built-in OpenRouter provider, or a profile provider on the OpenAI-compatible API. */
const modelRuntimeFor = (transport: Transport, origin: string) => {
    const model = {
        id: MODEL_ID, name: "Streaming test", api: "openai-completions" as const, reasoning: false, input: ["text" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 1_024,
    };
    const provider = transport === "OpenRouter" ? "openrouter" : "acme";
    const modelRuntime = ModelRuntime.create();
    modelRuntime.registerProvider(provider, transport === "OpenRouter"
        ? { apiKey: "test-only", models: [model] }
        : { baseUrl: `${origin}/v1`, apiKey: "test-only", api: "openai-completions", models: [model] });

    return { modelRuntime, provider };
};

const settle = async (scheduler: TurnScheduler) => {
    await scheduler.waitForIdle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await scheduler.waitForIdle();
};

for (const transport of ["OpenRouter", "OpenAI-compatible"] as const) {
    for (const phase of ["before the first byte", "while streaming"] as const) {
        test(`a stop ${phase} closes the ${transport} connection of the running model request, ends the turn as interrupted and sends nothing until a human continues`, { timeout: 15_000 }, async (t) => {
            const endpoint = await providerEndpoint(t, phase);

            if (!endpoint) {
                t.skip("Sandbox does not allow a local listener");
                return;
            }

            const addressed: string[] = [];

            if (transport === "OpenRouter") {
                const realFetch = globalThis.fetch;
                t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
                    const url = new URL(input instanceof Request ? input.url : input);

                    if (url.origin !== "https://openrouter.ai")
                        throw new Error(`The test allows no request to ${url.origin}.`);

                    addressed.push(url.href);
                    return realFetch(new URL(`${url.pathname}${url.search}`, endpoint.origin), init);
                });
            }

            const directory = mkdtempSync(join(tmpdir(), "ragents-stop-provider-"));
            const { modelRuntime, provider } = modelRuntimeFor(transport, endpoint.origin);
            const models: CatalogModel[] = [{ driver: "agent", provider, model: MODEL_ID, label: `${provider}/${MODEL_ID}`, thinking: thinkingLevels }];
            const catalog = new StaticModelCatalog(models, [{
                name: "agent", description: "Local provider", driver: "agent", provider, model: MODEL_ID,
                turnTimeoutMs: 600_000, isolateWorkspace: false,
            }]);
            const setup = setupRun({ execution: resolveExecution(catalog, { profile: "agent", isolateWorkspace: false }, "worker", models) });
            const runId = setup.view.id;
            const ownerId = setup.view.ownerId;
            const agentId = setup.agent.id;
            // A retry after the abort would reach the provider at once instead of after seconds.
            const driver = new AgentLoopDriver({ modelRuntime, settings: { retry: { baseDelayMs: 1 } } });
            const live = new LiveBus();
            const streamed = deferred();
            const deltas: string[] = [];
            live.subscribe(runId, agentId, (event) => {
                if (event.kind !== "text")
                    return;

                deltas.push(event.delta);
                streamed.resolve();
            });
            const errors: unknown[] = [];
            // Below the driver's own abort deadline, so a turn that ignores the abort stays visible as running.
            const interruptWaitMs = 2_000;
            const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
                drivers: { agent: driver }, catalog, live, workspaces: new FixedWorkspaces(directory), interruptWaitMs,
                onError: (error) => { errors.push(error); },
            });

            try {
                postTo(setup.runtime, setup.view, agentId, "input", "Write the report.");
                scheduler.start();
                await within(endpoint.received.promise, "The model request");

                if (phase === "while streaming")
                    await within(streamed.promise, "The first streamed text");

                const first = endpoint.exchanges[0]!;
                assert.equal(first.cutByClient, false, "the request is still open before the stop");
                assert.equal(scheduler.isRunning(runId, agentId), true);

                const stoppedAt = Date.now();
                const stopper = new RunStopper({ runtime: setup.runtime, interruptTurns: (id, interruption) => scheduler.interruptRun(id, interruption) });
                await stopper.stop(runId, { commandId: "stop", reason: REASON, userId: "alice" });
                const stopMs = Date.now() - stoppedAt;
                const runningAfterStop = scheduler.isRunning(runId, agentId);

                await within(first.cut.promise, "The client closing the provider connection");
                assert.equal(first.cutByClient, true);
                assert.equal(first.finished, false, "the provider never finished the response");
                assert.equal(runningAfterStop, false, "the driver settled after the abort, not after the interruption wait");
                assert.ok(stopMs < interruptWaitMs, `the stop took ${stopMs} ms`);
                assert.equal(endpoint.exchanges.length, 1);

                const events = setup.runtime.events(runId);
                const stopped = events.findIndex((event) => event.type === "run.stopped");
                const interruptions = events.flatMap((event, index) => event.type === "turn.interrupted" ? [{ index, event, reason: event.payload.reason }] : []);
                assert.equal(interruptions.length, 1);
                assert.ok(stopped >= 0 && stopped < interruptions[0]!.index, "run.stopped precedes turn.interrupted");
                assert.equal(interruptions[0]!.reason, REASON);
                assert.equal(interruptions[0]!.event.commandId, `stop:interrupt:${agentId}`);
                assert.equal(events.some((event) => event.type === "turn.finished" || event.type === "model.step.completed"), false);
                const kept = events.flatMap((event, index) => event.type === "model.output.interrupted" ? [{ index, text: event.payload.text }] : []);
                assert.deepEqual(kept.map((entry) => entry.text), phase === "while streaming" ? [PARTIAL] : []);
                assert.ok(kept.every((entry) => stopped < entry.index && entry.index < interruptions[0]!.index), "the streamed text is kept between stop and interruption");
                assert.deepEqual(deltas, phase === "while streaming" ? [PARTIAL] : []);
                const view = setup.runtime.view(runId);
                assert.deepEqual(view.turns.map((turn) => turn.status), ["interrupted"]);
                assert.equal(view.stopped?.reason, REASON);

                postTo(setup.runtime, setup.view, agentId, "while-stopped", "An automatic notice.");
                await settle(scheduler);
                assert.equal(endpoint.exchanges.length, 1, "no request reaches the provider while the run is stopped");
                assert.equal(setup.runtime.events(runId).slice(stopped).some((event) => event.type === "turn.started"), false);

                setup.runtime.enqueueInput({ actorId: ownerId, commandId: "continue" }, runId, { actorId: agentId, content: "Continue now.", origin: "human", userId: "alice" });
                await settle(scheduler);
                assert.equal(endpoint.exchanges.length, 2, "the human input continues the run with exactly one new request");
                assert.equal(endpoint.exchanges[1]!.finished, true);
                assert.equal(endpoint.exchanges[1]!.cutByClient, false);
                assert.deepEqual(setup.runtime.view(runId).turns.map((turn) => turn.status), ["interrupted", "completed"]);
                assert.deepEqual(endpoint.exchanges.map((exchange) => exchange.path), transport === "OpenRouter"
                    ? ["/api/v1/chat/completions", "/api/v1/chat/completions"]
                    : ["/v1/chat/completions", "/v1/chat/completions"]);
                assert.deepEqual(addressed, transport === "OpenRouter"
                    ? ["https://openrouter.ai/api/v1/chat/completions", "https://openrouter.ai/api/v1/chat/completions"]
                    : []);
                assert.deepEqual(errors, []);
            } finally {
                endpoint.disconnect();
                await scheduler.stop();
                await driver.shutdown().catch(() => undefined);
                setup.journal.close();
                rmSync(directory, { recursive: true, force: true });
            }
        });
    }
}
