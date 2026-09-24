import { Worker, type ResourceLimits } from "node:worker_threads";
import { performance } from "node:perf_hooks";

import type {
    CompileVirtualTypeScriptRequest,
    VirtualTypeScriptCompilation,
} from "./compiler.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 180_000;
const MAX_CONCURRENT_COMPILERS = 8;
const MAX_COMPILER_FILES = 128;
const MAX_COMPILER_INPUT_BYTES = 2 * 1024 * 1024;
const COMPILER_RESOURCE_LIMITS = {
    maxOldGenerationSizeMb: 256,
    maxYoungGenerationSizeMb: 16,
    stackSizeMb: 4,
} as const satisfies ResourceLimits;

export interface CompileVirtualTypeScriptAsyncOptions {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal | undefined;
}

export type VirtualTypeScriptWorkerErrorCode =
    | "ABORTED"
    | "COMPILER_EXCEPTION"
    | "TIMEOUT"
    | "WORKER_FAILURE";

export class VirtualTypeScriptWorkerError extends Error {
    readonly code: VirtualTypeScriptWorkerErrorCode;

    constructor(code: VirtualTypeScriptWorkerErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "VirtualTypeScriptWorkerError";
        this.code = code;
    }
}

interface PooledWorker {
    readonly worker: Worker;
    busy: boolean;
}

interface WorkerWaiter {
    readonly activate: (pooled: PooledWorker) => void;
}

const pool: PooledWorker[] = [];
const workerWaiters: WorkerWaiter[] = [];
let nextRequestId = 0;

const spawnWorker = (): PooledWorker => {
    const worker = new Worker(new URL("./compiler-worker.ts", import.meta.url), {
        execArgv: [],
        name: "ragents-typescript-compiler",
        resourceLimits: COMPILER_RESOURCE_LIMITS,
    });
    worker.unref();
    const pooled: PooledWorker = { worker, busy: false };
    const forget = (): void => {
        const index = pool.indexOf(pooled);
        if (index >= 0) pool.splice(index, 1);
    };
    worker.on("error", forget);
    worker.on("exit", forget);
    pool.push(pooled);
    return pooled;
};

const discardWorker = (pooled: PooledWorker): Promise<number> => {
    const index = pool.indexOf(pooled);
    if (index >= 0) pool.splice(index, 1);
    return pooled.worker.terminate();
};

const releaseWorker = (pooled: PooledWorker): void => {
    pooled.busy = false;
    const waiter = workerWaiters.shift();
    if (waiter) waiter.activate(pooled);
};

const idleWorker = (): PooledWorker | undefined => {
    const idle = pool.find((pooled) => !pooled.busy);
    if (idle) return idle;
    return pool.length < MAX_CONCURRENT_COMPILERS ? spawnWorker() : undefined;
};

export const typeScriptCompilerPool = (): { readonly threadIds: readonly number[]; readonly busy: number } => ({
    threadIds: pool.map((pooled) => pooled.worker.threadId),
    busy: pool.filter((pooled) => pooled.busy).length,
});

export const closeTypeScriptCompilers = async (): Promise<void> => {
    await Promise.all([...pool].map((pooled) => discardWorker(pooled)));
};

const acquireWorker = (
    deadline: number,
    timeoutMs: number,
    signal: AbortSignal | undefined,
): Promise<PooledWorker> => new Promise((resolve, reject) => {
    let settled = false;
    let waiter: WorkerWaiter | undefined;
    const removeWaiter = (): void => {
        if (!waiter) return;
        const index = workerWaiters.indexOf(waiter);
        if (index >= 0) workerWaiters.splice(index, 1);
    };
    const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        removeWaiter();
    };
    const fail = (error: VirtualTypeScriptWorkerError): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
    };
    const activate = (pooled: PooledWorker | undefined): void => {
        if (settled) {
            if (pooled) releaseWorker(pooled);
            return;
        }
        if (!pooled) {
            waiter = { activate };
            workerWaiters.push(waiter);
            return;
        }
        settled = true;
        cleanup();
        pooled.busy = true;
        resolve(pooled);
    };
    const onAbort = (): void => fail(new VirtualTypeScriptWorkerError(
        "ABORTED",
        "Die TypeScript-Kompilierung wurde abgebrochen.",
        { cause: signal?.reason },
    ));
    const timer = setTimeout(() => fail(new VirtualTypeScriptWorkerError(
        "TIMEOUT",
        `Der TypeScript-Compiler hat die Zeitgrenze von ${timeoutMs} ms überschritten.`,
    )), Math.max(0, deadline - performance.now()));

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else {
        try { activate(idleWorker()); }
        catch (error) {
            fail(new VirtualTypeScriptWorkerError(
                "WORKER_FAILURE",
                "Der TypeScript-Compiler-Worker konnte nicht gestartet werden.",
                { cause: error },
            ));
        }
    }
});

interface SerializedWorkerError {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
}

type CompilerWorkerMessage = {
    readonly kind: "result";
    readonly requestId: number;
    readonly compilation: VirtualTypeScriptCompilation;
} | {
    readonly kind: "error";
    readonly requestId: number;
    readonly error: SerializedWorkerError;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);

const isSerializedError = (value: unknown): value is SerializedWorkerError =>
    isRecord(value)
    && typeof value.name === "string"
    && typeof value.message === "string"
    && (value.stack === undefined || typeof value.stack === "string");

