import type { JournalEvent } from "./events.ts";

type ToolResultEvent = Extract<JournalEvent, { type: "tool.call.completed" | "tool.call.failed" }>;

/** The text the model sees of a tool call when no hook replaced it and the tool recorded its full output. */
export const derivedToolResultText = (event: ToolResultEvent): string =>
    event.type === "tool.call.failed"
        ? event.payload.error
        : typeof event.payload.output === "string" ? event.payload.output : JSON.stringify(event.payload.output ?? {});
