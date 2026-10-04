import { randomUUID } from "node:crypto";
import type { AgentCapabilities, ContentBlock, PromptResponse, Usage } from "@agentclientprotocol/sdk";
import { emptyUsage, type AgentDriver, type JsonValue, type Orchestration, type TurnRequest, type TurnResult, type TurnUsage } from "@ragents/engine";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import type { AskService } from "@ragents/plugins/ragents.ask/server/contract.js";
import type { McpRunServers } from "@ragents/plugins/ragents.mcp/server/service.js";
import type { AcpAgentDefinition } from "../config.js";
import { ACP_OPERATIONS, type AcpOpened, type AcpProgress } from "../executor/contract.js";
import { AcpUpdates } from "./updates.js";

export const ACP_STATE_ID = "ragents.acp.sessions";

interface SavedSession {
  readonly runtime: string;
  readonly sessionId: string;
  readonly usage: TurnUsage;
  readonly blocked?: string;
}

interface DriverOptions {
  readonly runtime: () => Orchestration;
  readonly execute: SandboxServices["execute"];
  readonly ask: AskService;
  readonly mcp: McpRunServers;
  readonly agents: ReadonlyMap<string, AcpAgentDefinition>;
}

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const cumulativeUsage = (usage: Usage | null | undefined, previous: TurnUsage, cost: number | undefined): TurnUsage => ({
  inputTokens: usage?.inputTokens ?? previous.inputTokens,
  outputTokens: usage?.outputTokens ?? previous.outputTokens,
  cacheReadTokens: usage?.cachedReadTokens ?? previous.cacheReadTokens,
  cacheWriteTokens: usage?.cachedWriteTokens ?? previous.cacheWriteTokens,
  costUsd: cost ?? previous.costUsd,
});

const deltaUsage = (total: TurnUsage, previous: TurnUsage): TurnUsage => Object.fromEntries(Object.entries(total).map(([key, value]) =>
  [key, Math.max(0, value - previous[key as keyof TurnUsage])])) as TurnUsage;

export class AcpDriver implements AgentDriver<"external"> {
  readonly kind = "external";
  readonly #options: DriverOptions;
  readonly #connections = new Map<string, AcpOpened & { notices?: readonly string[] }>();
  readonly #blocked = new Map<string, { runId: string; actorId: string; reason: string }>();
  readonly #stopped = new Set<string>();
  readonly #runs = new Set<string>();
  #bound = false;

  constructor(options: DriverOptions) { this.#options = options; }

  #key(runId: string, actorId: string): string { return JSON.stringify([runId, actorId]); }

  #saved(runId: string, actorId: string): SavedSession | undefined {
    const entry = this.#options.runtime().view(runId).pluginStates.find((state) => state.pluginId === ACP_STATE_ID && state.scope.kind === "actor" && state.scope.actorId === actorId);
    if (!entry) return undefined;
    const value = entry.state as unknown as SavedSession;
    if (!value || typeof value.runtime !== "string" || typeof value.sessionId !== "string" || !value.usage) throw new Error("The ACP actor's stored session is invalid");
    return value;
  }

