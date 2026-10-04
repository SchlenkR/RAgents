import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Client, CreateTerminalRequest, TerminalExitStatus, TerminalOutputResponse } from "@agentclientprotocol/sdk";
import type { ManagedService, WorkspaceExecutorMachine, WorkspaceModuleHost, WorkspaceProcessContext } from "@ragents/workspace-executor";

interface Terminal {
  readonly child: ManagedService;
  readonly limit: number;
  output: Buffer;
  truncated: boolean;
  status?: TerminalExitStatus;
  error?: Error;
}

const outputLimit = 256 * 1024;

export class AcpWorkspace {
  readonly #machine: WorkspaceExecutorMachine;
  readonly #host: WorkspaceModuleHost;
  readonly #context: WorkspaceProcessContext;
  readonly #session: (sessionId: string) => void;
  readonly #env: Readonly<Record<string, string>>;
  readonly #terminals = new Map<string, Terminal>();
  #closed = false;

  constructor(machine: WorkspaceExecutorMachine, host: WorkspaceModuleHost, context: WorkspaceProcessContext, session: (id: string) => void, env: Readonly<Record<string, string>>) {
    this.#machine = machine;
    this.#host = host;
    this.#context = context;
    this.#session = session;
    this.#env = env;
  }

  #check(sessionId: string): void {
    if (this.#closed) throw new Error("ACP workspace is closed");
    this.#session(sessionId);
  }

  async #file(requested: string): Promise<string> {
    if (!path.isAbsolute(requested) || requested.includes("\0")) throw new Error("ACP file paths must be absolute within the run workspace");
    return this.#machine.resolveRootPath(this.#context.root, requested);
  }

  attachmentPath(name: string): Promise<string> { return this.#file(path.join(this.#context.root, "attachments", name)); }

  callbacks(): Pick<Client, "readTextFile" | "writeTextFile" | "createTerminal" | "terminalOutput" | "waitForTerminalExit" | "killTerminal" | "releaseTerminal"> {
    return {
      readTextFile: async ({ sessionId, path: requested, line, limit }) => {
        this.#check(sessionId);
        if (line !== undefined && line !== null && (!Number.isInteger(line) || line < 1)) throw new Error("ACP read line must be a positive integer");
        if (limit !== undefined && limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error("ACP read limit must be a positive integer");
        const file = await this.#file(requested);
        const result = await this.#host.execute(this.#context.runId, "files.text", { path: file }) as { previewable: boolean; content?: string; reason?: string };
        if (!result.previewable || typeof result.content !== "string") throw new Error(`ACP read failed: ${result.reason ?? "not a text file"}`);
        const start = (line ?? 1) - 1;
        return { content: line == null && limit == null ? result.content : result.content.split("\n").slice(start, limit == null ? undefined : start + limit).join("\n") };
      },
      writeTextFile: async ({ sessionId, path: requested, content }) => {
        this.#check(sessionId);
        if (Buffer.byteLength(content) > outputLimit) throw new Error("ACP write exceeds the 256 KB file limit");
        const file = await this.#file(requested);
        await this.#host.execute(this.#context.runId, "write", { file_path: file, content });
        return {};
      },
      createTerminal: (request) => this.#createTerminal(request),
      terminalOutput: ({ sessionId, terminalId }) => { this.#check(sessionId); return this.#output(terminalId); },
      waitForTerminalExit: async ({ sessionId, terminalId }) => {
        this.#check(sessionId);
        const terminal = this.#terminal(terminalId);
        await terminal.child.finished;
        if (terminal.error) throw terminal.error;
        return terminal.status ?? { exitCode: null };
      },
      killTerminal: async ({ sessionId, terminalId }) => { this.#check(sessionId); await this.#stop(this.#terminal(terminalId)); return {}; },
      releaseTerminal: async ({ sessionId, terminalId }) => {
        this.#check(sessionId);
        const terminal = this.#terminal(terminalId);
        await this.#stop(terminal);
        this.#terminals.delete(terminalId);
        return {};
      },
    };
  }

  #terminal(id: string): Terminal {
    const terminal = this.#terminals.get(id);
    if (!terminal) throw new Error("ACP terminal is unknown or released");
    return terminal;
  }

  async #createTerminal(request: CreateTerminalRequest): Promise<{ terminalId: string }> {
    this.#check(request.sessionId);
    if (this.#terminals.size >= 32) throw new Error("ACP session has reached its 32 terminal limit");
    const context = this.#context;
    const cwd = await this.#machine.resolveRootDirectory(context.root, request.cwd ?? context.root);
    if (!request.command || request.command.includes("\0") || request.args?.some((arg) => arg.includes("\0"))) throw new Error("ACP terminal needs a command and valid arguments");
    const limit = request.outputByteLimit ?? 64 * 1024;
    if (!Number.isInteger(limit) || limit < 1 || limit > outputLimit) throw new Error("ACP terminal outputByteLimit must be from 1 to 262144");
    const env = request.env ?? [];
    if (env.some(({ name, value }) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes("\0"))) throw new Error("ACP terminal has an invalid environment");
    const launch = { command: request.command, args: request.args ?? [] };
    const wrapped = context.sandbox ? await context.sandbox.wrap(launch) : launch;
    this.#check(request.sessionId);
    const id = randomUUID();
    const append = (chunk: Buffer): void => {
      const terminal = this.#terminal(id);
      const bytes = Buffer.concat([terminal.output, chunk]);
      const from = Math.max(0, bytes.length - terminal.limit);
      const boundary = (() => { let at = from; while (at < bytes.length && (bytes[at]! & 0xc0) === 0x80) at++; return at; })();
      terminal.output = bytes.subarray(boundary);
      terminal.truncated ||= from > 0;
    };
    const child = this.#machine.startManagedService({
      ...wrapped, args: [...wrapped.args], cwd,
      env: { ...this.#machine.processEnvironment(context.runId), ...context.env, ...this.#env, ...Object.fromEntries(env.map(({ name, value }) => [name, value])) },
      uid: context.uid, gid: context.gid, label: "ACP terminal", onStdout: append, onStderr: append,
      onError: (error) => { this.#terminal(id).error = error; },
      onExit: (code) => { this.#terminal(id).status = { exitCode: code }; },
    });
    this.#terminals.set(id, { child, limit, output: Buffer.alloc(0), truncated: false });
    void child.finished.catch((error: unknown) => { const terminal = this.#terminals.get(id); if (terminal) terminal.error = error instanceof Error ? error : new Error(String(error)); });
    return { terminalId: id };
  }

  #output(id: string): TerminalOutputResponse {
    const terminal = this.#terminal(id);
    if (terminal.error) throw terminal.error;
    return { output: terminal.output.toString("utf8"), truncated: terminal.truncated, ...(terminal.status ? { exitStatus: terminal.status } : {}) };
  }

  async #stop(terminal: Terminal): Promise<void> {
    terminal.child.kill("SIGTERM");
    const force = setTimeout(() => terminal.child.kill("SIGKILL"), 1000);
    try { await terminal.child.finished; }
    finally { clearTimeout(force); }
  }

  async close(): Promise<void> {
    this.#closed = true;
    const results = await Promise.allSettled([...this.#terminals.values()].map((terminal) => this.#stop(terminal)));
    this.#terminals.clear();
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}
