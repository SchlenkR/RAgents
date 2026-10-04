import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type, type TSchema } from "typebox";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { defineRunFunction, type AgentContribution, type RunFunction } from "@ragents/engine";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";
import { parseMcpServers, type McpServers } from "../config.js";
import { MCP_OPERATIONS, type McpServerSnapshot, type McpSnapshot } from "../executor/contract.js";
import { redactMcpError } from "../executor/module.js";
import { mcpToolName } from "./naming.js";
import { boundedMcpText, mapMcpResult, type McpMappedResult } from "./results.js";
import type { McpRunServers } from "./service.js";

interface RunState {
  servers: McpServers;
  snapshot: McpSnapshot;
  functions: readonly RunFunction[];
  ready: Promise<void>;
  initial?: Promise<readonly RunFunction[]>;
  resolved: boolean;
  watch?: AbortController;
  connect?: AbortController;
  retry?: NodeJS.Timeout;
  readonly listeners: Set<(snapshot: McpSnapshot) => void>;
  readonly images: Map<string, McpMappedResult>;
  closed: boolean;
}

export interface RunMcpOptions {
  readonly servers: McpServers;
  readonly execute: SandboxServices["execute"];
  readonly fileFor: (runId: string) => string;
}

export class RunMcp implements McpRunServers {
  readonly #options: RunMcpOptions;
  readonly #runs = new Map<string, RunState>();
  #ended = false;

  constructor(options: RunMcpOptions) { this.#options = options; }

  #state(runId: string): RunState {
    if (this.#ended) throw new Error("MCP service has shut down");
    const previous = this.#runs.get(runId);
    if (previous) return previous;
    const state: RunState = { servers: this.#options.servers, snapshot: { servers: [] }, functions: [], ready: Promise.resolve(),
      listeners: new Set(), images: new Map(), closed: false, resolved: false };
    this.#runs.set(runId, state);
    state.ready = readFile(this.#options.fileFor(runId), "utf8").then((text) => {
      state.servers = this.#merge(parseMcpServers(JSON.parse(text)));
    }, (cause: NodeJS.ErrnoException) => { if (cause.code !== "ENOENT") throw cause; });
    return state;
  }

