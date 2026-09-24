import type { JournalEvent } from "./events.ts";
import type { JsonValue } from "./json.ts";
import { applyJsonChanges } from "./json-patch.ts";
import { pluginStateKey } from "./model.ts";

export type PluginStateEvent = Extract<JournalEvent, { type: "plugin.state-replaced" | "plugin.state-patched" }>;

export class PluginStateProjection {
    readonly #states = new Map<string, JsonValue>();

    observe(event: JournalEvent): JsonValue | undefined {
        if (event.type !== "plugin.state-replaced" && event.type !== "plugin.state-patched") return undefined;
        const key = pluginStateKey(event.payload.pluginId, event.payload.scope);
        if (event.type === "plugin.state-patched" && !this.#states.has(key))
            throw new Error(`Plugin state ${event.payload.pluginId} must exist before it can be patched.`);
        const state = event.type === "plugin.state-replaced"
            ? event.payload.state : applyJsonChanges(this.#states.get(key)!, event.payload.changes);
        this.#states.set(key, state);
        return state;
    }
}

export function pluginStateAt(events: readonly JournalEvent[], target: PluginStateEvent): JsonValue {
    const projection = new PluginStateProjection();
    const key = pluginStateKey(target.payload.pluginId, target.payload.scope);
    for (const event of events) {
        if ((event.type !== "plugin.state-replaced" && event.type !== "plugin.state-patched")
            || pluginStateKey(event.payload.pluginId, event.payload.scope) !== key) continue;
        const state = projection.observe(event)!;
        if (event.eventId === target.eventId) return state;
    }
    throw new Error(`Plugin state event ${target.eventId} is missing.`);
}
