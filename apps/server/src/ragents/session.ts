import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { parseChatAttachments, type ChatAttachment, type ChatAttachmentInput, type ChatEvent, type ChatStartupStatus } from "quassel/events";
import { attachmentContentPath } from "../api/contracts.js";
import type { ChatSessionLike, ChatUser, RunScriptListing, StartedScript } from "../chat-handler.js";
import {
  addressOf,
  assertJsonValue,
  attachmentInputKind,
  capabilityNames,
  DomainError,
  eventSubjectOf,
  firstHandCapabilities,
  isThinkingLevel,
  notShared,
  PluginStateProjection,
  resolveExecution,
  type CapabilityGrant,
  type JournalEvent,
  type JsonValue,
  type PublicStartEntry,
  type RegisteredStartOption,
  type RunScriptPackage,
  type RunSharing,
  type RunView,
  type SessionStartedContext,
  type StartOptionContext,
  type AgentExecution,
  type ModelSelection,
} from "@ragents/engine";
import type { ActivatedActorProgram, ActorProgramsService } from "../plugin-support/actor-programs/service.js";
import { modelLabel } from "../plugin-support/model-aliases.js";
import type { StartOptionState } from "../plugin-support/start-options-contract.js";
import type { Engine } from "./engine.js";
import type { CoordinatorDescriptor } from "./product-runtime.js";
import { modelStartOptionId, startOptionScope, storedModel, storedStartOption, storedThinking } from "./start-option-state.js";
import { coordinatorSelection, isRunCoordinator, storedModelChoice } from "./coordinator.js";
import { chatEventsOf, chatHistoryOf, type ChatProjectionScope } from "./chat-projection.js";
import { ChatTextPositions } from "./chat-text-positions.js";
import type { GlobalChatPolicy } from "./global-chat.js";
import { actorChatHistoryOf, type ActorConversations } from "./actor-chat-history.js";

const STAMPED_KINDS = new Set<ChatEvent["kind"]>(["user", "text", "thinking", "tool", "system", "action", "plugin"]);

type LiveTurn = {
  emitProgress: boolean;
  text: boolean;
  thinking: boolean;
  tools: Set<string>;
  toolResults: Set<string>;
};

const liveTurn = (emitProgress: boolean): LiveTurn => ({
  emitProgress,
  text: false,
  thinking: false,
  tools: new Set(),
  toolResults: new Set(),
});

const coordinatorGrants = (): CapabilityGrant[] =>
  capabilityNames.map((capability) => ({
    capability,
    scope: { kind: "run" as const },
    delegable: !firstHandCapabilities.includes(capability),
  }));

const primaryActorOf = (view: RunView) => view.primaryActorId
  ? view.actors.find((actor) => actor.id === view.primaryActorId && actor.kind !== "human")
  : undefined;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const userIdOf = (user: ChatUser | undefined): string | null => user?.id ?? null;

const startValueOf = (input: unknown): JsonValue | null =>
  input === undefined || input === null ? null : (assertJsonValue(input, "Start value of the run script"), input);

/** Who starts a run, through which template, and which start options it fixes. */
interface StartChoice {
  readonly userId: string | null;
  readonly entry: SessionStartedContext["startEntry"];
  readonly fixed: ReadonlyMap<string, JsonValue>;
}

/** A start without a template fixes nothing. */
const freeChoice = (userId: string | null): StartChoice => ({ userId, entry: null, fixed: new Map() });

/** A script template together with the package the host installs when it is clicked. */
export type RunScriptStart = RunScriptPackage & { entry: PublicStartEntry };

export type RunScriptPrograms = Pick<ActorProgramsService, "installScript" | "enqueueStart" | "isScriptActor">;

export interface RunChatSessionOptions {
  engine: Engine;
  id: string;
  coordinator: CoordinatorDescriptor;
  initialTitle?: string;
  toolNames?: readonly string[];
  modelSelection?: () => ModelSelection;
  inputContext?: GlobalChatPolicy["inputContext"];
  prompt: () => string;
  assertUsable: (id: string) => void;
  prepare: (id: string, emitSystem: (text: string) => void) => Promise<void>;
  prepareWorkspace: (id: string, emitSystem: (text: string) => void) => Promise<void>;
  /** After the first actor is set up in the prepared workspace, before any actor gets input. */
  started: (id: string, startEntry: SessionStartedContext["startEntry"]) => Promise<void>;
  scriptEntryFor: (entryId: string) => RunScriptStart | undefined;
  startEntryFor: (entryId: string) => PublicStartEntry | undefined;
  actorPrograms: RunScriptPrograms;
}

export class RunChatSession implements ChatSessionLike {
  readonly id: string;
  readonly #engine: Engine;
  readonly #coordinator: CoordinatorDescriptor;
  readonly #initialTitle: string | undefined;
  readonly #toolNames: readonly string[] | null;
  readonly #modelSelection: (() => ModelSelection) | undefined;
  readonly #inputContext: GlobalChatPolicy["inputContext"];
  readonly #prompt: () => string;
  readonly #assertUsable: (id: string) => void;
  readonly #prepare: (id: string, emitSystem: (text: string) => void) => Promise<void>;
  readonly #prepareWorkspace: (id: string, emitSystem: (text: string) => void) => Promise<void>;
  readonly #started: (id: string, startEntry: SessionStartedContext["startEntry"]) => Promise<void>;
  readonly #scriptEntryFor: (entryId: string) => RunScriptStart | undefined;
  readonly #startEntryFor: (entryId: string) => PublicStartEntry | undefined;
  readonly #actorPrograms: RunScriptPrograms;
  readonly #events: ChatEvent[] = [];
  readonly #listeners = new Set<(event: ChatEvent) => void>();
  readonly #liveTurns = new Map<string, LiveTurn>();
  readonly #journalFinishedTurns = new Set<string>();
  readonly #pendingSends = new Set<Promise<void>>();
  readonly #startValues = new Map<string, JsonValue>();
  /** Before the start, per signed-in user, whom the run is to be shared with; whoever creates the run brings their own. */
  readonly #pendingSharing = new Map<string, RunSharing>();
  #primaryActorId: string | undefined;
  #activeLiveTurnId: string | undefined;
  #starting: Promise<void> | undefined;
  #scriptQueue: Promise<unknown> = Promise.resolve();
  readonly #scriptStarts = new Set<AbortController>();
  #startup: ChatStartupStatus | undefined;
  #startCancellation: AbortController | undefined;
  #unsubscribeJournal: (() => void) | undefined;
  #unsubscribeLive: (() => void) | undefined;
  #running = false;
  #disposed = false;
  #textPositions = new ChatTextPositions();
  #pluginStates = new PluginStateProjection();

