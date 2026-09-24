import assert from "node:assert/strict";
import test from "node:test";

import { resolveExecution, StaticModelCatalog, type CatalogModel, type ExecutionRequest } from "../src/agents/catalog.ts";
import { thinkingLevels } from "../src/domain/driver.ts";
import { DomainError } from "../src/runtime/domain-error.ts";
import { catalog, catalogModels } from "./support.ts";

const executionOf = (request: ExecutionRequest, models: readonly CatalogModel[] = catalogModels) =>
    resolveExecution(catalog, request, "agent-1", models);

const selectionOf = (request: ExecutionRequest, models: readonly CatalogModel[] = catalogModels) => {
    const execution = executionOf(request, models);

    return execution.driver.kind === "manual" ? null : execution.driver.config;
};

const domainErrorOf = (code: string) => (error: unknown) =>
    error instanceof DomainError && error.code === code && error.status === 400;

test("a model named without a provider takes its provider from the catalog", () => {
    assert.deepEqual(selectionOf({ driver: "agent", model: "qwen3" }), { provider: "ollama", model: "qwen3" });
});

test("the label form provider/model from model_list is accepted as input", () => {
    assert.deepEqual(
        selectionOf({ driver: "agent", model: "openrouter/fable-5" }),
        { provider: "openrouter", model: "fable-5" },
    );
    assert.deepEqual(
        selectionOf({ driver: "agent", provider: "openrouter", model: "openrouter/fable-5" }),
        { provider: "openrouter", model: "fable-5" },
    );
});

test("a model the catalog does not know is refused with the exact spawn form in the message", () => {
    assert.throws(() => selectionOf({ driver: "agent", model: "moonshotai/kimi-k3" }), domainErrorOf("model-not-found"));
    assert.throws(
        () => selectionOf({ driver: "agent", model: "moonshotai/kimi-k3" }),
        /SEPARATE fields.*provider "openrouter" with model "fable-5"; provider "ollama" with model "qwen3"/,
    );
});

test("a model of another driver stays unknown, because a provider is only valid for its own driver", () => {
    assert.throws(() => selectionOf({ driver: "agent", model: "claude-opus-5" }), domainErrorOf("model-not-found"));
});

test("a model that several providers offer has to be named with its provider", () => {
    const twins: CatalogModel[] = [
        { driver: "agent", provider: "openrouter", model: "fable-5", label: "openrouter/fable-5", thinking: thinkingLevels },
        { driver: "agent", provider: "bedrock", model: "fable-5", label: "bedrock/fable-5", thinking: thinkingLevels },
    ];

    assert.throws(() => selectionOf({ driver: "agent", model: "fable-5" }, twins), domainErrorOf("model-ambiguous"));
    assert.deepEqual(selectionOf({ driver: "agent", provider: "bedrock", model: "fable-5" }, twins), {
        provider: "bedrock",
        model: "fable-5",
    });
});

test("a provider without a model is refused as well", () => {
    assert.throws(() => selectionOf({ driver: "agent", provider: "ollama" }), domainErrorOf("model-missing"));
});

test("provider and model given together stay exactly as asked", () => {
    assert.deepEqual(selectionOf({ driver: "agent", provider: "ollama", model: "qwen3", thinking: "high" }), {
        provider: "ollama",
        model: "qwen3",
        thinking: "high",
    });
});

const gradedModels: CatalogModel[] = [
    { driver: "agent", provider: "ollama", model: "qwen3", label: "ollama/qwen3", thinking: ["off", "low"] },
    { driver: "agent", provider: "ollama", model: "unlimited", label: "ollama/unlimited", thinking: thinkingLevels },
];

test("a thinking level the model offers is kept", () => {
    assert.deepEqual(selectionOf({ driver: "agent", model: "qwen3", thinking: "low" }, gradedModels), {
        provider: "ollama",
        model: "qwen3",
        thinking: "low",
    });
});

test("inherited profile thinking is validated against an overridden model before spawning", () => {
    const profiles = new StaticModelCatalog(gradedModels, [{
        name: "writer", driver: "agent", provider: "ollama", model: "unlimited", thinking: "medium",
        description: "Writer", turnTimeoutMs: null, isolateWorkspace: true,
    }]);
    assert.throws(
        () => resolveExecution(profiles, { profile: "writer", model: "qwen3" }, "worker", gradedModels),
        /thinking medium.*Valid levels for it: off, low/,
    );
    const execution = resolveExecution(profiles, { profile: "writer", model: "qwen3", thinking: "low" }, "worker", gradedModels);
    assert.deepEqual(execution.driver.config, { provider: "ollama", model: "qwen3", thinking: "low" });
});

test("model-specific extended thinking levels survive selection", () => {
    for (const thinking of ["minimal", "xhigh", "max"] as const) {
        assert.deepEqual(selectionOf({ driver: "agent", model: "unlimited", thinking }, gradedModels), {
            provider: "ollama", model: "unlimited", thinking,
        });
    }
});

test("a thinking level the model does not offer is refused with the valid levels", () => {
    assert.throws(
        () => selectionOf({ driver: "agent", model: "qwen3", thinking: "high" }, gradedModels),
        domainErrorOf("thinking-not-supported"),
    );
    assert.throws(
        () => selectionOf({ driver: "agent", model: "qwen3", thinking: "high" }, gradedModels),
        /Valid levels for it: off, low/,
    );
});

test("a model that declares every thinking level accepts every level", () => {
    assert.deepEqual(selectionOf({ driver: "agent", model: "unlimited", thinking: "high" }, gradedModels), {
        provider: "ollama",
        model: "unlimited",
        thinking: "high",
    });
});

test("an agent execution without any model is refused at spawn time, not at turn time", () => {
    assert.throws(() => executionOf({ driver: "agent" }), domainErrorOf("model-missing"));
    assert.throws(() => executionOf({ driver: "agent" }), /needs a model to run turns.*profile from model_list/);
});

test("omitting both profile and model names usable profiles without suggesting manual actors", () => {
    assert.throws(() => executionOf({}), (error: unknown) => {
        assert.ok(error instanceof DomainError);
        assert.equal(error.code, "model-missing");
        assert.match(error.message, /Known profiles for agent: agent\./);
        assert.doesNotMatch(error.message, /manual/);
        return true;
    });
    assert.deepEqual(selectionOf({ profile: "agent" }), { provider: "ollama", model: "qwen3" });
});

test("missing models do not advertise nonexistent profiles", () => {
    const emptyCatalog = new StaticModelCatalog(catalogModels, []);
    assert.throws(() => resolveExecution(emptyCatalog, {}, "agent-1", catalogModels), /Known profiles for agent: none\./);
});

test("the test profile agent resolves to its configured model", () => {
    assert.deepEqual(selectionOf({ profile: "agent" }), { provider: "ollama", model: "qwen3" });
});

test("a manual agent carries no model selection at all", () => {
    assert.deepEqual(executionOf({ profile: "manual" }, []), {
        driver: { kind: "manual", config: {} },
        workspacePath: null,
        turnTimeoutMs: null,
    });
});
