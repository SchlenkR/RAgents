import { randomUUID } from "node:crypto";
import path from "node:path";
import { PROTOCOL_VERSION, RequestError, type Agent, type AgentSideConnection, type CancelNotification, type InitializeRequest,
  type InitializeResponse, type ListSessionsRequest, type ListSessionsResponse, type LoadSessionRequest, type LoadSessionResponse,
  type NewSessionRequest, type NewSessionResponse, type PromptRequest, type PromptResponse, type SessionConfigOption,
  type SetSessionConfigOptionRequest, type SetSessionConfigOptionResponse } from "@agentclientprotocol/sdk";
import { MAX_CHAT_ATTACHMENT_BYTES, type ChatEvent } from "quassel/events";
import { coreContracts, type HostBootstrap } from "../../apps/server/src/api/contracts.ts";
import { readPackageVersion } from "../../apps/server/src/host-version.ts";
import { modelStartOptionId, type StartOptionState } from "../../apps/server/src/plugin-support/start-options-contract.ts";
import type { ProfileTarget } from "../../apps/server/src/profile-target.ts";
import { preparedRunInput } from "../../apps/server/src/run-preparation-input.ts";
import type { RpcClient } from "../../apps/web/src/rpc/client.ts";
import { runContracts } from "../../packages/ragents/src/http/contracts.ts";
import { RpcError } from "../../packages/ragents/src/rpc/protocol.ts";
import { mcpContracts } from "../../plugins/ragents.mcp/contract.ts";
import { WORKSPACE_BINDING_OPTION_ID, storedWorkspaceBinding } from "../../plugins/ragents.workspace/contract.ts";
import { delay, ensureHost, hostClient, loadProfile, LOGIN_REQUIRED } from "../agent/host.ts";
import { interruptPrimaryTurn } from "../agent/turn-control.ts";
import { ChatStream } from "./chat-stream.ts";
import { promptMessage, sessionMcpServers } from "./content.ts";
import { EditorWorkspaces, localHostAddress } from "./workspaces.ts";

interface Host {
  readonly target: ProfileTarget;
  readonly address: string;
  readonly rpc: RpcClient;
  readonly bootstrap: HostBootstrap;
  readonly workspaces: EditorWorkspaces;
}

interface ActivePrompt {
  readonly controller: AbortController;
  readonly sent: PromiseWithResolvers<void>;
  readonly finished: PromiseWithResolvers<void>;
  readonly stream: ChatStream;
}

interface EditorSession {
  readonly runId: string;
  readonly cwd: string;
  readonly createdAt: string;
}

const COMMAND_LIMIT = 20;

const configOptions = (options: readonly StartOptionState[]): SessionConfigOption[] => options.flatMap((option) => {
  if (option.id !== modelStartOptionId || !option.selectable || option.locked) return [];
  const value = option.value as { model?: unknown };
  const presentation = option.presentation as { kind?: unknown; options?: unknown };
  if (typeof value.model !== "string" || presentation.kind !== "model" || !Array.isArray(presentation.options)
    || presentation.options.some((model) => typeof model !== "string")) throw new Error("The host's model start option is malformed.");
  return [{ id: modelStartOptionId, name: "Model", category: "model", type: "select", currentValue: value.model,
    options: presentation.options.map((model: string) => ({ value: model, name: model })) }];
});

const protocolCall = async <T>(work: () => Promise<T>): Promise<T> => {
  try { return await work(); }
  catch (cause) {
    if (cause instanceof RequestError) throw cause;
    if (cause instanceof RpcError && cause.status === 401) throw RequestError.authRequired(undefined, `${LOGIN_REQUIRED} ${cause.message}`);
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new RequestError(cause instanceof RpcError && cause.status !== undefined && cause.status < 500 ? -32602 : -32603, message);
  }
};

export class EditorAgent implements Agent {
  readonly #sessions = new Map<string, EditorSession>();
  readonly #active = new Map<string, ActivePrompt>();
  #host: Promise<Host> | undefined;
  #initialized = false;
  #elicit = false;

  constructor(readonly connection: AgentSideConnection, readonly profile: string) {}

