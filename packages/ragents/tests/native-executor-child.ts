import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRunContext } from "../src/typescript/run-context.ts";
import { createScriptStd } from "../src/script/std.ts";
import type { NativeTypeScriptRequest } from "../src/typescript/native-executor.ts";
import type { JsonValue } from "../src/domain/json.ts";

let nextId = 0;
const pending = new Map<number, { resolve: (value: JsonValue) => void; reject: (error: Error) => void }>();
process.on("message", (raw) => {
    const message = raw as { kind?: string; id: number; error?: string; value: JsonValue };
    if (message.kind !== "response") return;
    const waiter = pending.get(message.id)!;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error));
    else waiter.resolve(message.value);
});
process.once("message", (raw) => {
    void (async () => {
        const request = raw as NativeTypeScriptRequest;
        const directory = process.env.RAGENTS_NATIVE_TEST_DIRECTORY;
        if (!directory) throw new Error("Native test directory is required.");
        try {
            await writeFile(path.join(directory, "package.json"), '{"type":"module"}');
            for (const file of request.program.files) {
                const target = path.join(directory, file.fileName);
                await mkdir(path.dirname(target), { recursive: true });
                await writeFile(target, file.text);
            }
            let carried = structuredClone(request.state);
            const state = { read: () => structuredClone(carried), replace: (value: unknown) => { carried = structuredClone(value); } };
            const capabilities = {
                descriptors: () => request.context.capabilities,
                call: (name: string, input: JsonValue) => new Promise<JsonValue>((resolve, reject) => {
                    const id = ++nextId;
                    pending.set(id, { resolve, reject });
                    process.send!({ kind: "call", id, name, input });
                }),
            };
            const context = {
                ...createRunContext({ ...request.context, state, capabilities,
                    signal: new AbortController().signal, log: (value) => process.send!({ kind: "log", value }),
                }),
                ...(request.std ? { std: createScriptStd({ turnStartedAt: request.std.now, idPrefix: request.std.idPrefix, state, capabilities }) } : {}),
            };
            const module = await import(pathToFileURL(path.join(directory, request.program.entry)).href);
            if (carried === undefined) carried = structuredClone(module.initial);
            const handle = module[request.program.exportName ?? "handle"];
            if (typeof handle !== "function") throw new Error("Native module must export handle.");
            const result = await handle(request.input, context);
            process.send!({ kind: "result", result, state: carried });
        } catch (error) {
            process.send!({ kind: "error", error: error instanceof Error ? error.message : String(error) });
        }
    })();
});