  constructor(options: RunChatSessionOptions) {
    this.id = options.id;
    this.#engine = options.engine;
    this.#coordinator = options.coordinator;
    this.#initialTitle = options.initialTitle;
    this.#toolNames = options.toolNames ?? null;
    this.#modelSelection = options.modelSelection;
    this.#inputContext = options.inputContext;
    this.#prompt = options.prompt;
    this.#assertUsable = options.assertUsable;
    this.#prepare = options.prepare;
    this.#prepareWorkspace = options.prepareWorkspace;
    this.#started = options.started;
    this.#scriptEntryFor = options.scriptEntryFor;
    this.#startEntryFor = options.startEntryFor;
    this.#actorPrograms = options.actorPrograms;
  }

  get running(): boolean {
    return this.#running;
  }

  get started(): boolean {
    return this.#primaryActorId !== undefined || this.#starting !== undefined;
  }

  get startLocked(): boolean {
    return this.#engine.journal.stateOf(this.id) !== null;
  }

  startOptions(userId: string | null): readonly StartOptionState[] {
    return this.#engine.startOptions.entries().map((entry) => this.#startOptionState(entry, userId));
  }

  /** Before the start the run remembers the choice; afterwards it writes a changeable option to the journal. */
  async selectStartOption(optionId: string, value: unknown, userId: string | null): Promise<StartOptionState> {
    const entry = this.#engine.startOptions.entry(optionId);
    if (!entry) throw new DomainError("option-unknown", `The start option ${optionId} is not registered.`, 404);
    if (!entry.option.selectable()) {
      throw new DomainError("option-not-selectable", `The start option ${optionId} is fixed by configuration.`, 409);
    }
    if (this.startLocked && !entry.option.changeable) {
      throw new DomainError("option-locked", "The run is already running, the start options are fixed.", 409);
    }
    const accepted = this.#engine.startOptions.accept(optionId, value, this.#startContext(userId));
    if (!this.startLocked) {
      this.#startValues.set(optionId, accepted);
      return this.#startOptionState(entry, userId);
    }
    if (!isDeepStrictEqual(storedStartOption(this.#engine.journal.stateOf(this.id), optionId), accepted)) {
      if (optionId === modelStartOptionId) await this.#assertCoordinatorCanRead(accepted as { model?: string; thinking?: string });
      const state = this.#engine.runtime.state(this.id);
      this.#engine.runtime.replacePluginState(
        { actorId: state.ownerId, commandId: `start-option:${optionId}:${this.id}:${this.#engine.runtime.view(this.id).revision}` },
        this.id,
        { pluginId: optionId, scope: startOptionScope, state: accepted },
      );
    }
    return this.#startOptionState(entry, userId);
  }

  /** The sharing this user chose before the start; nobody until they choose. */
  sharingBeforeStart(userId: string): RunSharing {
    if (this.startLocked) throw new DomainError("run-started", "The run is already created; its sharing is in the journal.", 409);
    return this.#pendingSharing.get(userId) ?? notShared();
  }

  /** Kept until the start; the run takes over only the sharing of the user who creates it. */
  shareBeforeStart(userId: string, sharing: RunSharing): void {
    if (this.startLocked) throw new DomainError("run-started", "The run is already created; its sharing is in the journal.", 409);
    this.#pendingSharing.set(userId, sharing);
  }

  /** Another model must be able to read the attachments the coordinator's conversation already contains. */
  async #assertCoordinatorCanRead(choice: { model?: string; thinking?: string }): Promise<void> {
    const view = this.#engine.runtime.view(this.id);
    const primary = primaryActorOf(view);
    if (!primary || primary.kind === "human" || primary.execution.driver.kind !== "agent" || !isRunCoordinator(this.#engine.runtime, this.id, primary.id)) return;
    const { provider, model } = coordinatorSelection(this.#engine.catalog, this.#coordinator,
      { model: choice.model, thinking: choice.thinking }, primary.execution.driver.config);
    const attached = new Set(view.inputs.filter((input) => input.actorId === primary.id).flatMap((input) => input.artifactIds));
    const kinds = new Set(view.artifacts.filter((artifact) => attached.has(artifact.id)).map((artifact) => attachmentInputKind(artifact.mediaType)));
    const supported = await this.#engine.inputCapabilities(provider, model);
    const missing = [...kinds].filter((kind) => (kind === "image" || kind === "video" || kind === "file") && !supported.includes(kind));
    if (missing.length > 0) {
      throw new DomainError("model-history-unsupported", `The conversation already contains ${missing.join(", ")} attachments that ${modelLabel(provider, model)} cannot process; choose a suitable model.`, 400);
    }
  }

  #startContext(userId: string | null): StartOptionContext {
    return { runId: this.id, userId };
  }

  #startValueOf(entry: RegisteredStartOption, choice: StartChoice): JsonValue {
    const chosen = this.startLocked
      ? storedStartOption(this.#engine.journal.stateOf(this.id), entry.option.id)
      : choice.fixed.get(entry.option.id) ?? this.#startValues.get(entry.option.id);
    return chosen ?? this.#engine.startOptions.defaultValue(entry.option.id, this.#startContext(choice.userId));
  }

  /** The one place where a template fixes start options: accepted with the acting user; a different earlier value is an error. */
  #startChoice(entry: PublicStartEntry, userId: string | null): StartChoice {
    const state = this.#engine.journal.stateOf(this.id);
    const fixed = new Map(Object.entries(entry.fixedStartOptions ?? {}).map(([optionId, value]) => {
      const accepted = this.#engine.startOptions.accept(optionId, value, this.#startContext(userId));
      const chosen = this.startLocked ? storedStartOption(state, optionId) : this.#startValues.get(optionId);
      if (chosen !== undefined && !isDeepStrictEqual(chosen, accepted)) {
        throw new DomainError("start-option-fixed", this.startLocked
          ? `The template "${entry.title}" fixes the start option ${optionId} to ${JSON.stringify(accepted)}, but this run already has a different value there: ${JSON.stringify(chosen)}.`
          : `The template "${entry.title}" fixes the start option ${optionId}, but a different value is chosen. Undo the choice or start without this template.`, 409);
      }
      return [optionId, accepted] as const;
    }));
    return { userId, entry: { id: entry.id, action: entry.action }, fixed };
  }

