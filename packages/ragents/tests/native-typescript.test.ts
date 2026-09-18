import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";

import { compileVirtualTypeScript } from "../src/typescript/compiler.ts";
import type { NativeTypeScriptProgram, NativeTypeScriptRequest } from "../src/typescript/native-executor.ts";
import { nativeTestExecutor, scriptProgram } from "./native-executor.ts";

const requestOf = (program: NativeTypeScriptProgram): NativeTypeScriptRequest => ({
    program,
    input: { content: "result" },
    context: {
        runId: "native-run",
        invocationId: "native-invocation",
        invocationKind: "input",
        principal: { id: "native-actor", kind: "script" },
        capabilities: [],
    },
    std: { now: "2026-09-10T12:00:00.000Z", idPrefix: "native-invocation:std" },
});

const binding = {
    call: async () => { throw new Error("No capabilities are configured."); },
    log: () => {},
};

test("native actors compile multiple TypeScript files with real Node types in an isolated workspace", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ragents-native-build-"));
    try {
        const source = [
            'import { join } from "node:path";',
            'import { Total } from "./lib/total.js";',
            "type State = { value: string; child: boolean };",
            "export const handle = (input: {content: string}) => ({",
            '  value: join(input.content, String(new Total(new Set([1, 2, 2, 3])).value)),',
            `  child: process.pid !== ${process.pid},`,
            "});",
        ].join("\n");
        const compiled = compileVirtualTypeScript({
            emit: "node",
            rootDirectory: directory,
            sources: [{fileName: "script.ts", text: source}, {
                fileName: "lib/total.ts",
                text: "export class Total { readonly value: number; constructor(values: Set<number>) { this.value = [...values].reduce((sum, value) => sum + value, 0); } }",
            }],
        });
        assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
        if (!compiled.valid) return;
        assert.ok(compiled.emittedFiles.some((file) => file.fileName === "lib/total.js"));

        const outcome = await nativeTestExecutor.execute(requestOf({entry: "script.js", files: [...compiled.emittedFiles]}), binding);
        assert.deepEqual(outcome.result, { value: path.join("result", "6"), child: true });
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("normal Node compilation rejects missing globals and never executes source", async () => {
    const globals = compileVirtualTypeScript({emit: "node", sources: [{
        fileName: "script.ts", text: "export const handle = () => { context.log(std.now()); };",
    }]});
    assert.equal(globals.valid, false);
    assert.ok(globals.diagnostics.some((entry) => entry.code === 2304 && entry.message.includes("context")));
    assert.ok(globals.diagnostics.some((entry) => entry.code === 2304 && entry.message.includes("std")));
    const compiled = compileVirtualTypeScript({emit: "node", sources: [{
        fileName: "script.ts", text: 'throw new Error("module initialization failed"); export const handle = () => {};',
    }]});
    assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
    await assert.rejects(nativeTestExecutor.execute(requestOf({entry: "script.js", files: [...compiled.emittedFiles]}), binding), /module initialization failed/);
});

test("native module exports share initial state and receive normal context and std objects", async () => {
    const program = scriptProgram([
        "export const initial = { count: 4 };",
        "export const update = async (input, context) => {",
        "  const state = context.state.read();",
        "  state.count += 1;",
        "  const previous = context.state.read().count;",
        "  context.state.replace(state);",
        "  const response = await context.functions.echo({ count: state.count });",
        "  context.log(response);",
        "  return { previous, now: context.std.now(), id: context.std.id(), run: context.run.id, signal: context.signal instanceof AbortSignal };",
        "};",
    ].join("\n"));
    program.exportName = "update";
    const calls: unknown[] = [];
    const logs: unknown[] = [];
    const request = requestOf(program);
    const outcome = await nativeTestExecutor.execute({...request, context: {...request.context, capabilities: [{id:"echo",label:"Echo",description:"Echo",schema:Type.Object({count:Type.Number()}),resultSchema:Type.Object({accepted:Type.Boolean()})}]}}, {
        call: async (name, input) => { calls.push({ name, input }); return { accepted: true }; },
        log: (value) => logs.push(value),
    });

    assert.deepEqual(outcome.result, {
        previous: 4, now: "2026-09-10T12:00:00.000Z", id: "native-invocation:std:1", run: "native-run", signal: true,
    });
    assert.deepEqual(outcome.state, { count: 5 });
    assert.deepEqual(calls, [{ name: "echo", input: { count: 5 } }]);
    assert.deepEqual(logs, [{ accepted: true }]);
});

test("aborting a native CPU loop terminates its Node process", async () => {
    const controller = new AbortController();
    let childPid: number | undefined;
    const execution = nativeTestExecutor.execute(requestOf(scriptProgram(
        "export const handle = (_input, context) => { context.log(process.pid); while (true) {} };",
    )), {
        ...binding,
        signal: controller.signal,
        log: (value) => { childPid = Number(value); controller.abort(new Error("run stopped")); },
    });

    await assert.rejects(execution, /run stopped/);
    assert.ok(childPid);
    assert.notEqual(childPid, process.pid);
    assert.throws(() => process.kill(childPid!, 0), (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH");
});