const isWorkerMessage = (value: unknown): value is CompilerWorkerMessage => {
    if (!isRecord(value) || typeof value.requestId !== "number") return false;
    if (value.kind === "result") return isRecord(value.compilation);
    return value.kind === "error" && isSerializedError(value.error);
};

const timeoutOf = (options: CompileVirtualTypeScriptAsyncOptions | undefined): number => {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new RangeError(`TypeScript-Compiler-Timeout muss zwischen 1 und ${MAX_TIMEOUT_MS} ms liegen.`);
    }
    return timeoutMs;
};

const validateRequestSize = (request: CompileVirtualTypeScriptRequest): void => {
    const files = [...request.sources, ...(request.declarations ?? [])];
    if (files.length > MAX_COMPILER_FILES)
        throw new RangeError(`Eine TypeScript-Kompilierung darf höchstens ${MAX_COMPILER_FILES} Dateien enthalten.`);
    const bytes = files.reduce((size, file) =>
        size + Buffer.byteLength(file.fileName, "utf8") + Buffer.byteLength(file.text, "utf8"),
    Buffer.byteLength(request.contract ?? "", "utf8"));
    if (bytes > MAX_COMPILER_INPUT_BYTES)
        throw new RangeError(`Die TypeScript-Compiler-Eingabe darf höchstens ${MAX_COMPILER_INPUT_BYTES} Byte groß sein.`);
};

const remoteError = (error: SerializedWorkerError): Error => {
    const remote = new Error(error.message);
    remote.name = error.name;
    if (error.stack !== undefined) remote.stack = error.stack;
    return remote;
};

export const compileVirtualTypeScriptAsync = async (
    request: CompileVirtualTypeScriptRequest,
    options?: CompileVirtualTypeScriptAsyncOptions,
): Promise<VirtualTypeScriptCompilation> => {
    validateRequestSize(request);
    const timeoutMs = timeoutOf(options);
    const deadline = performance.now() + timeoutMs;
    const pooled = await acquireWorker(deadline, timeoutMs, options?.signal);
    const { worker } = pooled;
    const requestId = ++nextRequestId;

    return await new Promise<VirtualTypeScriptCompilation>((resolve, reject) => {
        let settled = false;
        const cleanup = (): void => {
            clearTimeout(timer);
            options?.signal?.removeEventListener("abort", onAbort);
            worker.removeListener("message", onMessage);
            worker.removeListener("messageerror", onMessageError);
            worker.removeListener("error", onError);
            worker.removeListener("exit", onExit);
        };
        const finish = (
            result: { readonly compilation: VirtualTypeScriptCompilation }
                | { readonly error: VirtualTypeScriptWorkerError; readonly keepWorker?: boolean },
        ): void => {
            if (settled) return;
            settled = true;
            cleanup();
            if ("compilation" in result || result.keepWorker) {
                releaseWorker(pooled);
                if ("compilation" in result) resolve(result.compilation);
                else reject(result.error);
                return;
            }
            void discardWorker(pooled).then(
                () => reject(result.error),
                (terminationError: unknown) => reject(new VirtualTypeScriptWorkerError(
                    "WORKER_FAILURE",
                    "Der TypeScript-Compiler-Worker konnte nicht sauber beendet werden.",
                    { cause: terminationError },
                )),
            );
        };
        const onMessage = (message: unknown): void => {
            if (!isWorkerMessage(message)) {
                finish({ error: new VirtualTypeScriptWorkerError(
                    "WORKER_FAILURE",
                    "Der TypeScript-Compiler-Worker hat eine ungültige Antwort geliefert.",
                ) });
                return;
            }
            if (message.requestId !== requestId) return;
            if (message.kind === "result") {
                finish({ compilation: message.compilation });
                return;
            }
            finish({ error: new VirtualTypeScriptWorkerError(
                "COMPILER_EXCEPTION",
                `Der TypeScript-Compiler ist fehlgeschlagen: ${message.error.message}`,
                { cause: remoteError(message.error) },
            ), keepWorker: true });
        };
        const onMessageError = (error: Error): void => finish({
            error: new VirtualTypeScriptWorkerError(
                "WORKER_FAILURE",
                "Die Antwort des TypeScript-Compiler-Workers konnte nicht gelesen werden.",
                { cause: error },
            ),
        });
        const onError = (error: Error): void => finish({
            error: new VirtualTypeScriptWorkerError(
                "WORKER_FAILURE",
                `Der TypeScript-Compiler-Worker ist fehlgeschlagen: ${error.message}`,
                { cause: error },
            ),
        });
        const onExit = (code: number): void => finish({
            error: new VirtualTypeScriptWorkerError(
                "WORKER_FAILURE",
                `Der TypeScript-Compiler-Worker wurde ohne Ergebnis beendet (Exit-Code ${code}).`,
            ),
        });
        const onAbort = (): void => finish({
            error: new VirtualTypeScriptWorkerError(
                "ABORTED",
                "Die TypeScript-Kompilierung wurde abgebrochen.",
                { cause: options?.signal?.reason },
            ),
        });
        const timer = setTimeout(() => finish({
            error: new VirtualTypeScriptWorkerError(
                "TIMEOUT",
                `Der TypeScript-Compiler hat die Zeitgrenze von ${timeoutMs} ms überschritten.`,
            ),
        }), Math.max(0, deadline - performance.now()));

        worker.on("message", onMessage);
        worker.on("messageerror", onMessageError);
        worker.on("error", onError);
        worker.on("exit", onExit);
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        if (options?.signal?.aborted) onAbort();
        else worker.postMessage({ kind: "compile", requestId, request });
    });
};
