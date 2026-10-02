import { handleKey } from "../domain/actor-reference.ts";
import type { RunCapabilityPort, RunStatePort } from "../typescript/run-context.ts";
import { ScriptError } from "./types.ts";

export type MediatorBinding = {
    readonly state: RunStatePort;
    readonly capabilities: RunCapabilityPort;
};

type MediatorEntry = { readonly from: string | null; readonly text: string };
type MediatorState = { readonly entries: readonly MediatorEntry[]; readonly done: boolean };
type MediatorHook = (...args: unknown[]) => unknown;
type MediatorTargets =
    | { readonly kind: "list"; readonly ids: readonly string[] }
    | { readonly kind: "call"; readonly run: MediatorHook };
type MediatorStart = { readonly to: string; readonly text: string };
type MediatorEvent = { readonly type: string; readonly sourceActorId: string; readonly sourceActorHandle: string };
type MediatorInput = { readonly content: string; readonly event: MediatorEvent | null };

type MediatorKeys = {
    readonly all: readonly string[];
    readonly exact: ReadonlySet<string>;
    readonly folded: ReadonlyMap<string, string>;
};

type MediatorConfig = {
    readonly table: ReadonlyMap<string, MediatorTargets>;
    readonly keys: MediatorKeys;
    readonly label: "handle" | "none";
    readonly maxEntries: number;
    readonly start: MediatorStart;
    readonly onEntry: MediatorHook | null;
    readonly onRoute: MediatorHook | null;
    readonly onDone: MediatorHook;
};

const where = "context.std.mediators.route";
const mediatorEventType = "model.output.completed";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const recordOf = (value: unknown): Record<string, unknown> | null =>
    typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

const strippedOf = (value: string) => value.trim().replace(/^@/, "");

const referenceOf = (what: string, value: unknown): string => {
    if (typeof value !== "string" || !strippedOf(value))
        throw new ScriptError(`${where}: ${what} must be an actor ID or a handle as non-empty text.`);

    return strippedOf(value);
};

const keysOf = (references: readonly string[]): MediatorKeys => {
    const folded = new Map(references.map((reference) => [handleKey(reference), reference] as const));

    if (folded.size !== references.length)
        throw new ScriptError(`${where}: table names the same participant twice.`);

    return { all: references, exact: new Set(references), folded };
};

const keyOf = (keys: MediatorKeys, reference: string): string | null =>
    keys.exact.has(reference) ? reference : keys.folded.get(handleKey(reference)) ?? null;

const senderKeyOf = (keys: MediatorKeys, event: MediatorEvent): string | null =>
    keys.exact.has(event.sourceActorId)
        ? event.sourceActorId
        : keys.folded.get(handleKey(event.sourceActorHandle)) ?? null;

const unknownTarget = (what: string, reference: string, keys: MediatorKeys): never => {
    throw new ScriptError(
        `${where}: ${what} is not a key in the table. `
        + `The table knows: ${keys.all.join(", ")}. `
        + `A pure recipient belongs in the table as "${reference}": null.`,
    );
};

const targetsOf = (sender: string, value: unknown, keys: MediatorKeys): MediatorTargets => {
    if (typeof value === "function") return { kind: "call", run: value as MediatorHook };

    if (!Array.isArray(value))
        throw new ScriptError(
            `${where}: the targets of ${sender} must be a list of actor IDs or handles, a function or null.`,
        );

    const ids = value.map((entry) => {
        const reference = referenceOf(`a target of ${sender}`, entry);

        return keyOf(keys, reference) ?? unknownTarget(`the target ${reference} of ${sender}`, reference, keys);
    });

    if (new Set(ids).size !== ids.length)
        throw new ScriptError(`${where}: the targets of ${sender} name the same recipient twice.`);

    return { kind: "list", ids };
};

const tableOf = (value: unknown): { readonly table: ReadonlyMap<string, MediatorTargets>; readonly keys: MediatorKeys } => {
    const record = recordOf(value);

    if (!record)
        throw new ScriptError(`${where}: table must be a routing table from sender to targets.`);

    const entries = Object.entries(record)
        .map(([reference, targets]) => [referenceOf("every key of table", reference), targets] as const);
    const keys = keysOf(entries.map(([key]) => key));
    const table = new Map<string, MediatorTargets>();

    for (const [key, targets] of entries) {
        if (targets === null) continue;

        table.set(key, targetsOf(key, targets, keys));
    }

    if (table.size === 0)
        throw new ScriptError(`${where}: table must contain at least one sender.`);

    return { table, keys };
};

