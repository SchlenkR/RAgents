import { fork } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import type { NativeTypeScriptExecutor, NativeTypeScriptProgram } from "../src/typescript/native-executor.ts";

export const scriptProgram = (source: string): NativeTypeScriptProgram => ({
    entry: "script.js",
    files: [{ fileName: "script.js", text: ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText }],
});

export const nativeTestExecutor: NativeTypeScriptExecutor = {
    execute: async (request, binding) => {
        binding.signal?.throwIfAborted();
        const directory = await mkdtemp(path.join(tmpdir(), "ragents-native-test-"));
        try {
            return await new Promise((resolve, reject) => {
                const child = fork(new URL("./native-executor-child.ts", import.meta.url), [], {
                    execArgv: [], serialization: "advanced", stdio: ["ignore", "ignore", "pipe", "ipc"],
                    env: { ...process.env, RAGENTS_NATIVE_TEST_DIRECTORY: directory },
                });
                const exited = new Promise<void>((done) => { child.once("exit", () => done()); child.once("error", () => done()); });
                let failure = "";
                let finished = false;
                const finish = (error: unknown, result?: { result: unknown; state: unknown }) => {
                    if (finished) return;
                    finished = true;
                    clearTimeout(timer);
                    binding.signal?.removeEventListener("abort", abort);
                    child.kill("SIGKILL");
                    void exited.then(() => {
                        if (error) reject(error);
                        else resolve(result!);
                    });
                };
                const abort = () => finish(binding.signal?.reason ?? new Error("Native execution aborted."));
                const timer = setTimeout(() => finish(new Error("Native test execution timed out.")), 10_000);
                binding.signal?.addEventListener("abort", abort, { once: true });
                child.stderr?.on("data", (chunk) => { failure += String(chunk); });
                child.on("error", (error) => finish(error));
                child.on("exit", (code) => { if (!finished) finish(new Error(`Native test process exited ${code}: ${failure}`)); });
                child.on("message", (raw) => {
                    const message = raw as { kind: string; id: number; name: string; input: never; value: unknown; error: string; result: unknown; state: unknown };
                    if (message.kind === "call") {
                        void binding.call(message.name, message.input).then(
                            (value) => { if (child.connected) child.send({ kind: "response", id: message.id, value }); },
                            (error: unknown) => { if (child.connected) child.send({ kind: "response", id: message.id, error: error instanceof Error ? error.message : String(error) }); },
                        );
                    } else if (message.kind === "log") binding.log(message.value);
                    else if (message.kind === "result") finish(null, message);
                    else if (message.kind === "error") finish(new Error(message.error));
                });
                child.send(request);
            });
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    },
    stopRun: async () => {},
    stopInstance: async () => {},
    shutdown: async () => {},
};
