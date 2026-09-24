import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { ChatAttachment, ChatAttachmentInput, ChatEvent, ChatStartupStatus } from "../chat-events.js";
import { parseChatAttachments } from "../chat-attachments.js";
import { attachmentContentPath } from "../api/contracts.js";
import type { ChatSessionLike, ChatUser } from "../chat-handler.js";
import {
  assertJsonValue,
  attachmentInputKind,
  capabilityNames,
  DomainError,
  isThinkingLevel,
  PluginStateProjection,
  resolveExecution,
  type CapabilityGrant,
  type JournalEvent,
  type JsonValue,
  type PublicStartEntry,
  type RegisteredStartOption,
  type RunScriptPackage,
  type RunView,
  type StartOptionContext,
  type AgentExecution,
  type ModelSelection,
} from "@ragents/engine";
import type { ActorProgramsService } from "../plugin-support/actor-programs/service.js";
import type { StartOptionState } from "../plugin-support/start-options-contract.js";
import type { Engine } from "./engine.js";
import type { CoordinatorDescriptor } from "./product-runtime.js";
import { startOptionScope, storedModel, storedStartOption, storedThinking } from "./start-option-state.js";
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
    delegable: true,
  }));

const primaryActorOf = (view: RunView) => view.primaryActorId
  ? view.actors.find((actor) => actor.id === view.primaryActorId && actor.kind !== "human")
  : undefined;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const userIdOf = (user: ChatUser | undefined): string | null => user?.id ?? null;

/** Wer einen Run startet und welche Startoptionen seine Vorlage festlegt. */
interface StartChoice {
  readonly userId: string | null;
  readonly fixed: ReadonlyMap<string, JsonValue>;
}

/** Ein Start ohne Vorlage legt nichts fest. */
const freeChoice = (userId: string | null): StartChoice => ({ userId, fixed: new Map() });

