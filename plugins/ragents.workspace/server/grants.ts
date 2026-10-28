import path from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import { DomainError, defineRunFunction, implement, type AccessContext, type JournalEvent, type JsonObject, type JsonValue, type Orchestration, type RunState, type ToolScope } from "@ragents/engine";
import { ACCESS_OPERATIONS, assertNarrowWorkspaceGrant, type WorkspaceAccessInspection, type WorkspaceGrantPolicy } from "@ragents/workspace-executor";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { toolDescriptorFrom } from "@ragents/host/plugin-support/agent-tool.js";
import { WORKSPACE_GRANTS_STATE_ID, WORKSPACE_PLUGIN_ID, isWorkspaceAccessRequest, workspaceContracts, type WorkspaceAccessRequest, type WorkspaceGrant } from "../contract.js";
import type { WorkspaceRunState } from "./binding.js";

export const grantsOf = (state: WorkspaceRunState | null): readonly WorkspaceGrant[] => {
  const stored = [...state?.pluginStates.values() ?? []].find((entry) => entry.pluginId === WORKSPACE_GRANTS_STATE_ID && entry.scope.kind === "run")?.state;
  if (stored === undefined) return [];
  if (!Array.isArray(stored) || stored.some((entry) => typeof entry !== "object" || entry === null || Array.isArray(entry)
    || typeof entry.path !== "string" || (entry.access !== "read" && entry.access !== "write") || Object.keys(entry).length !== 2)) {
    throw new DomainError("workspace-grants-invalid", "The stored access grants are invalid.", 409);
  }
  return stored as unknown as readonly WorkspaceGrant[];
};

export const ACCESS_REQUESTED = "Access request shown to the owner; the decision arrives as a new message.";
const SUPERSEDED = "Access request closed by a new user message.";

interface AccessRequestsOptions {
  readonly runtime?: () => Orchestration;
  readonly sandbox: Pick<SandboxServices, "execute">;
  readonly policyFor: (runId: string) => Promise<WorkspaceGrantPolicy>;
  readonly disabledReason: (runId: string, userId: string | null) => string | null;
  readonly onBindingMachine: (runId: string, requested: string) => boolean;
}

const pendingHumanInput = (state: RunState, actorId: string): boolean => [...state.inputs.values()].some((input) =>
  input.actorId === actorId && input.origin === "human" && input.lifecycle.kind === "pending");

export class WorkspaceAccessRequests {
  #runtime: Orchestration | undefined;

  constructor(readonly options: AccessRequestsOptions) {}

