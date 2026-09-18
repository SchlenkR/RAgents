import { scriptInputOf } from "../src/agents/delivery.ts";
import { assertJsonValue } from "../src/domain/json.ts";
import { actorStatePluginId, emptyUsage } from "../src/domain/model.ts";
import { canonicalJson } from "../src/runtime/canonical-json.ts";
import type { Orchestration } from "../src/runtime/orchestration.ts";
import type { ActorProgramExecutor } from "../src/script/programs.ts";
import type { NativeTypeScriptProgram } from "../src/typescript/native-executor.ts";
import { nativeTestExecutor } from "./native-executor.ts";

export const nativeActorPrograms = (
    runtime: Orchestration,
    programs: ReadonlyMap<string, NativeTypeScriptProgram>,
): ActorProgramExecutor => ({
    async runInput(request, signal) {
        const program = programs.get(request.agentId);
        if (!program) throw new Error(`Actor ${request.agentId} has no program.`);
        const stored = runtime.view(request.runId).pluginStates.find((state) =>
            state.pluginId === actorStatePluginId && state.scope.kind === "actor" && state.scope.actorId === request.agentId)?.state;
        let call = 0;
        const outcome = await nativeTestExecutor.execute({
            program,
            input: scriptInputOf(request.input),
            state: stored,
            context: {
                runId: request.runId,
                invocationId: request.turnId,
                invocationKind: "input",
                principal: {id: request.agentId, kind: "script"},
                capabilities: request.tools.map((tool) => ({id: tool.name, label: tool.label, description: tool.description, schema: tool.schema, resultSchema: tool.resultSchema})),
            },
            std: {now: request.startedAt, idPrefix: `${request.turnId}:std`},
        }, {
            signal,
            call: (name, input) => request.invoke(`${request.turnId}:call:${call++}`, name, input),
            log: (value) => request.emit({kind: "runtime", text: typeof value === "string" ? value : JSON.stringify(value)}),
        });
        signal.throwIfAborted();
        if (outcome.state !== undefined) {
            assertJsonValue(outcome.state, "actor state");
            if (stored === undefined || canonicalJson(stored) !== canonicalJson(outcome.state))
                runtime.replaceActorState({actorId: request.agentId, commandId: `${request.turnId}:state`, turnId: request.turnId}, request.runId, request.agentId, outcome.state);
        }
        return {failure: null, usage: emptyUsage()};
    },
});
