import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  ClientSideConnection, PROTOCOL_VERSION, RequestError,
  type AgentCapabilities, type ContentBlock, type McpServer, type PromptResponse,
  type RequestPermissionOutcome, type RequestPermissionRequest, type SessionUpdate, type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import type { WorkspaceExecutorMachine, WorkspaceModuleHost, WorkspaceProcessContext } from "@ragents/workspace-executor";
import type { AcpAgentDefinition } from "../config.js";
import type { McpServers } from "@ragents/plugins/ragents.mcp/server/service.js";
import type { AcpOpened, AcpProgress } from "./contract.js";
import { AcpProcess } from "./process.js";
import { AcpWorkspace } from "./workspace.js";

interface Permission {
  readonly labels: ReadonlyMap<string, string>;
  readonly resolve: (outcome: RequestPermissionOutcome) => void;
}

const messageOf = (cause: unknown): string => cause instanceof RequestError && cause.data !== undefined && cause.data !== null
  ? `${cause.message}: ${typeof cause.data === "string" ? cause.data : JSON.stringify(cause.data)}`
  : cause instanceof Error ? cause.message : String(cause);

const boundedText = (text: string, maximum = 8192): string => {
  const lines = text.split("\n");
  const clipped = lines.slice(0, 80).map((line) => line.length > 1000 ? `${line.slice(0, 1000)} [Line truncated]` : line).join("\n");
  const marker = "\n[Output truncated]";
  return clipped.length > maximum || lines.length > 80 ? `${clipped.slice(0, maximum - marker.length)}${marker}` : clipped;
};

export const withDeadline = <T>(operation: Promise<T>, signal: AbortSignal | undefined, milliseconds: number, label: string): Promise<T> => new Promise((resolve, reject) => {
  const abort = (): void => { cleanup(); reject(new Error(`${label} was cancelled`)); };
  const timer = setTimeout(() => { cleanup(); reject(new Error(`${label} timed out`)); }, milliseconds);
  const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
  signal?.addEventListener("abort", abort, { once: true });
  operation.then((result) => { cleanup(); resolve(result); }, (error: unknown) => { cleanup(); reject(error); });
  if (signal?.aborted) abort();
});

export class AcpSession {
  readonly #context: WorkspaceProcessContext;
  readonly #servers: McpServers;
  readonly #process: AcpProcess;
  readonly #workspace: AcpWorkspace;
  readonly #permissions = new Map<string, Permission>();
  readonly #redactions: readonly string[];
  #client: ClientSideConnection | undefined;
  #sessionId: string | undefined;
  #capabilities: AgentCapabilities = {};
  #loading = false;
  #closed = false;
  #prompt: { progress: (value: AcpProgress) => void; signal: AbortSignal; cancelled: boolean } | undefined;

  constructor(machine: WorkspaceExecutorMachine, host: WorkspaceModuleHost, context: WorkspaceProcessContext, definition: AcpAgentDefinition, servers: McpServers) {
    this.#context = context;
    this.#servers = servers;
    this.#redactions = [...Object.values(definition.env ?? {}), ...Object.values(servers).flatMap((server) => Object.values("command" in server ? server.env ?? {} : server.headers ?? {}))].filter(Boolean).sort((a, b) => b.length - a.length);
    this.#process = new AcpProcess(machine, context, definition);
    this.#workspace = new AcpWorkspace(machine, host, context, (id) => this.#checkSession(id), definition.env ?? {});
  }

