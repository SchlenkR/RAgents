import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { assertJsonValue, type JsonValue } from "@ragents/engine/src/domain/json";
import { canonicalJson } from "@ragents/engine/src/runtime/canonical-json";
import { calendarTimeZone, latestCalendarOccurrence, nextCalendarOccurrence, type CalendarSchedule } from "./calendar.js";

export type ProgramStatus = "waiting" | "done" | "failed" | "blocked";
/** One assignment of a useState cell, numbered across the program; a cell reads the latest one the evaluation has passed. */
export interface ProgramAssignment { readonly cell: string; readonly value: JsonValue; readonly index: number }
export interface ProgramScope { slots: ProgramSlot[]; sets: ProgramAssignment[]; end?: true }
export type ProgramReceived = { readonly kind: "message"; readonly value: JsonValue } | { readonly kind: "timeout" };
export type ProgramSlot =
  | { kind: "useState"; first: JsonValue; name?: string }
  | { kind: "step"; done?: true; result?: JsonValue }
  | { kind: "waitUntil"; key: string; since: string; zone?: string; reached?: true }
  | { kind: "receive"; key: string; since: string; until?: string; received?: ProgramReceived }
  | { kind: "watch"; key: string; baseline?: string | null; changed?: string | null }
  | { kind: "when"; active: boolean; then?: ProgramScope; settled: ProgramAssignment[] }
  | { kind: "forEach"; items: { key: string; scope: ProgramScope }[]; settled: ProgramAssignment[] };
export interface ProgramWaiting {
  readonly position: string;
  readonly kind: "waitUntil" | "receive" | "watch";
  readonly message: string | null;
  readonly until: string | null;
  readonly file: { readonly path: string; readonly hash: string | null } | null;
}
/** The actor state of a state-aware program: the slot tree under root, and what it waits for. */
export interface ProgramState {
  readonly version: 1;
  readonly revision: string;
  readonly status: ProgramStatus;
  readonly waiting: ProgramWaiting | null;
  readonly wakeAt: string | null;
  readonly error: string | null;
  readonly result: JsonValue;
  readonly values: Readonly<Record<string, JsonValue>>;
  readonly root: ProgramScope;
  readonly next: number;
}
export type ProgramFile = { readonly hash: string | null } | { readonly error: string };
/** What the host knows when it wakes a program: the time and the server's zone, its revision, a message for a waiting receive, and watched file hashes. */
export interface ProgramWorld {
  readonly now: string;
  readonly timeZone: string;
  readonly revision: string;
  readonly message: { readonly name: string; readonly value: unknown } | null;
  readonly files: Readonly<Record<string, ProgramFile>>;
}
/** needs names files whose hash the evaluation lacks; the host evaluates again with them. */
export interface ProgramOutcome {
  readonly status: ProgramStatus;
  readonly consumed: boolean;
  readonly needs: readonly string[];
  readonly error: string | null;
}
export interface ProgramEvaluationContext {
  readonly run: { readonly id: string };
  readonly actor?: { readonly id: string; readonly handle: string } | undefined;
  readonly signal: AbortSignal;
  readonly state: { read(): unknown; replace(value: unknown): void };
  readonly functions: Readonly<Record<string, (input?: unknown) => Promise<unknown>>>;
  log(value: unknown): void;
  throwIfAborted(): void;
}
type ProgramBody = (ctx: ReturnType<Evaluation["context"]>) => unknown;
type Else = { readonly else: "preserve" | "forget" };
type Wait =
  | { readonly at: string }
  | { readonly afterMs: number }
  | { readonly daily: string; readonly timeZone?: string }
  | { readonly weekly: string; readonly days: readonly string[]; readonly timeZone?: string };
type Mode = "body" | "step" | "callback";
interface Frame { readonly cursor: Cursor; readonly mode: Mode }

