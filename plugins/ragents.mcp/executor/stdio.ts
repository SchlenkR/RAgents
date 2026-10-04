import { ReadBuffer, serializeMessage, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client";
import type { WorkspaceExecutorMachine, WorkspaceProcessContext, ManagedService } from "@ragents/workspace-executor";
import type { McpServerDefinition } from "../config.js";

export class ManagedMcpTransport implements Transport {
  readonly #machine: WorkspaceExecutorMachine;
  readonly #context: WorkspaceProcessContext;
  readonly #definition: Extract<McpServerDefinition, { command: string }>;
  readonly #buffer = new ReadBuffer();
  #process: ManagedService | undefined;
  #stderr = "";
  #closing = false;
  #ended = false;
  #lastRequestMethod: string | undefined;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(machine: WorkspaceExecutorMachine, context: WorkspaceProcessContext, definition: Extract<McpServerDefinition, { command: string }>) {
    this.#machine = machine;
    this.#context = context;
    this.#definition = definition;
  }

  get pid(): number | undefined { return this.#process?.pid; }
  get stderr(): string { return this.#stderr; }
  get ended(): boolean { return this.#ended; }
  get lastRequestMethod(): string | undefined { return this.#lastRequestMethod; }

  async start(): Promise<void> {
    if (this.#process) throw new Error("MCP stdio transport is already started");
    if (this.#closing) throw new Error("MCP stdio transport is closed");
    const context = this.#context;
    const launch = { command: this.#definition.command, args: [...(this.#definition.args ?? [])] };
    const wrapped = context.sandbox ? await context.sandbox.wrap(launch) : launch;
    if (this.#closing) throw new Error("MCP stdio transport is closed");
    const cwd = this.#definition.cwd ? await this.#machine.resolveRootDirectory(context.root, this.#definition.cwd) : context.root;
    this.#process = this.#machine.startManagedService({
      ...wrapped,
      args: [...wrapped.args],
      cwd,
      env: { ...this.#machine.processEnvironment(context.runId), ...context.env, ...this.#definition.env },
      uid: context.uid,
      gid: context.gid,
      label: "MCP server",
      stdin: "pipe",
      onStdout: (chunk) => {
        try {
          this.#buffer.append(chunk);
          for (;;) {
            const message = this.#buffer.readMessage();
            if (!message) break;
            this.onmessage?.(message);
          }
        } catch (cause) {
          this.onerror?.(cause instanceof Error ? cause : new Error(String(cause)));
          this.#process?.kill("SIGKILL");
        }
      },
      onStderr: (chunk) => { this.#stderr = (this.#stderr + chunk.toString("utf8")).slice(-4096); },
      onError: (error) => { this.onerror?.(error); },
      onExit: () => { this.#ended = true; this.onclose?.(); },
    });
    this.#process.stdin?.on("error", (error) => this.onerror?.(error));
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      const stdin = this.#process?.stdin;
      if (!stdin || this.#ended || this.#closing) { reject(new Error("MCP stdio server is not running")); return; }
      if ("method" in message && "id" in message) this.#lastRequestMethod = message.method;
      stdin.write(serializeMessage(message), (error) => error ? reject(error) : resolve());
    });
  }

  async close(): Promise<void> {
    this.#closing = true;
    const child = this.#process;
    if (!child) return;
    child.stdin?.end();
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
    try { await child.finished; } finally { clearTimeout(timer); this.#buffer.clear(); }
  }
}
