import { parentPort } from "node:worker_threads";

import {
    compileVirtualTypeScript,
    type CompileVirtualTypeScriptRequest,
} from "./compiler.ts";

interface SerializedWorkerError {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
}

type CompilerWorkerRequest = {
    readonly kind: "compile";
    readonly requestId: number;
    readonly request: CompileVirtualTypeScriptRequest;
};

type CompilerWorkerMessage = {
    readonly kind: "result";
    readonly requestId: number;
    readonly compilation: ReturnType<typeof compileVirtualTypeScript>;
} | {
    readonly kind: "error";
    readonly requestId: number;
    readonly error: SerializedWorkerError;
};

const serializedError = (error: unknown): SerializedWorkerError => {
    if (!(error instanceof Error)) return { name: "Error", message: String(error) };
    return {
        name: error.name,
        message: error.message,
        ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
};

if (parentPort === null) {
    throw new Error("Der TypeScript-Compiler-Worker benötigt einen übergeordneten Thread.");
}

const port = parentPort;
port.on("message", (message: CompilerWorkerRequest) => {
    if (message?.kind !== "compile") throw new Error("Der TypeScript-Compiler-Worker hat eine unbekannte Anfrage erhalten.");
    try {
        const compilation = compileVirtualTypeScript(message.request);
        port.postMessage({ kind: "result", requestId: message.requestId, compilation } satisfies CompilerWorkerMessage);
    } catch (error) {
        port.postMessage({ kind: "error", requestId: message.requestId, error: serializedError(error) } satisfies CompilerWorkerMessage);
    }
});