const startOf = (value: unknown, keys: MediatorKeys): MediatorStart => {
    const start = recordOf(value);

    if (!start || typeof start.text !== "string" || !start.text.trim())
        throw new ScriptError(`${where}: start needs text as the first line of the protocol and to as the recipient.`);

    const to = referenceOf("start.to", start.to);

    return { to: keyOf(keys, to) ?? unknownTarget(`start.to ${to}`, to, keys), text: start.text };
};

const hookOf = (name: string, value: unknown, required: boolean): MediatorHook | null => {
    if (value === undefined || value === null) {
        if (required) throw new ScriptError(`${where}: ${name} must be a function.`);

        return null;
    }

    if (typeof value !== "function")
        throw new ScriptError(`${where}: ${name} must be a function.`);

    return value as MediatorHook;
};

const configOf = (value: unknown): MediatorConfig => {
    const config = recordOf(value);

    if (!config)
        throw new ScriptError(`${where} expects a configuration object.`);

    const label = config.label;

    if (label !== "handle" && label !== "none")
        throw new ScriptError(`${where}: label must be "handle" or "none".`);

    const maxEntries = config.maxEntries;

    if (typeof maxEntries !== "number" || !Number.isSafeInteger(maxEntries) || maxEntries < 1)
        throw new ScriptError(`${where}: maxEntries must be an integer of at least 1.`);

    const { table, keys } = tableOf(config.table);

    return {
        table,
        keys,
        label,
        maxEntries,
        start: startOf(config.start, keys),
        onEntry: hookOf("onEntry", config.onEntry, false),
        onRoute: hookOf("onRoute", config.onRoute, false),
        onDone: hookOf("onDone", config.onDone, true) as MediatorHook,
    };
};

const entryOf = (value: unknown): MediatorEntry => {
    const entry = recordOf(value);

    if (!entry || (entry.from !== null && typeof entry.from !== "string") || typeof entry.text !== "string")
        throw new ScriptError("The state of the mediator contains an entry without from and text.");

    return { from: entry.from as string | null, text: entry.text };
};

const stateOf = (value: unknown): MediatorState | null => {
    if (value === undefined || value === null) return null;

    const state = recordOf(value);

    if (!state || !Array.isArray(state.entries) || typeof state.done !== "boolean")
        throw new ScriptError("The state of the mediator does not belong to this library.");

    return { entries: state.entries.map(entryOf), done: state.done };
};

const eventOf = (value: unknown): MediatorEvent | null => {
    if (value === undefined || value === null) return null;

    const event = recordOf(value);

    if (!event || typeof event.type !== "string" || typeof event.sourceActorId !== "string"
        || typeof event.sourceActorHandle !== "string")
        throw new ScriptError("The delivered event carries no type and no sender.");

    return { type: event.type, sourceActorId: event.sourceActorId, sourceActorHandle: event.sourceActorHandle };
};

const inputOf = (value: unknown): MediatorInput => {
    const input = recordOf(value);

    if (!input || typeof input.content !== "string")
        throw new ScriptError("The mediator did not receive an ActorInput with the text field content.");

    return { content: input.content, event: eventOf(input.event) };
};

const lastLineOf = (content: string, from: string): string => {
    const lines = content.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    const last = lines[lines.length - 1];

    if (last === undefined)
        throw new ScriptError(`The answer from @${from} contains no non-empty line.`);

    return last;
};

