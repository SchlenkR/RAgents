import { randomUUID } from "node:crypto";
import { DomainError, type ExecutableActor, type JournalEvent, type JsonValue, type Orchestration, type RunView } from "@ragents/engine";
import { WATCH_PLUGIN_ID, type WatchDefinition, type WatchRequest, type WatchServiceApi, type WatchSummary, type WatchVerdict } from "../contract.js";
import { changesBetween, lastActivityOf, observeActor, watchableActorOf } from "./observation.js";
import type { WatchPredicate } from "./condition.js";

const CONDITION_CHARS = 4_000;
const INSTRUCTION_CHARS = 2_000;
const HISTORY_LENGTH = 10;

type StoredWatch = WatchDefinition & { baseline?: JsonValue; wakes: number; history?: WatchVerdict[] };
interface WatchState { version: 1; watches: StoredWatch[] }

interface WatchRuntime {
  definition: WatchDefinition;
  predicate: WatchPredicate;
  baseline?: JsonValue;
  wakes: number;
  lastEvaluated?: string;
  lastEvaluatedAt?: string;
  lastJudgedChanges?: string;
  history: WatchVerdict[];
}

interface RunWatches {
  runId: string;
  unsubscribe: () => void;
  abort: AbortController;
  watches: Map<string, WatchRuntime>;
  debounce?: ReturnType<typeof setTimeout>;
  stallTimer?: ReturnType<typeof setInterval>;
  evaluating?: Promise<void>;
  dirty: boolean;
}

export interface WatchServiceOptions {
  runtime: () => Orchestration;
  compile: (condition: string, signal: AbortSignal) => Promise<WatchPredicate>;
  observe: (runId: string, operationId: string, signal: AbortSignal) => Promise<JsonValue>;
  operationExists: (operationId: string) => boolean;
  debounceMs?: number;
  stallCheckMs?: number;
  now?: () => number;
  log?: (message: string, error?: unknown) => void;
}

const summaryOf = (watch: WatchRuntime): WatchSummary => ({
  id: watch.definition.id,
  source: `@${watch.definition.sourceHandle}`,
  target: `@${watch.definition.targetHandle}`,
  condition: watch.definition.condition,
  ...(watch.definition.observe ? { observe: watch.definition.observe } : {}),
  ...(watch.definition.stallAfterSeconds ? { stallAfterSeconds: watch.definition.stallAfterSeconds } : {}),
  wakes: watch.wakes,
  ...(watch.lastEvaluatedAt ? { lastEvaluatedAt: watch.lastEvaluatedAt } : {}),
  ...(watch.history.length ? { lastVerdict: watch.history[watch.history.length - 1] } : {}),
});

const invalid = (message: string) => new DomainError("watch-invalid", message, 400);

const cleanText = (value: string | undefined, field: string, limit: number): string | undefined => {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) throw invalid(`${field} darf nicht leer sein.`);
  if (text.length > limit) throw invalid(`${field} darf höchstens ${limit} Zeichen enthalten.`);
  return text;
};

export const wakeMessage = (definition: WatchDefinition, reason: string, changes: readonly string[]): string => [
  `Der Wächter weckt Dich: ${reason}`,
  `Änderungen bei @${definition.sourceHandle} seit der letzten Weckung:\n${changes.length ? changes.map((line) => `- ${line}`).join("\n") : "- keine"}`,
  ...(definition.instruction ? [definition.instruction] : []),
].join("\n");

export class WatchService implements WatchServiceApi {
  readonly #options: WatchServiceOptions;
  readonly #runs = new Map<string, RunWatches>();
  #closed = false;

  constructor(options: WatchServiceOptions) {
    this.#options = options;
  }

