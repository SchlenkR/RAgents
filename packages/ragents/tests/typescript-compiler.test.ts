import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { typeScriptTypesFromSchema } from "../src/typescript/schema.ts";

import {
    VirtualTypeScriptWorkerError,
    canonicalTypeScriptBuildContract,
    compileVirtualTypeScript,
    compileVirtualTypeScriptAsync,
    typeScriptTypeFromSchema,
} from "../src/typescript/index.ts";
import { closeTypeScriptCompilers, typeScriptCompilerPool } from "../src/typescript/async-compiler.ts";

const compile = (text: string) => compileVirtualTypeScript({
    sources: [{ fileName: "main.ts", text }],
});

test("the virtual compiler reports unknown names, implicit any and incompatible types", () => {
    const unknownName = compile("export const answer = missingName;");
    const implicitAny = compile("export const echo = (value) => value;");
    const wrongType = compile("export const answer: string = 42;");

    assert.equal(unknownName.valid, false);
    assert.ok(unknownName.diagnostics.some((diagnostic) => diagnostic.code === 2304
        && diagnostic.fileName === "/main.ts"
        && diagnostic.start?.line === 1));
    assert.equal(implicitAny.valid, false);
    assert.ok(implicitAny.diagnostics.some((diagnostic) => diagnostic.code === 7006));
    assert.equal(wrongType.valid, false);
    assert.ok(wrongType.diagnostics.some((diagnostic) => diagnostic.code === 2322));
});

test("the virtual compiler accepts semantically valid code with virtual declarations", () => {
    const result = compileVirtualTypeScript({
        sources: [
            {
                fileName: "src/main.ts",
                text: [
                    "import { suffix } from './suffix.js';",
                    "export const greet = async (name: string): Promise<string> => hostPrefix + name + suffix;",
                ].join("\n"),
            },
            { fileName: "src/suffix.ts", text: "export const suffix: string = '!';" },
        ],
        declarations: [{ fileName: "runtime.d.ts", text: "declare const hostPrefix: string;" }],
    });

    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result.diagnostics, []);
    assert.deepEqual(result.emittedFiles, []);
});

test("the compilation hash is order-independent and binds declarations", () => {
    const sources = [
        { fileName: "b.ts", text: "export const b: number = 2;" },
        { fileName: "a.ts", text: "export const a: number = declared;" },
    ];
    const declaration = { fileName: "runtime.d.ts", text: "declare const declared: number;" };
    const first = compileVirtualTypeScript({ sources, declarations: [declaration] });
    const reordered = compileVirtualTypeScript({ sources: [...sources].reverse(), declarations: [declaration] });
    const changed = compileVirtualTypeScript({
        sources,
        declarations: [{ ...declaration, text: "declare const declared: string;" }],
    });

    assert.equal(first.compilationHash, reordered.compilationHash);
    assert.notEqual(first.compilationHash, changed.compilationHash);
    assert.match(first.compilationHash, /^[a-f0-9]{64}$/);
});

test("the compilation hash binds runtime schema constraints that erase to the same TypeScript type", () => {
    const sources = [{ fileName: "main.ts", text: "export const value: string = 'ok';" }];
    const short = compileVirtualTypeScript({
        sources,
        contract: canonicalTypeScriptBuildContract({ input: Type.String({ minLength: 1 }) }),
    });
    const long = compileVirtualTypeScript({
        sources,
        contract: canonicalTypeScriptBuildContract({ input: Type.String({ minLength: 100 }) }),
    });

    assert.notEqual(short.compilationHash, long.compilationHash);
});

test("browser emit is deterministic and is suppressed after semantic errors", () => {
    const request = {
        emit: "browser" as const,
        sources: [{
            fileName: "app/main.ts",
            text: "const answer: number = 40 + 2;\nwindow.result = answer;",
        }],
        declarations: [{
            fileName: "browser.d.ts",
            text: "interface Window { result?: number; }\ndeclare const window: Window;",
        }],
    };
    const first = compileVirtualTypeScript(request);
    const second = compileVirtualTypeScript(request);
    const invalid = compileVirtualTypeScript({
        ...request,
        sources: [{ fileName: "app/main.ts", text: "const answer: string = 42;" }],
    });

    assert.equal(first.valid, true, JSON.stringify(first.diagnostics));
    assert.deepEqual(first.emittedFiles, second.emittedFiles);
    assert.deepEqual(first.emittedFiles.map((file) => file.fileName), ["app/main.js"]);
    assert.match(first.emittedFiles[0]?.text ?? "", /const answer = 40 \+ 2;/);
    assert.doesNotMatch(first.emittedFiles[0]?.text ?? "", /: number/);
    assert.equal(invalid.valid, false);
    assert.deepEqual(invalid.emittedFiles, []);
});

test("the schema generator produces defensive TypeScript without any", () => {
    const type = typeScriptTypeFromSchema(Type.Object({
        text: Type.String(),
        count: Type.Optional(Type.Integer()),
        payload: Type.Any(),
    }, { additionalProperties: false }));
    const cyclic: Record<string, unknown> = { type: "array" };
    cyclic.items = cyclic;

    assert.equal(type, "{ \"count\"?: number; \"payload\": unknown; \"text\": string; }");
    assert.doesNotMatch(type, /\bany\b/);
    const documented = typeScriptTypeFromSchema(Type.Object({
        items: Type.Optional(Type.Boolean({ description: "true liefert die Liste mit.\n  Sonst */ nicht." })),
    }, { additionalProperties: false }));
    assert.equal(documented, "{ /** true liefert die Liste mit. Sonst * / nicht. */ \"items\"?: boolean; }");
    assert.equal(typeScriptTypeFromSchema({ type: "mystery" }), "unknown");
    assert.equal(typeScriptTypeFromSchema(cyclic), "Array<unknown>");
});

