import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { Type } from "typebox";

import { ModelRuntime } from "@ragents/agent";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type Context } from "@ragents/ai";

import { resolveExecution, StaticModelCatalog, type CatalogModel } from "../src/agents/catalog.ts";
import { ToolRegistry } from "../src/agents/plugins.ts";
import { STEERING_MAX_CHARS, TurnScheduler } from "../src/agents/scheduler.ts";
import { defineRunFunction, type RunFunction, type ToolScope } from "../src/agents/tools.ts";
import { FixedWorkspaces } from "../src/agents/workspaces.ts";
import { thinkingLevels } from "../src/domain/driver.ts";
import { project } from "../src/domain/projection.ts";
import { AgentLoopDriver, type AgentHook } from "../src/drivers/agent.ts";
import { allGrants, postTo, setupRun } from "./support.ts";

const HANDED_OVER = "Handed over.";

const handOver = (during: (scope: ToolScope) => void = () => undefined) => defineRunFunction({
    name: "hand_over", label: "Hand over", description: "Hands the work over and ends the turn.",
    schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.String(),
    available: () => true, nativeTool: true,
    endsTurn: (output) => output === HANDED_OVER,
    run: (scope) => {
        during(scope);
        return HANDED_OVER;
    },
});

const note = defineRunFunction({
    name: "note", label: "Note", description: "Notes something.",
    schema: Type.Object({}, { additionalProperties: false }), resultSchema: Type.String(),
    available: () => true, nativeTool: true,
    run: () => "Noted.",
});

const handOverStep = (...extra: string[]) => fauxAssistantMessage(
    [fauxToolCall("hand_over", {}, { id: "call-hand-over" }), ...extra.map((name) => fauxToolCall(name, {}, { id: `call-${name}` }))],
    { stopReason: "toolUse" },
);

const rolesOf = (context: Context) => context.messages.map((message) => message.role);

const textOf = (message: Context["messages"][number] | undefined) =>
    message === undefined || message.role === "assistant" ? "" : typeof message.content === "string"
        ? message.content
        : message.content.map((part) => part.type === "text" ? part.text : "").join("");

/** A scheduler with the agent loop on a scripted model; the model sees only the given native tools. */
const scripted = (t: TestContext, tools: readonly RunFunction[], hooks: readonly AgentHook[] = []) => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-turn-ending-"));
    const faux = registerFauxProvider({ models: [{ id: "turn-ending-engine", reasoning: false }], tokensPerSecond: 100000 });
    const modelRuntime = ModelRuntime.create();
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl,
        apiKey: "faux-key",
        api: faux.api,
        models: faux.models.map((entry) => ({
            id: entry.id, name: entry.name, api: entry.api, reasoning: entry.reasoning, input: entry.input, cost: entry.cost,
            contextWindow: entry.contextWindow, maxTokens: entry.maxTokens, baseUrl: entry.baseUrl,
        })),
    });
    const models: CatalogModel[] = [{
        driver: "agent", provider: model.provider, model: model.id, label: `${model.provider}/${model.id}`, thinking: thinkingLevels,
    }];
    const catalog = new StaticModelCatalog(models, [{
        name: "agent", description: "Faux", driver: "agent", provider: model.provider, model: model.id,
        turnTimeoutMs: 600_000, isolateWorkspace: false,
    }]);
    const setup = setupRun({
        grants: allGrants(),
        execution: resolveExecution(catalog, { profile: "agent", isolateWorkspace: false }, "worker", models),
    });
    const driver = new AgentLoopDriver({ modelRuntime, resolveHooks: () => hooks });
    const registry = new ToolRegistry().register({ name: "turn-ending", dynamic: true, descriptors: [], tools: () => [...tools] });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: { agent: driver }, catalog, registry, workspaces: new FixedWorkspaces(directory),
    });
    t.after(async () => {
        await scheduler.stop();
        await driver.shutdown().catch(() => undefined);
        faux.unregister();
        setup.journal.close();
        rmSync(directory, { recursive: true, force: true });
    });
    const contexts: Context[] = [];
    const answer = (text: string) => (context: Context) => {
        contexts.push({ messages: structuredClone(context.messages) });
        return fauxAssistantMessage(text);
    };
    const post = (commandId: string, content: string) => postTo(setup.runtime, setup.view, setup.agent.id, commandId, content);
    const view = () => setup.runtime.view(setup.view.id);
    const events = () => setup.runtime.events(setup.view.id);

    return { ...setup, faux, scheduler, contexts, answer, post, view, events };
};