  bind(runtime: Orchestration): void {
    if (this.#runtime === runtime) return;
    if (this.#runtime) throw new Error("Workspace access requests are already bound.");
    this.#runtime = runtime;
    runtime.subscribe((events) => this.#onJournal(events));
  }

  #requireRuntime(): Orchestration {
    if (!this.#runtime && this.options.runtime) this.bind(this.options.runtime());
    if (!this.#runtime) throw new Error("Workspace access requests are not bound yet.");
    return this.#runtime;
  }

  async request(scope: ToolScope, toolCallId: string, input: { path: string; access: "read" | "write"; reason: string }): Promise<string> {
    if (!input.reason.trim()) throw new DomainError("workspace-access-reason", "Give a reason for the access request.", 400);
    const { runId, actorId, turnId } = scope.caller;
    const runtime = this.#requireRuntime();
    const inspected = await this.#inspect(runId, input.path, input.access, scope.signal);
    if (inspected.reachable) return "The run already has the requested access.";
    if (!this.options.onBindingMachine(runId, input.path)) throw new DomainError("workspace-grant-machine", "Grants apply only to the run's workspace machine.", 403);
    const payload: WorkspaceAccessRequest = { kind: "access-request", path: inspected.path, access: input.access, reason: input.reason.trim(), file: inspected.kind === "file" };
    assertNarrowWorkspaceGrant(payload.path, await this.options.policyFor(runId));
    scope.signal?.throwIfAborted();
    if (turnId) runtime.assertActorTurn(runId, actorId, turnId);
    if (runtime.select(runId, (state) => pendingHumanInput(state, actorId))) return SUPERSEDED;
    runtime.proposeAction(scope.context(toolCallId), runId, {
      owner: WORKSPACE_PLUGIN_ID,
      title: "Access request",
      payload: payload as unknown as JsonObject,
    });
    return ACCESS_REQUESTED;
  }

  availability(runId: string, access: AccessContext): { disabledReason: string | null } {
    this.#requireRuntime();
    return { disabledReason: this.options.disabledReason(runId, access.user?.id ?? null) };
  }

  async answer(runId: string, actionId: string, decision: "allow" | "allow-folder" | "deny", access: AccessContext, signal?: AbortSignal): Promise<void> {
    this.#assertMayAnswer(runId, access);
    const runtime = this.#requireRuntime();
    const request = this.#pending(runId, actionId).payload;
    if (decision === "deny") {
      runtime.resolveAction(this.#context(runId, actionId), runId, actionId, { decision: "dismissed", result: { decision } });
      return;
    }
    const inspected = await this.#inspect(runId, request.path, request.access, signal);
    if (inspected.path !== request.path) throw new DomainError("workspace-grant-path-changed", "The requested path now resolves elsewhere; request access again.", 409);
    if (decision === "allow-folder" && (!request.file || inspected.kind !== "file")) {
      throw new DomainError("workspace-grant-folder", "Allow folder is available only for an existing file.", 400);
    }
    const kind = /^[a-z]:[\\/]/i.test(request.path) || request.path.startsWith("\\\\") ? path.win32 : path.posix;
    const target = decision === "allow-folder" ? kind.dirname(request.path) : request.path;
    const checked = decision === "allow-folder" ? await this.#inspect(runId, target, request.access, signal) : inspected;
    if (checked.path !== target) throw new DomainError("workspace-grant-path-changed", "The requested folder now resolves elsewhere; request access again.", 409);
    assertNarrowWorkspaceGrant(checked.path, await this.options.policyFor(runId));
    signal?.throwIfAborted();
    this.#assertMayAnswer(runId, access);
    this.#pending(runId, actionId);
    const grant: WorkspaceGrant = { path: checked.path, access: request.access };
    const existing = grantsOf(runtime.state(runId));
    const covered = existing.some((entry) => entry.path === grant.path && (entry.access === "write" || entry.access === grant.access));
    const grants = covered ? existing : [...existing.filter((entry) => entry.path !== grant.path), grant];
    if (grants.length > 1024) throw new DomainError("workspace-grants-limit", "This run has reached its limit of 1024 access grants.", 409);
    runtime.resolveActionWithState(this.#context(runId, actionId), runId, actionId,
      { decision: "approved", result: { decision, path: grant.path, access: grant.access } },
      { pluginId: WORKSPACE_GRANTS_STATE_ID, scope: { kind: "run" }, state: grants as unknown as JsonValue });
  }

  #assertMayAnswer(runId: string, access: AccessContext): void {
    const reason = this.options.disabledReason(runId, access.user?.id ?? null);
    if (reason) throw new DomainError("workspace-access-forbidden", reason, 403);
  }

  #pending(runId: string, actionId: string): { payload: WorkspaceAccessRequest } {
    const action = this.#requireRuntime().state(runId).actions.get(actionId);
    if (!action || action.owner !== WORKSPACE_PLUGIN_ID || !isWorkspaceAccessRequest(action.payload)) throw new DomainError("workspace-access-request-missing", "This access request does not exist.", 404);
    if (action.status !== "pending") throw new DomainError("action-already-resolved", "This access request is already closed.", 409);
    return { payload: action.payload };
  }

  #inspect(runId: string, requested: string, access: "read" | "write", signal?: AbortSignal): Promise<WorkspaceAccessInspection> {
    return this.options.sandbox.execute(runId, ACCESS_OPERATIONS.inspect, { path: requested, access }, { ...(signal ? { signal } : {}) }) as Promise<WorkspaceAccessInspection>;
  }

  #context(runId: string, actionId: string) {
    return { actorId: this.#requireRuntime().state(runId).ownerId, commandId: `workspace-access:${actionId}:${randomUUID()}` };
  }

  withdraw(runId: string, actorId?: string, superseded = false): void {
    const runtime = this.#requireRuntime();
    let state: RunState;
    try { state = runtime.state(runId); }
    catch (error) {
      if (error instanceof DomainError && (error.code === "run-not-found" || error.code === "journal-unavailable")) return;
      throw error;
    }
    for (const action of state.actions.values()) {
      if (action.owner === WORKSPACE_PLUGIN_ID && isWorkspaceAccessRequest(action.payload) && action.status === "pending"
        && (actorId === undefined || action.askedBy === actorId)) {
        runtime.resolveAction(this.#context(runId, action.id), runId, action.id, { decision: "dismissed", result: superseded ? { superseded: true } : { withdrawn: true } });
      }
    }
  }

  #onJournal(events: JournalEvent[]): void {
    for (const event of events) {
      if (event.type === "actor.input.enqueued" && event.payload.origin === "human") {
        queueMicrotask(() => this.withdraw(event.runId, event.payload.actorId, true));
      } else if (event.type === "actor.stopped") {
        queueMicrotask(() => this.withdraw(event.runId, event.payload.actorId));
      } else if (event.type === "action.resolved") {
        queueMicrotask(() => this.#notify(event.runId, event.payload.actionId, event.commandId));
      }
    }
  }

  #notify(runId: string, actionId: string, commandId: string): void {
    const runtime = this.#requireRuntime();
    try {
      const state = runtime.state(runId);
      const action = state.actions.get(actionId);
      if (!action || action.owner !== WORKSPACE_PLUGIN_ID || !isWorkspaceAccessRequest(action.payload)) return;
      const result = action.result as Record<string, unknown> | null;
      if (result?.withdrawn || result?.superseded) return;
      const actor = state.actors.get(action.askedBy);
      if (!actor || actor.kind === "human" || actor.lifecycle.kind === "stopped") return;
      const granted = runtime.events(runId).some((event) => (event.type === "plugin.state-replaced" || event.type === "plugin.state-patched")
        && event.commandId === commandId && event.payload.pluginId === WORKSPACE_GRANTS_STATE_ID);
      const content = granted ? `Access allowed (${action.payload.access}): ${String(result?.path)}`
        : action.status === "dismissed" && result?.decision === "deny" ? "Access denied. Do not try to work around this refusal."
          : "Access request closed without granting access.";
      runtime.enqueueInput({ actorId: state.ownerId, commandId: `workspace-access-input:${actionId}` }, runId, { actorId: actor.id, content });
    } catch (error) {
      if (error instanceof DomainError && (error.code === "run-not-found" || error.code === "journal-unavailable")) return;
      console.error(`Access decision could not reach its actor: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export const requestAccessTool = (service: WorkspaceAccessRequests) => defineRunFunction({
  name: "request_access",
  label: "Access request",
  description: "Ask the owner for read or write access to a path outside the run's folders and end your turn; the decision arrives as a new message.",
  longDescription: "Use the path you need, relative to the working directory, with an alias, or with home notation. Write access also permits reading. Call this as the only tool in your response. Do not try to work around a refusal. Broad or secret paths require full access instead.",
  schema: Type.Object({
    path: Type.String({ minLength: 1, maxLength: 4096, description: "The file or folder you need to reach" }),
    access: Type.Union([Type.Literal("read"), Type.Literal("write")], { description: "Read only, or read and write" }),
    reason: Type.String({ minLength: 1, maxLength: 2000, description: "Why this path is needed" }),
  }, { additionalProperties: false }),
  resultSchema: Type.String(),
  available: alwaysAvailable,
  executionMode: "sequential",
  endsTurn: (output) => output === ACCESS_REQUESTED,
  run: (scope, toolCallId, input) => service.request(scope, toolCallId, input),
});

export const requestAccessContributor = (service: WorkspaceAccessRequests) => {
  const tool = requestAccessTool(service);
  return { name: "ragents.workspace.access", descriptors: [toolDescriptorFrom(tool, alwaysAvailable)], tools: () => [tool] };
};

export const accessRequestMethods = (service: WorkspaceAccessRequests, ensureSession: (runId: string) => void) => [
  implement(workspaceContracts.accessRequestAvailability, ({ runId }, { access }) => {
    ensureSession(runId);
    return service.availability(runId, access);
  }),
  implement(workspaceContracts.answerAccess, async ({ runId, actionId, decision }, { access, signal }) => {
    ensureSession(runId);
    await service.answer(runId, actionId, decision, access, signal);
    return null;
  }),
];