  #skillEntry(entryId: string): PublicStartEntry {
    const entry = this.#startEntryFor(entryId);
    if (!entry || entry.action !== "skill") throw new DomainError("entry-unknown", `The template ${entryId} is not a skill template of this profile.`, 404);
    return entry;
  }

  #startOptionState(entry: RegisteredStartOption, userId: string | null): StartOptionState {
    const value = this.#startValueOf(entry, freeChoice(userId));
    return {
      id: entry.option.id,
      owner: entry.owner,
      value,
      presentation: entry.option.describe(value, this.#startContext(userId)),
      selectable: entry.option.selectable(),
      locked: this.startLocked && !entry.option.changeable,
      chosen: !this.startLocked && this.#startValues.has(entry.option.id),
    };
  }

  attach(): boolean {
    const state = this.#engine.journal.stateOf(this.id);
    if (!state) return false;
    this.#subscribeJournal();
    const primaryActor = primaryActorOf(this.#engine.runtime.view(this.id));
    if (!primaryActor) {
      this.#clearPrimaryActor();
      return false;
    }
    this.#bind(primaryActor.id);
    return true;
  }

  subscribe(listener: (event: ChatEvent) => void): () => void {
    listener({ kind: "reset", conversationId: this.#textPositions.conversationId });
    for (const event of this.#events) listener(event);
    listener(this.#statusEvent());
    listener({ kind: "replay-end", conversationId: this.#textPositions.conversationId });
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** With a skill template, the message starts a new run through it, with the start options it fixes. */
  send(text: string, attachments?: ChatAttachmentInput[], userLocation?: unknown, user?: ChatUser, entryId?: string): Promise<void> {
    return this.#track(() => this.#send(text, attachments, undefined, userLocation, user, entryId), false);
  }

  async sendAndWait(text: string, user?: ChatUser): Promise<void> {
    await this.send(text, undefined, undefined, user);
  }

  sendToActor(actorId: string, text: string, attachments?: ChatAttachmentInput[], user?: ChatUser): Promise<void> {
    return this.#track(() => this.#send(text, attachments, actorId, undefined, user), false);
  }

  actorConversations(): ActorConversations {
    this.#assertUsable(this.id);
    if (!this.#engine.journal.stateOf(this.id)) throw new DomainError("run-not-found", "The run does not exist.", 404);
    return actorChatHistoryOf(this.#engine.runtime.view(this.id), this.#engine.runtime.events(this.id));
  }

  capabilities(actor: string, userId: string | null): Promise<{ input: string[]; model: string }> {
    return this.#capabilitiesFor(actor, freeChoice(userId));
  }

  async #capabilitiesFor(actor: string, choice: StartChoice): Promise<{ input: string[]; model: string }> {
    const execution = this.#executionFor(actor, choice);
    if (execution.driver.kind === "script") return { input: [], model: "TypeScript" };
    if (execution.driver.kind !== "agent") return { input: ["text"], model: execution.driver.kind };
    const { provider, model } = execution.driver.config;
    return { input: [...await this.#engine.inputCapabilities(provider, model)], model: modelLabel(provider, model) };
  }

  attachment(artifactId: string): { attachment: ChatAttachment; content: Uint8Array } {
    this.#assertUsable(this.id);
    const state = this.#engine.runtime.state(this.id);
    const { artifact, content } = this.#engine.runtime.artifactContent(this.id, artifactId, state.ownerId);
    return { attachment: this.#attachmentInfo(artifact), content };
  }

  /** Starts a run script: in a new run its first turn builds the run, in a running run only an embeddable one joins it. */
  start(entryId: string, input: unknown, user?: ChatUser): void {
    void this.#track(() => this.#start(entryId, input, user));
  }

  /** startedBy is the actor that receives the script's result; without it, the owner. */
  async startAndWait(entryId: string, input: unknown, user?: ChatUser, startedBy?: string): Promise<StartedScript> {
    return this.#track(() => this.#start(entryId, input, user, startedBy));
  }

  /** The script templates among these entries, and whether each can start in this run now. */
  runScripts(entries: readonly PublicStartEntry[], userId: string | null): RunScriptListing[] {
    const started = this.#runStarted();
    return entries.flatMap((entry) => {
      const found = this.#scriptEntryFor(entry.id);
      if (!found) return [];
      const reason = !started ? undefined
        : !found.embeddable ? "It starts only a new run; its RUN.md does not set embeddable: true."
        : this.#optionConflict(found.entry, userId);
      return [{ id: entry.id, title: entry.title, description: entry.description, available: reason === undefined, ...(reason ? { reason } : {}) }];
    });
  }

  #optionConflict(entry: PublicStartEntry, userId: string | null): string | undefined {
    try {
      this.#startChoice(entry, userId);
      return undefined;
    } catch (error) {
      return messageOf(error);
    }
  }

  async startPackageAndWait(script: RunScriptStart, input: unknown, user?: ChatUser): Promise<StartedScript> {
    return this.#track(() => this.#startPackage(() => script, input, user));
  }

  #track<T>(work: () => Promise<T>, reportError = true): Promise<T> {
    if (this.#disposed) throw new Error("The run was deleted");
    this.#assertUsable(this.id);
    const operation = work();
    const tracked = operation.then(() => undefined, (error: unknown) => {
      if (reportError && !this.#disposed) this.#emit({ kind: "system", text: `Error: ${messageOf(error)}` });
    });
    this.#pendingSends.add(tracked);
    void tracked.then(
      () => this.#pendingSends.delete(tracked),
      () => this.#pendingSends.delete(tracked),
    );
    return operation;
  }

  async stop(): Promise<void> {
    this.#assertUsable(this.id);
    return this.#track(() => this.#stop(), false);
  }

  async #stop(): Promise<void> {
    if (this.#startCancellation && !this.#startCancellation.signal.aborted) {
      const message = "The start was cancelled by the operator.";
      this.#startCancellation.abort(new DomainError("run-start-aborted", message, 409));
      if (this.#startup?.status === "preparing") this.#setStartup({ status: "failed", message });
    }
    for (const controller of this.#scriptStarts) controller.abort(new DomainError("run-start-aborted", "The start was cancelled by the operator.", 409));
    try {
      if (this.#engine.journal.stateOf(this.id)) {
        await this.#engine.stopRun(this.id, {
          commandId: `chat-stop:${randomUUID()}`,
          reason: "Emergency stop by the operator",
        });
      }
    } finally {
      this.#liveTurns.clear();
      this.#journalFinishedTurns.clear();
      this.#activeLiveTurnId = undefined;
      if (this.#running) {
        this.#running = false;
        this.#emit({ kind: "turn-done" });
        this.#fanout(this.#statusEvent());
      }
    }
  }

  postExtension(event: { pluginId: string; type: string; payload?: unknown }): void {
    if (this.#disposed) throw new Error("The run was deleted");
    this.#emit({ kind: "plugin", ...event });
  }

  resetHistory(): void {
    if (this.#engine.journal.stateOf(this.id)) throw new Error("The old journal must be removed before the conversation reset");
    this.#startCancellation?.abort(new Error("The start preparation was reset."));
    this.#startCancellation = undefined;
    for (const controller of this.#scriptStarts) controller.abort(new Error("The start preparation was reset."));
    this.#startup = undefined;
    this.#unsubscribeJournal?.();
    this.#unsubscribeLive?.();
    this.#unsubscribeJournal = undefined;
    this.#unsubscribeLive = undefined;
    this.#primaryActorId = undefined;
    this.#liveTurns.clear();
    this.#journalFinishedTurns.clear();
    this.#activeLiveTurnId = undefined;
    this.#startValues.clear();
    this.#pendingSharing.clear();
    this.#events.length = 0;
    this.#textPositions = new ChatTextPositions();
    this.#pluginStates = new PluginStateProjection();
    this.#running = false;
    this.#fanout({ kind: "reset", reason: "conversation-reset", conversationId: null });
    this.#fanout(this.#statusEvent());
    this.#fanout({ kind: "replay-end", conversationId: null });
  }

  dispose(): void {
    this.#disposed = true;
    this.#startCancellation?.abort(new Error("The run was deleted"));
    this.#startCancellation = undefined;
    for (const controller of this.#scriptStarts) controller.abort(new Error("The run was deleted"));
    this.#startup = undefined;
    this.#unsubscribeJournal?.();
    this.#unsubscribeLive?.();
    this.#unsubscribeJournal = undefined;
    this.#unsubscribeLive = undefined;
    this.#listeners.clear();
  }

  async drain(): Promise<void> {
    this.dispose();
    await this.settle();
  }

  /** Waits for every send and start in flight without giving the session up. */
  async settle(): Promise<void> {
    await Promise.allSettled([...this.#pendingSends]);
  }

  #emitSystem(): (text: string) => void {
    return (system) => this.#emit({ kind: "system", text: system });
  }

  async #send(text: string, supplied?: ChatAttachmentInput[], target?: string, userLocation?: unknown, user?: ChatUser, entryId?: string): Promise<void> {
    if (userLocation !== undefined && !this.#inputContext) throw new DomainError("chat-context-unavailable", "This run does not accept UI context.", 400);
    const choice = entryId === undefined ? freeChoice(userIdOf(user)) : this.#startChoice(this.#skillEntry(entryId), userIdOf(user));
    const attachments = this.#checkedAttachments(supplied);
    if (!text.trim() && attachments.length === 0) throw new DomainError("empty-message", "Text or attachments are missing", 400);
    const existingTarget = target ?? this.#engine.journal.stateOf(this.id)?.primaryActorId;
    if (existingTarget) this.#assertChatTarget(existingTarget);
    if (attachments.length > 0) await this.#checkAttachmentCapabilities(target ?? "primary", attachments, choice);
    await this.#prepare(this.id, this.#emitSystem());
    this.#assertUsable(this.id);
    const primaryActorId = target ? this.#targetActor(target).id : await this.#ensureRun(user, choice);
    this.#assertUsable(this.id);
    this.#assertChatTarget(primaryActorId);
    if (target) await this.#prepareWorkspace(this.id, this.#emitSystem());
    this.#assertUsable(this.id);
    if (attachments.length > 0) await this.#checkAttachmentCapabilities(primaryActorId, attachments, choice);
    const sourceEventIds = !target && this.#inputContext ? await this.#inputContext(this.#engine.runtime, this.id, userLocation) : [];
    this.#assertUsable(this.id);
    const state = this.#engine.runtime.state(this.id);
    this.#assertChatTarget(primaryActorId);
    const artifactIds = attachments.map((attachment) => {
      const commandId = `chat-attachment:${randomUUID()}`;
      this.#engine.runtime.publishArtifact({ actorId: state.ownerId, commandId }, this.id, {
        title: attachment.name, mediaType: attachment.mediaType,
        content: Buffer.from(attachment.data, "base64"), previousVersionId: null,
      });
      const event = this.#engine.runtime.events(this.id).find((entry) => entry.commandId === commandId && entry.type === "artifact.published");
      if (!event || event.type !== "artifact.published") throw new Error("The attachment was not stored");
      return event.payload.artifact.id;
    });
    this.#engine.runtime.enqueueInput(
      { actorId: state.ownerId, commandId: `chat:${randomUUID()}` },
      this.id,
      { actorId: primaryActorId, content: text, artifactIds, sourceEventIds, origin: "human", ...user ? { userId: user.id } : {} },
    );
  }

  #checkedAttachments(value: unknown): ChatAttachmentInput[] {
    try {
      const attachments = parseChatAttachments(value);
      for (const attachment of attachments) {
        if (attachmentInputKind(attachment.mediaType) === "text") {
          new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(attachment.data, "base64"));
        }
      }
      return attachments;
    } catch (error) {
      throw new DomainError("invalid-attachment", `Invalid attachment: ${messageOf(error)}`, 400);
    }
  }

  #assertChatTarget(reference: string): void {
    const actor = this.#targetActor(reference);
    if (actor.kind !== "agent" && actor.kind !== "external") {
      throw new DomainError("actor-chat-unsupported", `@${addressOf(actor)} is a TypeScript actor, not a chat partner. Use its mini-app or its documented functions. The message was not queued.`, 400);
    }
  }

  #targetActor(reference: string) {
    const actor = this.#engine.runtime.view(this.id).actors.find((entry) => entry.id === reference || `@${addressOf(entry)}` === reference);
    if (!actor || actor.kind === "human" || actor.lifecycle.kind === "stopped") {
      throw new DomainError("actor-unavailable", `The actor ${reference} is not available`, 404);
    }
    return actor;
  }

  #executionFor(reference: string, choice: StartChoice): AgentExecution {
    const state = this.#engine.journal.stateOf(this.id);
    const id = reference === "primary" ? state?.primaryActorId : reference;
    if (id) {
      const execution = this.#targetActor(id).execution;
      if (execution.driver.kind !== "agent") return execution;
      if (id === state?.primaryActorId && this.#modelSelection) return { ...execution, driver: { kind: "agent", config: this.#modelSelection() } };
      return isRunCoordinator(this.#engine.runtime, this.id, id)
        ? { ...execution, driver: { kind: "agent", config: coordinatorSelection(this.#engine.catalog, this.#coordinator, storedModelChoice(state), execution.driver.config) } }
        : execution;
    }
    if (reference !== "primary") throw new DomainError("actor-unavailable", "The actor is not available", 404);
    return this.#coordinatorExecution(choice);
  }

  #coordinatorExecution(choice: StartChoice): AgentExecution {
    const state = this.#engine.journal.stateOf(this.id);
    const selected = this.#engine.startOptions.entry(modelStartOptionId);
    const modelChoice = selected ? this.#startValueOf(selected, choice) as { model?: string; thinking?: string } : undefined;
    const model = modelChoice?.model ?? storedModel(state);
    const thinking = modelChoice?.thinking ?? storedThinking(state);
    const execution = resolveExecution(this.#engine.catalog, {
      profile: this.#coordinator.profile,
      ...(model ? { model } : {}),
      ...(isThinkingLevel(thinking) ? { thinking } : {}),
    }, this.#coordinator.handle, this.#engine.catalog.modelList);
    return execution.driver.kind === "agent" && this.#modelSelection
      ? { ...execution, driver: { kind: "agent", config: this.#modelSelection() } } : execution;
  }

  preparationSelection(userId: string | null): ModelSelection {
    this.#assertUsable(this.id);
    if (this.#disposed || this.started || this.startLocked) {
      throw new DomainError("preparation-unavailable", "Preparation is only possible before the run starts.", 409);
    }
    const execution = this.#coordinatorExecution(freeChoice(userId));
    if (execution.driver.kind !== "agent") throw new DomainError("preparation-model-required", "Preparation requires a coordinator with a model runtime.", 400);
    return { ...execution.driver.config };
  }

  async #checkAttachmentCapabilities(reference: string, attachments: readonly ChatAttachmentInput[], choice: StartChoice): Promise<void> {
    const execution = this.#executionFor(reference, choice);
    if (execution.driver.kind === "script" || execution.driver.kind === "external") return;
    if (execution.driver.kind !== "agent") throw new DomainError("attachments-unsupported", "Attachments require an actor with a model runtime", 400);
    const { input, model } = await this.#capabilitiesFor(reference, choice);
    const state = this.#engine.journal.stateOf(this.id);
    const id = reference === "primary" ? state?.primaryActorId : reference;
    const toolNames = id ? this.#targetActor(id).toolNames : this.#toolNames;
    for (const attachment of attachments) {
      const kind = attachmentInputKind(attachment.mediaType);
      if ((kind === "image" || kind === "video" || kind === "file") && !input.includes(kind)) {
        throw new DomainError("attachment-model-unsupported", `The model ${model} does not support ${kind} (${attachment.name}). Inputs: ${input.join(", ")}.`, 400);
      }
      if (kind === "binary" && toolNames !== null && !toolNames.some((name) => name === "read" || name === "bash")) {
        throw new DomainError("attachment-tools-required", `${attachment.name} requires file access, but this actor has neither read nor bash.`, 400);
      }
    }
  }

  #attachmentInfo(artifact: { id: string; title: string; mediaType: string; size: number }): ChatAttachment {
    return { name: artifact.title, mediaType: artifact.mediaType, size: artifact.size,
      url: attachmentContentPath(this.id, artifact.id) };
  }

  async #ensureRun(user: ChatUser | undefined, choice: StartChoice): Promise<string> {
    this.#assertUsable(this.id);
    const bound = this.#syncPrimaryActor();
    if (bound) return bound;
    if (this.#starting) await this.#starting;
    const afterStart = this.#syncPrimaryActor();
    if (afterStart) return afterStart;
    await this.#exclusiveStart(() => this.#startRun(user, choice));
    const primaryActorId = this.#syncPrimaryActor();
    if (!primaryActorId) throw new Error("The run has no primary actor after the start");
    return primaryActorId;
  }

  #exclusiveStart(work: () => Promise<void>): Promise<void> {
    this.#starting ??= Promise.resolve().then(work).finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  #start(entryId: string, input: unknown, user?: ChatUser, startedBy?: string): Promise<StartedScript> {
    return this.#startPackage(() => {
      const found = this.#scriptEntryFor(entryId);
      if (!found) throw new DomainError("entry-unknown", `The template ${entryId} is not a script template of this profile.`, 404);
      return found;
    }, input, user, startedBy);
  }

  #runStarted(): boolean {
    return this.startLocked && this.#engine.runtime.view(this.id).actors.some((actor) => actor.kind !== "human");
  }

  async #startPackage(resolve: () => RunScriptStart, input: unknown, user?: ChatUser, startedBy?: string): Promise<StartedScript> {
    if (this.#runStarted()) return this.#startInRun(resolve(), input, user, startedBy);
    if (this.#starting) throw new DomainError("run-starting", "The run is being started.", 409);
    const cancellation = new AbortController();
    this.#startCancellation = cancellation;
    let started: StartedScript | undefined;
    const operation = this.#exclusiveStart(async () => {
      const { signal } = cancellation;
      try {
        signal.throwIfAborted();
        const found = resolve();
        const choice = this.#startChoice(found.entry, userIdOf(user));
        const startValue = startValueOf(input);
        await this.#prepare(this.id, this.#emitSystem());
        signal.throwIfAborted();
        this.#assertUsable(this.id);
        started = await this.#startWithScript(found, startValue, signal, user, choice);
        signal.throwIfAborted();
        this.#setStartup(undefined);
      } catch (error) {
        if (!this.#disposed && this.#startCancellation === cancellation) {
          this.#setStartup({ status: "failed", message: messageOf(signal.aborted ? signal.reason : error) });
        }
        throw error;
      } finally {
        if (this.#startCancellation === cancellation) this.#startCancellation = undefined;
      }
    });
    this.#setStartup({ status: "preparing", message: "Preparing run." });
    await operation;
    if (!started) throw new Error("The run script start ended without a result");
    return started;
  }

  /** Starts in a running run wait for each other; each checks what can refuse it before the run changes, and none touches the primary actor or the startup status. */
  async #startInRun(found: RunScriptStart, input: unknown, user?: ChatUser, startedBy?: string): Promise<StartedScript> {
    if (!found.embeddable) {
      throw new DomainError("run-started", `The run is already running; the run script "${found.entry.title}" only starts a new run. A run script starts inside a running run only if its RUN.md sets embeddable: true.`, 409);
    }
    const startValue = startValueOf(input);
    const cancellation = new AbortController();
    this.#scriptStarts.add(cancellation);
    const operation = this.#scriptQueue.then(async () => {
      const { signal } = cancellation;
      signal.throwIfAborted();
      await this.#starting?.catch(() => undefined);
      signal.throwIfAborted();
      const choice = this.#startChoice(found.entry, userIdOf(user));
      await this.#prepare(this.id, this.#emitSystem());
      signal.throwIfAborted();
      this.#assertUsable(this.id);
      await this.#prepareWorkspace(this.id, this.#emitSystem());
      signal.throwIfAborted();
      this.#assertUsable(this.id);
      const installed = await this.#installScript(found, signal, startedBy);
      signal.throwIfAborted();
      this.#assertUsable(this.id);
      return this.#enqueueStart(installed, startValue, choice, true, startedBy);
    });
    this.#scriptQueue = operation.catch(() => undefined);
    try {
      return await operation;
    } finally {
      this.#scriptStarts.delete(cancellation);
    }
  }

  async #startRun(user: ChatUser | undefined, choice: StartChoice): Promise<void> {
    this.#createRunIfNeeded(this.#initialTitle ?? this.#coordinator.runTitle, user, choice);
    this.#assertUsable(this.id);
    await this.#prepareWorkspace(this.id, this.#emitSystem());
    this.#assertUsable(this.id);
    this.#ensureCoordinatorAsPrimary(choice);
    await this.#started(this.id, choice.entry);
    this.#assertUsable(this.id);
  }

  async #startWithScript(found: RunScriptStart, input: JsonValue | null, signal: AbortSignal, user: ChatUser | undefined, choice: StartChoice): Promise<StartedScript> {
    const { entry } = found;
    this.#createRunIfNeeded(this.#initialTitle ?? entry.title, user, choice);
    this.#assertUsable(this.id);
    this.#setStartup({ status: "preparing", message: "Preparing working directory." });
    signal.throwIfAborted();
    await this.#prepareWorkspace(this.id, this.#emitSystem());
    signal.throwIfAborted();
    this.#assertUsable(this.id);
    this.#setStartup({ status: "preparing", message: "Preparing UI." });
    signal.throwIfAborted();
    const installed = await this.#installScript(found, signal);
    signal.throwIfAborted();
    this.#assertUsable(this.id);
    if (found.coordinator) this.#ensureCoordinatorAsPrimary(choice);
    else {
      const state = this.#engine.runtime.state(this.id);
      this.#engine.runtime.selectPrimaryActor({actorId: state.ownerId, commandId: `run-script-primary:${this.id}`}, this.id, installed.actorId);
      this.#bind(installed.actorId);
    }
    await this.#started(this.id, choice.entry);
    this.#assertUsable(this.id);
    signal.throwIfAborted();
    const started = this.#enqueueStart(installed, input, choice, false);
    if (found.coordinator) this.#emit({ kind: "system", text: `The run script "${entry.title}" runs as @${installed.actorHandle} and sets up the run.` });
    return started;
  }

  /** Every start opens a room of its own, from the room of whoever started it. */
  #installScript(found: RunScriptStart, signal: AbortSignal, startedBy?: string): Promise<ActivatedActorProgram> {
    const { entry, handle, files, programs, sharedPrograms = [] } = found;
    const state = this.#engine.runtime.state(this.id);
    const origin = startedBy === undefined ? null : state.actors.get(startedBy)?.room ?? null;
    return this.#actorPrograms.installScript(
      {actorId: state.ownerId, commandId: `run-script:${this.id}:${handle}:${randomUUID()}`},
      this.id, {entryId: entry.id, handle, files, programs, sharedPrograms}, origin, signal,
    );
  }

  #enqueueStart(installed: ActivatedActorProgram, input: JsonValue | null, choice: StartChoice, embedded: boolean, startedBy?: string): StartedScript {
    const ownerId = this.#engine.runtime.state(this.id).ownerId;
    const options = Object.fromEntries(this.#engine.startOptions.entries()
      .map((option) => [option.option.id, this.#startValueOf(option, choice)]));
    const { count } = this.#actorPrograms.enqueueStart(
      {actorId: ownerId, commandId: `run-script-input:${this.id}:${installed.name}:${randomUUID()}`},
      this.id, installed.name, {content: JSON.stringify({ input, options }), embedded, startedBy: startedBy ?? ownerId},
    );
    return { actorId: installed.actorId, handle: installed.actorHandle, count };
  }

  #createRunIfNeeded(title: string, user: ChatUser | undefined, choice: StartChoice): void {
    this.#assertUsable(this.id);
    const isNewRun = !this.#engine.journal.stateOf(this.id);
    if (isNewRun) {
      const sharing = user ? this.#pendingSharing.get(user.id) : undefined;
      this.#engine.runtime.createRun(
        { commandId: `run:${this.id}` },
        {
          runId: this.id,
          title,
          ownerHandle: user?.id ?? this.#coordinator.ownerHandle,
          ownerDisplayName: user?.label ?? this.#coordinator.ownerDisplayName,
          ...user ? { ownerUserId: user.id } : {},
          initialPluginStates: this.#startupPluginStates(choice),
          ...sharing ? { sharing } : {},
        },
      );
      this.#pendingSharing.clear();
    }

    if (!isNewRun && !this.#engine.runtime.view(this.id).actors.some((actor) => actor.kind !== "human"))
      this.#persistStartupSelections(choice);
  }

  #ensureCoordinatorAsPrimary(choice: StartChoice): void {
    const state = this.#engine.runtime.state(this.id);
    let primaryActor = primaryActorOf(this.#engine.runtime.view(this.id));
    if (!primaryActor) {
      const current = this.#engine.runtime.view(this.id);
      let coordinator = current.actors.find((actor) =>
        actor.kind === "agent"
        && actor.handle === this.#coordinator.handle
        && actor.lifecycle.kind !== "stopped");

      if (!coordinator) {
        const spawnCommandId = `coordinator:${this.id}:${current.revision}`;
        this.#engine.runtime.spawnAgent(
          { actorId: state.ownerId, commandId: spawnCommandId },
          this.id,
          {
            handle: this.#coordinator.handle,
            displayName: this.#coordinator.displayName,
            prompt: this.#prompt(),
            execution: this.#coordinatorExecution(choice),
            grants: coordinatorGrants(),
            toolNames: this.#toolNames === null ? null : [...this.#toolNames],
          },
        );
        const spawned = [...this.#engine.runtime.events(this.id)].reverse().find((event) =>
          event.commandId === spawnCommandId && event.type === "agent.spawned");
        if (!spawned || spawned.type !== "agent.spawned")
          throw new Error("The primary actor could not be resolved after spawning");

        coordinator = this.#engine.runtime.view(this.id).actors.find((actor) =>
          actor.id === spawned.payload.agentId && actor.kind === "agent");
      }

      if (!coordinator)
        throw new Error("The coordinator could not be resolved");

      const revision = this.#engine.runtime.view(this.id).revision;
      this.#engine.runtime.selectPrimaryActor(
        { actorId: state.ownerId, commandId: `primary:${this.id}:${coordinator.id}:${revision}` },
        this.id,
        coordinator.id,
      );
      primaryActor = primaryActorOf(this.#engine.runtime.view(this.id));
    }

    if (!primaryActor) throw new Error("The primary actor could not be created");
    this.#bind(primaryActor.id);
  }

  #startupPluginStates(choice: StartChoice): readonly { pluginId: string; state: JsonValue }[] {
    return this.#engine.startOptions.entries().map((entry) => ({
      pluginId: entry.option.id,
      state: this.#startValueOf(entry, choice),
    }));
  }

  #persistStartupSelections(choice: StartChoice): void {
    const state = this.#engine.runtime.state(this.id);
    for (const entry of this.#engine.startOptions.entries()) {
      if (storedStartOption(this.#engine.journal.stateOf(this.id), entry.option.id) !== undefined) continue;
      this.#engine.runtime.replacePluginState(
        { actorId: state.ownerId, commandId: `start-option:${entry.option.id}:${this.id}` },
        this.id,
        { pluginId: entry.option.id, scope: startOptionScope, state: this.#startValueOf(entry, choice) },
      );
    }
  }

  #bind(primaryActorId: string): void {
    if (this.#primaryActorId === primaryActorId) return;
    this.#unsubscribeLive?.();
    this.#liveTurns.clear();
    this.#journalFinishedTurns.clear();
    this.#activeLiveTurnId = undefined;
    this.#primaryActorId = primaryActorId;
    const scope = this.#scope(primaryActorId);
    const primaryActor = this.#engine.runtime.state(this.id).actors.get(primaryActorId);

    if (primaryActor && primaryActor.kind !== "human" && primaryActor.lifecycle.kind === "running") {
      this.#activeLiveTurnId = primaryActor.lifecycle.turnId;
      this.#liveTurns.set(primaryActor.lifecycle.turnId, liveTurn(false));
    }

    this.#events.length = 0;
    this.#textPositions = new ChatTextPositions();
    this.#pluginStates = new PluginStateProjection();
    this.#events.push(...chatHistoryOf(this.#engine.runtime.events(this.id), scope, this.#textPositions, this.#pluginStates));
    this.#running = this.#engine.scheduler.isRunning(this.id, primaryActorId);
    this.#subscribeJournal();
    if (this.#listeners.size > 0) {
      this.#fanout({ kind: "reset", conversationId: this.#textPositions.conversationId });
      for (const event of this.#events) this.#fanout(event);
      this.#fanout(this.#statusEvent());
      this.#fanout({ kind: "replay-end", conversationId: this.#textPositions.conversationId });
    }

    this.#unsubscribeLive = this.#engine.live.subscribe(this.id, primaryActorId, (event) => {
      if (event.kind === "turn-started") {
        this.#activeLiveTurnId = event.turnId;
        this.#liveTurns.set(event.turnId, liveTurn(true));
        this.#running = true;
        this.#fanout(this.#statusEvent());
        return;
      }
      if (event.kind === "turn-finished") {
        this.#liveTurns.delete(event.turnId);
        if (this.#activeLiveTurnId === event.turnId) this.#activeLiveTurnId = undefined;
        this.#running = false;
        if (!this.#journalFinishedTurns.delete(event.turnId)) this.#emit({ kind: "turn-done" });
        this.#fanout(this.#statusEvent());
        return;
      }
      const turn = this.#activeLiveTurnId
        ? this.#liveTurns.get(this.#activeLiveTurnId)
        : undefined;
      if (!turn?.emitProgress) return;
      if (event.kind === "text") turn.text = true;
      if (event.kind === "thinking") turn.thinking = true;
      if (event.kind === "tool") turn.tools.add(event.id);
      if (event.kind === "tool-result") turn.toolResults.add(event.id);
      this.#emit(event.kind === "text"
        ? { ...event, cursor: this.#textPositions.advance(this.#activeLiveTurnId!, event.delta) }
        : event.kind === "tool-result"
        ? { kind: "tool-result", id: event.id, result: event.result, isError: event.isError }
        : event);
    });
  }

  #subscribeJournal(): void {
    if (this.#unsubscribeJournal) return;
    this.#unsubscribeJournal = this.#engine.journal.subscribe((events) => {
      const selected = events.some((event) => event.runId === this.id && event.type === "run.primary-actor-selected");
      const selectedPrimaryActorId = selected
        ? primaryActorOf(this.#engine.runtime.view(this.id))?.id
        : this.#primaryActorId;
      if (selectedPrimaryActorId !== this.#primaryActorId) {
        this.#syncPrimaryActor();
        return;
      }

      for (const event of events) {
        if (event.runId !== this.id) continue;
        const live = this.#isLive(event);
        const cursor = this.#textPositions.observe(event);
        const primaryActorId = this.#primaryActorId;
        if (!primaryActorId) continue;
        if ((event.type === "turn.finished" || event.type === "turn.interrupted")
          && this.#liveTurns.has(event.payload.turnId)
          && this.#engine.runtime.state(this.id).turns.get(event.payload.turnId)?.actorId === primaryActorId) this.#journalFinishedTurns.add(event.payload.turnId);
        if (live) continue;
        for (const chatEvent of chatEventsOf(event, this.#scope(primaryActorId), cursor, this.#pluginStates)) this.#emit(chatEvent);
      }

      if (events.some((event) =>
        event.runId === this.id
        && event.type === "actor.stopped"
        && event.payload.actorId === this.#primaryActorId)) this.#syncPrimaryActor();
    });
  }

  #syncPrimaryActor(): string | undefined {
    if (!this.#engine.journal.stateOf(this.id)) {
      this.#clearPrimaryActor();
      return undefined;
    }
    const primaryActor = primaryActorOf(this.#engine.runtime.view(this.id));
    if (!primaryActor) {
      this.#clearPrimaryActor();
      return undefined;
    }
    this.#bind(primaryActor.id);
    return primaryActor.id;
  }

  #clearPrimaryActor(): void {
    if (!this.#primaryActorId) return;
    this.#unsubscribeLive?.();
    this.#unsubscribeLive = undefined;
    this.#primaryActorId = undefined;
    this.#liveTurns.clear();
    this.#journalFinishedTurns.clear();
    this.#activeLiveTurnId = undefined;
    if (!this.#running) return;
    this.#running = false;
    this.#emit({ kind: "turn-done" });
    this.#fanout(this.#statusEvent());
  }

  #scope(primaryActorId: string): ChatProjectionScope {
    return {
      conversationId: this.#engine.runtime.events(this.id)[0].eventId,
      primaryActorId,
      ownerId: this.#engine.runtime.state(this.id).ownerId,
      labelOf: (actorId) => this.#engine.runtime.state(this.id).actors.get(actorId)?.displayName,
      scriptActorHandle: (actorId) => this.#actorPrograms.isScriptActor(this.id, actorId)
        ? this.#engine.runtime.select(this.id, (state) => { const actor = state.actors.get(actorId); return actor && addressOf(actor); }) : undefined,
      turnOf: (turnId) => {
        const turn = this.#engine.runtime.state(this.id).turns.get(turnId);
        if (!turn) throw new Error(`The turn ${turnId} is missing from run ${this.id}`);
        return turn;
      },
      inputOf: (inputId) => {
        const input = this.#engine.runtime.select(this.id, (state) => {
          const found = state.inputs.get(inputId);
          return found && { enqueuedBy: found.enqueuedBy, sourceEventIds: found.sourceEventIds, ...found.origin ? { origin: found.origin } : {} };
        });
        if (!input) throw new Error(`The input ${inputId} is missing from run ${this.id}`);
        return input;
      },
      sourceOf: (eventId) => {
        const source = this.#eventOf(eventId);
        return { type: source.type, subjectId: this.#engine.runtime.select(this.id, (state) => eventSubjectOf(state, source)) };
      },
      handleOf: (actorId) => {
        const handle = this.#engine.runtime.select(this.id, (state) => { const actor = state.actors.get(actorId); return actor && addressOf(actor); });
        if (handle === undefined) throw new Error(`The actor ${actorId} is missing from run ${this.id}`);
        return handle;
      },
      interruptedByCommand: (commandId, actorId) => {
        const turns = this.#engine.runtime.state(this.id).turns;
        return this.#engine.runtime.events(this.id).some((event) => event.commandId === commandId
          && event.type === "turn.interrupted" && turns.get(event.payload.turnId)?.actorId === actorId);
      },
      attachmentOf: (artifactId) => {
        const artifact = this.#engine.runtime.state(this.id).artifacts.get(artifactId);
        if (!artifact) throw new Error(`The attachment ${artifactId} is missing`);
        return this.#attachmentInfo(artifact);
      },
    };
  }

  /** Searches from the newest event back, without copying the journal. */
  #eventOf(eventId: string): JournalEvent {
    for (const event of this.#engine.runtime.recentEvents(this.id)) if (event.eventId === eventId) return event;
    throw new Error(`The event ${eventId} is missing from run ${this.id}`);
  }

  #isLive(event: JournalEvent): boolean {
    if (event.actorId !== this.#primaryActorId) return false;
    if (event.type === "model.output.completed" || event.type === "model.output.interrupted") return this.#liveTurns.get(event.payload.turnId)?.text === true
      && this.#textPositions.covers(event.payload.turnId, event.payload.text);
    if (event.type === "model.reasoning.completed") return this.#liveTurns.get(event.payload.turnId)?.thinking === true;
    if (event.type === "tool.call.started")
      return this.#liveTurns.get(event.payload.turnId)?.tools.has(event.payload.toolCallId) === true;
    if (event.type === "tool.call.completed" || event.type === "tool.call.failed")
      return this.#liveTurns.get(event.payload.turnId)?.toolResults.has(event.payload.toolCallId) === true;
    return false;
  }

  #statusEvent(): Extract<ChatEvent, { kind: "status" }> {
    return { kind: "status", running: this.#running, ...(this.#startup ? { startup: this.#startup } : {}) };
  }

  #setStartup(startup: ChatStartupStatus | undefined): void {
    if (this.#startup?.status === startup?.status && this.#startup?.message === startup?.message) return;
    this.#startup = startup;
    this.#fanout(this.#statusEvent());
  }

  #emit(event: ChatEvent): void {
    const stamped = STAMPED_KINDS.has(event.kind) && !("at" in event && event.at)
      ? { ...event, at: new Date().toISOString() }
      : event;
    this.#events.push(stamped);
    this.#fanout(stamped);
  }

  #fanout(event: ChatEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}
