import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  Client, SSEClientTransport, StreamableHTTPClientTransport, SdkError, SdkErrorCode,
  type CallToolResult, type Transport,
} from "@modelcontextprotocol/client";
import type { WorkspaceExecutorMachine, WorkspaceModuleFactory, WorkspaceProcessContext } from "@ragents/workspace-executor";
import { parseMcpServers, type McpServerDefinition, type McpServers } from "../config.js";
import { MCP_OPERATIONS, type McpServerSnapshot, type McpSnapshot } from "./contract.js";
import { ManagedMcpTransport } from "./stdio.js";

export interface McpModuleOptions {
  readonly connectTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

interface Connection {
  readonly name: string;
  readonly definition: McpServerDefinition;
  snapshot: McpServerSnapshot;
  client?: Client;
  transport?: Transport;
  connecting?: Promise<void>;
}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const untilAborted = <T>(operation: Promise<T>, signal: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
  const abort = (): void => { reject(signal.reason); };
  signal.addEventListener("abort", abort, { once: true });
  operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  if (signal.aborted) abort();
});

export const redactMcpError = (cause: unknown, definitions: McpServers): string => {
  const values = Object.values(definitions).flatMap((definition) => Object.values("command" in definition ? definition.env ?? {} : definition.headers ?? {}));
  const redacted = values.filter((value) => value.length > 0).sort((a, b) => b.length - a.length)
    .reduce((text, value) => text.replaceAll(value, "[redacted]"), messageOf(cause));
  return redacted.length <= 2048 ? redacted : `${redacted.slice(0, 400)}\n[Diagnostics truncated]\n${redacted.slice(-1600)}`;
};

class RunConnections {
  readonly #machine: WorkspaceExecutorMachine;
  readonly #context: () => Promise<WorkspaceProcessContext>;
  readonly #options: Required<McpModuleOptions>;
  readonly #servers: readonly Connection[];
  readonly #listeners = new Set<(snapshot: McpSnapshot) => void>();
  readonly #controllers = new Set<AbortController>();
  readonly #watches = new Set<() => void>();
  #closed = false;