  #merge(servers: McpServers): McpServers {
    const duplicate = Object.keys(servers).find((name) => Object.hasOwn(this.#options.servers, name));
    if (duplicate) throw new Error(`Run-scoped MCP server ${duplicate} already exists in the profile; choose a different server name`);
    return { ...this.#options.servers, ...servers };
  }

  async restore(runId: string): Promise<void> {
    const state = this.#state(runId);
    await state.ready;
  }

  async serversFor(runId: string): Promise<McpServers> {
    const state = this.#state(runId);
    await state.ready;
    return state.servers;
  }

  async setRunServers(runId: string, definitions: McpServers): Promise<void> {
    const state = this.#state(runId);
    if (state.initial) throw new Error("Run-scoped MCP servers must be set before the run's first tool resolution");
    const servers = parseMcpServers(definitions);
    const merged = this.#merge(servers);
    const file = this.#options.fileFor(runId);
    const temporary = `${file}.${randomUUID()}.tmp`;
    state.ready = state.ready.then(async () => {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await chmod(path.dirname(file), 0o700);
      try {
        await writeFile(temporary, JSON.stringify(servers), { mode: 0o600, flag: "wx" });
        await rename(temporary, file);
        state.servers = merged;
      } finally { await rm(temporary, { force: true }); }
    });
    await state.ready;
  }

  async replaceRunServers(runId: string, definitions: McpServers): Promise<void> {
    const servers = parseMcpServers(definitions);
    this.#merge(servers);
    const state = this.#state(runId);
    await state.ready;
    if (state.initial) await this.close(runId);
    state.initial = undefined;
    state.resolved = false;
    state.closed = false;
    state.snapshot = { servers: [] };
    state.functions = [];
    await this.setRunServers(runId, servers);
  }

  tools(runId: string): readonly RunFunction[] | Promise<readonly RunFunction[]> {
    const state = this.#state(runId);
    if (state.closed) {
      state.closed = false;
      state.initial = undefined;
      state.resolved = false;
    }
    if (state.initial) return state.resolved ? state.functions : state.initial;
    state.initial = state.ready.then(async () => {
      if (state.closed || Object.keys(state.servers).length === 0) return state.functions;
      try {
        state.connect = new AbortController();
        this.#update(runId, state, await this.#options.execute(runId, MCP_OPERATIONS.connect, { servers: state.servers }, { signal: state.connect.signal }) as McpSnapshot);
        if (!state.closed) this.#watch(runId, state);
      } catch (cause) { this.#failed(runId, state, cause); }
      return state.functions;
    }).finally(() => { state.resolved = true; });
    return state.initial;
  }

  #update(runId: string, state: RunState, snapshot: McpSnapshot): void {
    if (state.closed) return;
    state.snapshot = snapshot;
    const taken = new Set<string>();
    state.functions = snapshot.servers.flatMap((server) => server.tools.map((tool) => {
      const candidate = mcpToolName(server.name, tool.name);
      const name = taken.has(candidate) ? mcpToolName(server.name, `${tool.name}__${taken.size}`) : candidate;
      taken.add(name);
      return defineRunFunction({
        name,
        label: tool.title ?? tool.name,
        description: `[MCP ${server.name}] ${tool.title && tool.description ? `${tool.title}: ${tool.description}` : tool.description ?? tool.title ?? tool.name}`.slice(0, 4000),
        schema: tool.inputSchema as TSchema,
        resultSchema: Type.String(),
        available: alwaysAvailable,
        executionMode: tool.annotations?.readOnlyHint === true ? "parallel" : "sequential",
        run: async ({ signal, modelContext }, toolCallId, input) => {
          state.images.delete(toolCallId);
          const result = await this.#options.execute(runId, MCP_OPERATIONS.call, { server: server.name, tool: tool.name, arguments: input }, { signal: signal ?? new AbortController().signal, untilAborted: true }) as CallToolResult;
          const mapped = mapMcpResult(result);
          if (mapped.images.length > 0 && modelContext !== undefined) state.images.set(toolCallId, mapped);
          return mapped.text;
        },
      });
    }));
    for (const listener of state.listeners) listener(snapshot);
  }

  #failed(runId: string, state: RunState, cause: unknown): void {
    const error = redactMcpError(cause, state.servers);
    const existing = state.snapshot.servers;
    const snapshot: McpSnapshot = { servers: Object.entries(state.servers).map(([name, definition]) => ({
      ...(existing.find((entry) => entry.name === name) ?? { name, transport: "command" in definition ? "stdio" as const : definition.type === "sse" ? "sse" as const : "http" as const, tools: [] }),
      state: "failed", error,
    })) };
    this.#update(runId, state, snapshot);
  }

  #watch(runId: string, state: RunState): void {
    if (state.closed) return;
    const controller = new AbortController();
    state.watch = controller;
    const ended = (cause: unknown): void => {
      if (controller.signal.aborted || state.closed) return;
      this.#failed(runId, state, cause);
      state.retry = setTimeout(async () => {
        if (state.closed) return;
        try {
          this.#update(runId, state, await this.#options.execute(runId, MCP_OPERATIONS.connect, { servers: state.servers }) as McpSnapshot);
          this.#watch(runId, state);
        } catch (error) { ended(error); }
      }, 5000);
      state.retry.unref();
    };
    this.#options.execute(runId, MCP_OPERATIONS.watch, {}, {
      signal: controller.signal,
      untilAborted: true,
      onProgress: (value) => this.#update(runId, state, value as McpSnapshot),
    }).then(() => ended(new Error("MCP status observation ended")), ended);
  }

  snapshot(runId: string): McpSnapshot {
    const state = this.#runs.get(runId);
    if (state?.snapshot.servers.length) return state.snapshot;
    const servers = state?.servers ?? this.#options.servers;
    return { servers: Object.entries(servers).map(([name, definition]) => ({ name, transport: "command" in definition ? "stdio" : definition.type === "sse" ? "sse" : "http", state: state?.closed ? "closed" : "connecting", tools: [] })) };
  }

  subscribe(runId: string, listener: (snapshot: McpSnapshot) => void): () => void {
    const state = this.#state(runId);
    state.listeners.add(listener);
    listener(this.snapshot(runId));
    return () => { state.listeners.delete(listener); };
  }

  prompt(runId: string): string {
    const servers = this.snapshot(runId).servers;
    if (servers.length === 0) return "";
    return "External MCP servers supply native tools. Their instructions apply to their tools.\n" + servers.map((server) => {
      const status = server.state === "connected" ? `connected (${server.transport}, ${server.protocolVersion ?? "unknown protocol"})` : `${server.state}${server.error ? `: ${server.error}` : ""}`;
      return `MCP ${server.name}: ${status}${server.instructions ? `\n${boundedMcpText(server.instructions, 4096)}` : ""}`;
    }).join("\n");
  }

  images(): AgentContribution {
    return {
      id: "ragents.mcp.images",
      afterToolCall: ({ runId }, outcome, call) => {
        const images = this.#runs.get(runId)?.images;
        const key = outcome.toolCallId;
        if (!key) return undefined;
        const result = images?.get(key);
        images?.delete(key);
        if (!result || outcome.isError) return undefined;
        return call.modelReadsImages ? { content: [{ type: "text", text: result.text }, ...result.images] }
          : { content: [{ type: "text", text: `${result.text}\nThe selected model cannot read the returned images.` }] };
      },
    };
  }

  async close(runId: string): Promise<void> {
    const state = this.#runs.get(runId);
    if (!state || state.closed) return;
    state.closed = true;
    state.connect?.abort();
    state.watch?.abort();
    clearTimeout(state.retry);
    state.images.clear();
    let error: string | undefined;
    try {
      if (state.initial) {
        await this.#options.execute(runId, MCP_OPERATIONS.close, {});
        await state.initial;
      }
    } catch (cause) {
      error = redactMcpError(cause, state.servers);
      throw new Error(error);
    } finally {
      state.snapshot = { servers: state.snapshot.servers.map((server) => ({ ...server, state: "closed", error })) };
      for (const listener of state.listeners) listener(state.snapshot);
    }
  }

  async delete(runId: string): Promise<void> {
    await this.close(runId);
    this.#runs.delete(runId);
    await rm(this.#options.fileFor(runId), { force: true });
  }

  async shutdown(): Promise<void> {
    this.#ended = true;
    await Promise.all([...this.#runs.keys()].map((runId) => this.close(runId)));
  }
}
