import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { canonicalHash, DomainError, type JsonValue, type Orchestration, type RunView } from "@ragents/engine";
import { watchDirectory } from "@ragents/workspace-executor";
import { ACTOR_PROGRAMS_STATE_ID, ACTOR_STATE_ID, ACTOR_TRIGGERS_STATE_ID, type ActorProgramDefinition, type ActorProgramLogLine, type ActorProgramStatus, type ActorTriggerProgress, type ActorTriggerReason, type ActorTriggerResult } from "@ragents/host/plugin-support/actor-programs/contract.js";
import { nextScheduledOccurrence, serverTimeZone } from "./schedule.js";

const MAX_ACTIVE = 4;
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEADLINE_REASON = "The trigger input exceeded its time limit.";
const backoffMs = (failures: number): number => Math.min(60000 * 2 ** (failures - 1), 3600000);
const pumpEvents = new Set(["turn.started", "turn.finished", "turn.interrupted", "actor.stopped", "actor.restarted", "run.paused", "run.resumed"]);

const nullableText = Type.Union([Type.String(), Type.Null()]);
const occurrenceSchema = Type.Object({
  number: Type.Integer({ minimum: 1 }),
  key: Type.String(),
  commandId: Type.String(),
  reason: Type.Union([Type.Literal("manual"), Type.Literal("interval"), Type.Literal("daily"), Type.Literal("weekly"), Type.Literal("file-change")]),
  scheduledAt: Type.String(),
  timeZone: Type.String(),
}, { additionalProperties: false });
const triggerStateSchema = Type.Object({
  version: Type.Literal(1),
  schedule: Type.String(),
  paused: Type.Boolean(),
  nextDueAt: nullableText,
  nextDueReason: Type.Union([Type.Literal("interval"), Type.Literal("daily"), Type.Literal("weekly"), Type.Null()]),
  occurrence: Type.Integer({ minimum: 0 }),
  accepted: Type.Union([occurrenceSchema, Type.Null()]),
  lastRunAt: nullableText,
  lastResult: Type.Union([Type.Object({
    outcome: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("interrupted"), Type.Literal("timeout")]),
    at: Type.String(),
    summary: Type.String(),
  }, { additionalProperties: false }), Type.Null()]),
  failures: Type.Integer({ minimum: 0 }),
  backoffUntil: nullableText,
  problem: nullableText,
  filePending: Type.Boolean(),
}, { additionalProperties: false });
type TriggerState = Static<typeof triggerStateSchema>;
type Occurrence = Static<typeof occurrenceSchema>;
type Stored = { readonly kind: "none" } | { readonly kind: "damaged" } | { readonly kind: "valid"; readonly state: TriggerState };

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const fail = (code: string, message: string, status = 409): never => { throw new DomainError(code, message, status); };
const validState = (value: unknown): value is TriggerState => {
  if (!Value.Check(triggerStateSchema, value)) return false;
  const state = value as TriggerState;
  return (state.nextDueAt === null) === (state.nextDueReason === null)
    && [state.nextDueAt, state.lastRunAt, state.backoffUntil, state.lastResult?.at, state.accepted?.scheduledAt].every((at) => at === null || at === undefined || Number.isFinite(Date.parse(at)));
};
const storedOf = (view: RunView, actorId: string): Stored => {
  const entry = view.pluginStates.find((candidate) => candidate.pluginId === ACTOR_TRIGGERS_STATE_ID && candidate.scope.kind === "actor" && candidate.scope.actorId === actorId);
  if (!entry || entry.state === null) return { kind: "none" };
  return validState(entry.state) ? { kind: "valid", state: entry.state } : { kind: "damaged" };
};
const scheduleOf = (program: ActorProgramDefinition): string => canonicalHash((program.triggers ?? {}) as JsonValue);
const timeoutOf = (program: ActorProgramDefinition): number => (program.triggers?.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000;
const inputFor = (runtime: Orchestration, view: RunView, commandId: string) => {
  for (const event of runtime.recentEvents(view.id)) {
    if (event.commandId === commandId && event.type === "actor.input.enqueued") return view.inputs.find((input) => input.id === event.payload.inputId);
  }
  return undefined;
};
const turnFor = (runtime: Orchestration, view: RunView, commandId: string) => {
  const lifecycle = inputFor(runtime, view, commandId)?.lifecycle;
  return lifecycle?.kind === "claimed" ? view.turns.find((turn) => turn.id === lifecycle.turnId) : undefined;
};
const declaresTriggers = (state: JsonValue): boolean => typeof state === "object" && state !== null && !Array.isArray(state)
  && typeof state.program === "object" && state.program !== null && !Array.isArray(state.program) && state.program.triggers !== undefined;
const lastOutput = (runtime: Orchestration, runId: string, turnId: string): string | undefined => {
  for (const event of runtime.recentEvents(runId)) {
    if (event.type === "runtime.output.recorded" && event.payload.turnId === turnId) return event.payload.text.split(/\r?\n/).at(-1);
    if (event.type === "turn.started" && event.payload.turnId === turnId) return undefined;
  }
  return undefined;
};

/** The occurrence the host accepted for this actor; the input with its command ID carries it as its trigger. */
export const acceptedTriggerOf = (view: RunView, actorId: string): Occurrence | undefined => {
  const stored = storedOf(view, actorId);
  return stored.kind === "valid" ? stored.state.accepted ?? undefined : undefined;
};

export const triggerProgressOf = (runtime: Orchestration, view: RunView, actorId: string, runProblem: string | null = null): ActorTriggerProgress => {
  const stored = storedOf(view, actorId);
  if (stored.kind === "damaged") return { paused: false, status: "blocked", lastRunAt: null, nextRunAt: null, lastResult: null, problem: "The trigger state is damaged. Resume the triggers to plan them again." };
  const state = stored.kind === "valid" ? stored.state : undefined;
  const problem = state?.problem ?? runProblem ?? (view.pause ? "The run is paused." : null);
  const running = state?.accepted ? turnFor(runtime, view, state.accepted.commandId)?.status === "running" : false;
  const next = state?.nextDueAt ? Math.max(Date.parse(state.nextDueAt), state.backoffUntil ? Date.parse(state.backoffUntil) : 0) : null;
  return {
    paused: state?.paused ?? false,
    status: problem ? "blocked" : state?.accepted ? running ? "running" : "queued" : state?.paused ? "paused" : "ready",
    lastRunAt: state?.lastRunAt ?? null,
    nextRunAt: !state || state.paused || problem || state.accepted || next === null ? null : new Date(next).toISOString(),
    lastResult: state?.lastResult ?? null,
    problem,
  };
};

/** The bounded recent input log of an actor from ordinary output and failure events; nothing is stored twice. */
const recentLog = (runtime: Orchestration, runId: string, actorId: string, limit: number): { log: ActorProgramLogLine[]; droppedLogLines: number } => {
  const turns = new Set(runtime.view(runId).turns.filter((turn) => turn.actorId === actorId).map((turn) => turn.id));
  return runtime.events(runId).reduce((ring, event) => {
    if (event.type !== "runtime.output.recorded" && event.type !== "turn.finished" && event.type !== "turn.interrupted") return ring;
    if (!turns.has(event.payload.turnId)) return ring;
    const reason = event.type === "turn.interrupted" ? event.payload.reason : event.type === "turn.finished" && event.payload.outcome === "failed" ? event.payload.reason : null;
    const added: ActorProgramLogLine[] = event.type === "runtime.output.recorded"
      ? event.payload.text.split(/\r?\n/).map((line) => ({ at: event.occurredAt, level: "info" as const, text: line.slice(0, 1000) }))
      : reason === null ? [] : [{ at: event.occurredAt, level: "error", text: reason.slice(0, 1000) }];
    if (added.length === 0) return ring;
    const log = [...ring.log, ...added];
    return { log: log.slice(-limit), droppedLogLines: ring.droppedLogLines + Math.max(0, log.length - limit) };
  }, { log: [] as ActorProgramLogLine[], droppedLogLines: 0 });
};

export interface ProgramTriggerOptions {
  readonly runtime: () => Orchestration;
  readonly programsOf: (view: RunView) => readonly ActorProgramDefinition[];
  /** Makes the run's workspace known before its first trigger input, as opening the run would. */
  readonly prepareRun: (runId: string) => Promise<void>;
  readonly interrupt: (runId: string, actorId: string, reason: string) => Promise<void>;
  /** Whether an isolated program runs under the operating system's process protection. */
  readonly sandboxFor: (runId: string, program: ActorProgramDefinition) => Promise<boolean>;
  readonly watch?: typeof watchDirectory;
  readonly now?: () => number;
  readonly wake?: (callback: () => void, delay: number) => () => void;
}

/** Turns the triggers of active actor programs into ordinary ActorInputs: one accepted occurrence per program, planned in the journal. */
export class ProgramTriggers {
  readonly #options: ProgramTriggerOptions;
  readonly #runs = new Set<string>();
  readonly #stopped = new Set<string>();
  readonly #failures = new Map<string, string>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #watches = new Map<string, () => void>();
  #unsubscribe: (() => void) | undefined;
  #cancelWake: (() => void) | undefined;
  #closed = false;

  constructor(options: ProgramTriggerOptions) { this.#options = options; }
  #runtime(): Orchestration { return this.#options.runtime(); }
  #view(runId: string): RunView { return this.#runtime().view(runId); }
  #now(): number { return this.#options.now ? this.#options.now() : Date.parse(this.#runtime().now()); }
  #at(): string { return new Date(this.#now()).toISOString(); }

  /** Only runs whose programs declare triggers or once had a trigger input are watched; selecting needs no copy of the run. */
  #triggered(runId: string): boolean {
    return this.#runtime().select(runId, (state) => [...state.pluginStates.values()].some((entry) =>
      entry.pluginId === ACTOR_TRIGGERS_STATE_ID && entry.state !== null || entry.pluginId === ACTOR_PROGRAMS_STATE_ID && declaresTriggers(entry.state)));
  }

  async ready(): Promise<void> {
    this.#unsubscribe ??= this.#runtime().subscribe((events) => {
      const runs = new Set<string>();
      for (const event of events) {
        const programChanged = event.type === "plugin.state-replaced" && event.payload.pluginId === ACTOR_PROGRAMS_STATE_ID;
        if (programChanged && !this.#runs.has(event.runId) && this.#triggered(event.runId)) this.#runs.add(event.runId);
        if ((programChanged || pumpEvents.has(event.type)) && this.#runs.has(event.runId)) runs.add(event.runId);
      }
      for (const runId of runs) this.#queuePump(runId);
    });
    for (const run of this.#runtime().listRuns()) {
      try {
        if (!this.#triggered(run.id)) continue;
        this.#runs.add(run.id);
        this.#queuePump(run.id);
      } catch (error) { this.#failures.set(run.id, errorText(error)); }
    }
    this.#arm();
  }

  #program(view: RunView, actorId: string): ActorProgramDefinition {
    return this.#options.programsOf(view).find((program) => program.actorId === actorId) ?? fail("program-not-active", "The actor has no active program.", 404);
  }

  progress(runId: string, actorId: string): ActorTriggerProgress {
    return triggerProgressOf(this.#runtime(), this.#view(runId), actorId, this.#failures.get(runId) ?? null);
  }

  async status(runId: string, actorId: string, logLimit = 20): Promise<ActorProgramStatus> {
    const view = this.#view(runId);
    const program = this.#program(view, actorId);
    const state = view.pluginStates.find((entry) => entry.pluginId === ACTOR_STATE_ID && entry.scope.kind === "actor" && entry.scope.actorId === actorId)?.state;
    const sandbox = program.isolated ? await this.#options.sandboxFor(runId, program) ? "process" as const : "disabled" as const : null;
    return { ...this.progress(runId, actorId), triggers: program.triggers ?? {}, permissions: program.permissions ?? {}, sandbox, state: structuredClone(state ?? {}), ...recentLog(this.#runtime(), runId, actorId, logLimit) };
  }

  /** One manual occurrence now, also while paused; never beside another accepted occurrence of the same program. */
  trigger(runId: string, actorId: string): Promise<{ accepted: true }> {
    this.#runs.add(runId);
    return this.#serial(runId, async () => {
      await this.#pump(runId);
      const view = this.#view(runId);
      const program = this.#program(view, actorId);
      const stored = storedOf(view, actorId);
      if (stored.kind === "damaged") fail("trigger-state-damaged", "The trigger state is damaged. Resume the triggers to plan them again.");
      await this.#accept(runId, program, stored.kind === "valid" ? stored.state : this.#planned(program, undefined), "manual");
      this.#arm();
      return { accepted: true as const };
    });
  }

  /** Resuming plans the next occurrence from now and clears a problem and the backoff after failures. */
  pause(runId: string, actorId: string, paused: boolean): Promise<{ nextRunAt: string | null }> {
    this.#runs.add(runId);
    return this.#serial(runId, async () => {
      const view = this.#view(runId);
      const program = this.#program(view, actorId);
      const stored = storedOf(view, actorId);
      const planned = this.#planned(program, stored.kind === "valid" ? { ...stored.state, paused: false } : undefined);
      this.#write(runId, actorId, paused ? { ...planned, paused, nextDueAt: null, nextDueReason: null } : planned);
      await this.#syncWatches(runId);
      this.#arm();
      return { nextRunAt: this.progress(runId, actorId).nextRunAt };
    });
  }

  #planned(program: ActorProgramDefinition, previous: TriggerState | undefined): TriggerState {
    const next = previous?.paused || previous?.accepted ? null : nextScheduledOccurrence(program.triggers ?? {}, this.#now());
    return {
      version: 1, schedule: scheduleOf(program), paused: previous?.paused ?? false, nextDueAt: next?.at ?? null, nextDueReason: next?.reason ?? null,
      occurrence: previous?.occurrence ?? 0, accepted: previous?.accepted ?? null, lastRunAt: previous?.lastRunAt ?? null, lastResult: previous?.lastResult ?? null,
      failures: 0, backoffUntil: null, problem: null, filePending: false,
    };
  }

  #write(runId: string, actorId: string, state: TriggerState): void {
    const runtime = this.#runtime();
    runtime.replacePluginState({ actorId: runtime.state(runId).ownerId, commandId: `actor-program-triggers:${randomUUID()}` }, runId,
      { pluginId: ACTOR_TRIGGERS_STATE_ID, scope: { kind: "actor", actorId }, state: state as unknown as JsonValue });
  }

  #current(runId: string, actorId: string): TriggerState | undefined {
    const stored = storedOf(this.#view(runId), actorId);
    return stored.kind === "valid" ? stored.state : undefined;
  }

  #activeCount(view: RunView): number {
    return this.#options.programsOf(view).filter((program) => acceptedTriggerOf(view, program.actorId)).length;
  }

  async #accept(runId: string, program: ActorProgramDefinition, state: TriggerState, reason: ActorTriggerReason): Promise<void> {
    const view = this.#view(runId);
    if (this.#closed || this.#stopped.has(runId) || view.pause) fail("trigger-blocked", "The run is paused or stopped.");
    if (!program.input) fail("trigger-without-input", "This program has no onInput handler for trigger inputs.");
    if (state.accepted) fail("trigger-busy", "The program already has an accepted trigger input.");
    if (this.#activeCount(view) >= MAX_ACTIVE) fail("triggers-busy", `${MAX_ACTIVE} trigger inputs are already active in this run.`);
    await this.#options.prepareRun(runId);
    const number = state.occurrence + 1;
    const key = `${runId}:${program.actorId}:${number}`;
    const scheduled = reason === "interval" || reason === "daily" || reason === "weekly";
    const calendar = reason === "daily" ? program.triggers?.daily : reason === "weekly" ? program.triggers?.weekly : undefined;
    const accepted: Occurrence = { number, key, commandId: `actor-program-trigger:${key}:${randomUUID()}`, reason, scheduledAt: scheduled && state.nextDueAt ? state.nextDueAt : this.#at(), timeZone: calendar?.timeZone ?? serverTimeZone() };
    this.#write(runId, program.actorId, { ...state, occurrence: number, accepted, lastRunAt: this.#at(), nextDueAt: null, nextDueReason: null, filePending: reason === "file-change" ? false : state.filePending });
    this.#enqueue(runId, program.actorId, accepted);
  }

  #enqueue(runId: string, actorId: string, occurrence: Occurrence): void {
    const runtime = this.#runtime();
    if (inputFor(runtime, this.#view(runId), occurrence.commandId)) return;
    runtime.enqueueInput({ actorId: runtime.state(runId).ownerId, commandId: occurrence.commandId }, runId, { actorId, presentation: "background", content: `Trigger: ${occurrence.reason}.` });
  }

  async #settle(runId: string, program: ActorProgramDefinition, state: TriggerState, accepted: Occurrence): Promise<void> {
    const runtime = this.#runtime();
    if (!inputFor(runtime, this.#view(runId), accepted.commandId)) {
      if (state.problem) return;
      await this.#options.prepareRun(runId);
      this.#enqueue(runId, program.actorId, accepted);
      return;
    }
    const turn = turnFor(runtime, this.#view(runId), accepted.commandId);
    if (!turn) return;
    if (turn.status === "running") {
      if (this.#now() >= Date.parse(turn.startedAt) + timeoutOf(program)) await this.#options.interrupt(runId, program.actorId, DEADLINE_REASON);
      if (turnFor(runtime, this.#view(runId), accepted.commandId)?.status === "running") return;
    }
    const finished = turnFor(runtime, this.#view(runId), accepted.commandId)!;
    const outcome = finished.reason === DEADLINE_REASON ? "timeout" : finished.status === "completed" ? "completed" : finished.status === "interrupted" ? "interrupted" : "failed";
    const at = finished.finishedAt ?? this.#at();
    const result: ActorTriggerResult = { outcome, at, summary: (outcome === "completed" ? lastOutput(runtime, runId, finished.id) || "Completed." : finished.reason ?? "The trigger input failed.").slice(0, 1000) };
    const current = this.#current(runId, program.actorId) ?? state;
    const failures = outcome === "completed" ? 0 : current.failures + 1;
    const next = current.paused ? null : nextScheduledOccurrence(program.triggers ?? {}, Math.max(Date.parse(at), this.#now()));
    this.#write(runId, program.actorId, { ...current, accepted: null, lastResult: result, nextDueAt: next?.at ?? null, nextDueReason: next?.reason ?? null,
      failures, backoffUntil: failures ? new Date(Date.parse(at) + backoffMs(failures)).toISOString() : null });
  }

  #failed(runId: string, actorId: string, error: unknown): void {
    const current = this.#current(runId, actorId);
    if (!current) return;
    const failures = current.failures + 1;
    this.#write(runId, actorId, { ...current, failures, backoffUntil: new Date(this.#now() + backoffMs(failures)).toISOString(), lastResult: { outcome: "failed", at: this.#at(), summary: errorText(error).slice(0, 1000) } });
  }

  #blocked(runId: string, actorId: string, error: unknown): void {
    const current = this.#current(runId, actorId);
    if (current) this.#write(runId, actorId, { ...current, problem: errorText(error).slice(0, 1000) });
  }

  #due(state: TriggerState): number | null {
    if (state.paused || state.accepted || state.problem) return null;
    const backoff = state.backoffUntil ? Date.parse(state.backoffUntil) : 0;
    if (state.filePending) return Math.max(this.#now(), backoff);
    return state.nextDueAt === null ? null : Math.max(Date.parse(state.nextDueAt), backoff);
  }

  async #pump(runId: string): Promise<void> {
    if (this.#closed || this.#stopped.has(runId)) return;
    const programs = this.#options.programsOf(this.#view(runId));
    for (const program of programs) {
      const state = this.#current(runId, program.actorId);
      if (!state?.accepted) continue;
      try { await this.#settle(runId, program, state, state.accepted); }
      catch (error) { this.#blocked(runId, program.actorId, error); }
    }
    for (const program of programs) {
      const stored = storedOf(this.#view(runId), program.actorId);
      if (stored.kind === "damaged" || (stored.kind === "none" ? !program.triggers : stored.state.schedule === scheduleOf(program))) continue;
      this.#write(runId, program.actorId, this.#planned(program, stored.kind === "valid" ? stored.state : undefined));
    }
    const view = this.#view(runId);
    if (!view.pause) {
      const due = programs.flatMap((program) => {
        const stored = storedOf(view, program.actorId);
        const at = stored.kind === "valid" ? this.#due(stored.state) : null;
        return stored.kind === "valid" && at !== null && at <= this.#now() ? [{ program, state: stored.state, at }] : [];
      }).sort((left, right) => left.at - right.at || left.program.name.localeCompare(right.program.name));
      for (const { program, state } of due) {
        if (this.#activeCount(this.#view(runId)) >= MAX_ACTIVE) break;
        try { await this.#accept(runId, program, state, state.filePending ? "file-change" : state.nextDueReason!); }
        catch (error) { this.#failed(runId, program.actorId, error); }
      }
    }
    this.#failures.delete(runId);
    await this.#syncWatches(runId);
  }

  async #syncWatches(runId: string): Promise<void> {
    const view = this.#view(runId);
    const enabled = this.#closed || this.#stopped.has(runId) || view.pause ? [] : this.#options.programsOf(view).filter((program) => {
      const stored = storedOf(view, program.actorId);
      return stored.kind === "valid" && !stored.state.paused && !stored.state.problem;
    });
    const desired = enabled.flatMap((program) => (program.triggers?.fileChange?.folders ?? []).map((folder) => ({ actorId: program.actorId, folder, key: `${runId}\0${program.actorId}\0${folder}` })));
    for (const [key, stop] of this.#watches) {
      if (!key.startsWith(`${runId}\0`) || desired.some((entry) => entry.key === key)) continue;
      stop();
      this.#watches.delete(key);
    }
    for (const { actorId, folder, key } of desired) {
      if (this.#watches.has(key)) continue;
      const blocked = (error: Error) => {
        void this.#serial(runId, async () => {
          this.#blocked(runId, actorId, error);
          await this.#syncWatches(runId);
        }).catch((cause) => { this.#failures.set(runId, errorText(cause)); });
      };
      try {
        if (await realpath(folder) !== folder) throw new Error("The watched folder changed its target.");
        const stop = await (this.#options.watch ?? watchDirectory)(folder, {
          onChange: () => {
            void this.#serial(runId, async () => {
              const current = this.#current(runId, actorId);
              if (this.#closed || this.#stopped.has(runId) || this.#view(runId).pause || !current || current.paused || current.problem) return;
              this.#write(runId, actorId, { ...current, filePending: true });
              await this.#pump(runId);
            }).catch((cause) => blocked(cause instanceof Error ? cause : new Error(errorText(cause)))).finally(() => this.#arm());
          },
          onError: blocked,
        });
        this.#watches.set(key, stop);
      } catch (error) {
        this.#blocked(runId, actorId, error);
        for (const [owned, stop] of this.#watches) if (owned.startsWith(`${runId}\0${actorId}\0`)) { stop(); this.#watches.delete(owned); }
      }
    }
  }

  #serial<T>(runId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(runId) ?? Promise.resolve();
    const operation = previous.then(work);
    const settled = operation.then(() => undefined, () => undefined);
    this.#queues.set(runId, settled);
    void settled.then(() => { if (this.#queues.get(runId) === settled) this.#queues.delete(runId); });
    return operation;
  }

  #queuePump(runId: string): void {
    void this.#serial(runId, () => this.#pump(runId)).catch((error) => { this.#failures.set(runId, errorText(error)); }).finally(() => this.#arm());
  }

  #arm(): void {
    this.#cancelWake?.();
    this.#cancelWake = undefined;
    if (this.#closed) return;
    const deadlines = [...this.#runs].flatMap((runId) => {
      if (this.#stopped.has(runId)) return [];
      try {
        const view = this.#view(runId);
        const full = this.#activeCount(view) >= MAX_ACTIVE;
        return this.#options.programsOf(view).flatMap((program) => {
          const stored = storedOf(view, program.actorId);
          if (stored.kind !== "valid") return [];
          if (stored.state.accepted) {
            const turn = turnFor(this.#runtime(), view, stored.state.accepted.commandId);
            return turn?.status === "running" && !stored.state.problem ? [Date.parse(turn.startedAt) + timeoutOf(program)] : [];
          }
          const due = full || view.pause ? null : this.#due(stored.state);
          return due === null ? [] : [due];
        });
      } catch (error) { this.#failures.set(runId, errorText(error)); return []; }
    });
    if (!deadlines.length) return;
    const delay = Math.min(30000, Math.max(10, Math.min(...deadlines) - this.#now()));
    const callback = () => { for (const runId of this.#runs) this.#queuePump(runId); };
    if (this.#options.wake) this.#cancelWake = this.#options.wake(callback, delay);
    else {
      const timer = setTimeout(callback, delay);
      timer.unref();
      this.#cancelWake = () => clearTimeout(timer);
    }
  }

  stop(runId: string): void {
    this.#stopped.add(runId);
    for (const [key, stop] of this.#watches) if (key.startsWith(`${runId}\0`)) { stop(); this.#watches.delete(key); }
    this.#arm();
  }

  forget(runId: string): void {
    this.stop(runId);
    this.#runs.delete(runId);
    this.#failures.delete(runId);
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    this.#cancelWake?.();
    this.#unsubscribe?.();
    for (const stop of this.#watches.values()) stop();
    this.#watches.clear();
    await Promise.all([...this.#queues.values()]);
  }
}