  #now(): number {
    return this.#options.now ? this.#options.now() : Date.parse(this.#options.runtime().now());
  }

  async create(runId: string, callerActorId: string, request: WatchRequest): Promise<WatchSummary> {
    const runtime = this.#options.runtime();
    const view = runtime.view(runId);
    const source = watchableActorOf(view, request.source);
    if (!source) throw invalid(`Der beobachtete Actor ${request.source} existiert in diesem Run nicht.`);
    const target = request.target ? watchableActorOf(view, request.target) : watchableActorOf(view, callerActorId);
    if (!target) throw invalid(`Der zu weckende Actor ${request.target ?? callerActorId} existiert in diesem Run nicht oder ist kein Agent.`);
    const condition = cleanText(request.condition, "condition", CONDITION_CHARS)!;
    const instruction = cleanText(request.instruction, "instruction", INSTRUCTION_CHARS);
    if (request.observe !== undefined && !this.#options.operationExists(request.observe)) throw invalid(`Die Operation ${request.observe} ist nicht registriert.`);
    if (request.stallAfterSeconds !== undefined && (!Number.isInteger(request.stallAfterSeconds) || request.stallAfterSeconds < 1)) throw invalid("stallAfterSeconds muss eine positive ganze Zahl sein.");
    const run = this.#ensure(runId);
    const existing = [...run.watches.values()].find((watch) => watch.definition.sourceActorId === source.id && watch.definition.targetActorId === target.id && watch.definition.condition === condition);
    if (existing) return summaryOf(existing);
    const predicate = await this.#options.compile(condition, run.abort.signal);
    if (this.#runs.get(runId) !== run) throw invalid("Der Run wurde während des Anlegens beendet.");
    const definition: WatchDefinition = {
      id: `watch_${randomUUID()}`,
      sourceActorId: source.id,
      sourceHandle: source.handle,
      targetActorId: target.id,
      targetHandle: target.handle,
      condition,
      ...(request.observe !== undefined ? { observe: request.observe } : {}),
      ...(instruction !== undefined ? { instruction } : {}),
      ...(request.stallAfterSeconds !== undefined ? { stallAfterSeconds: request.stallAfterSeconds } : {}),
      createdBy: callerActorId,
    };
    const watch: WatchRuntime = { definition, predicate, wakes: 0, history: [] };
    run.watches.set(definition.id, watch);
    this.#persist(run);
    this.#updateStallTimer(run);
    this.#schedule(run, true);
    return summaryOf(watch);
  }

  list(runId: string): WatchSummary[] {
    return [...(this.#runs.get(runId)?.watches.values() ?? [])].map(summaryOf);
  }

  remove(runId: string, watchId: string, reason: string): void {
    const run = this.#runs.get(runId);
    const watch = run?.watches.get(watchId);
    if (!run || !watch) throw new DomainError("watch-unknown", `Der Wächter ${watchId} existiert in diesem Run nicht.`, 404);
    if (!reason.trim()) throw invalid("reason darf nicht leer sein.");
    run.watches.delete(watchId);
    this.#persist(run);
    this.#updateStallTimer(run);
  }

  async prepare(runId: string): Promise<void> {
    if (this.#closed || this.#runs.has(runId)) return;
    const runtime = this.#options.runtime();
    if (runtime.events(runId).length === 0) return;
    const stored = this.#stored(runtime.view(runId));
    if (stored.length === 0) return;
    const run = this.#ensure(runId);
    for (const entry of stored) {
      const { baseline, wakes, history, ...definition } = entry;
      const predicate = await this.#options.compile(definition.condition, run.abort.signal);
      if (this.#runs.get(runId) !== run) return;
      run.watches.set(definition.id, { definition, predicate, ...(baseline !== undefined ? { baseline } : {}), wakes, history: history ?? [] });
    }
    this.#updateStallTimer(run);
    this.#schedule(run, true);
  }

  stop(runId: string): void {
    const run = this.#runs.get(runId);
    if (!run) return;
    this.#runs.delete(runId);
    run.unsubscribe();
    run.abort.abort();
    if (run.debounce) clearTimeout(run.debounce);
    if (run.stallTimer) clearInterval(run.stallTimer);
  }

  shutdown(): void {
    for (const runId of [...this.#runs.keys()]) this.stop(runId);
    this.#closed = true;
  }

  #stored(view: RunView): StoredWatch[] {
    const state = view.pluginStates.find((entry) => entry.pluginId === WATCH_PLUGIN_ID && entry.scope.kind === "run")?.state as unknown as WatchState | undefined;
    return state?.watches ?? [];
  }

  #ensure(runId: string): RunWatches {
    if (this.#closed) throw new Error("Der Wächterdienst ist beendet.");
    const existing = this.#runs.get(runId);
    if (existing) return existing;
    const runtime = this.#options.runtime();
    const run: RunWatches = {
      runId,
      unsubscribe: runtime.subscribe((events) => { if (events.some((event) => event.runId === runId)) this.#schedule(run); }),
      abort: new AbortController(),
      watches: new Map(),
      dirty: false,
    };
    this.#runs.set(runId, run);
    return run;
  }

  #persist(run: RunWatches): void {
    const runtime = this.#options.runtime();
    const view = runtime.view(run.runId);
    const state: WatchState = { version: 1, watches: [...run.watches.values()].map((watch) => ({ ...watch.definition, ...(watch.baseline !== undefined ? { baseline: watch.baseline } : {}), wakes: watch.wakes, history: watch.history })) };
    runtime.replacePluginState({ actorId: view.ownerId, commandId: `ragents.watch:state:${randomUUID()}` }, run.runId, { pluginId: WATCH_PLUGIN_ID, scope: { kind: "run" }, state: state as unknown as JsonValue });
  }

  #updateStallTimer(run: RunWatches): void {
    const needed = [...run.watches.values()].some((watch) => watch.definition.stallAfterSeconds !== undefined);
    if (!needed && run.stallTimer) { clearInterval(run.stallTimer); run.stallTimer = undefined; }
    if (needed && !run.stallTimer) {
      run.stallTimer = setInterval(() => this.#schedule(run), this.#options.stallCheckMs ?? 30_000);
      run.stallTimer.unref();
    }
  }

  #schedule(run: RunWatches, immediate = false): void {
    if (this.#runs.get(run.runId) !== run) return;
    if (run.evaluating) { run.dirty = true; return; }
    if (immediate) {
      if (run.debounce) { clearTimeout(run.debounce); run.debounce = undefined; }
      this.#start(run);
      return;
    }
    if (run.debounce) return;
    run.debounce = setTimeout(() => { run.debounce = undefined; this.#start(run); }, this.#options.debounceMs ?? 1_000);
    run.debounce.unref();
  }

  #start(run: RunWatches): void {
    run.evaluating = this.#evaluateAll(run).finally(() => {
      run.evaluating = undefined;
      if (run.dirty) { run.dirty = false; this.#schedule(run); }
    });
  }

  async #evaluateAll(run: RunWatches): Promise<void> {
    for (const watch of [...run.watches.values()]) {
      if (this.#runs.get(run.runId) !== run || !run.watches.has(watch.definition.id)) return;
      try { await this.#evaluate(run, watch); }
      catch (error) {
        if (run.abort.signal.aborted) return;
        (this.#options.log ?? ((message, cause) => console.error(message, cause)))(`Wächter ${watch.definition.id} in Run ${run.runId} konnte nicht bewerten:`, error);
      }
    }
  }

  async #evaluate(run: RunWatches, watch: WatchRuntime): Promise<void> {
    const runtime = this.#options.runtime();
    const view = runtime.view(run.runId);
    const source = view.actors.find((actor): actor is ExecutableActor => actor.kind !== "human" && actor.id === watch.definition.sourceActorId);
    const target = view.actors.find((actor): actor is ExecutableActor => actor.kind !== "human" && actor.id === watch.definition.targetActorId);
    if (!source || !target || target.lifecycle.kind === "stopped") return;
    const observation = await this.#observe(run, watch, view, source, runtime.events(run.runId));
    if (this.#runs.get(run.runId) !== run || !run.watches.has(watch.definition.id)) return;
    const key = JSON.stringify(observation);
    if (watch.baseline === undefined) {
      watch.baseline = observation;
      watch.lastEvaluated = key;
      this.#persist(run);
      return;
    }
    if (key === watch.lastEvaluated) return;
    const current = runtime.view(run.runId);
    const busy = current.actors.find((actor): actor is ExecutableActor => actor.kind !== "human" && actor.id === target.id)?.lifecycle.kind !== "idle"
      || current.inputs.some((input) => input.actorId === target.id && input.lifecycle.kind === "pending")
      || current.actions.some((action) => action.askedBy === target.id && action.status === "pending");
    if (busy) return;
    const unsettled = source.lifecycle.kind === "running" || current.inputs.some((input) => input.actorId === source.id && input.lifecycle.kind === "pending");
    if (unsettled && !(typeof observation === "object" && observation !== null && "stalledForSeconds" in observation)) return;
    const changes = changesBetween(watch.baseline, observation);
    const judged = JSON.stringify(changes);
    if (changes.length === 0 || judged === watch.lastJudgedChanges) { watch.lastEvaluated = key; return; }
    const reason = watch.predicate(observation, watch.baseline);
    const at = new Date(this.#now()).toISOString();
    watch.lastEvaluated = key;
    watch.lastEvaluatedAt = at;
    watch.lastJudgedChanges = judged;
    watch.history = [...watch.history, { at, wake: reason !== undefined, reason: reason ?? "Bedingung nicht erfüllt", changes }].slice(-HISTORY_LENGTH);
    if (reason === undefined) {
      if (changes.some((line) => !line.startsWith("stalledForSeconds:"))) this.#persist(run);
      return;
    }
    runtime.enqueueInput({ actorId: current.ownerId, commandId: `ragents.watch:wake:${watch.definition.id}:${randomUUID()}` }, run.runId, {
      actorId: target.id,
      presentation: "background",
      content: wakeMessage(watch.definition, reason, changes),
    });
    watch.baseline = observation;
    watch.wakes += 1;
    this.#persist(run);
  }

  async #observe(run: RunWatches, watch: WatchRuntime, view: RunView, source: ExecutableActor, events: readonly JournalEvent[]): Promise<JsonValue> {
    const observed = watch.definition.observe ? await this.#options.observe(run.runId, watch.definition.observe, run.abort.signal) : undefined;
    const stall = watch.definition.stallAfterSeconds;
    const age = stall ? this.#now() - Date.parse(lastActivityOf(events, source)) : 0;
    return {
      source: observeActor(view, source.id) as unknown as JsonValue,
      ...(observed !== undefined ? { observed } : {}),
      ...(stall && age >= stall * 1_000 ? { stalledForSeconds: Math.floor(age / (stall * 1_000)) * stall } : {}),
    };
  }
}