test("a result that ends the turn completes it after a tool-use step, and the next input continues the context", async (t) => {
    const run = scripted(t, [handOver(), note]);
    run.faux.setResponses([handOverStep(), run.answer("Continuing.")]);
    run.post("start", "Prepare the release.");
    run.scheduler.start();
    await run.scheduler.waitForIdle();

    assert.equal(run.faux.state.callCount, 1, "no model request after the ending call");
    const ended = run.view().turns[0]!;
    assert.equal(ended.status, "completed");
    assert.deepEqual(ended.toolCalls.map((call) => [call.name, call.status]), [["hand_over", "completed"]]);
    const types = run.events().map((event) => event.type);
    assert.deepEqual(types.slice(types.indexOf("model.step.completed")), [
        "model.step.completed", "tool.call.started", "tool.call.completed", "model.tool-result.presented", "turn.finished",
    ]);
    const step = run.events().find((event) => event.type === "model.step.completed");
    assert.equal(step?.type === "model.step.completed" ? step.payload.stopReason : undefined, "toolUse");

    run.post("next", "Go on.");
    await run.scheduler.waitForIdle();

    assert.equal(run.faux.state.callCount, 2);
    assert.deepEqual(run.view().turns.map((turn) => turn.status), ["completed", "completed"]);
    const context = run.contexts[0]!;
    assert.deepEqual(rolesOf(context), ["user", "assistant", "toolResult", "user"], "the tool result stays in place before the next input");
    assert.equal(textOf(context.messages[2]), HANDED_OVER);
    assert.match(textOf(context.messages[3]), /^\[Actors in the run, as of turn start\]\n[\s\S]*\n\nGo on\.$/);
    assert.doesNotThrow(() => project(run.events()), "the journal check accepts a turn that ends with a tool result");
});

test("an input that arrives during the ending call joins the turn as steering, one too long starts the next turn", async (t) => {
    const steered = scripted(t, [handOver((scope) => postTo(scope.runtime, scope.runtime.view(scope.caller.runId), scope.caller.actorId, "during", "Also run the tests."))]);
    steered.faux.setResponses([handOverStep(), steered.answer("Tests are green.")]);
    steered.post("start", "Prepare the release.");
    steered.scheduler.start();
    await steered.scheduler.waitForIdle();

    assert.equal(steered.faux.state.callCount, 2, "the waiting input gets its model request");
    const [turn] = steered.view().turns;
    assert.equal(steered.view().turns.length, 1);
    assert.deepEqual(steered.view().inputs.map((input) => input.lifecycle), [
        { kind: "claimed", turnId: turn!.id, steered: false },
        { kind: "claimed", turnId: turn!.id, steered: true },
    ]);
    assert.deepEqual(rolesOf(steered.contexts[0]!).slice(-2), ["toolResult", "user"]);
    assert.equal(textOf(steered.contexts[0]!.messages.at(-1)), "Also run the tests.");

    const long = "x".repeat(STEERING_MAX_CHARS + 1);
    const waiting = scripted(t, [handOver((scope) => postTo(scope.runtime, scope.runtime.view(scope.caller.runId), scope.caller.actorId, "during", long))]);
    waiting.faux.setResponses([handOverStep(), waiting.answer("Read it.")]);
    waiting.post("start", "Prepare the release.");
    waiting.scheduler.start();
    await waiting.scheduler.waitForIdle();

    assert.equal(waiting.faux.state.callCount, 2);
    const [first, second] = waiting.view().turns;
    assert.deepEqual(waiting.view().turns.map((entry) => entry.status), ["completed", "completed"]);
    assert.deepEqual(waiting.view().inputs.map((input) => input.lifecycle), [
        { kind: "claimed", turnId: first!.id, steered: false },
        { kind: "claimed", turnId: second!.id, steered: false },
    ], "the input the ending turn left waiting starts the next turn");
    assert.deepEqual(rolesOf(waiting.contexts[0]!), ["user", "assistant", "toolResult", "user"]);
});

test("the turn goes on when another call of the same step does not end it or a hook turns the result into an error", async (t) => {
    const mixed = scripted(t, [handOver(), note]);
    mixed.faux.setResponses([handOverStep("note"), mixed.answer("Both done.")]);
    mixed.post("start", "Prepare the release.");
    mixed.scheduler.start();
    await mixed.scheduler.waitForIdle();
    assert.equal(mixed.faux.state.callCount, 2);
    assert.equal(mixed.view().turns.length, 1);

    const replaced = (isError: boolean): AgentHook => ({
        id: "test.check",
        afterToolCall: (outcome) => outcome.toolName === "hand_over" ? { content: [{ type: "text", text: "Checked." }], isError } : undefined,
    });
    const refused = scripted(t, [handOver()], [replaced(true)]);
    refused.faux.setResponses([handOverStep(), refused.answer("I will fix it.")]);
    refused.post("start", "Prepare the release.");
    refused.scheduler.start();
    await refused.scheduler.waitForIdle();
    assert.equal(refused.faux.state.callCount, 2, "the model reacts to the error in the same turn");

    const checked = scripted(t, [handOver()], [replaced(false)]);
    checked.faux.setResponses([handOverStep()]);
    checked.post("start", "Prepare the release.");
    checked.scheduler.start();
    await checked.scheduler.waitForIdle();
    assert.equal(checked.faux.state.callCount, 1, "a replacement without an error keeps the end of the turn");
    assert.equal(checked.view().turns[0]!.status, "completed");
});