  constructor(machine: WorkspaceExecutorMachine, context: () => Promise<WorkspaceProcessContext>, definitions: McpServers, options: Required<McpModuleOptions>) {
    this.#machine = machine;
    this.#context = context;
    this.#options = options;
    this.#servers = Object.entries(definitions).map(([name, definition]) => ({ name, definition, snapshot: {
      name, transport: "command" in definition ? "stdio" : definition.type === "sse" ? "sse" : "http", state: "connecting", tools: [],
    } }));
  }

  snapshot(): McpSnapshot { return { servers: this.#servers.map((entry) => entry.snapshot) }; }

  #changed(): void { for (const listener of this.#listeners) listener(this.snapshot()); }

  #error(cause: unknown): string {
    return redactMcpError(cause, Object.fromEntries(this.#servers.map((entry) => [entry.name, entry.definition])));
  }

  async connect(): Promise<McpSnapshot> {
    if (this.#closed) throw new Error("MCP connections of this run are closed");
    await Promise.all(this.#servers.map((entry) => entry.client ? Promise.resolve() : this.#connect(entry)));
    return this.snapshot();
  }

  #connect(entry: Connection): Promise<void> {
    if (entry.connecting) return entry.connecting;
    entry.connecting = this.#open(entry).catch((cause: unknown) => {
      if (!this.#closed) {
        entry.snapshot = { ...entry.snapshot, state: "failed", error: this.#error(cause) };
        this.#changed();
      }
    }).finally(() => { entry.connecting = undefined; });
    return entry.connecting;
  }

  async #open(entry: Connection): Promise<void> {
    if (this.#closed) return;
    const previous = entry.client;
    entry.client = undefined;
    await previous?.close();
    await entry.transport?.close();
    if (this.#closed) return;
    entry.snapshot = { ...entry.snapshot, state: "connecting", error: undefined };
    this.#changed();
    const context = await this.#context();
    if (this.#closed) return;
    const controller = new AbortController();
    this.#controllers.add(controller);
    const timer = setTimeout(() => controller.abort(new Error("MCP connection timed out")), this.#options.connectTimeoutMs);
    const attempt = async (transport: Transport, mode: "auto" | "legacy", kind: McpServerSnapshot["transport"]): Promise<void> => {
      controller.signal.throwIfAborted();
      if (this.#closed) throw new Error("MCP run stopped while connecting");
      const client = new Client({ name: "RAgents", version: "1" }, {
        capabilities: { roots: { listChanged: false } },
        versionNegotiation: { mode, probe: { timeoutMs: Math.min(3000, this.#options.connectTimeoutMs) } },
        listChanged: { tools: { onChanged: (error, tools) => {
          if (this.#closed || entry.client !== client) return;
          if (error) {
            entry.snapshot = { ...entry.snapshot, state: "failed", error: this.#error(error) };
          } else if (tools) {
            entry.snapshot = { ...entry.snapshot, tools };
          }
          this.#changed();
        } } },
      });
      client.setRequestHandler("roots/list", () => ({ roots: [{ uri: pathToFileURL(context.root).href, name: path.basename(context.root) }] }));
      entry.client = client;
      entry.transport = transport;
      client.onclose = () => {
        if (this.#closed || entry.client !== client) return;
        entry.client = undefined;
        const stderr = transport instanceof ManagedMcpTransport ? transport.stderr : "";
        entry.snapshot = { ...entry.snapshot, state: "failed", error: this.#error(`MCP server disconnected${stderr ? `: ${stderr}` : ""}`) };
        this.#changed();
      };
      client.onerror = (error) => {
        if (this.#closed || entry.client !== client || entry.snapshot.state !== "connected" || error.name === "AbortError") return;
        entry.snapshot = { ...entry.snapshot, state: "failed", error: this.#error(error) };
        this.#changed();
      };
      try {
        await untilAborted(client.connect(transport, { signal: controller.signal, timeout: this.#options.connectTimeoutMs }), controller.signal);
        const listed = client.getServerCapabilities()?.tools ? await untilAborted(client.listTools({}, { signal: controller.signal, timeout: this.#options.connectTimeoutMs }), controller.signal) : { tools: [] };
        if (this.#closed) throw new Error("MCP run stopped while connecting");
        const instructions = client.getInstructions();
        entry.snapshot = { name: entry.name, transport: kind, state: "connected", protocolVersion: client.getNegotiatedProtocolVersion(),
          ...(instructions ? { instructions: instructions.slice(0, 4096) } : {}), tools: listed.tools };
        this.#changed();
      } catch (cause) {
        if (entry.client === client) entry.client = undefined;
        await client.close();
        await transport.close();
        if (transport instanceof ManagedMcpTransport && transport.stderr) throw new Error(`${messageOf(cause)}: ${transport.stderr}`, { cause });
        throw cause;
      }
    };
    try {
      if ("command" in entry.definition) {
        const transport = new ManagedMcpTransport(this.#machine, context, entry.definition);
        try { await attempt(transport, "auto", "stdio"); }
        catch (cause) {
          const failure = cause instanceof Error && cause.cause instanceof SdkError ? cause.cause : cause;
          if (this.#closed || controller.signal.aborted || !transport.ended || transport.lastRequestMethod !== "server/discover" || !(failure instanceof SdkError)
            || ![SdkErrorCode.ConnectionClosed, SdkErrorCode.EraNegotiationFailed].includes(failure.code)) throw cause;
          await attempt(new ManagedMcpTransport(this.#machine, context, entry.definition), "legacy", "stdio");
        }
      } else {
        const definition = entry.definition;
        const url = new URL(definition.url);
        const headers = definition.headers;
        const request: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.any([
          controller.signal, ...(init?.signal ? [init.signal] : []), ...(init?.method === "DELETE" ? [AbortSignal.timeout(2000)] : []),
        ]) });
        if (definition.type === "sse") {
          await attempt(new SSEClientTransport(url, { requestInit: { headers }, fetch: request }), "auto", "sse");
        } else {
          let rejectedInitialize: number | undefined;
          const transport = new StreamableHTTPClientTransport(url, {
            requestInit: { headers },
            fetch: async (input, init) => {
              const response = await request(input, init);
              if (typeof init?.body === "string" && JSON.parse(init.body).method === "initialize" && response.status >= 400 && response.status < 500) rejectedInitialize = response.status;
              return response;
            },
          });
          try { await attempt(transport, "auto", "http"); }
          catch (cause) {
            if (this.#closed || controller.signal.aborted || definition.type === "http" || rejectedInitialize === undefined || [401, 403, 408, 429].includes(rejectedInitialize)) throw cause;
            await attempt(new SSEClientTransport(url, { requestInit: { headers }, fetch: request }), "auto", "sse");
          }
        }
      }
    } finally { clearTimeout(timer); this.#controllers.delete(controller); }
  }

  async call(server: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    signal?.throwIfAborted();
    if (this.#closed) throw new Error("MCP connections of this run are closed");
    const entry = this.#servers.find((candidate) => candidate.name === server);
    if (!entry) throw new Error(`Unknown MCP server; available: ${this.#servers.map((candidate) => candidate.name).join(", ")}`);
    if (!entry.client || entry.snapshot.state !== "connected") {
      const cause = entry.snapshot.error ?? "connection is not ready";
      void this.#connect(entry);
      throw new Error(`MCP server ${server} is unavailable: ${cause}. Reconnecting; retry the tool after it connects.`);
    }
    try {
      return await entry.client.callTool({ name: tool, arguments: args }, { signal, timeout: this.#options.requestTimeoutMs, resetTimeoutOnProgress: true, onprogress: () => undefined });
    } catch (cause) { throw new Error(this.#error(cause)); }
  }

  watch(progress: (snapshot: McpSnapshot) => void, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    progress(this.snapshot());
    this.#listeners.add(progress);
    return new Promise((resolve) => {
      const stop = (): void => { this.#listeners.delete(progress); this.#watches.delete(stop); signal.removeEventListener("abort", stop); resolve(); };
      this.#watches.add(stop);
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
    });
  }

  async close(): Promise<void> {
    this.#closed = true;
    for (const controller of this.#controllers) controller.abort(new Error("MCP run stopped while connecting"));
    for (const stop of this.#watches) stop();
    this.#listeners.clear();
    const results = await Promise.allSettled(this.#servers.map(async (entry) => {
      const client = entry.client;
      entry.client = undefined;
      try {
        if (entry.snapshot.state === "connected" && entry.transport instanceof StreamableHTTPClientTransport && entry.transport.sessionId) await entry.transport.terminateSession();
      } finally {
        try { await client?.close(); }
        finally { await entry.transport?.close(); await entry.connecting; }
        entry.snapshot = { ...entry.snapshot, state: "closed", error: undefined };
      }
    }));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw new Error(this.#error(failed.reason));
  }
}

export const mcpModule = (machine: WorkspaceExecutorMachine, options: McpModuleOptions = {}): WorkspaceModuleFactory => (host) => {
  const runs = new Map<string, RunConnections>();
  const settings = { connectTimeoutMs: options.connectTimeoutMs ?? 15_000, requestTimeoutMs: options.requestTimeoutMs ?? 300_000 };
  const fields = (value: unknown): Record<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("MCP operation needs an object");
    return value as Record<string, unknown>;
  };
  const run = (runId: string): RunConnections => {
    const state = runs.get(runId);
    if (!state) throw new Error("The run's MCP servers have not connected yet");
    return state;
  };
  const close = async (runId: string): Promise<void> => {
    const state = runs.get(runId);
    runs.delete(runId);
    await state?.close();
  };
  return {
    operations: {
      [MCP_OPERATIONS.connect]: async ({ runId, input, signal }) => {
        signal?.throwIfAborted();
        const servers = parseMcpServers(fields(input).servers);
        const state = runs.get(runId) ?? new RunConnections(machine, () => host.contextFor(runId), servers, settings);
        runs.set(runId, state);
        let stopped: Promise<{ error: unknown } | undefined> | undefined;
        const stop = (): void => { stopped = close(runId).then(() => undefined, (error: unknown) => ({ error })); };
        signal?.addEventListener("abort", stop, { once: true });
        try { return await state.connect(); }
        finally {
          signal?.removeEventListener("abort", stop);
          const failure = await stopped;
          if (failure) throw failure.error;
        }
      },
      [MCP_OPERATIONS.call]: async ({ runId, input, signal }) => {
        const entry = fields(input);
        if (typeof entry.server !== "string" || typeof entry.tool !== "string") throw new Error("MCP call needs server and tool names");
        return run(runId).call(entry.server, entry.tool, fields(entry.arguments ?? {}), signal);
      },
      [MCP_OPERATIONS.watch]: async ({ runId, progress, signal }) => {
        if (!signal || !progress) throw new Error("MCP watch needs a signal and a progress listener");
        await run(runId).watch(progress, signal);
        return null;
      },
      [MCP_OPERATIONS.close]: async ({ runId }) => { await close(runId); return null; },
    },
    stopRun: close,
    shutdown: async () => { await Promise.all([...runs.keys()].map(close)); },
  };
};