  async #connect(): Promise<Host> {
    const target = await loadProfile(this.profile);
    const address = await ensureHost(target);
    const rpc = hostClient(address);
    try {
      const bootstrap = await rpc.call(coreContracts.plugins.bootstrap, {});
      return { target, address, rpc, bootstrap, workspaces: new EditorWorkspaces(address, !await localHostAddress(address), target.dataDirectory) };
    } catch (cause) { rpc.close(); throw cause; }
  }

  #ready(): Promise<Host> {
    if (!this.#initialized || !this.#host) throw RequestError.invalidRequest(undefined, "Initialize the ACP connection first.");
    return this.#host;
  }

  initialize(params: InitializeRequest): Promise<InitializeResponse> {
    return protocolCall(async () => {
      if (this.#initialized) throw RequestError.invalidRequest(undefined, "The ACP connection is already initialized.");
      if (params.protocolVersion !== PROTOCOL_VERSION) return { protocolVersion: PROTOCOL_VERSION };
      this.#host = this.#connect();
      const host = await this.#host;
      this.#initialized = true;
      this.#elicit = params.clientCapabilities?.elicitation?.form != null;
      const mcp = host.bootstrap.plugins.some(({ id }) => id === "ragents.mcp");
      return { protocolVersion: PROTOCOL_VERSION, agentInfo: { name: "ragents", title: "RAgents", version: readPackageVersion() }, authMethods: [],
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} }, promptCapabilities: { image: true, embeddedContext: true },
          ...mcp ? { mcpCapabilities: { http: true, sse: true } } : {} } };
    });
  }

  authenticate(): Promise<void> { return Promise.reject(RequestError.authRequired(undefined, LOGIN_REQUIRED)); }

  async #mcp(host: Host, runId: string, servers: NewSessionRequest["mcpServers"]): Promise<void> {
    const configured = host.bootstrap.plugins.some(({ id }) => id === "ragents.mcp");
    if (!configured && servers.length > 0) throw RequestError.invalidParams(undefined, "The host profile needs ragents.mcp to use the editor's MCP servers.");
    if (configured) await host.rpc.call(mcpContracts.setServers, { runId, servers: sessionMcpServers(servers) });
  }

  async #options(host: Host, runId: string): Promise<SessionConfigOption[]> {
    return configOptions(await host.rpc.call(coreContracts.startOptions.list, { runId }));
  }

  async #commands(host: Host, runId: string): Promise<void> {
    const skills = host.bootstrap.startEntries.filter((entry) => entry.action === "skill");
    const availableCommands = skills.length <= COMMAND_LIMIT ? skills.map((entry) => ({ name: entry.id, description: entry.description })) : [];
    await this.connection.sessionUpdate({ sessionId: runId, update: { sessionUpdate: "available_commands_update", availableCommands } });
  }

  newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    return protocolCall(async () => {
      const host = await this.#ready();
      if (params.additionalDirectories?.length) throw RequestError.invalidParams(undefined, "Additional workspace directories are not supported.");
      const runId = randomUUID();
      const binding = await host.workspaces.binding(params.cwd);
      const options = await host.rpc.call(coreContracts.startOptions.list, { runId });
      if (!options.some(({ id }) => id === WORKSPACE_BINDING_OPTION_ID)) throw new Error(`The host profile needs ${WORKSPACE_BINDING_OPTION_ID} to bind the editor folder.`);
      await host.rpc.call(coreContracts.startOptions.select, { runId, optionId: WORKSPACE_BINDING_OPTION_ID, value: binding });
      await this.#mcp(host, runId, params.mcpServers);
      this.#sessions.set(runId, { runId, cwd: path.resolve(params.cwd), createdAt: new Date().toISOString() });
      await this.#commands(host, runId);
      return { sessionId: runId, configOptions: await this.#options(host, runId) };
    });
  }

  #session(runId: string): EditorSession {
    const session = this.#sessions.get(runId);
    if (!session) throw RequestError.invalidParams(undefined, "Create or load the session before sending a prompt.");
    return session;
  }

  async #attachment(host: Host, runId: string, event: Extract<ChatEvent, { kind: "user" }>): Promise<void> {
    for (const attachment of event.attachments ?? []) {
      const url = new URL(attachment.url, host.address);
      if (url.origin !== new URL(host.address).origin || attachment.size > MAX_CHAT_ATTACHMENT_BYTES) throw new Error("The host returned an invalid chat attachment.");
      const response = await fetch(url, { headers: process.env.RAGENTS_TOKEN ? { authorization: `Bearer ${process.env.RAGENTS_TOKEN}` } : {},
        redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Chat attachment download failed with HTTP ${response.status}.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_CHAT_ATTACHMENT_BYTES) throw new Error("The replayed chat attachment exceeds the attachment limit.");
      await this.connection.sessionUpdate({ sessionId: runId, update: { sessionUpdate: "user_message_chunk", content: attachment.mediaType.startsWith("image/")
        ? { type: "image", mimeType: attachment.mediaType, data: Buffer.from(bytes).toString("base64") }
        : { type: "resource", resource: { uri: url.href, mimeType: attachment.mediaType, blob: Buffer.from(bytes).toString("base64") } } } });
    }
  }

  prompt(params: PromptRequest): Promise<PromptResponse> {
    return protocolCall(async () => {
      const host = await this.#ready();
      const session = this.#session(params.sessionId);
      if (this.#active.has(session.runId)) throw RequestError.invalidRequest(undefined, "The session already has an active prompt.");
      const message = promptMessage(params.prompt);
      const controller = new AbortController();
      const stream = new ChatStream({ connection: this.connection, rpc: host.rpc, runId: session.runId, cwd: session.cwd,
        replay: false, elicit: this.#elicit, signal: controller.signal, attachment: async () => undefined });
      const active: ActivePrompt = { controller, stream, sent: Promise.withResolvers<void>(), finished: Promise.withResolvers<void>() };
      void active.sent.promise.catch(() => undefined);
      this.#active.set(session.runId, active);
      try {
        await stream.ready();
        if (controller.signal.aborted) return { stopReason: "cancelled" };
        stream.submit();
        const command = /^\/([^\s]+)(?:\s|$)/.exec(message.text);
        const skills = host.bootstrap.startEntries.filter((entry) => entry.action === "skill");
        const entry = skills.length <= COMMAND_LIMIT ? skills.find((entry) => entry.id === command?.[1]) : undefined;
        const text = entry ? promptMessage([{ type: "text", text: preparedRunInput([], [entry.prompt,
          message.text.slice(command![0].length).trim()].filter(Boolean).join("\n\n"), undefined, entry.skill).text }]).text : message.text;
        await host.rpc.call(coreContracts.chat.send, { runId: session.runId, ...message, text, ...entry ? { entry: entry.id } : {} });
        active.sent.resolve();
        return { stopReason: await stream.done() };
      } catch (cause) { active.sent.reject(cause); throw cause; }
      finally { active.sent.resolve(); controller.abort(); stream.close(); this.#active.delete(session.runId); active.finished.resolve(); }
    });
  }

  cancel(params: CancelNotification): Promise<void> {
    return protocolCall(async () => {
      const host = await this.#ready();
      this.#session(params.sessionId);
      const active = this.#active.get(params.sessionId);
      if (!active) return;
      active.controller.abort();
      await active.sent.promise;
      if (!this.#active.has(params.sessionId)) return;
      const deadline = Date.now() + 15_000;
      for (;;) {
        const view = await host.rpc.call(runContracts.view, { runId: params.sessionId });
        if (view?.actors.some((actor) => actor.id === view.primaryActorId && actor.kind !== "human" && actor.lifecycle.kind === "running")) {
          await interruptPrimaryTurn(host.rpc, params.sessionId);
          return;
        }
        if (!view || !view.inputs.some((input) => input.actorId === view.primaryActorId && input.lifecycle.kind === "pending")) return;
        if (Date.now() >= deadline) throw new Error("The queued prompt did not start in time to cancel it.");
        await delay(20);
      }
    });
  }

  loadSession(params: LoadSessionRequest): Promise<LoadSessionResponse> {
    return protocolCall(async () => {
      const host = await this.#ready();
      if (!path.isAbsolute(params.cwd)) throw RequestError.invalidParams(undefined, "The session cwd must be an absolute path.");
      if (params.additionalDirectories?.length) throw RequestError.invalidParams(undefined, "Additional workspace directories are not supported.");
      if (this.#active.has(params.sessionId)) throw RequestError.invalidRequest(undefined, "Cancel the active prompt before loading the session.");
      const view = await host.rpc.call(runContracts.view, { runId: params.sessionId });
      const existing = this.#sessions.get(params.sessionId);
      if (!view && !existing) throw RequestError.invalidParams(undefined, "The session does not exist or is not accessible.");
      const options = await host.rpc.call(coreContracts.startOptions.list, { runId: params.sessionId });
      const binding = storedWorkspaceBinding(options.find(({ id }) => id === WORKSPACE_BINDING_OPTION_ID)?.value);
      const requested = await host.workspaces.binding(params.cwd);
      if (!binding || binding.folder === "fresh" || binding.folder.path !== path.resolve(params.cwd)
        || (binding.machine === "server") !== (requested.machine === "server")
        || (binding.machine !== "server" && requested.machine !== "server" && binding.machine.client !== requested.machine.client)) {
        throw RequestError.invalidParams(undefined, "The session is bound to a different folder or machine.");
      }
      await this.#mcp(host, params.sessionId, params.mcpServers);
      const session = { runId: params.sessionId, cwd: path.resolve(params.cwd), createdAt: existing?.createdAt ?? new Date().toISOString() };
      this.#sessions.set(session.runId, session);
      const stream = new ChatStream({ connection: this.connection, rpc: host.rpc, runId: session.runId, cwd: session.cwd,
        replay: true, elicit: false, signal: new AbortController().signal, attachment: (event) => this.#attachment(host, session.runId, event) });
      try { await stream.done(); } finally { stream.close(); }
      await this.#commands(host, session.runId);
      return { configOptions: await this.#options(host, session.runId) };
    });
  }

  listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse> {
    return protocolCall(async () => {
      const host = await this.#ready();
      if (params.cursor) throw RequestError.invalidParams(undefined, "This agent returns the complete session list without a cursor.");
      if (params.cwd && !path.isAbsolute(params.cwd)) throw RequestError.invalidParams(undefined, "The session cwd must be an absolute path.");
      const runs = await host.rpc.call(coreContracts.runs.list, {});
      const sessions = new Map([...this.#sessions].map(([sessionId, session]) => [sessionId, { sessionId, cwd: session.cwd, updatedAt: session.createdAt }]));
      for (const run of runs) {
        const metadata = run.metadata?.["ragents.workspace"] as { binding?: unknown } | undefined;
        const binding = storedWorkspaceBinding(metadata?.binding);
        if (!binding || binding.folder === "fresh" || ("fresh" in binding.folder && binding.folder.fresh === true)) continue;
        if ((binding.machine === "server") === host.workspaces.remote) continue;
        sessions.set(run.id, { sessionId: run.id, cwd: binding.folder.path, updatedAt: new Date(run.updatedAt).toISOString(), ...run.title ? { title: run.title } : {} });
      }
      return { sessions: [...sessions.values()].filter((session) => !params.cwd || session.cwd === path.resolve(params.cwd!)) };
    });
  }

  setSessionConfigOption(params: SetSessionConfigOptionRequest): Promise<SetSessionConfigOptionResponse> {
    return protocolCall(async () => {
      const host = await this.#ready();
      this.#session(params.sessionId);
      if (params.configId !== modelStartOptionId || typeof params.value !== "string") throw RequestError.invalidParams(undefined, "Only the model selector is supported.");
      await host.rpc.call(coreContracts.startOptions.select, { runId: params.sessionId, optionId: modelStartOptionId, value: { model: params.value } });
      const options = await this.#options(host, params.sessionId);
      await this.connection.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "config_option_update", configOptions: options } });
      return { configOptions: options };
    });
  }

  async close(): Promise<void> {
    if (!this.#initialized || !this.#host) return;
    const host = await this.#host;
    try {
      const active = [...this.#active.entries()];
      await Promise.all(active.map(([sessionId]) => this.cancel({ sessionId })));
      await Promise.all(active.map(([, prompt]) => prompt.finished.promise));
      if (host.workspaces.remote && host.bootstrap.plugins.some(({ id }) => id === "ragents.mcp")) {
        await Promise.all([...this.#sessions.keys()].map((runId) => host.rpc.call(mcpContracts.closeConnections, { runId })));
      }
    } finally {
      try { await host.workspaces.close(); } finally { host.rpc.close(); }
    }
  }
}
