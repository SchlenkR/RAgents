import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";

import type { JsonValue } from "../src/domain/json.ts";
import type { NativeTypeScriptExecutor } from "../src/typescript/native-executor.ts";
import type { RunCapabilityDescriptor } from "../src/typescript/run-context.ts";
import { executeTypeScriptSnippet, TypeScriptSnippetCompilationError, TypeScriptSnippetExecutionError } from "../src/typescript/snippet.ts";
import { nativeTestExecutor } from "./native-executor.ts";

const capabilities: readonly RunCapabilityDescriptor[] = [{
    id: "increment",
    label: "Increment",
    description: "Increment the supplied number.",
    schema: Type.Object({ value: Type.Number() }, { additionalProperties: false }),
    resultSchema: Type.Object({ value: Type.Number() }, { additionalProperties: false }),
}];

const context = {
    runId: "snippet-run",
    invocationId: "snippet-call",
    actor: { id: "coordinator", handle: "coordinator" },
    principal: { id: "coordinator", kind: "agent" as const },
};

const fixture = () => {
    const calls: { name: string; input: JsonValue }[] = [];
    const starts: string[] = [];
    const stops: string[] = [];
    const executor: NativeTypeScriptExecutor = {
        ...nativeTestExecutor,
        execute: (request, binding) => {
            assert.equal(request.context.invocationKind, "snippet");
            assert.deepEqual(request.state, {});
            assert.ok(request.instanceId);
            starts.push(request.instanceId);
            return nativeTestExecutor.execute(request, binding);
        },
        stopInstance: async (runId, instanceId) => {
            assert.equal(runId, context.runId);
            stops.push(instanceId);
        },
    };
    return {
        calls, starts, stops, executor,
        execute: (code: string, signal?: AbortSignal) => executeTypeScriptSnippet({
            code, capabilities, executor, context, signal,
            call: async (name, input) => {
                calls.push({ name, input });
                assert.equal(name, "increment");
                assert.ok(input !== null && typeof input === "object" && !Array.isArray(input));
                assert.equal(typeof input.value, "number");
                return { value: Number(input.value) + 1 };
            },
        }),
    };
};

test("snippets await typed plugin functions and return results and logs under the caller identity", async () => {
    const run = fixture();
    const result = await run.execute(`
const first = await context.functions.increment({ value: 2 });
const second = await context.functions.increment(first);
context.log(second);
return { value: second.value, principal: context.principal, kind: context.invocation.kind };
`);
    assert.deepEqual(result, {
        result: { value: 4, principal: { id: "coordinator", kind: "agent" }, kind: "snippet" },
        logs: ["{ value: 4 }"],
    });
    assert.deepEqual(run.calls, [
        { name: "increment", input: { value: 2 } },
        { name: "increment", input: { value: 3 } },
    ]);
    assert.deepEqual(run.stops, run.starts);
});

test("snippet type errors prevent all side effects and identify the original source line", async () => {
    const run = fixture();
    await assert.rejects(run.execute([
        'await context.functions.increment({ value: 2 });',
        'return context.functions.increment({ value: "wrong" });',
    ].join("\n")), (error: unknown) => {
        assert.ok(error instanceof TypeScriptSnippetCompilationError);
        assert.match(error.message, /snippet\.ts:2:/);
        assert.ok(error.diagnostics.some((entry) => entry.code === 2322 && entry.start?.line === 2));
        return true;
    });
    assert.deepEqual(run.calls, []);
    assert.deepEqual(run.starts, []);
    assert.deepEqual(run.stops, []);
});

test("snippets reject unavailable functions and syntax errors before execution", async () => {
    const run = fixture();
    await assert.rejects(run.execute('return context.functions.unavailable({});'), /Property 'unavailable' does not exist/);
    await assert.rejects(run.execute('const broken = ;'), /TypeScript-Snippet wurde nicht ausgeführt/);
    assert.deepEqual(run.starts, []);
});

test("functions with an empty input schema accept a call without arguments and optional fields may be undefined in results", async () => {
    const empty: RunCapabilityDescriptor = {
        id: "status",
        label: "Status",
        description: "Read the current status.",
        schema: Type.Object({}, { additionalProperties: false }),
        resultSchema: Type.Object({ phase: Type.String(), note: Type.Optional(Type.String()) }, { additionalProperties: false }),
    };
    const calls: JsonValue[] = [];
    const result = await executeTypeScriptSnippet({
        code: "const status = await context.functions.status();\nconst again = await context.functions.status({ detail: status.note ?? undefined });\nreturn { phase: again.phase, note: again.note };",
        capabilities: [{ ...empty, schema: Type.Object({ detail: Type.Optional(Type.String()) }, { additionalProperties: false }) }], executor: nativeTestExecutor, context,
        call: async (name, input) => {
            assert.equal(name, "status");
            calls.push(input);
            return { phase: "selecting" };
        },
    });
    assert.deepEqual(calls, [{}, { detail: undefined }]);
    assert.deepEqual(result, { result: { phase: "selecting" }, logs: [] });
    await assert.rejects(executeTypeScriptSnippet({
        code: "return context.functions.increment();",
        capabilities, executor: nativeTestExecutor, context,
        call: async () => ({ value: 1 }),
    }), TypeScriptSnippetCompilationError);
});

test("each snippet starts with fresh local state and no return produces null", async () => {
    const run = fixture();
    assert.deepEqual(await run.execute('context.state.replace({ count: 3 });'), { result: null, logs: [] });
    assert.deepEqual(await run.execute('return context.state.read();'), { result: {}, logs: [] });
    assert.equal(new Set(run.starts).size, 2);
    assert.deepEqual(run.stops, run.starts);
});

test("runtime failures retain progress logs and always release the snippet instance", async () => {
    const run = fixture();
    await assert.rejects(run.execute('context.log("created first item"); throw new Error("later step failed");'), (error: unknown) => {
        assert.ok(error instanceof TypeScriptSnippetExecutionError);
        assert.match(error.message, /later step failed/);
        assert.deepEqual(error.logs, ["created first item"]);
        return true;
    });
    await assert.rejects(run.execute('return { value: Infinity };'), /must be a finite JSON number/);
    assert.equal(run.starts.length, 2);
    assert.deepEqual(run.stops, run.starts);
});

test("aborting a CPU-bound snippet terminates its process and releases its instance", async () => {
    const controller = new AbortController();
    const run = fixture();
    let processId: number | undefined;
    const executor: NativeTypeScriptExecutor = {
        ...run.executor,
        execute: (request, binding) => run.executor.execute(request, {
            ...binding,
            log: (value) => {
                processId = Number(value);
                controller.abort(new Error("snippet stopped"));
                binding.log(value);
            },
        }),
    };
    await assert.rejects(executeTypeScriptSnippet({
        code: 'context.log(process.pid); while (true) {}',
        capabilities, executor, context,
        signal: controller.signal,
        call: async () => { throw new Error("No function expected."); },
    }), /snippet stopped/);
    assert.ok(processId);
    assert.throws(() => process.kill(processId!, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
    assert.deepEqual(run.stops, run.starts);
});

test("cleanup failures preserve the execution failure instead of hiding either error", async () => {
    const run = fixture();
    await assert.rejects(executeTypeScriptSnippet({
        code: 'throw new Error("execution failed");',
        capabilities, context,
        executor: { ...run.executor, stopInstance: async () => { throw new Error("cleanup failed"); } },
        call: async () => null,
    }), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.match(error.message, /execution failed/);
        assert.match(error.message, /cleanup failed/);
        assert.equal(error.errors.length, 2);
        return true;
    });
});
