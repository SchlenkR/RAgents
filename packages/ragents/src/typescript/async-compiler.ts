import { Worker, type ResourceLimits } from "node:worker_threads";
import { performance } from "node:perf_hooks";

import type {
    CompileVirtualTypeScriptRequest,
    VirtualTypeScriptCompilation,
} from "./compiler.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 180_000;
const MAX_CONCURRENT_COMPILERS = 8;
const MAX_CONCURRENT_JOBS = 4;
const MAX_COMPILER_FILES = 128;
const MAX_COMPILER_INPUT_BYTES = 2 * 1024 * 1024;
const COMPILER_RESOURCE_LIMITS = {
    maxOldGenerationSizeMb: 256,
    maxYoungGenerationSizeMb: 16,
    stackSizeMb: 4,
} as const satisfies ResourceLimits;
const JOB_RESOURCE_LIMITS = {
    maxOldGenerationSizeMb: 1024,
    maxYoungGenerationSizeMb: 32,
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

interface WorkerPool {
    readonly limits: ResourceLimits;
    readonly size: number;
    readonly workers: PooledWorker[];
    readonly waiters: WorkerWaiter[];
}

interface PooledWorker {
    readonly pool: WorkerPool;
    readonly worker: Worker;
    busy: boolean;
}

interface WorkerWaiter {
    readonly activate: (pooled: PooledWorker) => void;
}

const compilerPool: WorkerPool = { limits: COMPILER_RESOURCE_LIMITS, size: MAX_CONCURRENT_COMPILERS, workers: [], waiters: [] };
const jobPool: WorkerPool = { limits: JOB_RESOURCE_LIMITS, size: MAX_CONCURRENT_JOBS, workers: [], waiters: [] };
let nextRequestId = 0;

const LOADER_FLAGS = ["--import", "--loader", "--experimental-loader", "--require", "-r"] as const;

/** Only the loader flags of the host (such as --import tsx); Node strips no types under node_modules, and debugger or memory flags stay behind. */
const loaderArguments = (execArgv: readonly string[]): readonly string[] =>
    execArgv.flatMap((argument, index) => {
        if (LOADER_FLAGS.some((flag) => argument.startsWith(`${flag}=`))) return [argument];
        if (LOADER_FLAGS.some((flag) => argument === flag) && index + 1 < execArgv.length) return [argument, execArgv[index + 1]!];
        return [];
    });

const spawnWorker = (pool: WorkerPool): PooledWorker => {
    const worker = new Worker(new URL("./compiler-worker.ts", import.meta.url), {
        execArgv: [...loaderArguments(process.execArgv)],
        name: "ragents-typescript-compiler",
        resourceLimits: pool.limits,
    });
    worker.unref();
    const pooled: PooledWorker = { pool, worker, busy: false };
    const forget = (): void => {
        const index = pool.workers.indexOf(pooled);
        if (index >= 0) pool.workers.splice(index, 1);
    };
    worker.on("error", forget);
    worker.on("exit", forget);
    pool.workers.push(pooled);
    return pooled;
};

const discardWorker = (pooled: PooledWorker): Promise<number> => {
    const index = pooled.pool.workers.indexOf(pooled);
    if (index >= 0) pooled.pool.workers.splice(index, 1);
    return pooled.worker.terminate();
};

const releaseWorker = (pooled: PooledWorker): void => {
    pooled.busy = false;
    const waiter = pooled.pool.waiters.shift();
    if (waiter) waiter.activate(pooled);
};

const idleWorker = (pool: WorkerPool): PooledWorker | undefined => {
    const idle = pool.workers.find((pooled) => !pooled.busy);
    if (idle) return idle;
    return pool.workers.length < pool.size ? spawnWorker(pool) : undefined;
};

export const typeScriptCompilerPool = (): { readonly threadIds: readonly number[]; readonly busy: number } => ({
    threadIds: compilerPool.workers.map((pooled) => pooled.worker.threadId),
    busy: compilerPool.workers.filter((pooled) => pooled.busy).length,
});

export const closeTypeScriptCompilers = async (): Promise<void> => {
    await Promise.all([...compilerPool.workers, ...jobPool.workers].map((pooled) => discardWorker(pooled)));
};

const acquireWorker = (
    pool: WorkerPool,
    deadline: number,
    timeoutMs: number,
    signal: AbortSignal | undefined,
): Promise<PooledWorker> => new Promise((resolve, reject) => {
    let settled = false;
    let waiter: WorkerWaiter | undefined;
    const removeWaiter = (): void => {
        if (!waiter) return;
        const index = pool.waiters.indexOf(waiter);
        if (index >= 0) pool.waiters.splice(index, 1);
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
            pool.waiters.push(waiter);
            return;
        }
        settled = true;
        cleanup();
        pooled.busy = true;
        resolve(pooled);
    };
    const onAbort = (): void => fail(new VirtualTypeScriptWorkerError(
        "ABORTED",
        "The TypeScript compilation was cancelled.",
        { cause: signal?.reason },
    ));
    const timer = setTimeout(() => fail(new VirtualTypeScriptWorkerError(
        "TIMEOUT",
        `The TypeScript compiler exceeded the timeout of ${timeoutMs} ms.`,
    )), Math.max(0, deadline - performance.now()));

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else {
        try { activate(idleWorker(pool)); }
        catch (error) {
            fail(new VirtualTypeScriptWorkerError(
                "WORKER_FAILURE",
                "The TypeScript compiler worker could not be started.",
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
    readonly kind: "value";
    readonly requestId: number;
    readonly value: unknown;
} | {
    readonly kind: "error";
    readonly requestId: number;
    readonly error: SerializedWorkerError;
};

export interface TypeScriptWorkerJob {
    readonly module: string;
    readonly name: string;
    readonly input: unknown;
}

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
    if (value.kind === "value") return "value" in value;
    return value.kind === "error" && isSerializedError(value.error);
};

const timeoutOf = (options: CompileVirtualTypeScriptAsyncOptions | undefined, fallbackMs = DEFAULT_TIMEOUT_MS): number => {
    const timeoutMs = options?.timeoutMs ?? fallbackMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new RangeError(`TypeScript compiler timeout must be between 1 and ${MAX_TIMEOUT_MS} ms.`);
    }
    return timeoutMs;
};

const validateRequestSize = (request: CompileVirtualTypeScriptRequest): void => {
    const files = [...request.sources, ...(request.declarations ?? [])];
    if (files.length > MAX_COMPILER_FILES)
        throw new RangeError(`A TypeScript compilation may contain at most ${MAX_COMPILER_FILES} files.`);
    const bytes = files.reduce((size, file) =>
        size + Buffer.byteLength(file.fileName, "utf8") + Buffer.byteLength(file.text, "utf8"),
    Buffer.byteLength(request.contract ?? "", "utf8"));
    if (bytes > MAX_COMPILER_INPUT_BYTES)
        throw new RangeError(`The TypeScript compiler input may be at most ${MAX_COMPILER_INPUT_BYTES} bytes.`);
};

const remoteError = (error: SerializedWorkerError): Error => {
    const remote = new Error(error.message);
    remote.name = error.name;
    if (error.stack !== undefined) remote.stack = error.stack;
    return remote;
};

const callWorker = async <Result>(
    pool: WorkerPool,
    post: (requestId: number) => unknown,
    failed: (error: SerializedWorkerError) => Error,
    timeoutMs: number,
    signal: AbortSignal | undefined,
): Promise<Result> => {
    const deadline = performance.now() + timeoutMs;
    const pooled = await acquireWorker(pool, deadline, timeoutMs, signal);
    const { worker } = pooled;
    const requestId = ++nextRequestId;

    return await new Promise<Result>((resolve, reject) => {
        let settled = false;
        const cleanup = (): void => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            worker.removeListener("message", onMessage);
            worker.removeListener("messageerror", onMessageError);
            worker.removeListener("error", onError);
            worker.removeListener("exit", onExit);
        };
        const finish = (
            result: { readonly value: Result }
                | { readonly error: Error; readonly keepWorker?: boolean },
        ): void => {
            if (settled) return;
            settled = true;
            cleanup();
            if ("value" in result || result.keepWorker) {
                releaseWorker(pooled);
                if ("value" in result) resolve(result.value);
                else reject(result.error);
                return;
            }
            void discardWorker(pooled).then(
                () => reject(result.error),
                (terminationError: unknown) => reject(new VirtualTypeScriptWorkerError(
                    "WORKER_FAILURE",
                    "The TypeScript compiler worker could not be terminated cleanly.",
                    { cause: terminationError },
                )),
            );
        };
        const onMessage = (message: unknown): void => {
            if (!isWorkerMessage(message)) {
                finish({ error: new VirtualTypeScriptWorkerError(
                    "WORKER_FAILURE",
                    "The TypeScript compiler worker returned an invalid response.",
                ) });
                return;
            }
            if (message.requestId !== requestId) return;
            if (message.kind === "result") {
                finish({ value: message.compilation as Result });
                return;
            }
            if (message.kind === "value") {
                finish({ value: message.value as Result });
                return;
            }
            finish({ error: failed(message.error), keepWorker: true });
        };
        const onMessageError = (error: Error): void => finish({
            error: new VirtualTypeScriptWorkerError(
                "WORKER_FAILURE",
                "The response of the TypeScript compiler worker could not be read.",
                { cause: error },
            ),
        });
        const onError = (error: Error): void => finish({
            error: new VirtualTypeScriptWorkerError(
                "WORKER_FAILURE",
                `The TypeScript compiler worker failed: ${error.message}`,
                { cause: error },
            ),
        });
        const onExit = (code: number): void => finish({
            error: new VirtualTypeScriptWorkerError(
                "WORKER_FAILURE",
                `The TypeScript compiler worker exited without a result (exit code ${code}).`,
            ),
        });
        const onAbort = (): void => finish({
            error: new VirtualTypeScriptWorkerError(
                "ABORTED",
                "The TypeScript compilation was cancelled.",
                { cause: signal?.reason },
            ),
        });
        const timer = setTimeout(() => finish({
            error: new VirtualTypeScriptWorkerError(
                "TIMEOUT",
                `The TypeScript compiler exceeded the timeout of ${timeoutMs} ms.`,
            ),
        }), Math.max(0, deadline - performance.now()));

        worker.on("message", onMessage);
        worker.on("messageerror", onMessageError);
        worker.on("error", onError);
        worker.on("exit", onExit);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
        else worker.postMessage(post(requestId));
    });
};

export const compileVirtualTypeScriptAsync = async (
    request: CompileVirtualTypeScriptRequest,
    options?: CompileVirtualTypeScriptAsyncOptions,
): Promise<VirtualTypeScriptCompilation> => {
    validateRequestSize(request);
    return await callWorker<VirtualTypeScriptCompilation>(
        compilerPool,
        (requestId) => ({ kind: "compile", requestId, request }),
        (error) => new VirtualTypeScriptWorkerError(
            "COMPILER_EXCEPTION",
            `The TypeScript compiler failed: ${error.message}`,
            { cause: remoteError(error) },
        ),
        timeoutOf(options),
        options?.signal,
    );
};

export const runTypeScriptWorkerJob = async <Result>(
    job: TypeScriptWorkerJob,
    options?: CompileVirtualTypeScriptAsyncOptions,
): Promise<Result> => await callWorker<Result>(
    jobPool,
    (requestId) => ({ kind: "job", requestId, ...job }),
    remoteError,
    timeoutOf(options, MAX_TIMEOUT_MS),
    options?.signal,
);
