import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk";
import type { ManagedService, WorkspaceExecutorMachine, WorkspaceProcessContext } from "@ragents/workspace-executor";
import type { AcpAgentDefinition } from "../config.js";

export class AcpProcess {
  readonly #machine: WorkspaceExecutorMachine;
  readonly #context: WorkspaceProcessContext;
  readonly #definition: AcpAgentDefinition;
  readonly #input: ReadableStream<Uint8Array>;
  readonly stream: Stream;
  #controller!: ReadableStreamDefaultController<Uint8Array>;
  #child: ManagedService | undefined;
  #ended = false;
  #stderr = "";
  #exitCode: number | null = null;
  #closing: Promise<void> | undefined;

  constructor(machine: WorkspaceExecutorMachine, context: WorkspaceProcessContext, definition: AcpAgentDefinition) {
    this.#machine = machine;
    this.#context = context;
    this.#definition = definition;
    this.#input = new ReadableStream({ start: (controller) => { this.#controller = controller; } });
    const output = new WritableStream<Uint8Array>({ write: (bytes) => new Promise<void>((resolve, reject) => {
      const stdin = this.#child?.stdin;
      if (!stdin || this.#ended) return reject(new Error("ACP adapter is not running"));
      stdin.write(bytes, (error) => error ? reject(error) : resolve());
    }) });
    this.stream = ndJsonStream(output, this.#input, { maxMessageBytes: 4 * 1024 * 1024 });
  }

  get pid(): number | undefined { return this.#child?.pid; }
  get stderr(): string { return this.#stderr; }

  async start(): Promise<void> {
    if (this.#closing) throw new Error("ACP adapter closed before launch");
    const context = this.#context;
    const launch = { command: this.#definition.command, args: [...(this.#definition.args ?? [])] };
    const wrapped = context.sandbox ? await context.sandbox.wrap(launch) : launch;
    if (this.#closing) throw new Error("ACP adapter closed before launch");
    this.#child = this.#machine.startManagedService({
      ...wrapped, args: [...wrapped.args], cwd: context.root,
      env: { ...this.#machine.processEnvironment(context.runId), ...context.env, ...this.#definition.env },
      uid: context.uid, gid: context.gid, stdin: "pipe", label: "ACP adapter",
      onStdout: (chunk) => { if (!this.#ended) this.#controller.enqueue(chunk); },
      onStderr: (chunk) => { this.#stderr = (this.#stderr + chunk.toString("utf8")).slice(-4096); },
      onError: (error) => this.#end(error),
      onExit: (code) => { this.#exitCode = code; },
    });
    this.#child.stdin?.on("error", (error) => this.#end(error));
    void this.#child.finished.then(() => this.#end(new Error(`ACP adapter exited (${this.#exitCode ?? "signal"})${this.#stderr ? `: ${this.#stderr}` : ""}`)), (error: unknown) => this.#end(error));
  }

  #end(error: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#controller.error(error);
  }

  close(): Promise<void> {
    return this.#closing ??= (async () => {
      const child = this.#child;
      if (!child) { this.#end(new Error("ACP adapter closed")); return; }
      child.stdin?.end();
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 1000);
      try { await child.finished; }
      finally { clearTimeout(force); this.#end(new Error("ACP adapter closed")); }
    })();
  }
}