const PRESERVE: Else = Object.freeze({ else: "preserve" });
const FORGET: Else = Object.freeze({ else: "forget" });
const CELL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const CLOCK = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const WEEKDAYS = new Set(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const iso = (time: number): string => new Date(time).toISOString();
const at = (scope: string, segment: string): string => scope ? `${scope} > ${segment}` : segment;
const emptyScope = (): ProgramScope => ({ slots: [], sets: [] });
const shown = (value: JsonValue): string => {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
};
const labelOf = (kind: ProgramSlot["kind"], key: string): string =>
  kind === "receive" || kind === "watch" ? `(${JSON.stringify(key)})` : kind === "waitUntil" ? `(${key})` : "";
const keyOf = (slot: ProgramSlot): string => slot.kind === "receive" || slot.kind === "waitUntil" || slot.kind === "watch" ? slot.key : "";
const described = (slot: ProgramSlot): string => `${slot.kind}${labelOf(slot.kind, keyOf(slot))}`;
const scopeName = (scope: string): string => scope ? `the scope ${scope}` : "the program body";
const itemPath = (position: string, key: string): string => `${position} [${JSON.stringify(key)}]`;

class Cursor {
  index = 0;
  ordinal = 0;
  readonly scope: ProgramScope;
  readonly path: string;
  constructor(scope: ProgramScope, scopePath: string) {
    this.scope = scope;
    this.path = scopePath;
  }
}
class Suspension {
  readonly waiting: ProgramWaiting;
  constructor(waiting: ProgramWaiting) { this.waiting = waiting; }
}
class Divergence extends Error {}

const waitOf = (wait: Wait): { key: string; at?: number; afterMs?: number; calendar?: CalendarSchedule } => {
  if (!isRecord(wait)) throw new Error("ctx.waitUntil needs { at }, { afterMs }, { daily } or { weekly, days }.");
  const kinds = ["at", "afterMs", "daily", "weekly"].filter((key) => key in wait);
  if (kinds.length !== 1) throw new Error("ctx.waitUntil needs exactly one of at, afterMs, daily or weekly.");
  if ("at" in wait) {
    const time = typeof wait.at === "string" ? Date.parse(wait.at) : Number.NaN;
    if (!Number.isFinite(time)) throw new Error(`ctx.waitUntil({ at }) needs an ISO time, not ${JSON.stringify(wait.at)}.`);
    return { key: `at ${iso(time)}`, at: time };
  }
  if ("afterMs" in wait) {
    if (!Number.isSafeInteger(wait.afterMs) || wait.afterMs < 1) throw new Error("ctx.waitUntil({ afterMs }) needs a positive whole number of milliseconds.");
    return { key: `after ${wait.afterMs}ms`, afterMs: wait.afterMs };
  }
  const time = "daily" in wait ? wait.daily : wait.weekly;
  if (typeof time !== "string" || !CLOCK.test(time)) throw new Error(`ctx.waitUntil needs a 24-hour HH:MM time, not ${JSON.stringify(time)}.`);
  const timeZone = wait.timeZone === undefined ? undefined : calendarTimeZone(wait.timeZone);
  const zone = timeZone ? ` ${timeZone}` : "";
  if ("daily" in wait) return { key: `daily ${time}${zone}`, calendar: { at: time, timeZone } };
  const days = wait.days;
  if (!Array.isArray(days) || days.length === 0 || new Set(days).size !== days.length || days.some((day) => !WEEKDAYS.has(day)))
    throw new Error("ctx.waitUntil({ weekly, days }) needs unique weekdays from mon to sun.");
  return { key: `weekly ${days.join(",")} ${time}${zone}`, calendar: { at: time, timeZone, days: days as CalendarSchedule["days"] } };
};

const collect = (scope: ProgramScope): ProgramAssignment[] => [
  ...scope.sets,
  ...scope.slots.flatMap((slot) => slot.kind === "when" ? [...slot.settled, ...slot.then ? collect(slot.then) : []]
    : slot.kind === "forEach" ? [...slot.settled, ...slot.items.flatMap((item) => collect(item.scope))] : []),
];

/** The named cells of the tree with their latest values, by position; a name used twice keeps its first cell. */
const namedValues = (root: ProgramScope): Record<string, JsonValue> => {
  const latest = new Map<string, ProgramAssignment>();
  for (const entry of collect(root)) {
    const prior = latest.get(entry.cell);
    if (!prior || entry.index > prior.index) latest.set(entry.cell, entry);
  }
  const values: Record<string, JsonValue> = {};
  const walk = (scope: ProgramScope, scopePath: string): void => scope.slots.forEach((slot, index) => {
    const position = at(scopePath, `#${index} ${described(slot)}`);
    if (slot.kind === "useState" && slot.name !== undefined && !Object.hasOwn(values, slot.name)) values[slot.name] = latest.get(position)?.value ?? slot.first;
    if (slot.kind === "when" && slot.then) walk(slot.then, `${position} then`);
    if (slot.kind === "forEach") for (const item of slot.items) walk(item.scope, itemPath(position, item.key));
  });
  walk(root, "");
  return values;
};

class Evaluation {
  readonly frames = new AsyncLocalStorage<Frame>();
  readonly world: ProgramWorld;
  readonly now: number;
  readonly #messages: ReadonlySet<string>;
  readonly #values = new Map<string, { value: JsonValue; index: number }>();
  readonly #names = new Map<string, string>();
  readonly wakes: number[] = [];
  readonly needs = new Set<string>();
  next: number;
  consumed = false;
  closed = false;
  #stepping = false;
  suspension: Suspension | null = null;
  divergence: Divergence | null = null;

  constructor(world: ProgramWorld, messages: ReadonlySet<string>, next: number) {
    this.world = world;
    this.now = Date.parse(world.now);
    this.#messages = messages;
    this.next = next;
  }

  json(value: unknown, label: string): JsonValue {
    assertJsonValue(value, label);
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  }

  #frame(name: string): Frame {
    const frame = this.frames.getStore();
    if (this.closed || !frame) throw new Error(`ctx.${name} runs only while the program body runs; await every primitive.`);
    if (frame.mode === "step") throw new Error(`ctx.${name} cannot run inside ctx.step: a step runs once, so call primitives in the program body and pass their values into the step.`);
    if (frame.mode === "callback") throw new Error(`ctx.${name} cannot run inside a forEach key function or a useStateWith factory.`);
    if (this.divergence) throw this.divergence;
    if (this.suspension) throw this.suspension;
    if (this.#stepping) throw new Error(`Await the running ctx.step before ctx.${name}.`);
    return frame;
  }

  #diverge(detail: string): never {
    this.divergence = new Divergence(`This program cannot be continued: ${detail}. Restore the code that recorded this state, or activate the program under a new name to start over.`);
    throw this.divergence;
  }

  #suspend(waiting: ProgramWaiting): never {
    this.suspension = new Suspension(waiting);
    throw this.suspension;
  }

  /** The recorded slot at the cursor, which must have the same kind and key; undefined where the code reaches a new position. */
  #slot(frame: Frame, kind: ProgramSlot["kind"], key: string): { slot: ProgramSlot | undefined; position: string } {
    const { cursor } = frame;
    const index = cursor.index++;
    const position = at(cursor.path, `#${index} ${kind}${labelOf(kind, key)}`);
    const recorded = cursor.scope.slots[index];
    const place = `at ${at(cursor.path, `#${index}`)}`;
    if (recorded) {
      if (recorded.kind !== kind) this.#diverge(`${place} the recorded slot is ${described(recorded)}, the code now calls ${kind}${labelOf(kind, key)}`);
      if (keyOf(recorded) !== key) this.#diverge(`${place} the recorded slot is ${described(recorded)}, the code now calls ${kind}${labelOf(kind, key)} with another key`);
      return { slot: recorded, position };
    }
    if (cursor.scope.end) this.#diverge(`${place} ${scopeName(cursor.path)} ended after ${index} slots, the code now calls ${kind}${labelOf(kind, key)} there`);
    return { slot: undefined, position };
  }

  #add<S extends ProgramSlot>(frame: Frame, slot: S): S {
    frame.cursor.scope.slots.push(slot);
    return slot;
  }

  #pass(entry: ProgramAssignment): void {
    const current = this.#values.get(entry.cell);
    if (!current || entry.index > current.index) this.#values.set(entry.cell, { value: entry.value, index: entry.index });
  }

  #passTree(scope: ProgramScope): void {
    for (const entry of collect(scope)) this.#pass(entry);
  }

  /** A dropped scope's assignments to cells outside it stay in effect: the anchor keeps the latest per cell and passes them on every evaluation. */
  #settle(anchor: { settled: ProgramAssignment[] }, scope: ProgramScope, scopePath: string): void {
    const inside = (cell: string) => cell.startsWith(`${scopePath} > `);
    const kept = collect(scope).filter((entry) => !inside(entry.cell));
    const latest = new Map<string, ProgramAssignment>();
    for (const entry of [...anchor.settled, ...kept]) {
      const prior = latest.get(entry.cell);
      if (!prior || entry.index > prior.index) latest.set(entry.cell, entry);
    }
    anchor.settled = [...latest.values()].sort((left, right) => left.index - right.index);
    for (const [name, cell] of this.#names) if (inside(cell)) this.#names.delete(name);
    for (const entry of kept) this.#pass(entry);
  }

  async scope<T>(cursor: Cursor, body: () => T | Promise<T>): Promise<T> {
    const result = await this.frames.run({ cursor, mode: "body" }, body);
    if (this.#stepping) throw new Error("Await every ctx.step before the program body or a when or forEach callback returns.");
    if (this.suspension || this.divergence) return result;
    const missing = cursor.scope.slots[cursor.index];
    if (missing) this.#diverge(`at ${at(cursor.path, `#${cursor.index}`)} the recorded slot is ${described(missing)}, the code no longer calls it`);
    const unmatched = cursor.scope.sets[cursor.ordinal];
    if (unmatched) this.#diverge(`${scopeName(cursor.path)} recorded assignment ${cursor.ordinal + 1} (${unmatched.cell} = ${shown(unmatched.value)}), the code no longer makes it`);
    cursor.scope.end = true;
    return result;
  }

  #cell(create: () => unknown, name: unknown) {
    const frame = this.#frame("useState");
    if (name !== undefined && (typeof name !== "string" || !CELL_NAME.test(name))) throw new Error(`A useState name is a letter followed by at most 63 letters, digits, _ or -, not ${JSON.stringify(name)}.`);
    const { slot, position } = this.#slot(frame, "useState", "");
    const cell = (slot ?? this.#add(frame, { kind: "useState", first: this.json(this.frames.run({ cursor: frame.cursor, mode: "callback" }, create), `The first value of ${position}`) })) as Extract<ProgramSlot, { kind: "useState" }>;
    if (typeof name === "string") {
      cell.name = name;
      const other = this.#names.get(name);
      if (other !== undefined && other !== position) throw new Error(`The useState name ${name} is used at ${other} and ${position}; names must be unique.`);
      this.#names.set(name, position);
    } else delete cell.name;
    if (!this.#values.has(position)) this.#values.set(position, { value: cell.first, index: -1 });
    const evaluation = this;
    return Object.freeze({
      get value(): JsonValue {
        if (evaluation.closed) throw new Error("A useState cell is read only while the program body runs.");
        return structuredClone(evaluation.#values.get(position)!.value);
      },
      set: (value: unknown): void => this.#assign(position, value),
    });
  }

  #assign(cell: string, value: unknown): void {
    const frame = this.frames.getStore();
    if (this.closed || !frame) throw new Error("A useState cell is assigned only while the program body runs.");
    if (frame.mode !== "body") throw new Error("A useState cell cannot be assigned inside ctx.step or a callback: return the value from the step and assign it after the step.");
    if (this.divergence) throw this.divergence;
    if (this.suspension) throw this.suspension;
    if (this.#stepping) throw new Error("Await the running ctx.step before assigning a useState cell.");
    const json = this.json(value, `The value assigned to ${cell}`);
    const { cursor } = frame;
    const ordinal = cursor.ordinal++;
    const recorded = cursor.scope.sets[ordinal];
    if (recorded) {
      if (recorded.cell !== cell || canonicalJson(recorded.value) !== canonicalJson(json))
        this.#diverge(`${scopeName(cursor.path)} recorded assignment ${ordinal + 1} as ${recorded.cell} = ${shown(recorded.value)}, the code now assigns ${cell} = ${shown(json)}`);
      this.#pass(recorded);
      return;
    }
    if (cursor.scope.end) this.#diverge(`${scopeName(cursor.path)} ended after ${ordinal} assignments, the code now assigns ${cell} = ${shown(json)}`);
    const entry: ProgramAssignment = { cell, value: json, index: this.next++ };
    cursor.scope.sets.push(entry);
    this.#pass(entry);
  }

  async #step(effect: unknown): Promise<unknown> {
    const frame = this.#frame("step");
    if (typeof effect !== "function") throw new Error("ctx.step needs a function.");
    const { slot, position } = this.#slot(frame, "step", "");
    const step = (slot ?? this.#add(frame, { kind: "step" })) as Extract<ProgramSlot, { kind: "step" }>;
    if (step.done) return step.result === undefined ? undefined : structuredClone(step.result);
    this.#stepping = true;
    let value: unknown;
    try { value = await this.frames.run({ cursor: frame.cursor, mode: "step" }, effect as () => unknown); }
    catch (error) { throw new Error(`The step at ${position} failed: ${errorText(error)}`, { cause: error }); }
    finally { this.#stepping = false; }
    if (value === undefined) {
      step.done = true;
      return undefined;
    }
    const result = this.json(value, `The result of the step at ${position}`);
    step.done = true;
    step.result = result;
    return structuredClone(result);
  }

  async #waitUntil(wait: Wait): Promise<{ at: string }> {
    const frame = this.#frame("waitUntil");
    const parsed = waitOf(wait);
    const { slot, position } = this.#slot(frame, "waitUntil", parsed.key);
    const current = (slot ?? this.#add(frame, { kind: "waitUntil", key: parsed.key, since: this.world.now, ...parsed.calendar ? { zone: calendarTimeZone(parsed.calendar.timeZone ?? this.world.timeZone) } : {} })) as Extract<ProgramSlot, { kind: "waitUntil" }>;
    const since = Date.parse(current.since);
    if (parsed.calendar) {
      const schedule = { ...parsed.calendar, timeZone: parsed.calendar.timeZone ?? current.zone };
      const latest = latestCalendarOccurrence(schedule, since, this.now);
      if (latest === null) this.#suspend({ position, kind: "waitUntil", message: null, until: nextCalendarOccurrence(schedule, since), file: null });
      this.wakes.push(Date.parse(nextCalendarOccurrence(schedule, this.now)));
      return { at: latest };
    }
    const target = parsed.at ?? since + parsed.afterMs!;
    if (!current.reached && this.now < target) this.#suspend({ position, kind: "waitUntil", message: null, until: iso(target), file: null });
    current.reached = true;
    return { at: iso(target) };
  }

  async #receive(name: unknown, options: unknown): Promise<ProgramReceived> {
    const frame = this.#frame("receive");
    if (typeof name !== "string" || !this.#messages.has(name)) throw new Error(`ctx.receive(${JSON.stringify(name)}) names no message of this program; declare it under messages in defineProgram.`);
    const timeoutMs = isRecord(options) ? options.timeoutMs : undefined;
    if (options !== undefined && (!isRecord(options) || timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || (timeoutMs as number) < 1)))
      throw new Error("ctx.receive options are { timeoutMs } with a positive whole number of milliseconds.");
    const { slot, position } = this.#slot(frame, "receive", name);
    const current = (slot ?? this.#add(frame, { kind: "receive", key: name, since: this.world.now, ...timeoutMs === undefined ? {} : { until: iso(this.now + (timeoutMs as number)) } })) as Extract<ProgramSlot, { kind: "receive" }>;
    if (current.received) return structuredClone(current.received);
    const message = this.world.message;
    if (message && !this.consumed && message.name === name) {
      this.consumed = true;
      current.received = { kind: "message", value: this.json(message.value, `The message ${name}`) };
      return structuredClone(current.received);
    }
    if (current.until !== undefined && this.now >= Date.parse(current.until)) {
      current.received = { kind: "timeout" };
      return { kind: "timeout" };
    }
    return this.#suspend({ position, kind: "receive", message: name, until: current.until ?? null, file: null });
  }

  async #watch(file: unknown): Promise<{ hash: string | null }> {
    const frame = this.#frame("watch");
    if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) throw new Error(`ctx.watch needs an absolute file path, not ${JSON.stringify(file)}.`);
    const { slot, position } = this.#slot(frame, "watch", file);
    const current = (slot ?? this.#add(frame, { kind: "watch", key: file })) as Extract<ProgramSlot, { kind: "watch" }>;
    if ("changed" in current) return { hash: current.changed ?? null };
    const seen = this.world.files[file];
    const waiting = (hash: string | null): never => this.#suspend({ position, kind: "watch", message: null, until: null, file: { path: file, hash } });
    if (!seen) {
      this.needs.add(file);
      return waiting(current.baseline ?? null);
    }
    if ("error" in seen) throw new Error(`ctx.watch(${JSON.stringify(file)}): ${seen.error}`);
    if (!("baseline" in current)) {
      current.baseline = seen.hash;
      return waiting(seen.hash);
    }
    if (seen.hash === current.baseline) return waiting(current.baseline ?? null);
    current.changed = seen.hash;
    return { hash: seen.hash };
  }

  async #when(condition: unknown, body: unknown, otherwise: unknown): Promise<unknown> {
    const frame = this.#frame("when");
    if (otherwise !== PRESERVE && otherwise !== FORGET) throw new Error("ctx.when needs ctx.elsePreserve or ctx.elseForget as its third argument: it decides whether the branch keeps its state while the condition is false.");
    if (typeof body !== "function") throw new Error("ctx.when needs a callback as its second argument.");
    const { slot, position } = this.#slot(frame, "when", "");
    const current = (slot ?? this.#add(frame, { kind: "when", active: false, settled: [] })) as Extract<ProgramSlot, { kind: "when" }>;
    for (const entry of current.settled) this.#pass(entry);
    const branch = `${position} then`;
    if (condition) {
      current.active = true;
      current.then ??= emptyScope();
      return this.scope(new Cursor(current.then, branch), body as () => unknown);
    }
    current.active = false;
    if (current.then && otherwise === FORGET) {
      this.#settle(current, current.then, branch);
      delete current.then;
    } else if (current.then) this.#passTree(current.then);
    return undefined;
  }

  async #forEach(items: unknown, key: unknown, body: unknown): Promise<unknown[]> {
    const frame = this.#frame("forEach");
    if (!Array.isArray(items) || typeof key !== "function" || typeof body !== "function") throw new Error("ctx.forEach needs an array, a key function and a callback.");
    const keyed = items.map((item) => {
      const value = this.frames.run({ cursor: frame.cursor, mode: "callback" }, () => (key as (item: unknown) => unknown)(item));
      if (typeof value !== "string") throw new Error(`A forEach key is a string, not ${JSON.stringify(value)}.`);
      return { key: value, item };
    });
    const duplicate = keyed.find((entry, index) => keyed.findIndex((other) => other.key === entry.key) !== index);
    if (duplicate) throw new Error(`The forEach key ${JSON.stringify(duplicate.key)} occurs twice; keys identify each item's state.`);
    const { slot, position } = this.#slot(frame, "forEach", "");
    const current = (slot ?? this.#add(frame, { kind: "forEach", items: [], settled: [] })) as Extract<ProgramSlot, { kind: "forEach" }>;
    for (const entry of current.settled) this.#pass(entry);
    const wanted = new Set(keyed.map((entry) => entry.key));
    for (const dropped of current.items.filter((item) => !wanted.has(item.key))) this.#settle(current, dropped.scope, itemPath(position, dropped.key));
    current.items = current.items.filter((item) => wanted.has(item.key));
    const results: unknown[] = [];
    for (const { key: itemKey, item } of keyed) {
      let entry = current.items.find((candidate) => candidate.key === itemKey);
      if (!entry) {
        entry = { key: itemKey, scope: emptyScope() };
        current.items.push(entry);
      }
      results.push(await this.scope(new Cursor(entry.scope, itemPath(position, itemKey)), () => (body as (item: unknown) => unknown)(item)));
    }
    return results;
  }

  /** The primitives' promises reject when the evaluation suspends; a handler keeps an unawaited one from crashing the process. */
  #quiet<T>(promise: Promise<T>): Promise<T> {
    promise.catch(() => undefined);
    return promise;
  }

  context(base: ProgramEvaluationContext) {
    const functions = Object.freeze(Object.fromEntries(Object.entries(base.functions).map(([name, call]) => [name, (input?: unknown) => {
      if (this.frames.getStore()?.mode !== "step") throw new Error(`Call ctx.functions.${name} inside ctx.step(...) so that it runs once.`);
      return call(input);
    }])));
    return Object.freeze({
      run: base.run,
      actor: base.actor,
      signal: base.signal,
      functions,
      log: (value: unknown) => base.log(value),
      throwIfAborted: () => base.throwIfAborted(),
      useState: (initial: unknown, name?: string) => this.#cell(() => initial, name),
      useStateWith: (create: () => unknown, name?: string) => {
        if (typeof create !== "function") throw new Error("ctx.useStateWith needs a function that creates the first value.");
        return this.#cell(create, name);
      },
      step: (effect: () => unknown) => this.#quiet(this.#step(effect)),
      waitUntil: (wait: Wait) => this.#quiet(this.#waitUntil(wait)),
      receive: (name: string, options?: { timeoutMs: number }) => this.#quiet(this.#receive(name, options)),
      watch: (file: string) => this.#quiet(this.#watch(file)),
      when: (condition: boolean, body: () => unknown, otherwise: Else) => this.#quiet(this.#when(condition, body, otherwise)),
      forEach: (items: readonly unknown[], key: (item: unknown) => string, body: (item: unknown) => unknown) => this.#quiet(this.#forEach(items, key, body)),
      elsePreserve: PRESERVE,
      elseForget: FORGET,
    });
  }
}

const isScope = (value: unknown): value is ProgramScope => isRecord(value) && Array.isArray(value.slots) && Array.isArray(value.sets);
const storedState = (value: unknown): { kind: "empty" } | { kind: "valid"; state: ProgramState } | { kind: "damaged"; reason: string } => {
  if (value === undefined || value === null || isRecord(value) && Object.keys(value).length === 0) return { kind: "empty" };
  if (!isRecord(value) || value.version !== 1) return { kind: "damaged", reason: "unknown version" };
  if (!isScope(value.root) || !Number.isSafeInteger(value.next) || typeof value.revision !== "string") return { kind: "damaged", reason: "invalid slot tree" };
  return { kind: "valid", state: value as unknown as ProgramState };
};

/** Evaluates the program body once against its recorded slots and the world, and replaces the actor state only when something changed. */
export const evaluateProgram = async (body: ProgramBody, messages: readonly string[], world: ProgramWorld, base: ProgramEvaluationContext): Promise<ProgramOutcome> => {
  const raw = base.state.read();
  const stored = storedState(raw);
  if (stored.kind === "damaged")
    return { status: "blocked", consumed: false, needs: [], error: `The program state is damaged (${stored.reason}). Activate the program under a new name to start over.` };
  const before = stored.kind === "valid" ? stored.state : undefined;
  const root = before ? structuredClone(before.root) : emptyScope();
  const evaluation = new Evaluation(world, new Set(messages), before?.next ?? 0);
  const replace = (state: ProgramState): void => { if (canonicalJson(state) !== canonicalJson(raw)) base.state.replace(state); };
  let result: JsonValue = null;
  let failure: string | null = null;
  try {
    const value = await evaluation.scope(new Cursor(root, ""), () => body(evaluation.context(base)));
    if (!evaluation.suspension && !evaluation.divergence) result = evaluation.json(value === undefined ? null : value, "The program result");
  } catch (error) {
    if (!(error instanceof Suspension) && !(error instanceof Divergence)) failure = errorText(error);
  } finally {
    evaluation.closed = true;
  }
  if (evaluation.divergence) {
    const error = evaluation.divergence.message;
    replace({ ...before ?? { version: 1, waiting: null, result: null, values: {}, root: emptyScope(), next: 0 }, revision: world.revision, status: "blocked", wakeAt: null, error });
    return { status: "blocked", consumed: false, needs: [], error };
  }
  const status: ProgramStatus = failure !== null ? "failed" : evaluation.suspension ? "waiting" : "done";
  const waiting = status === "waiting" ? evaluation.suspension!.waiting : null;
  const wakes = [...evaluation.wakes, ...waiting?.until ? [Date.parse(waiting.until)] : [], ...status === "failed" ? [evaluation.now] : []];
  replace({
    version: 1, revision: world.revision, status, waiting, wakeAt: wakes.length > 0 ? iso(Math.min(...wakes)) : null, error: failure,
    result: status === "done" ? result : null, values: namedValues(root), root, next: evaluation.next,
  });
  return { status, consumed: evaluation.consumed, needs: [...evaluation.needs], error: failure };
};

const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const text = { type: "string" };
/** The actor state schema of every state-aware program; views read status, waiting, wakeAt, error, result and values. */
export const programStateSchema = {
  type: "object",
  properties: {
    version: { const: 1, type: "number" },
    revision: text,
    status: { anyOf: ["waiting", "done", "failed", "blocked"].map((value) => ({ const: value, type: "string" })) },
    waiting: nullable({
      type: "object",
      properties: {
        position: text,
        kind: { anyOf: ["waitUntil", "receive", "watch"].map((value) => ({ const: value, type: "string" })) },
        message: nullable(text),
        until: nullable(text),
        file: nullable({ type: "object", properties: { path: text, hash: nullable(text) }, required: ["path", "hash"], additionalProperties: false }),
      },
      required: ["position", "kind", "message", "until", "file"],
      additionalProperties: false,
    }),
    wakeAt: nullable(text),
    error: nullable(text),
    result: {},
    values: { type: "object", additionalProperties: {} },
    root: {},
    next: { type: "integer" },
  },
  additionalProperties: false,
} as const;
const queuedSchema = { type: "object", properties: { queued: { const: true, type: "boolean" } }, required: ["queued"], additionalProperties: false } as const;

interface ProgramMessage { label: string; description?: string; input: object; tool?: object; confirmation?: string }
interface ProgramContract { capabilities?: readonly string[]; messages?: Readonly<Record<string, ProgramMessage>> }

/** A state-aware program: the host evaluates body on every wake; its messages become functions that deliver to a waiting receive. */
export const defineProgram = (contract: ProgramContract, body: ProgramBody) => {
  if (typeof contract !== "object" || contract === null || typeof body !== "function") throw new Error("defineProgram needs a contract and a program body.");
  const messages = contract.messages ?? {};
  for (const [name, message] of Object.entries(messages)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error(`Invalid message name ${name}.`);
    if (!isRecord(message) || typeof message.label !== "string" || !isRecord(message.input)) throw new Error(`The message ${name} needs a label and an input schema.`);
  }
  return {
    contract: {
      state: programStateSchema,
      functions: Object.fromEntries(Object.entries(messages).map(([name, message]) => [name, {
        label: message.label, ...message.description === undefined ? {} : { description: message.description }, input: message.input, output: queuedSchema,
        ...message.tool === undefined ? {} : { tool: message.tool }, ...message.confirmation === undefined ? {} : { confirmation: message.confirmation }, message: true,
      }])),
      input: { capabilities: [...contract.capabilities ?? []] },
      program: true,
    },
    functions: Object.fromEntries(Object.keys(messages).map((name) => [name, () => { throw new Error(`The host delivers ${name} to a waiting ctx.receive; it does not run as a function.`); }])),
    onInput: () => { throw new Error("The host evaluates a state-aware program; it has no onInput."); },
    evaluate: (world: ProgramWorld, context: ProgramEvaluationContext) => evaluateProgram(body, Object.keys(messages), world, context),
  };
};
