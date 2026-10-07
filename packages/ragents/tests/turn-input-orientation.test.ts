import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ModelRuntime } from "@ragents/agent";
import { fauxAssistantMessage, registerFauxProvider, type Context } from "@ragents/ai";

import { resolveExecution, StaticModelCatalog, type CatalogModel } from "../src/agents/catalog.ts";
import { modelContextOf } from "../src/agents/model-context.ts";
import { TurnScheduler } from "../src/agents/scheduler.ts";
import { FixedWorkspaces } from "../src/agents/workspaces.ts";
import { thinkingLevels } from "../src/domain/driver.ts";
import { AgentLoopDriver } from "../src/drivers/agent.ts";
import type { SteeredInput } from "../src/drivers/types.ts";
import { Journal } from "../src/runtime/journal.ts";
import { Orchestration } from "../src/runtime/orchestration.ts";
import { allGrants, catalog, FakeDriver, manualExecution, noUsage, postTo, setupRun, testServices } from "./support.ts";

const userTextsOf = (message: Context["messages"][number] | undefined): string[] =>
    message?.role !== "user" ? []
        : typeof message.content === "string" ? [message.content]
        : message.content.flatMap((part) => part.type === "text" ? [part.text] : []);

test("the system prompt stays byte-identical across turns; preloaded skills and the roster go into each turn's input and replay unchanged", async (t) => {
    const directory = mkdtempSync(join(tmpdir(), "ragents-input-orientation-"));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    mkdirSync(join(directory, "skills", "review"), { recursive: true });
    writeFileSync(join(directory, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Reviews drafts.\n---\nRead checklist.md first.\n");
    const skill = {
        name: "review",
        description: "Reviews drafts.",
        filePath: join(directory, "skills", "review", "SKILL.md"),
        baseDir: join(directory, "skills", "review"),
        location: "@skills/review/SKILL.md",
        disableModelInvocation: false,
    };
    const faux = registerFauxProvider({ models: [{ id: "input-orientation", reasoning: false }], tokensPerSecond: 1_000_000 });
    t.after(() => faux.unregister());
    const modelRuntime = ModelRuntime.create();
    const model = faux.getModel();
    modelRuntime.registerProvider(model.provider, {
        baseUrl: model.baseUrl, apiKey: "faux-key", api: faux.api,
        models: faux.models.map((entry) => ({
            id: entry.id, name: entry.name, api: entry.api, reasoning: entry.reasoning, input: entry.input,
            cost: entry.cost, contextWindow: entry.contextWindow, maxTokens: entry.maxTokens, baseUrl: entry.baseUrl,
        })),
    });
    const models: CatalogModel[] = [{ driver: "agent", provider: model.provider, model: model.id, label: model.id, thinking: thinkingLevels }];
    const fauxCatalog = new StaticModelCatalog(models, [{
        name: "agent", description: "Faux", driver: "agent", provider: model.provider, model: model.id,
        turnTimeoutMs: 600_000, isolateWorkspace: false,
    }]);
    const requests: Context[] = [];
    const answer = (text: string) => (context: Context) => {
        requests.push(JSON.parse(JSON.stringify(context)) as Context);
        return fauxAssistantMessage(text);
    };
    faux.setResponses([answer("Reviewed."), answer("Continued."), answer("Wrapped up.")]);
    const engineFor = (journal: Journal, runtime: Orchestration) => {
        const driver = new AgentLoopDriver({ modelRuntime, resolveSkills: () => [skill], skillPreload: { selector: async () => null } });
        const scheduler = new TurnScheduler(runtime, journal, { drivers: { agent: driver }, catalog: fauxCatalog, workspaces: new FixedWorkspaces(directory) });
        return { driver, scheduler, stop: async () => { await scheduler.stop(); await driver.shutdown(); } };
    };

    const services = testServices();
    const journal = new Journal(join(directory, "runs"), services);
    const runtime = new Orchestration(journal, services);
    const run = runtime.createRun({ commandId: "create" }, { title: "Orientation", ownerHandle: "owner", ownerDisplayName: "Owner" });
    const spawn = (handle: string, execution = manualExecution(), toolNames: string[] | null = []) => runtime.spawnAgent(
        { actorId: run.ownerId, commandId: `spawn-${handle}` }, run.id,
        { handle, displayName: handle, prompt: `You are ${handle}.`, execution, grants: allGrants(), toolNames },
    ).actors.find((actor) => actor.handle === handle)!.id;
    const worker = spawn("worker", resolveExecution(fauxCatalog, { profile: "agent", isolateWorkspace: false }, "worker", models), null);
    const kai = spawn("kai");
    const post = (commandId: string, content: string, target = runtime) => target.enqueueInput({ actorId: run.ownerId, commandId }, run.id, { actorId: worker, content });
    const first = engineFor(journal, runtime);

    try {
        first.scheduler.start();
        post("first", "/skill:review Check the draft.");
        await first.scheduler.waitForIdle();
        runtime.stopActor({ actorId: run.ownerId, commandId: "stop-kai" }, run.id, kai, "Done.");
        spawn("lena");
        post("second", "Continue with the current team.");
        await first.scheduler.waitForIdle();
    } finally {
        await first.stop();
    }

    assert.equal(requests.length, 2);
    const [turn1, turn2] = requests as [Context, Context];
    assert.equal(turn2.systemPrompt, turn1.systemPrompt, "worker lifecycles and preloads leave the system prompt unchanged");
    assert.doesNotMatch(turn1.systemPrompt ?? "", /preloaded_skill|Actors in the run|@kai|@lena/);

    const firstInput = userTextsOf(turn1.messages.at(-1));
    assert.equal(firstInput.length, 2);
    assert.match(firstInput[0]!, /^\[Actors in the run, as of turn start\]\n/);
    assert.match(firstInput[0]!, /- @worker: "worker", agent, running \(you\)\n/);
    assert.match(firstInput[0]!, /- @kai: "kai", agent, idle\n\n\/skill:review Check the draft\.$/);
    assert.match(firstInput[1]!, /^# Preloaded skills for this turn\n[\s\S]*<preloaded_skill name="review" location="@skills\/review\/SKILL\.md">\nRead checklist\.md first\.\n<\/preloaded_skill>$/);

    const secondInput = userTextsOf(turn2.messages.at(-1));
    assert.equal(secondInput.length, 1, "a turn without a preload carries no skill block");
    assert.match(secondInput[0]!, /- @kai: "kai", agent, stopped\n/);
    assert.match(secondInput[0]!, /- @lena: "lena", agent, idle\n/);
    assert.match(secondInput[0]!, /\n\nContinue with the current team\.$/);
    assert.equal(
        JSON.stringify(turn2.messages.slice(0, turn1.messages.length)),
        JSON.stringify(turn1.messages),
        "the first turn keeps its roster and its skill block byte for byte",
    );

    const projected = JSON.stringify(modelContextOf(runtime.events(run.id), worker, (hash) => runtime.mediaContent(hash)));
    journal.close();
    let next = 0;
    const reloadServices = { ...testServices(13), newId: (kind: string) => `${kind}-after-${++next}` };
    const reloaded = new Journal(join(directory, "runs"), reloadServices);
    const restored = new Orchestration(reloaded, reloadServices);
    const second = engineFor(reloaded, restored);

    try {
        assert.equal(JSON.stringify(modelContextOf(restored.events(run.id), worker, (hash) => restored.mediaContent(hash))), projected);
        second.scheduler.start();
        post("third", "Wrap up.", restored);
        await second.scheduler.waitForIdle();
    } finally {
        await second.stop();
        reloaded.close();
    }

    assert.equal(requests.length, 3);
    const turn3 = requests[2]!;
    assert.equal(turn3.systemPrompt, turn1.systemPrompt, "after the reload the system prompt is the same");
    assert.equal(
        JSON.stringify(turn3.messages.slice(0, turn2.messages.length)),
        JSON.stringify(turn2.messages),
        "after the reload the earlier turns replay their journaled inputs byte for byte",
    );
    assert.match(userTextsOf(turn3.messages.at(-1))[0]!, /- @kai: "kai", agent, stopped\n[\s\S]*\n\nWrap up\.$/);
});

test("an input orientation goes with every input, the steered ones included, and never into the system prompt", async () => {
    const setup = setupRun({ grants: allGrants(), toolNames: [] });
    const steered: SteeredInput[] = [];
    const driver = new FakeDriver(async (request) => {
        if (request.input.content === "First message.") {
            postTo(setup.runtime, setup.view, setup.agent.id, "steer", "Second message.");
            steered.push(...request.claimSteering());
        }
        return { failure: null, usage: noUsage() };
    });
    const scheduler = new TurnScheduler(setup.runtime, setup.journal, {
        drivers: { agent: driver },
        catalog,
        inputOrientation: (runId, input) => `[Context of ${runId === setup.view.id ? input.content : "another run"}]`,
    });

    try {
        postTo(setup.runtime, setup.view, setup.agent.id, "first", "First message.");
        scheduler.start();
        await scheduler.waitForIdle();
        postTo(setup.runtime, setup.view, setup.agent.id, "third", "Third message.");
        await scheduler.waitForIdle();

        assert.deepEqual(driver.requests.map((request) => request.orientation), ["[Context of First message.]", "[Context of Third message.]"]);
        assert.deepEqual(steered.map((entry) => [entry.prompt, entry.orientation]), [["Second message.", "[Context of Second message.]"]]);
        assert.equal(driver.requests[1]!.systemPrompt, driver.requests[0]!.systemPrompt);
        assert.doesNotMatch(driver.requests[0]!.systemPrompt, /Context of/);
    } finally {
        await scheduler.stop();
        setup.journal.close();
    }
});
