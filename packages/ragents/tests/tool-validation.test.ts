import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Type } from "typebox";

import { ModelRuntime } from "@ragents/agent";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider, type Context } from "@ragents/ai";

import { resolveExecution, StaticModelCatalog, type CatalogModel } from "../src/agents/catalog.ts";
import { ToolRegistry } from "../src/agents/plugins.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { defineRunFunction, defineToolAvailability, describeToolAvailability } from "../src/agents/tools.ts";
import { FixedWorkspaces } from "../src/agents/workspaces.ts";
import { thinkingLevels } from "../src/domain/driver.ts";
import { validatedEventPayloadOf } from "../src/domain/event-validation.ts";
import type { JournalEvent } from "../src/domain/events.ts";
import { AgentLoopDriver } from "../src/drivers/agent.ts";
import { allGrants, postTo, setupRun } from "./support.ts";

const always = defineToolAvailability({
    availability: "always",
    availabilityDetail: "Available in every turn.",
}, () => true);

const strictTool = defineRunFunction({
    name: "strict_tool",
    label: "strict_tool",
    description: "First line of strict_tool. Needs a target.",
    schema: Type.Object({ target: Type.String() }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: always,
    nativeTool: true,
    run: (_scope, _toolCallId, input: { target: string }) => input.target,
});

const contextTool = defineRunFunction({
    name: "context_tool",
    label: "context_tool",
    description: "First line of context_tool. Takes no input.",
    schema: Type.Object({}, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: always,
    nativeTool: true,
    run: () => "Context.",
});

const nestedTool = defineRunFunction({
    name: "nested_tool",
    label: "nested_tool",
    description: "First line of nested_tool. Needs options.",
    schema: Type.Object({
        options: Type.Object({ depth: Type.Integer() }, { additionalProperties: false }),
    }, { additionalProperties: false }),
    resultSchema: Type.Integer(),
    available: always,
    nativeTool: true,
    run: (_scope, _toolCallId, input: { options: { depth: number } }) => input.options.depth,
});

const silentTool = defineRunFunction({
    name: "silent_tool",
    label: "silent_tool",
    description: "First line of silent_tool. Fails without its own message.",
    schema: Type.Object({}, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: always,
    nativeTool: true,
    run: (): string => { throw new Error("   ", { cause: new Error("The cause is only in cause.") }); },
});

const causelessTool = defineRunFunction({
    name: "causeless_tool",
    label: "causeless_tool",
    description: "First line of causeless_tool. Fails without a message and without a cause.",
    schema: Type.Object({}, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: always,
    nativeTool: true,
    run: (): string => { throw new Error(""); },
});

let vanished = false;

const vanishingTool = defineRunFunction({
    name: "vanishing_tool",
    label: "vanishing_tool",
    description: "First line of vanishing_tool. Disappears after the selection.",
    schema: Type.Object({}, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: defineToolAvailability({ availability: "conditional", availabilityDetail: "Until it disappears." }, () => !vanished),
    nativeTool: true,
    run: () => "Still there.",
});

const registryWithTools = () => {
    const registry = new ToolRegistry();
    registry.register({
        name: "test.validation",
        descriptors: [strictTool, contextTool, nestedTool, silentTool, causelessTool, vanishingTool].map((tool) => ({
            name: tool.name,
            description: tool.description,
            scope: "per-turn",
            nativeTool: true,
            ...describeToolAvailability(tool.available),
        })),
        tools: () => [strictTool, contextTool, nestedTool, silentTool, causelessTool, vanishingTool],
    });

    return registry;
};

const toolCallEventsOf = (events: readonly JournalEvent[], toolCallId: string) =>
    events.filter((event) =>
        (event.type === "tool.call.started" || event.type === "tool.call.completed" || event.type === "tool.call.failed") &&
        event.payload.toolCallId === toolCallId);

const toolResultTextOf = (context: Context, toolCallId: string) => {
    const message = context.messages.find((entry) => entry.role === "toolResult" && entry.toolCallId === toolCallId);
    const block = message?.role === "toolResult" ? message.content.find((entry) => entry.type === "text") : undefined;

    return block?.type === "text" ? block.text : null;
};

const fauxScheduler = async (directory: string, responses: Parameters<ReturnType<typeof registerFauxProvider>["setResponses"]>[0]) => {
    const faux = registerFauxProvider({ models: [{ id: "tool-validation", reasoning: false }] });
    faux.setResponses(responses);
    const modelRuntime = ModelRuntime.create();
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl,
        apiKey: "faux-key",
        api: faux.api,
        models: faux.models.map((entry) => ({
            id: entry.id,
            name: entry.name,
            api: entry.api,
            reasoning: entry.reasoning,
            input: entry.input,
            cost: entry.cost,
            contextWindow: entry.contextWindow,
            maxTokens: entry.maxTokens,
            baseUrl: entry.baseUrl,
        })),
    });
    const models: CatalogModel[] = [{
        driver: "agent",
        provider: model.provider,
        model: model.id,
        label: `${model.provider}/${model.id}`,
        thinking: thinkingLevels,
    }];
    const fauxCatalog = new StaticModelCatalog(models, [{
        name: "agent",
        description: "Test profile with the faux model.",
        driver: "agent",
        provider: model.provider,
        model: model.id,
        turnTimeoutMs: 600_000,
        isolateWorkspace: false,
    }]);
    const setup = setupRun({
        grants: allGrants(),
        execution: resolveExecution(fauxCatalog, { profile: "agent", isolateWorkspace: false }, "worker", models),
    });
    const driver = new AgentLoopDriver({ modelRuntime });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: { agent: driver },
        catalog: fauxCatalog,
        registry: registryWithTools(),
        workspaces: new FixedWorkspaces(directory),
    });
    const run = async () => {
        postTo(setup.runtime, setup.view, setup.agent.id, "validation-input", "Go.");
        scheduler.start();
        await scheduler.waitForIdle();

        return setup.runtime.events(setup.view.id);
    };
    const close = async () => {
        await scheduler.stop();
        await driver.shutdown().catch(() => undefined);
        faux.unregister();
        setup.journal.close();
    };

    return { run, close };
};

test("a rejected tool call is in the journal with its input and error text", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-tool-validation-"));
    const { run, close } = await fauxScheduler(directory, [
        () => fauxAssistantMessage([fauxToolCall("strict_tool", {}, { id: "call-invalid" })]),
        () => fauxAssistantMessage([fauxToolCall("strict_tool", { target: "Target" }, { id: "call-valid" })]),
        () => fauxAssistantMessage([fauxToolCall("ghost_tool", {}, { id: "call-unknown" })]),
        () => fauxAssistantMessage("Done."),
    ]);

    try {
        const events = await run();
        const invalid = toolCallEventsOf(events, "call-invalid");

        assert.deepEqual(invalid.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
        assert.equal(invalid[0]?.type === "tool.call.started" ? invalid[0].payload.name : null, "strict_tool");
        assert.deepEqual(invalid[0]?.type === "tool.call.started" ? invalid[0].payload.input : null, {});
        assert.match(
            invalid[1]?.type === "tool.call.failed" ? invalid[1].payload.error : "",
            /Validation failed for tool "strict_tool"/,
        );

        const valid = toolCallEventsOf(events, "call-valid");

        assert.deepEqual(valid.map((event) => event.type), ["tool.call.started", "tool.call.completed"]);
        assert.deepEqual(valid[0]?.type === "tool.call.started" ? valid[0].payload.input : null, { target: "Target" });

        const unknown = toolCallEventsOf(events, "call-unknown");

        assert.deepEqual(unknown.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
        assert.match(
            unknown[1]?.type === "tool.call.failed" ? unknown[1].payload.error : "",
            /ghost_tool/,
        );
    } finally {
        await close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("a tool error without a message is in the journal with its cause or a substitute text", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-tool-cause-"));
    const { run, close } = await fauxScheduler(directory, [
        () => fauxAssistantMessage([fauxToolCall("silent_tool", {}, { id: "call-silent" })]),
        () => fauxAssistantMessage([fauxToolCall("causeless_tool", {}, { id: "call-causeless" })]),
        () => fauxAssistantMessage("Done."),
    ]);

    try {
        const events = await run();
        const silent = toolCallEventsOf(events, "call-silent");

        assert.deepEqual(silent.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
        assert.equal(
            silent[1]?.type === "tool.call.failed" ? silent[1].payload.error : "",
            "The cause is only in cause.",
        );

        const causeless = toolCallEventsOf(events, "call-causeless");

        assert.deepEqual(causeless.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
        assert.equal(
            causeless[1]?.type === "tool.call.failed" ? causeless[1].payload.error : "",
            "Error without a cause",
        );
    } finally {
        await close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("a tool that disappears between selection and call gives the model an error result and the turn continues", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-tool-vanished-"));
    vanished = false;
    let seen: string | null = null;
    const { run, close } = await fauxScheduler(directory, [
        () => { vanished = true; return fauxAssistantMessage([fauxToolCall("vanishing_tool", {}, { id: "call-vanished" })]); },
        (context: Context) => { seen = toolResultTextOf(context, "call-vanished"); return fauxAssistantMessage("Done."); },
    ]);

    try {
        const events = await run();
        const calls = toolCallEventsOf(events, "call-vanished");

        assert.deepEqual(calls.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
        assert.match(seen ?? "", /not available/);
        assert.deepEqual(events.filter((event) => event.type === "turn.finished").map((event) => event.type === "turn.finished" && event.payload.outcome), ["completed"]);
    } finally {
        vanished = false;
        await close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("a call id reused within the turn becomes unique, every call runs and the turn ends normally", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-tool-reused-id-"));
    let seen: Context | undefined;
    const { run, close } = await fauxScheduler(directory, [
        () => fauxAssistantMessage([fauxToolCall("strict_tool", { target: "A" }, { id: "call-same" })]),
        () => fauxAssistantMessage([fauxToolCall("strict_tool", { target: "B" }, { id: "call-same" })]),
        () => fauxAssistantMessage([fauxToolCall("strict_tool", { target: "A" }, { id: "call-same" }), fauxToolCall("strict_tool", { target: "C" }, { id: "call-same" })]),
        (context: Context) => { seen = context; return fauxAssistantMessage("Done."); },
    ]);

    try {
        const events = await run();
        const started = events.filter((event) => event.type === "tool.call.started");
        const ids = started.map((event) => event.type === "tool.call.started" && event.payload.toolCallId);

        assert.equal(new Set(ids).size, 4);
        assert.deepEqual(started.map((event) => event.type === "tool.call.started" && event.payload.input), [{ target: "A" }, { target: "B" }, { target: "A" }, { target: "C" }]);
        assert.deepEqual(ids.map((id) => toolResultTextOf(seen!, id as string)), ["A", "B", "A", "C"]);
        assert.deepEqual(events.filter((event) => event.type === "turn.finished").map((event) => event.type === "turn.finished" && event.payload.outcome), ["completed"]);
    } finally {
        await close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("unknown fields are removed, the call runs and the model sees the note", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-tool-tolerance-"));
    const seen: Record<string, string | null> = {};
    const { run, close } = await fauxScheduler(directory, [
        () => fauxAssistantMessage([fauxToolCall("context_tool", { previous: "[]", __unused: "{}" }, { id: "call-ignored" })]),
        (context) => {
            seen.ignored = toolResultTextOf(context, "call-ignored");
            return fauxAssistantMessage([fauxToolCall("strict_tool", { target: "Target", extra: 1 }, { id: "call-extra" })]);
        },
        (context) => {
            seen.extra = toolResultTextOf(context, "call-extra");
            return fauxAssistantMessage("Done.");
        },
    ]);

    try {
        const events = await run();
        const ignored = toolCallEventsOf(events, "call-ignored");

        assert.deepEqual(ignored.map((event) => event.type), ["tool.call.started", "tool.call.completed"]);
        const started = ignored[0]?.type === "tool.call.started" ? ignored[0].payload : null;
        assert.deepEqual(started, {
            turnId: started?.turnId,
            toolCallId: "call-ignored",
            name: "context_tool",
            input: {},
            ignoredFields: ["previous", "__unused"],
        });
        assert.equal(
            seen.ignored,
            "Note: context_tool takes no input; the fields previous, __unused are unknown and were ignored.\n\nContext.",
        );

        const extra = toolCallEventsOf(events, "call-extra");

        assert.deepEqual(extra.map((event) => event.type), ["tool.call.started", "tool.call.completed"]);
        assert.deepEqual(extra[0]?.type === "tool.call.started" ? extra[0].payload.input : null, { target: "Target" });
        assert.deepEqual(extra[0]?.type === "tool.call.started" ? extra[0].payload.ignoredFields : null, ["extra"]);
        assert.equal(seen.extra, "Note: strict_tool does not know the field extra, which was ignored.\n\nTarget");
    } finally {
        await close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("unknown fields next to missing required fields or in nested objects stay hard errors", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-tool-hard-errors-"));
    const seen: Record<string, string | null> = {};
    const { run, close } = await fauxScheduler(directory, [
        () => fauxAssistantMessage([fauxToolCall("strict_tool", { extra: 1 }, { id: "call-missing" })]),
        (context) => {
            seen.missing = toolResultTextOf(context, "call-missing");
            return fauxAssistantMessage([fauxToolCall("nested_tool", { options: { depth: 1, colour: "red" } }, { id: "call-nested" })]);
        },
        (context) => {
            seen.nested = toolResultTextOf(context, "call-nested");
            return fauxAssistantMessage("Done.");
        },
    ]);

    try {
        const events = await run();
        const missing = toolCallEventsOf(events, "call-missing");

        assert.deepEqual(missing.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
        assert.deepEqual(missing[0]?.type === "tool.call.started" ? missing[0].payload.input : null, { extra: 1 });
        assert.match(seen.missing ?? "", /target: must have required properties target/);
        assert.match(seen.missing ?? "", /root: unknown fields extra/);

        const nested = toolCallEventsOf(events, "call-nested");

        assert.deepEqual(nested.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
        assert.match(seen.nested ?? "", /options: unknown fields colour/);
    } finally {
        await close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("the start payload accepts ignored fields only as a non-empty list of names", () => {
    const valid = { turnId: "turn", toolCallId: "call", name: "context_tool", input: {} };
    assert.deepEqual(validatedEventPayloadOf("tool.call.started", valid, "started"), valid);
    assert.deepEqual(
        validatedEventPayloadOf("tool.call.started", { ...valid, ignoredFields: ["previous"] }, "started"),
        { ...valid, ignoredFields: ["previous"] },
    );
    for (const invalid of [{ ...valid, ignoredFields: [] }, { ...valid, ignoredFields: [""] }, { ...valid, ignoredFields: "previous" }, { ...valid, ignoredFields: [1] }])
        assert.throws(() => validatedEventPayloadOf("tool.call.started", invalid, "started"), /must be|must not be empty/);
});