/** A script template together with the package the host installs when it is clicked. */
export type RunScriptStart = RunScriptPackage & { entry: PublicStartEntry };

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
  scriptEntryFor: (entryId: string) => RunScriptStart | undefined;
  startEntryFor: (entryId: string) => PublicStartEntry | undefined;
  actorPrograms: ActorProgramsService;
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
  readonly #scriptEntryFor: (entryId: string) => RunScriptStart | undefined;
  readonly #startEntryFor: (entryId: string) => PublicStartEntry | undefined;
  readonly #actorPrograms: ActorProgramsService;
  readonly #events: ChatEvent[] = [];
  readonly #listeners = new Set<(event: ChatEvent) => void>();
  readonly #liveTurns = new Map<string, LiveTurn>();
  readonly #journalFinishedTurns = new Set<string>();
  readonly #pendingSends = new Set<Promise<void>>();
  readonly #startValues = new Map<string, JsonValue>();
  #primaryActorId: string | undefined;
  #activeLiveTurnId: string | undefined;
  #starting: Promise<void> | undefined;
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

  selectStartOption(optionId: string, value: unknown, userId: string | null): StartOptionState {
    const entry = this.#engine.startOptions.entry(optionId);
    if (!entry) throw new DomainError("option-unknown", `Die Startoption ${optionId} ist nicht registriert.`, 404);
    if (!entry.option.selectable()) {
      throw new DomainError("option-not-selectable", `Die Startoption ${optionId} ist fest konfiguriert.`, 409);
    }
    if (this.startLocked) {
      throw new DomainError("option-locked", "Der Run läuft bereits, die Startoptionen stehen fest.", 409);
    }
    this.#startValues.set(optionId, this.#engine.startOptions.accept(optionId, value, this.#startContext(userId)));
    return this.#startOptionState(entry, userId);
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

  /** Die eine Stelle, an der eine Vorlage Startoptionen festlegt: mit dem Handelnden angenommen, eine andere Belegung davor ist ein Fehler. */
  #startChoice(entry: PublicStartEntry, userId: string | null): StartChoice {
    const state = this.#engine.journal.stateOf(this.id);
    const fixed = new Map(Object.entries(entry.fixedStartOptions ?? {}).map(([optionId, value]) => {
      const accepted = this.#engine.startOptions.accept(optionId, value, this.#startContext(userId));
      const chosen = this.startLocked ? storedStartOption(state, optionId) : this.#startValues.get(optionId);
      if (chosen !== undefined && !isDeepStrictEqual(chosen, accepted)) {
        throw new DomainError("start-option-fixed", this.startLocked
          ? `Die Vorlage "${entry.title}" legt die Startoption ${optionId} fest, dieser Run steht dort aber schon auf einem anderen Wert.`
          : `Die Vorlage "${entry.title}" legt die Startoption ${optionId} fest, gewählt ist ein anderer Wert. Nimm die Wahl zurück oder starte ohne diese Vorlage.`, 409);
      }
      return [optionId, accepted] as const;
    }));
    return { userId, fixed };
  }

  #skillEntry(entryId: string): PublicStartEntry {
    const entry = this.#startEntryFor(entryId);
    if (!entry || entry.action !== "skill") throw new DomainError("entry-unknown", `Die Vorlage ${entryId} ist keine Skill-Vorlage dieses Profils.`, 404);
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
      locked: this.startLocked,
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

  /** Mit einer Skill-Vorlage startet die Nachricht einen neuen Run über sie, mit den Startoptionen, die sie festlegt. */
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
    if (!this.#engine.journal.stateOf(this.id)) throw new DomainError("run-not-found", "Der Run ist nicht vorhanden.", 404);
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
    return { input: [...await this.#engine.inputCapabilities(provider, model)], model: `${provider}/${model}` };
  }

  attachment(artifactId: string): { attachment: ChatAttachment; content: Uint8Array } {
    this.#assertUsable(this.id);
    const state = this.#engine.runtime.state(this.id);
    const { artifact, content } = this.#engine.runtime.artifactContent(this.id, artifactId, state.ownerId);
    return { attachment: this.#attachmentInfo(artifact), content };
  }

  /** Starts the run through a script template: no message, the script's first turn builds the run. */
  start(entryId: string, input: unknown, user?: ChatUser): void {
    this.#track(() => this.#start(entryId, input, user));
  }

  async startAndWait(entryId: string, input: unknown, user?: ChatUser): Promise<void> {
    await this.#track(() => this.#start(entryId, input, user));
  }

  async startPackageAndWait(script: RunScriptStart, input: unknown, user?: ChatUser): Promise<void> {
    await this.#track(() => this.#startPackage(() => script, input, user));
  }

  #track(work: () => Promise<void>, reportError = true): Promise<void> {
    if (this.#disposed) throw new Error("Der Run wurde gelöscht");
    this.#assertUsable(this.id);
    const operation = work();
    const tracked = operation.catch((error: unknown) => {
      if (reportError && !this.#disposed) this.#emit({ kind: "system", text: `Fehler: ${messageOf(error)}` });
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
      const message = "Der Start wurde durch den Bediener abgebrochen.";
      this.#startCancellation.abort(new DomainError("run-start-aborted", message, 409));
      this.#setStartup({ status: "failed", message });
    }
    try {
      if (this.#engine.journal.stateOf(this.id)) {
        await this.#engine.stopRun(this.id, {
          commandId: `chat-stop:${randomUUID()}`,
          reason: "Not-Aus durch den Bediener",
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
    if (this.#disposed) throw new Error("Der Run wurde gelöscht");
    this.#emit({ kind: "plugin", ...event });
  }

  resetHistory(): void {
    if (this.#engine.journal.stateOf(this.id)) throw new Error("Das alte Journal muss vor dem Gesprächsreset entfernt sein");
    this.#startCancellation?.abort(new Error("Die Startvorbereitung wurde zurückgesetzt."));
    this.#startCancellation = undefined;
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
    this.#startCancellation?.abort(new Error("Der Run wurde gelöscht"));
    this.#startCancellation = undefined;
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
    if (userLocation !== undefined && !this.#inputContext) throw new DomainError("chat-context-unavailable", "Dieser Run übernimmt keinen Oberflächenkontext.", 400);
    const choice = entryId === undefined ? freeChoice(userIdOf(user)) : this.#startChoice(this.#skillEntry(entryId), userIdOf(user));
    const attachments = this.#checkedAttachments(supplied);
    if (!text.trim() && attachments.length === 0) throw new DomainError("empty-message", "Text oder Anhänge fehlen", 400);
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
      if (!event || event.type !== "artifact.published") throw new Error("Der Anhang wurde nicht gespeichert");
      return event.payload.artifact.id;
    });
    this.#engine.runtime.enqueueInput(
      { actorId: state.ownerId, commandId: `chat:${randomUUID()}` },
      this.id,
      { actorId: primaryActorId, content: text, artifactIds, sourceEventIds },
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
      throw new DomainError("invalid-attachment", `Ungültiger Anhang: ${messageOf(error)}`, 400);
    }
  }

  #assertChatTarget(reference: string): void {
    const actor = this.#targetActor(reference);
    if (actor.kind !== "agent") {
      throw new DomainError("actor-chat-unsupported", `@${actor.handle} ist ein TypeScript-Actor und kein Chatpartner. Verwende seine Mini-App oder seine dokumentierten Funktionen. Die Nachricht wurde nicht eingereiht.`, 400);
    }
  }

  #targetActor(reference: string) {
    const actor = this.#engine.runtime.view(this.id).actors.find((entry) => entry.id === reference || `@${entry.handle}` === reference);
    if (!actor || actor.kind === "human" || actor.lifecycle.kind === "stopped") {
      throw new DomainError("actor-unavailable", `Der Actor ${reference} ist nicht verfügbar`, 404);
    }
    return actor;
  }

  #executionFor(reference: string, choice: StartChoice): AgentExecution {
    const state = this.#engine.journal.stateOf(this.id);
    const id = reference === "primary" ? state?.primaryActorId : reference;
    if (id) {
      const execution = this.#targetActor(id).execution;
      return id === state?.primaryActorId && execution.driver.kind === "agent" && this.#modelSelection
        ? { ...execution, driver: { kind: "agent", config: this.#modelSelection() } } : execution;
    }
    if (reference !== "primary") throw new DomainError("actor-unavailable", "Der Actor ist nicht verfügbar", 404);
    return this.#coordinatorExecution(choice);
  }

  #coordinatorExecution(choice: StartChoice): AgentExecution {
    const state = this.#engine.journal.stateOf(this.id);
    const selected = this.#engine.startOptions.entry("ragents.model");
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
      throw new DomainError("preparation-unavailable", "Die Vorbereitung ist nur vor dem Start des Runs möglich.", 409);
    }
    const execution = this.#coordinatorExecution(freeChoice(userId));
    if (execution.driver.kind !== "agent") throw new DomainError("preparation-model-required", "Die Vorbereitung benötigt einen Koordinator mit Modelllaufzeit.", 400);
    return { ...execution.driver.config };
  }

  async #checkAttachmentCapabilities(reference: string, attachments: readonly ChatAttachmentInput[], choice: StartChoice): Promise<void> {
    const execution = this.#executionFor(reference, choice);
    if (execution.driver.kind === "script") return;
    if (execution.driver.kind !== "agent") throw new DomainError("attachments-unsupported", "Anhänge benötigen einen Actor mit Modelllaufzeit", 400);
    const { input, model } = await this.#capabilitiesFor(reference, choice);
    const state = this.#engine.journal.stateOf(this.id);
    const id = reference === "primary" ? state?.primaryActorId : reference;
    const toolNames = id ? this.#targetActor(id).toolNames : this.#toolNames;
    for (const attachment of attachments) {
      const kind = attachmentInputKind(attachment.mediaType);
      if ((kind === "image" || kind === "video" || kind === "file") && !input.includes(kind)) {
        throw new DomainError("attachment-model-unsupported", `Das Modell ${model} unterstützt ${kind} nicht (${attachment.name}). Eingaben: ${input.join(", ")}.`, 400);
      }
      if (kind === "binary" && toolNames !== null && !toolNames.some((name) => name === "read" || name === "bash")) {
        throw new DomainError("attachment-tools-required", `${attachment.name} benötigt Dateizugriff, aber dieser Actor hat weder read noch bash.`, 400);
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
    if (!primaryActorId) throw new Error("Der Run hat nach dem Start keinen Primary-Actor");
    return primaryActorId;
  }

  #exclusiveStart(work: () => Promise<void>): Promise<void> {
    this.#starting ??= Promise.resolve().then(work).finally(() => {
      this.#starting = undefined;
    });
    return this.#starting;
  }

  async #start(entryId: string, input: unknown, user?: ChatUser): Promise<void> {
    await this.#startPackage(() => {
      const found = this.#scriptEntryFor(entryId);
      if (!found) throw new DomainError("entry-unknown", `Die Vorlage ${entryId} ist keine Script-Vorlage dieses Profils.`, 404);
      return found;
    }, input, user);
  }

  async #startPackage(resolve: () => RunScriptStart, input: unknown, user?: ChatUser): Promise<void> {
    if (this.#starting) throw new DomainError("run-starting", "Der Run wird gerade gestartet.", 409);
    if (this.startLocked && this.#engine.runtime.view(this.id).actors.some((actor) => actor.kind !== "human")) {
      throw new DomainError("run-started", "Der Run läuft schon; ein Run-Script startet nur einen neuen Run.", 409);
    }
    const cancellation = new AbortController();
    this.#startCancellation = cancellation;
    const operation = this.#exclusiveStart(async () => {
      const { signal } = cancellation;
      try {
        signal.throwIfAborted();
        const found = resolve();
        const choice = this.#startChoice(found.entry, userIdOf(user));
        const startValue: JsonValue | null = input === undefined || input === null ? null : (assertJsonValue(input, "Startwert des Run-Scripts"), input);
        await this.#prepare(this.id, this.#emitSystem());
        signal.throwIfAborted();
        this.#assertUsable(this.id);
        await this.#startWithScript(found, startValue, signal, user, choice);
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
    this.#setStartup({ status: "preparing", message: "Run wird vorbereitet." });
    await operation;
  }

  async #startRun(user: ChatUser | undefined, choice: StartChoice): Promise<void> {
    this.#createRunIfNeeded(this.#initialTitle ?? this.#coordinator.runTitle, user, choice);
    this.#assertUsable(this.id);
    await this.#prepareWorkspace(this.id, this.#emitSystem());
    this.#assertUsable(this.id);
    this.#ensureCoordinatorAsPrimary(choice);
  }

  async #startWithScript(found: RunScriptStart, input: JsonValue | null, signal: AbortSignal, user: ChatUser | undefined, choice: StartChoice): Promise<void> {
    const { entry, ...script } = found;
    this.#createRunIfNeeded(this.#initialTitle ?? entry.title, user, choice);
    this.#assertUsable(this.id);
    this.#setStartup({ status: "preparing", message: "Arbeitsverzeichnis wird vorbereitet." });
    signal.throwIfAborted();
    await this.#prepareWorkspace(this.id, this.#emitSystem());
    signal.throwIfAborted();
    this.#assertUsable(this.id);
    this.#setStartup({ status: "preparing", message: "Oberfläche wird vorbereitet." });
    signal.throwIfAborted();
    await this.#copyPrograms(script.programs, signal);
    signal.throwIfAborted();
    const state = this.#engine.runtime.state(this.id);
    const installed = await this.#actorPrograms.importPackage(
      {actorId: state.ownerId, commandId: `run-script:${this.id}:${script.handle}`},
      this.id, script.handle, script.files, signal, entry.id,
    );
    signal.throwIfAborted();
    this.#assertUsable(this.id);
    if (script.coordinator) this.#ensureCoordinatorAsPrimary(choice);
    else {
      this.#engine.runtime.selectPrimaryActor({actorId: state.ownerId, commandId: `run-script-primary:${this.id}`}, this.id, installed.actorId);
      this.#bind(installed.actorId);
    }
    const options = Object.fromEntries(this.#engine.startOptions.entries()
      .map((option) => [option.option.id, this.#startValueOf(option, choice)]));
    signal.throwIfAborted();
    this.#engine.runtime.enqueueInput(
      { actorId: state.ownerId, commandId: `run-script-input:${this.id}:${script.handle}` },
      this.id,
      { actorId: installed.actorId, content: JSON.stringify({ input, options }) },
    );
    if (script.coordinator) {
      this.#emit({ kind: "system", text: `Das Run-Script "${entry.title}" läuft als @${installed.actorHandle} und baut den Run auf.` });
      return;
    }
  }

  async #copyPrograms(programs: RunScriptPackage["programs"], signal: AbortSignal): Promise<void> {
    if (programs.length === 0) return;
    const root = await this.#actorPrograms.workspaceDirectory(this.id);
    for (const program of programs) {
      signal.throwIfAborted();
      const target = path.join(root, program.name);
      await mkdir(target);
      for (const file of program.files) {
        signal.throwIfAborted();
        const destination = path.join(target, file.path);
        await mkdir(path.dirname(destination), {recursive: true});
        await writeFile(destination, file.content, {flag: "wx"});
      }
    }
  }

  #createRunIfNeeded(title: string, user: ChatUser | undefined, choice: StartChoice): void {
    this.#assertUsable(this.id);
    const isNewRun = !this.#engine.journal.stateOf(this.id);
    if (isNewRun) {
      this.#engine.runtime.createRun(
        { commandId: `run:${this.id}` },
        {
          runId: this.id,
          title,
          ownerHandle: user?.id ?? this.#coordinator.ownerHandle,
          ownerDisplayName: user?.label ?? this.#coordinator.ownerDisplayName,
          ...user ? { ownerUserId: user.id } : {},
          initialPluginStates: this.#startupPluginStates(choice),
        },
      );
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
          throw new Error("Der Primary-Actor konnte nach dem Erzeugen nicht aufgelöst werden");

        coordinator = this.#engine.runtime.view(this.id).actors.find((actor) =>
          actor.id === spawned.payload.agentId && actor.kind === "agent");
      }

      if (!coordinator)
        throw new Error("Der Koordinator konnte nicht aufgelöst werden");

      const revision = this.#engine.runtime.view(this.id).revision;
      this.#engine.runtime.selectPrimaryActor(
        { actorId: state.ownerId, commandId: `primary:${this.id}:${coordinator.id}:${revision}` },
        this.id,
        coordinator.id,
      );
      primaryActor = primaryActorOf(this.#engine.runtime.view(this.id));
    }

    if (!primaryActor) throw new Error("Der Primary-Actor konnte nicht angelegt werden");
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
        if (event.actorId === primaryActorId
          && (event.type === "turn.finished" || event.type === "turn.interrupted")
          && this.#liveTurns.has(event.payload.turnId)) this.#journalFinishedTurns.add(event.payload.turnId);
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
      turnOf: (turnId) => {
        const turn = this.#engine.runtime.state(this.id).turns.get(turnId);
        if (!turn) throw new Error(`Der Turn ${turnId} fehlt im Run ${this.id}`);
        return turn;
      },
      interruptedByCommand: (commandId, actorId) => {
        const turns = this.#engine.runtime.state(this.id).turns;
        return this.#engine.runtime.events(this.id).some((event) => event.commandId === commandId
          && event.type === "turn.interrupted" && turns.get(event.payload.turnId)?.actorId === actorId);
      },
      attachmentOf: (artifactId) => {
        const artifact = this.#engine.runtime.state(this.id).artifacts.get(artifactId);
        if (!artifact) throw new Error(`Der Anhang ${artifactId} fehlt`);
        return this.#attachmentInfo(artifact);
      },
    };
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
