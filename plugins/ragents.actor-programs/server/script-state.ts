import type { JsonValue } from "@ragents/engine";
import type { ActorScriptState } from "@ragents/host/plugin-support/actor-programs/contract.js";

export const MAX_OPEN_STARTS = 50;
const MAX_RESULT_CHARACTERS = 32_000;
const MAX_SUMMARY_LENGTH = 1_000;
const SHOWN_RESULT_CHARACTERS = 4_000;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const isOrigin = (value: unknown): boolean =>
    isRecord(value) && (value.kind === "script" && typeof value.entryId === "string" || value.kind === "shared" && typeof value.pluginId === "string");

/** An older or unknown shape counts as empty, and so does a package record of an older shape: such packages have no recorded origin. */
export const scriptStateOf = (value: unknown): ActorScriptState => {
    if (!isRecord(value) || value.version !== 2 || !isRecord(value.packages) || !Array.isArray(value.deliveries))
        return { version: 2, packages: {}, deliveries: [] };
    const packages = Object.entries(value.packages).filter(([, entry]) => isRecord(entry) && isOrigin(entry.origin) && typeof entry.identity === "string");
    return { ...value as unknown as ActorScriptState, packages: Object.fromEntries(packages) as ActorScriptState["packages"] };
};

export interface ScriptFinish {
    readonly start: number;
    readonly result: JsonValue;
    readonly summary?: string;
}

/** What a program's turn handler returned through context.finish; a handler built before finish returns nothing. */
export const finishesOf = (value: unknown): readonly ScriptFinish[] => {
    if (value === undefined || value === null) return [];
    if (!isRecord(value) || !Array.isArray(value.finishes)) throw new Error("The program returned an invalid finish list.");
    return value.finishes.map((entry): ScriptFinish => {
        if (!isRecord(entry) || !Number.isInteger(entry.start) || (entry.start as number) < 1) throw new Error("finish needs the count of an open start.");
        const result = (entry.result ?? null) as JsonValue;
        if (JSON.stringify(result).length > MAX_RESULT_CHARACTERS) throw new Error(`The result of finish is larger than ${MAX_RESULT_CHARACTERS} characters as JSON.`);
        if (entry.summary !== undefined && (typeof entry.summary !== "string" || entry.summary.length > MAX_SUMMARY_LENGTH)) {
            throw new Error(`The summary of finish must be a text of at most ${MAX_SUMMARY_LENGTH} characters.`);
        }
        return { start: entry.start as number, result, ...(typeof entry.summary === "string" ? { summary: entry.summary } : {}) };
    });
};

/** The result as a short message for an LLM starter: summary line, then the compact result. */
export const agentResultText = (handle: string, finish: ScriptFinish): string => {
    const headline = `Run script @${handle} finished start ${finish.start}${finish.summary ? `: ${finish.summary}` : "."}`;
    if (finish.result === null) return headline;
    const json = JSON.stringify(finish.result);
    const shown = json.length > SHOWN_RESULT_CHARACTERS ? `${json.slice(0, SHOWN_RESULT_CHARACTERS)}... (shortened, ${json.length} characters)` : json;
    return `${headline}\nResult: ${shown}`;
};

/** The result for a TypeScript starter: onResult gets it parsed, onInput as this JSON. */
export const scriptResultContent = (handle: string, finish: ScriptFinish): string =>
    JSON.stringify({ handle, count: finish.start, result: finish.result, ...(finish.summary !== undefined ? { summary: finish.summary } : {}) });
