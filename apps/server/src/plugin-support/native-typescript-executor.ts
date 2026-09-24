import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { NativeTypeScriptBinding, NativeTypeScriptExecutor, NativeTypeScriptRequest, NativeTypeScriptResult } from "@ragents/engine";
import type { JsonValue } from "@ragents/engine";
import { sandboxedLaunch, startManagedService, type ManagedService, type WorkspaceProcessContext } from "@ragents/workspace-executor";
import { syncWorkspaceOwnership } from "./workspace-ownership.js";

interface ExecutorOptions {
  directoryFor(runId: string): string;
  /** Die Node-Ausführung läuft immer auf dem Server, auch bei einem Arbeitsbereich auf einem Arbeitsplatz. */
  serverProcessContextFor(runId: string): Promise<WorkspaceProcessContext>;
}
interface Backend {
  runId: string;
  instanceId: string;
  fingerprint: string;
  controller: AbortController;
  service: ManagedService;
  queue: Promise<void>;
  receive(message: unknown): void;
  reject(error: Error): void;
  log(value: unknown): void;
}
interface BackendSlot {
  controller: AbortController;
  pending: Promise<Backend>;
  stopping?: Promise<void>;
}
const errorOf = (error: unknown): Error => error instanceof Error ? error : new Error(String(error));
let runnerBundle: Promise<string> | undefined;
const runner = (): Promise<string> => runnerBundle ??= build({
  entryPoints: [fileURLToPath(new URL("./native-typescript-child.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  write: false,
}).then((result) => result.outputFiles![0]!.text);

export class NodeTypeScriptExecutor implements NativeTypeScriptExecutor {
  readonly #options: ExecutorOptions;
  readonly #backends = new Map<string, BackendSlot>();
  readonly #stopping = new Map<string, Promise<void>>();
  #closed = false;

  constructor(options: ExecutorOptions) { this.#options = options; }

  async execute(request: NativeTypeScriptRequest, binding: NativeTypeScriptBinding): Promise<NativeTypeScriptResult> {
    binding.signal?.throwIfAborted();
    if (this.#closed || this.#stopping.has(request.context.runId)) throw new Error("Die Node-Ausführung wird beendet.");
    const instanceId = request.instanceId ?? `invocation-${randomUUID()}`;
    const key = `${request.context.runId}\0${instanceId}`;
    const fingerprint = createHash("sha256").update(JSON.stringify({ entry: request.program.entry, files: request.program.files })).digest("hex");
    let slot = this.#backends.get(key);
    if (!slot) {
      const controller = new AbortController();
      slot = { controller, pending: this.#start(request, instanceId, fingerprint, controller, binding.signal) };
      this.#backends.set(key, slot);
      const created = slot;
      void slot.pending.catch(() => { if (this.#backends.get(key) === created) this.#backends.delete(key); });
    }
    slot.controller.signal.throwIfAborted();
    const backend = await slot.pending;
    if (backend.fingerprint !== fingerprint) throw new Error("Die Backend-Revision muss vor dem Codewechsel beendet werden.");
    const operation = backend.queue.then(() => this.#invoke(backend, request, binding));
    backend.queue = operation.then(() => undefined, () => undefined);
    try { return await operation; }
    finally {
      if (request.instanceId === undefined) await this.stopInstance(request.context.runId, instanceId);
    }
  }

  async #start(request: NativeTypeScriptRequest, instanceId: string, fingerprint: string, controller: AbortController, callerSignal?: AbortSignal): Promise<Backend> {
    const signal = callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal;
    const processContext = await this.#options.serverProcessContextFor(request.context.runId);
    signal.throwIfAborted();
    const directory = path.join(this.#options.directoryFor(request.context.runId), createHash("sha256").update(instanceId).digest("hex"), fingerprint);
    await mkdir(directory, { recursive: true });
    for (const file of request.program.files) {
      const target = path.resolve(directory, file.fileName);
      if (!target.startsWith(`${directory}${path.sep}`)) throw new Error("Backend-Datei liegt außerhalb des Builds.");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.text);
    }
    const entry = path.resolve(directory, request.program.entry);
    if (!entry.startsWith(`${directory}${path.sep}`) || !request.program.files.some((file) => path.resolve(directory, file.fileName) === entry))
      throw new Error("Der gebaute Backend-Einstieg fehlt.");
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(path.join(directory, "__runner.mjs"), await runner());
    const toolkit = fileURLToPath(new URL("../../../../node_modules", import.meta.url));
    const resolvedDependencies = request.cwd ? await realpath(path.join(request.cwd, "node_modules")).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return realpath(toolkit);
    }) : await realpath(toolkit);
    await symlink(resolvedDependencies, path.join(directory, "node_modules")).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    await syncWorkspaceOwnership(directory, processContext);
    signal.throwIfAborted();
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    void ready.catch(() => undefined);
    const backend: Backend = {
      runId: request.context.runId, instanceId, fingerprint, controller,
      service: undefined as unknown as ManagedService,
      queue: Promise.resolve(), log: () => undefined,
      reject: rejectReady,
      receive: (raw) => {
        const message = raw as { kind: string; error?: string };
        if (message.kind === "ready") resolveReady();
        else if (message.kind === "failed") rejectReady(new Error(message.error));
      },
    };
    let stderr = "";
    const fail = (error: Error): void => {
      controller.abort(error);
      backend.reject(error);
      backend.service.kill("SIGKILL");
    };
    const launch = await sandboxedLaunch(processContext, { command: process.execPath, args: [path.join(directory, "__runner.mjs")] });
    signal.throwIfAborted();
    backend.service = startManagedService({
      command: launch.command,
      args: [...launch.args],
      cwd: request.cwd ?? processContext.cwd,
      env: { ...processContext.env, RAGENTS_RUN_ID: request.context.runId },
      uid: processContext.uid, gid: processContext.gid,
      ipc: true, label: `TypeScript ${instanceId}`,
      onMessage: (message) => {
        try { backend.receive(message); }
        catch (error) { fail(errorOf(error)); }
      },
      onStdout: (chunk) => backend.log(chunk.toString("utf8")),
      onStderr: (chunk) => {
        const text = chunk.toString("utf8");
        stderr = (stderr + text).slice(-4_000);
        backend.log(text);
      },
      onError: fail,
      onExit: (code) => {
        const error = new Error(`Backendprozess beendet (Code ${code}).${stderr.trim() ? `\n${stderr.trim()}` : ""}`);
        controller.abort(error);
        backend.reject(error);
        void backend.service.finished.then(() => backend.queue).finally(() => {
          const key = `${backend.runId}\0${backend.instanceId}`;
          const current = this.#backends.get(key);
          if (current) void current.pending.then((value) => { if (value === backend && this.#backends.get(key) === current) this.#backends.delete(key); }, () => undefined);
        }).catch(() => undefined);
      },
    });
    const timeout = setTimeout(() => rejectReady(new Error("Das Backend wurde nicht innerhalb von 15 Sekunden bereit.")), 15_000);
    const abort = () => rejectReady(errorOf(signal?.reason ?? "Der Backendstart wurde abgebrochen."));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      await backend.service.send({ kind: "load", entry });
      await ready;
      signal.throwIfAborted();
      if (this.#closed || this.#stopping.has(backend.runId)) throw new Error("Der Run wurde beim Backendstart gestoppt.");
      return backend;
    } catch (error) {
      backend.service.kill("SIGKILL");
      await backend.service.finished;
      throw error;
    } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
  }

  async #invoke(backend: Backend, request: NativeTypeScriptRequest, binding: NativeTypeScriptBinding): Promise<NativeTypeScriptResult> {
    const signal = binding.signal ? AbortSignal.any([backend.controller.signal, binding.signal]) : backend.controller.signal;
    signal.throwIfAborted();
    const capabilities = new Set(request.context.capabilities.map((entry) => entry.id));
    const calls = new Set<Promise<void>>();
    let force: NodeJS.Timeout | undefined;
    let rejectInvocation!: (error: Error) => void;
    const abort = (): void => {
      void backend.service.send({ kind: "cancel" }).catch(() => undefined);
      force = setTimeout(() => backend.service.kill("SIGKILL"), 200);
      rejectInvocation(errorOf(signal.reason ?? "Der Aufruf wurde abgebrochen."));
    };
    const operation = new Promise<NativeTypeScriptResult>((resolve, reject) => {
      rejectInvocation = reject;
      backend.reject = reject;
      backend.log = binding.log;
      backend.receive = (raw) => {
        const message = raw as { kind: string; name?: string; input?: JsonValue; callId?: number; value?: unknown; result?: unknown; state?: unknown; error?: string };
        if (message.kind === "result") resolve({ result: message.result, state: message.state });
        else if (message.kind === "failed") reject(new Error(message.error));
        else if (message.kind === "log") binding.log(message.value);
        else if (message.kind === "call") {
          const operation = (async () => {
            try {
              signal.throwIfAborted();
              if (!capabilities.has(message.name!)) throw new Error(`Capability ${message.name} ist nicht freigegeben.`);
              const value = await binding.call(message.name!, message.input!);
              await backend.service.send({ kind: "reply", callId: message.callId, value });
            } catch (error) {
              await backend.service.send({ kind: "reply", callId: message.callId, error: errorOf(error).message }).catch(() => undefined);
            }
          })();
          calls.add(operation);
          void operation.finally(() => calls.delete(operation));
        }
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else void backend.service.send({ kind: "execute", request }).catch(reject);
    });
    try {
      const result = await operation;
      await Promise.allSettled([...calls]);
      signal.throwIfAborted();
      return result;
    } finally {
      try {
        await Promise.allSettled([...calls]);
        if (signal.aborted) await backend.service.finished;
      } finally {
        signal.removeEventListener("abort", abort);
        if (force) clearTimeout(force);
        backend.log = () => undefined;
        backend.reject = () => undefined;
        backend.receive = () => undefined;
      }
    }
  }

  stopInstance(runId: string, instanceId: string): Promise<void> {
    const key = `${runId}\0${instanceId}`;
    const slot = this.#backends.get(key);
    if (!slot) return Promise.resolve();
    if (slot.stopping) return slot.stopping;
    slot.controller.abort(new Error("Die Node-Instanz wird beendet."));
    slot.stopping = (async () => {
      const backend = await slot.pending.catch(() => undefined);
      if (!backend) return;
      backend.service.kill("SIGKILL");
      await backend.service.finished;
      await backend.queue;
    })().finally(() => { if (this.#backends.get(key) === slot) this.#backends.delete(key); });
    return slot.stopping;
  }

  stopRun(runId: string): Promise<void> {
    const current = this.#stopping.get(runId);
    if (current) return current;
    const stopped = Promise.resolve().then(async () => {
      await Promise.all([...this.#backends.keys()].filter((key) => key.startsWith(`${runId}\0`))
        .map((key) => this.stopInstance(runId, key.slice(runId.length + 1))));
    }).finally(() => { if (this.#stopping.get(runId) === stopped) this.#stopping.delete(runId); });
    this.#stopping.set(runId, stopped);
    return stopped;
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    await Promise.all([...new Set([...this.#backends.keys()].map((key) => key.split("\0")[0]!))].map((runId) => this.stopRun(runId)));
  }
}
