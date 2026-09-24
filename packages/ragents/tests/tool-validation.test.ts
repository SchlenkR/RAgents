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
import { defineRunFunction, defineToolAvailability } from "../src/agents/tools.ts";
import { FixedWorkspaces } from "../src/agents/workspaces.ts";
import { thinkingLevels } from "../src/domain/driver.ts";
import { validatedEventPayloadOf } from "../src/domain/event-validation.ts";
import type { JournalEvent } from "../src/domain/events.ts";
import { AgentSessionDriver } from "../src/drivers/agent.ts";
import { allGrants, postTo, setupRun } from "./support.ts";

const always = defineToolAvailability({
    availability: "always",
    availabilityDetail: "In jedem Turn verfügbar.",
}, () => true);

const strictTool = defineRunFunction({
    name: "strict_tool",
    label: "strict_tool",
    description: "Erste Zeile von strict_tool. Braucht ein Ziel.",
    schema: Type.Object({ target: Type.String() }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: always,
    nativeTool: true,
    run: (_scope, _toolCallId, input: { target: string }) => input.target,
});

const contextTool = defineRunFunction({
    name: "context_tool",
    label: "context_tool",
    description: "Erste Zeile von context_tool. Nimmt keine Eingabe.",
    schema: Type.Object({}, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: always,
    nativeTool: true,
    run: () => "Kontext.",
});

const nestedTool = defineRunFunction({
    name: "nested_tool",
    label: "nested_tool",
    description: "Erste Zeile von nested_tool. Braucht Optionen.",
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
    description: "Erste Zeile von silent_tool. Scheitert ohne eigene Meldung.",
    schema: Type.Object({}, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: always,
    nativeTool: true,
    run: (): string => { throw new Error("   ", { cause: new Error("Die Ursache steht nur im cause.") }); },
});

const causelessTool = defineRunFunction({
    name: "causeless_tool",
    label: "causeless_tool",
    description: "Erste Zeile von causeless_tool. Scheitert ohne Meldung und ohne Ursache.",
    schema: Type.Object({}, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: always,
    nativeTool: true,
    run: (): string => { throw new Error(""); },
});

const registryWithTools = () => {
    const registry = new ToolRegistry();
    registry.register({
        name: "test.validation",
        descriptors: [strictTool, contextTool, nestedTool, silentTool, causelessTool].map((tool) => ({
            name: tool.name,
            description: tool.description,
            scope: "per-turn",
            nativeTool: true,
            availability: "always",
            availabilityDetail: "In jedem Turn verfügbar.",
        })),
        tools: () => [strictTool, contextTool, nestedTool, silentTool, causelessTool],
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
        description: "Testprofil mit dem Faux-Modell.",
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
    const driver = new AgentSessionDriver({ modelRuntime });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: { agent: driver },
        catalog: fauxCatalog,
        registry: registryWithTools(),
        workspaces: new FixedWorkspaces(directory),
    });
    const run = async () => {
        postTo(setup.runtime, setup.view, setup.agent.id, "validation-input", "Los.");
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

test("ein abgelehnter Werkzeugaufruf steht mit Eingabe und Fehlertext im Journal", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-tool-validation-"));
    const { run, close } = await fauxScheduler(directory, [
        () => fauxAssistantMessage([fauxToolCall("strict_tool", {}, { id: "call-invalid" })]),
        () => fauxAssistantMessage([fauxToolCall("strict_tool", { target: "Ziel" }, { id: "call-valid" })]),
        () => fauxAssistantMessage([fauxToolCall("ghost_tool", {}, { id: "call-unknown" })]),
        () => fauxAssistantMessage("Fertig."),
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
        assert.deepEqual(valid[0]?.type === "tool.call.started" ? valid[0].payload.input : null, { target: "Ziel" });

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

test("ein Werkzeugfehler ohne Meldung steht mit Ursache oder Ersatztext im Journal", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-tool-cause-"));
    const { run, close } = await fauxScheduler(directory, [
        () => fauxAssistantMessage([fauxToolCall("silent_tool", {}, { id: "call-silent" })]),
        () => fauxAssistantMessage([fauxToolCall("causeless_tool", {}, { id: "call-causeless" })]),
        () => fauxAssistantMessage("Fertig."),
    ]);

    try {
        const events = await run();
        const silent = toolCallEventsOf(events, "call-silent");

        assert.deepEqual(silent.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
        assert.equal(
            silent[1]?.type === "tool.call.failed" ? silent[1].payload.error : "",
            "Die Ursache steht nur im cause.",
        );

        const causeless = toolCallEventsOf(events, "call-causeless");

        assert.deepEqual(causeless.map((event) => event.type), ["tool.call.started", "tool.call.failed"]);
        assert.equal(
            causeless[1]?.type === "tool.call.failed" ? causeless[1].payload.error : "",
            "Fehler ohne Ursache",
        );
    } finally {
        await close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("unbekannte Felder werden entfernt, der Aufruf läuft und das Modell sieht den Hinweis", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-tool-tolerance-"));
    const seen: Record<string, string | null> = {};
    const { run, close } = await fauxScheduler(directory, [
        () => fauxAssistantMessage([fauxToolCall("context_tool", { previous: "[]", __unused: "{}" }, { id: "call-ignored" })]),
        (context) => {
            seen.ignored = toolResultTextOf(context, "call-ignored");
            return fauxAssistantMessage([fauxToolCall("strict_tool", { target: "Ziel", extra: 1 }, { id: "call-extra" })]);
        },
        (context) => {
            seen.extra = toolResultTextOf(context, "call-extra");
            return fauxAssistantMessage("Fertig.");
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
            "Hinweis: context_tool nimmt keine Eingabe; die Felder previous, __unused sind unbekannt und wurden ignoriert.\n\nKontext.",
        );

        const extra = toolCallEventsOf(events, "call-extra");

        assert.deepEqual(extra.map((event) => event.type), ["tool.call.started", "tool.call.completed"]);
        assert.deepEqual(extra[0]?.type === "tool.call.started" ? extra[0].payload.input : null, { target: "Ziel" });
        assert.deepEqual(extra[0]?.type === "tool.call.started" ? extra[0].payload.ignoredFields : null, ["extra"]);
        assert.equal(seen.extra, "Hinweis: das Feld extra kennt strict_tool nicht und wurde ignoriert.\n\nZiel");
    } finally {
        await close();
        rmSync(directory, { recursive: true, force: true });
    }
});

test("unbekannte Felder neben fehlenden Pflichtfeldern oder in verschachtelten Objekten bleiben harte Fehler", async () => {
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
            return fauxAssistantMessage("Fertig.");
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

test("die Startpayload nimmt ignorierte Felder nur als nicht leere Namensliste an", () => {
    const valid = { turnId: "turn", toolCallId: "call", name: "context_tool", input: {} };
    assert.deepEqual(validatedEventPayloadOf("tool.call.started", valid, "started"), valid);
    assert.deepEqual(
        validatedEventPayloadOf("tool.call.started", { ...valid, ignoredFields: ["previous"] }, "started"),
        { ...valid, ignoredFields: ["previous"] },
    );
    for (const invalid of [{ ...valid, ignoredFields: [] }, { ...valid, ignoredFields: [""] }, { ...valid, ignoredFields: "previous" }, { ...valid, ignoredFields: [1] }])
        assert.throws(() => validatedEventPayloadOf("tool.call.started", invalid, "started"), /must be|must not be empty/);
});