test("the asynchronous compiler returns a successful isolated compilation", async () => {
    const request = {
        sources: [{ fileName: "main.ts", text: "export const answer: number = 42;" }],
    };
    const expected = compileVirtualTypeScript(request);
    const result = await compileVirtualTypeScriptAsync(request);

    assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
    assert.deepEqual(result, expected);
});

test("recursive schema declarations preserve nested types and isolate definitions with equal names", () => {
    const tree = (value: ReturnType<typeof Type.String> | ReturnType<typeof Type.Number>) => Type.Cyclic({
        Node: Type.Object({ value, children: Type.Array(Type.Ref("Node")) }, { additionalProperties: false }),
    }, "Node");
    const generated = typeScriptTypesFromSchema(Type.Object({
        text: tree(Type.String()),
        count: tree(Type.Number()),
    }, { additionalProperties: false }), "Tree");
    const declarations = `${generated.declarations.join("\n")}\ndeclare const accept: (value: ${generated.type}) => void;`;
    const check = (nested: string) => compileVirtualTypeScript({
        sources: [{ fileName: "main.ts", text: `accept({text:{value:'a',children:[{value:${nested},children:[]}]},count:{value:1,children:[{value:2,children:[]}]}});` }],
        declarations: [{ fileName: "runtime.d.ts", text: declarations }],
    });
    const valid = check("'b'");
    assert.equal(valid.valid, true, JSON.stringify(valid.diagnostics));
    assert.equal(check("123").valid, false);
    assert.doesNotMatch(declarations, /\bunknown\b|\bany\b/);
});

test("the asynchronous compiler returns semantic diagnostics as a normal result", async () => {
    const result = await compileVirtualTypeScriptAsync({
        sources: [{ fileName: "main.ts", text: "export const answer: string = 42;" }],
    });

    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === 2322));
});

test("the asynchronous compiler terminates a worker at its hard deadline", async () => {
    await assert.rejects(
        compileVirtualTypeScriptAsync({
            sources: [{ fileName: "main.ts", text: "export const answer: number = 42;" }],
        }, { timeoutMs: 1 }),
        (error: unknown) => error instanceof VirtualTypeScriptWorkerError
            && error.code === "TIMEOUT"
            && /1 ms/.test(error.message),
    );
});

test("the asynchronous compiler terminates its worker when the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("run stopped"));

    await assert.rejects(
        compileVirtualTypeScriptAsync({
            sources: [{ fileName: "main.ts", text: "export const answer: number = 42;" }],
        }, { signal: controller.signal }),
        (error: unknown) => error instanceof VirtualTypeScriptWorkerError
            && error.code === "ABORTED",
    );
});

test("the asynchronous compiler rejects oversized input before starting a worker", async () => {
    await assert.rejects(
        compileVirtualTypeScriptAsync({
            sources: [{ fileName: "main.ts", text: "x".repeat(2 * 1024 * 1024) }],
        }),
        /höchstens 2097152 Byte/,
    );
});

test("consecutive compilations reuse one warm worker and the warm run is much faster than the cold start", async () => {
    await closeTypeScriptCompilers();
    const declarations = [{ fileName: "context.d.ts", text: "declare const answer: number;" }];
    const timed = async (text: string) => {
        const started = performance.now();
        const result = await compileVirtualTypeScriptAsync({ sources: [{ fileName: "main.ts", text }], declarations });
        assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
        return performance.now() - started;
    };
    const cold = await timed("export const first: number = answer + 1;");
    const threadIds = typeScriptCompilerPool().threadIds;
    assert.equal(threadIds.length, 1);
    const warm = await timed("export const second: string = String(answer);");
    assert.deepEqual(typeScriptCompilerPool().threadIds, threadIds);
    assert.equal(typeScriptCompilerPool().busy, 0);
    assert.ok(warm * 2 < cold, `Warm ${warm.toFixed(0)} ms gegenüber kalt ${cold.toFixed(0)} ms`);
});

test("a worker that dies mid-compilation fails only its request and is replaced for the next one", async () => {
    await closeTypeScriptCompilers();
    const pending = compileVirtualTypeScriptAsync({ sources: [{ fileName: "main.ts", text: "export const answer: number = 42;" }] });
    const [crashed] = typeScriptCompilerPool().threadIds;
    assert.ok(crashed !== undefined);
    await closeTypeScriptCompilers();
    await assert.rejects(pending, (error: unknown) => error instanceof VirtualTypeScriptWorkerError
        && error.code === "WORKER_FAILURE"
        && /ohne Ergebnis beendet/.test(error.message));
    assert.deepEqual(typeScriptCompilerPool().threadIds, []);
    const result = await compileVirtualTypeScriptAsync({ sources: [{ fileName: "main.ts", text: "export const answer: number = 42;" }] });
    assert.equal(result.valid, true);
    assert.equal(typeScriptCompilerPool().threadIds.length, 1);
    assert.notEqual(typeScriptCompilerPool().threadIds[0], crashed);
});