  #keep(request: TurnRequest<"external">, state: SavedSession): void {
    const runtime = this.#options.runtime();
    runtime.replacePluginState({ actorId: runtime.view(request.runId).ownerId, commandId: `acp-session:${randomUUID()}`, turnId: request.turnId }, request.runId,
      { pluginId: ACP_STATE_ID, scope: { kind: "actor", actorId: request.agentId }, state: state as unknown as JsonValue });
  }

  #bind(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.#options.runtime().subscribe((events) => {
      for (const event of events) {
        if (event.type !== "turn.finished") continue;
        const blocked = this.#blocked.get(this.#key(event.runId, event.actorId));
        if (!blocked) continue;
        this.#blocked.delete(this.#key(event.runId, event.actorId));
        queueMicrotask(() => {
          const runtime = this.#options.runtime();
          const actor = runtime.view(blocked.runId).actors.find((actor) => actor.id === blocked.actorId);
          if (actor?.kind !== "human" && actor?.lifecycle.kind === "idle")
            runtime.stopActor({ actorId: runtime.view(blocked.runId).ownerId, commandId: `acp-block:${randomUUID()}` }, blocked.runId, blocked.actorId, blocked.reason);
        });
      }
    });
  }

  async #content(request: TurnRequest<"external">, capabilities: AgentCapabilities): Promise<ContentBlock[]> {
    const prompt: ContentBlock[] = [{ type: "text", text: [request.instructions ? `Working instructions:\n${request.instructions}` : "", request.prompt].filter(Boolean).join("\n\n") }];
    for (const attachment of request.attachments ?? []) {
      if (attachment.mediaType.startsWith("image/")) {
        if (!capabilities.promptCapabilities?.image) throw new Error("The external ACP agent does not advertise image prompts");
        prompt.push({ type: "image", mimeType: attachment.mediaType, data: Buffer.from(attachment.content).toString("base64") });
      } else {
        if (!capabilities.promptCapabilities?.embeddedContext) throw new Error("The external ACP agent does not advertise embedded resource prompts");
        const name = await request.storeAttachment(attachment.name, attachment.content);
        const uri = `ragents-attachment:///${encodeURIComponent(name)}`;
        prompt.push({ type: "resource", resource: { uri, mimeType: attachment.mediaType,
          ...(attachment.mediaType.startsWith("text/") || attachment.mediaType.includes("json") ? { text: Buffer.from(attachment.content).toString("utf8") } : { blob: Buffer.from(attachment.content).toString("base64") }),
        } });
      }
    }
    return prompt;
  }

  async #permission(request: TurnRequest<"external">, progress: Extract<AcpProgress, { kind: "permission" }>, signal: AbortSignal): Promise<void> {
    const offered = progress.options.length === 1 ? [...progress.options, { label: "Cancel permission", description: "Close this request without granting permission." }] : progress.options;
    const outcome = await this.#options.ask.ask({ runId: request.runId, agentId: request.agentId, turnId: request.turnId, commandId: `acp-permission:${request.turnId}:${progress.request}` },
      { questions: [{ question: progress.title, header: "Permission", options: offered, multiSelect: false }] }, signal).catch((cause: unknown) => {
        if (signal.aborted) return { kind: "dismissed" as const };
        throw cause;
      });
    const answer = outcome.kind === "answered" ? outcome.answers[0] : undefined;
    const selected = answer && "selected" in answer && answer.selected.length === 1 ? answer.selected[0] : undefined;
    const label = progress.options.some((option) => option.label === selected) ? selected : undefined;
    await this.#options.execute(request.runId, ACP_OPERATIONS.permission, { actorId: request.agentId, request: progress.request, ...(label === undefined ? {} : { label }) }, { whenReachable: true });
  }

  async runTurn(request: TurnRequest<"external">, signal: AbortSignal): Promise<TurnResult> {
    this.#bind();
    const key = this.#key(request.runId, request.agentId);
    if (this.#stopped.has(key)) throw new Error("ACP actor is stopped");
    const actor = this.#options.runtime().view(request.runId).actors.find((entry) => entry.id === request.agentId);
    if (!actor?.grants.some((grant) => grant.capability === "workspace.use" && grant.usable !== false)) throw new Error("ACP actors require the workspace.use capability");
    if (actor.kind !== "human" && actor.execution.workspacePath !== null) throw new Error("ACP actors use the run workspace; isolateWorkspace must be false");
    this.#runs.add(request.runId);
    const definition = this.#options.agents.get(request.runtime);
    if (!definition) throw new Error(`External runtime ${request.runtime} is not configured`);
    const saved = this.#saved(request.runId, request.agentId);
    if (saved && saved.runtime !== request.runtime) throw new Error("ACP actor's saved runtime differs from its selected runtime");
    const controller = new AbortController();
    const abort = AbortSignal.any([signal, controller.signal]);
    const updates = new AcpUpdates(request, abort);
    const permissions = new Set<Promise<void>>();
    let failure: string | undefined;
    let response: PromptResponse | undefined;
    try {
      let opened = this.#connections.get(key);
      if (!opened) {
        opened = await this.#options.execute(request.runId, ACP_OPERATIONS.open,
          { actorId: request.agentId, definition, mcpServers: await this.#options.mcp.serversFor(request.runId), ...(saved ? { sessionId: saved.sessionId } : {}) }, { signal: abort }) as AcpOpened & { notices?: readonly string[] };
        if (abort.aborted || this.#stopped.has(key)) throw new Error("ACP actor stopped while opening its session");
        this.#connections.set(key, opened);
        this.#keep(request, { runtime: request.runtime, sessionId: opened.sessionId, usage: saved?.usage ?? emptyUsage() });
        for (const text of opened.notices ?? []) request.emit({ kind: "runtime", text });
      }
      const prompt = await this.#content(request, opened.capabilities);
      response = await this.#options.execute(request.runId, ACP_OPERATIONS.prompt, { actorId: request.agentId, prompt }, { signal: abort, untilAborted: true,
        onProgress: (raw) => {
          try {
            const progress = raw as AcpProgress;
            if (progress.kind === "update") updates.accept(progress.update);
            else {
              updates.permission(progress.toolCall);
              const pending = this.#permission(request, progress, abort).catch((cause: unknown) => { failure ??= messageOf(cause); controller.abort(); }).finally(() => permissions.delete(pending));
              permissions.add(pending);
            }
          } catch (cause) { failure ??= messageOf(cause); controller.abort(); }
        },
      }) as PromptResponse;
      const previous = saved?.usage ?? emptyUsage();
      const total = cumulativeUsage(response.usage, previous, updates.cost);
      this.#keep(request, { runtime: request.runtime, sessionId: opened.sessionId, usage: total });
      updates.finish(abort.aborted || response.stopReason === "cancelled");
      return { failure: failure ?? (response.stopReason === "end_turn" || signal.aborted ? null : `ACP prompt stopped: ${response.stopReason}`), usage: deltaUsage(total, previous) };
    } catch (cause) {
      updates.finish(true);
      this.#connections.delete(key);
      await this.#options.execute(request.runId, ACP_OPERATIONS.close, { actorId: request.agentId }, { whenReachable: true });
      const reason = failure ?? messageOf(cause);
      if (saved && !signal.aborted) this.#blocked.set(key, { runId: request.runId, actorId: request.agentId, reason });
      throw new Error(reason);
    } finally { controller.abort(); await Promise.allSettled([...permissions]); }
  }

  async disposeAgent(runId: string, actorId: string): Promise<void> {
    const key = this.#key(runId, actorId);
    this.#stopped.add(key);
    this.#connections.delete(key);
    await this.#options.execute(runId, ACP_OPERATIONS.close, { actorId }, { whenReachable: true });
  }

  reviveAgent(runId: string, actorId: string): void { this.#stopped.delete(this.#key(runId, actorId)); }

  async haltRun(runId: string): Promise<void> {
    for (const key of this.#connections.keys()) if (JSON.parse(key)[0] === runId) this.#connections.delete(key);
    await this.#options.execute(runId, ACP_OPERATIONS.close, {}, { whenReachable: true });
    this.#runs.delete(runId);
  }

  disposeRun(runId: string): Promise<void> { return this.haltRun(runId); }

  async shutdown(): Promise<void> {
    const results = await Promise.allSettled([...this.#runs].map((runId) => this.haltRun(runId)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
  }
}