  get pid(): number | undefined { return this.#process.pid; }
  get closed(): boolean { return this.#closed || this.#client?.signal.aborted === true; }

  redact(text: string): string {
    const value = this.#redactions.reduce((value, secret) => value.replaceAll(secret, "[redacted]"), text).replaceAll(this.#context.root, ".");
    return this.#sessionId ? value.replaceAll(this.#sessionId, "[private session]") : value;
  }

  diagnostic(cause: unknown): Error { return new Error(this.redact(`${messageOf(cause)}${this.#process.stderr ? `: ${this.#process.stderr}` : ""}`).slice(0, 4096)); }

  #checkSession(id: string): void {
    if (this.#closed || id !== this.#sessionId) throw new Error("ACP request belongs to an unavailable session");
  }

  async open(sessionId: string | undefined, signal: AbortSignal | undefined): Promise<AcpOpened & { notices: readonly string[] }> {
    try {
      await withDeadline(this.#process.start(), signal, 15_000, "ACP process launch");
      if (this.#closed) throw new Error("ACP actor stopped while starting");
      this.#client = new ClientSideConnection(() => ({
        ...this.#workspace.callbacks(),
        requestPermission: (request) => this.#permission(request),
        sessionUpdate: ({ sessionId: updatedSession, update }) => {
          if (this.#loading || this.#closed || !this.#prompt) return;
          this.#checkSession(updatedSession);
          this.#prompt.progress({ kind: "update", update: this.#boundedUpdate(update) });
        },
      }), this.#process.stream);
      const initialized = await withDeadline(this.#client.initialize({ protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: "RAgents", version: "1" }, clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      }), signal, 15_000, "ACP initialize");
      if (initialized.protocolVersion !== PROTOCOL_VERSION) throw new Error(`ACP agent negotiated unsupported protocol version ${initialized.protocolVersion}`);
      this.#capabilities = initialized.agentCapabilities ?? {};
      const { servers, notices } = this.#mcpServers();
      const setup = async (): Promise<void> => {
        if (sessionId) {
          if (!this.#capabilities.loadSession) throw new Error("ACP actor is blocked: the agent does not advertise loadSession; its previous session cannot be restored");
          this.#sessionId = sessionId;
          this.#loading = true;
          try { await this.#client!.loadSession({ sessionId, cwd: this.#context.root, mcpServers: servers }); }
          finally { this.#loading = false; }
        } else {
          this.#sessionId = (await this.#client!.newSession({ cwd: this.#context.root, mcpServers: servers })).sessionId;
        }
      };
      try { await withDeadline(setup(), signal, 15_000, sessionId ? "ACP session/load" : "ACP session/new"); }
      catch (cause) {
        if (cause instanceof RequestError && cause.code === -32000) {
          const methods = (initialized.authMethods ?? []).map((method) => `${method.name} (${method.id})`).join(", ") || "no method advertised";
          throw new Error(`ACP authentication requires non-interactive credentials or a prior sign-in. Authentication methods: ${methods}. ${messageOf(cause)}`);
        }
        throw cause;
      }
      if (!this.#sessionId) throw new Error("ACP agent returned an empty session id");
      if (this.#closed || signal?.aborted) throw new Error("ACP actor stopped while opening its session");
      return { sessionId: this.#sessionId, capabilities: this.#capabilities, notices };
    } catch (cause) {
      await this.close();
      throw this.diagnostic(cause);
    }
  }

  #mcpServers(): { servers: McpServer[]; notices: string[] } {
    const notices: string[] = [];
    const servers = Object.entries(this.#servers).flatMap(([name, server]): McpServer[] => {
      if ("command" in server) {
        if (server.cwd) throw new Error(`MCP server ${name} specifies cwd, which ACP cannot pass to the agent`);
        return [{ name, command: server.command, args: [...(server.args ?? [])], env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })) }];
      }
      const type = server.type === "sse" ? "sse" : "http";
      if (!this.#capabilities.mcpCapabilities?.[type]) { notices.push(`MCP server ${name} is not passed to the external agent: ${type} transport is not advertised.`); return []; }
      return [{ name, type, url: server.url, headers: Object.entries(server.headers ?? {}).map(([name, value]) => ({ name, value })) }];
    });
    return { servers, notices };
  }

  #bounded(value: unknown): unknown {
    if (value === undefined) return undefined;
    const serialized = JSON.stringify(value, (key, entry: unknown) => /(?:sessionId|toolCallId|terminalId|optionId|authorization|token|secret|password|apiKey)/i.test(key) ? "[private]" : typeof entry === "string" ? this.redact(entry) : entry);
    if (serialized === undefined) return null;
    return serialized.length > 8192 ? `${serialized.slice(0, 8192)}\n[Output truncated]` : JSON.parse(serialized);
  }

  #boundedTool<T extends ToolCallUpdate>(update: T): T {
    return { ...update,
      ...(update.name ? { name: this.redact(update.name).slice(0, 128) } : {}),
      ...(update.title === undefined || update.title === null ? {} : { title: this.redact(update.title).slice(0, 256) }),
      rawInput: this.#bounded(update.rawInput), rawOutput: this.#bounded(update.rawOutput),
      content: update.content?.slice(0, 16).map((part) => part.type === "content" && part.content.type === "text"
        ? { type: "content", content: { type: "text", text: boundedText(this.redact(part.content.text)) } }
        : part.type === "diff" ? { type: "diff", path: this.redact(part.path), oldText: part.oldText == null ? part.oldText : boundedText(this.redact(part.oldText), 4096), newText: boundedText(this.redact(part.newText), 4096) }
        : { type: "content", content: { type: "text", text: part.type === "terminal" ? "Terminal command" : `Attached ${part.content.type} content` } }),
      locations: update.locations?.slice(0, 16).map((location) => ({ ...location, path: this.redact(location.path) })),
    };
  }

  #boundedUpdate(update: SessionUpdate): SessionUpdate {
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") return this.#boundedTool(update);
    if (update.sessionUpdate === "agent_message_chunk" || update.sessionUpdate === "agent_thought_chunk") {
      return update.content.type === "text" ? { ...update, content: { type: "text", text: this.redact(update.content.text) } } : update;
    }
    if (update.sessionUpdate === "plan") return { ...update, entries: update.entries.slice(0, 50).map((entry) => ({ ...entry, content: this.redact(entry.content).slice(0, 1000) })) };
    return update;
  }

  #permission(request: RequestPermissionRequest): Promise<{ outcome: RequestPermissionOutcome }> {
    this.#checkSession(request.sessionId);
    const prompt = this.#prompt;
    if (!prompt || prompt.signal.aborted || prompt.cancelled) return Promise.resolve({ outcome: { outcome: "cancelled" } });
    if (request.options.length < 1 || request.options.length > 20) throw new Error("ACP permission requires 1 to 20 options");
    const id = randomUUID();
    const labels = request.options.map((option, index) => `${this.redact(option.name).slice(0, 150)} (${index + 1})`);
    return new Promise((resolve) => {
      this.#permissions.set(id, { labels: new Map(request.options.map((option, index) => [labels[index]!, option.optionId])), resolve: (outcome) => resolve({ outcome }) });
      prompt.progress({ kind: "permission", request: id, title: this.redact(request.toolCall.title ?? "Allow the external agent's tool call?").slice(0, 500), toolCall: this.#boundedTool(request.toolCall),
        options: request.options.map((option, index) => ({ label: labels[index]!, description: option.kind.replaceAll("_", " ") })),
      });
    });
  }

  answerPermission(request: string, label: string | undefined): void {
    const pending = this.#permissions.get(request);
    if (!pending) return;
    const optionId = label === undefined ? undefined : pending.labels.get(label);
    if (label !== undefined && !optionId) throw new Error("ACP permission answer does not match an offered option");
    this.#permissions.delete(request);
    pending.resolve({ outcome: optionId ? "selected" : "cancelled", ...(optionId ? { optionId } : {}) } as RequestPermissionOutcome);
  }

  #cancelPermissions(): void {
    for (const pending of this.#permissions.values()) pending.resolve({ outcome: "cancelled" });
    this.#permissions.clear();
  }

  async prompt(prompt: readonly ContentBlock[], progress: (value: AcpProgress) => void, signal: AbortSignal): Promise<PromptResponse> {
    if (this.closed || !this.#client || !this.#sessionId) throw new Error("ACP session is not connected");
    if (this.#prompt) throw new Error("ACP actor already has an active prompt");
    signal.throwIfAborted();
    const content = await Promise.all(prompt.map(async (block): Promise<ContentBlock> => {
      if (block.type !== "resource" || !block.resource.uri.startsWith("ragents-attachment:///")) return block;
      const name = decodeURIComponent(block.resource.uri.slice("ragents-attachment:///".length));
      if (!name || name.includes("/") || name.includes("\\") || name.includes("\0")) throw new Error("ACP attachment reference needs a file name");
      const file = await this.#workspace.attachmentPath(name);
      return { ...block, resource: { ...block.resource, uri: pathToFileURL(file).href } };
    }));
    signal.throwIfAborted();
    if (this.#prompt) throw new Error("ACP actor already has an active prompt");
    this.#prompt = { progress, signal, cancelled: false };
    const client = this.#client;
    const sessionId = this.#sessionId;
    let force: NodeJS.Timeout | undefined;
    let cancellation: Promise<void> | undefined;
    const cancel = (): void => {
      if (!this.#prompt || this.#prompt.cancelled) return;
      this.#prompt.cancelled = true;
      this.#cancelPermissions();
      cancellation = client.cancel({ sessionId }).catch((cause: unknown) => { throw this.diagnostic(cause); });
      void cancellation.catch(() => undefined);
      force = setTimeout(() => { void this.close().catch(() => undefined); }, 2000);
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      const result = await client.prompt({ sessionId, prompt: content });
      await cancellation;
      return result;
    } catch (cause) { throw this.diagnostic(cause); }
    finally {
      if (force) clearTimeout(force);
      signal.removeEventListener("abort", cancel);
      this.#cancelPermissions();
      this.#prompt = undefined;
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#cancelPermissions();
    const results = await Promise.allSettled([this.#workspace.close(), this.#process.close()]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}