const mediatorHandler = (binding: MediatorBinding, value: unknown) => {
    const config = configOf(value);

    const rendered = (entries: readonly MediatorEntry[]) => entries
        .map((entry) => entry.from === null || config.label === "none" ? entry.text : `${entry.from}: ${entry.text}`)
        .join("\n");

    const hook = async (name: string, run: MediatorHook | null, args: readonly unknown[]) => {
        if (!run) return;

        try {
            await run(...args);
        } catch (error) {
            throw new ScriptError(`The hook ${name} of the mediator failed: ${messageOf(error)}`);
        }
    };

    const produced = (sender: string, result: unknown): readonly string[] => {
        if (result === null || result === undefined) return [];

        const values = typeof result === "string" ? [result] : result;

        if (!Array.isArray(values))
            throw new ScriptError(
                `The target function for ${sender} must return an actor ID, a handle, a list of them or null.`,
            );

        return values.map((id) => {
            const key = typeof id === "string" ? keyOf(config.keys, strippedOf(id)) : null;

            if (key === null)
                throw new ScriptError(
                    `The target function for ${sender} names the unknown target ${String(id)}. `
                    + `The table knows: ${config.keys.all.join(", ")}.`,
                );

            return key;
        });
    };

    const called = async (sender: string, run: MediatorHook, entry: MediatorEntry): Promise<unknown> => {
        try {
            return await run(entry);
        } catch (error) {
            throw new ScriptError(`The target function for ${sender} failed: ${messageOf(error)}`);
        }
    };

    const resolved = async (sender: string, targets: MediatorTargets, entry: MediatorEntry): Promise<readonly string[]> =>
        targets.kind === "list" ? targets.ids : produced(sender, await called(sender, targets.run, entry));

    const advance = async (
        entries: readonly MediatorEntry[],
        accepted: MediatorEntry | null,
        targets: () => Promise<readonly string[]>,
    ) => {
        const done = entries.length >= config.maxEntries;
        binding.state.replace({ entries: entries.map((entry) => ({ from: entry.from, text: entry.text })), done });

        if (accepted) await hook("onEntry", config.onEntry, [accepted]);

        if (done) {
            await hook("onDone", config.onDone, [entries]);

            return;
        }

        const latest = entries[entries.length - 1] as MediatorEntry;

        for (const target of await targets()) {
            await hook("onRoute", config.onRoute, [latest, target]);
            await binding.capabilities.call("actor_input", { to: target, message: rendered(entries) });
        }
    };

    return async (received: unknown) => {
        const input = inputOf(received);
        const current = stateOf(binding.state.read());

        if (input.event === null) {
            if (current)
                throw new ScriptError("The mediator is already set up; a second direct ActorInput is not intended.");

            await binding.capabilities.call("event_subscribe", {
                sourceActorIds: [...config.table.keys()],
                eventTypes: [mediatorEventType],
            });
            await advance([{ from: null, text: config.start.text }], null, () => Promise.resolve([config.start.to]));

            return;
        }

        if (!current)
            throw new ScriptError("The mediator is not set up yet; the first ActorInput must come without an event.");

        if (current.done) return;

        const event = input.event;

        if (event.type !== mediatorEventType)
            throw new ScriptError(`The mediator only accepts ${mediatorEventType}, here ${event.type} arrived.`);

        const senderKey = senderKeyOf(config.keys, event);
        const targets = senderKey === null ? undefined : config.table.get(senderKey);

        if (senderKey === null || !targets)
            throw new ScriptError(
                `The sender ${event.sourceActorId} with the handle ${event.sourceActorHandle} `
                + `does not appear in the table as a sender. `
                + `Senders are: ${[...config.table.keys()].join(", ")}. `
                + `A key may be the actor ID, the handle or @handle.`,
            );

        const entry: MediatorEntry = {
            from: event.sourceActorHandle,
            text: lastLineOf(input.content, event.sourceActorHandle),
        };

        await advance([...current.entries, entry], entry, () => resolved(senderKey, targets, entry));
    };
};

export const createMediators = (binding: MediatorBinding) => ({
    route: (config: unknown) => mediatorHandler(binding, config),
});

export const mediatorsDeclarations = `
interface RAgentsMediatorEntry {
  readonly from: string | null;
  readonly text: string;
}

interface RAgentsMediatorState {
  readonly entries: ReadonlyArray<RAgentsMediatorEntry>;
  readonly done: boolean;
}

/** Every target is an actor id, a handle or @handle and must be a key of the table. */
type RAgentsMediatorTargets =
  | ReadonlyArray<string>
  | ((entry: RAgentsMediatorEntry) => string | ReadonlyArray<string> | null)
  | null;

interface RAgentsMediatorConfig {
  /** Every key is an actor id, a handle or @handle; handles are matched case-insensitively. */
  readonly table: Readonly<Record<string, RAgentsMediatorTargets>>;
  /** to is an actor id, a handle or @handle and must be a key of the table. */
  readonly start: { readonly to: string; readonly text: string };
  readonly label: "handle" | "none";
  readonly maxEntries: number;
  readonly onEntry?: (entry: RAgentsMediatorEntry) => void | Promise<void>;
  readonly onRoute?: (entry: RAgentsMediatorEntry, target: string) => void | Promise<void>;
  readonly onDone: (entries: ReadonlyArray<RAgentsMediatorEntry>) => void | Promise<void>;
}

interface RAgentsMediators {
  route(config: RAgentsMediatorConfig): (input: unknown) => Promise<void>;
}
`;
