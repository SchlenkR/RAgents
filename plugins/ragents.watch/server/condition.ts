import { createContext, runInContext } from "node:vm";
import { compileVirtualTypeScriptAsync, type JsonValue } from "@aicontainer/ragents";

const conditionFile = "watch-condition.ts";
const RUN_TIMEOUT_MS = 200;
const REASON_CHARS = 300;

export type WatchPredicate = (now: JsonValue, before: JsonValue) => string | undefined;

export const watchStateDeclarations = `interface WatchTurn { readonly status: string; readonly reason?: string }
interface WatchSource {
  readonly lifecycle: "idle" | "running" | "stopped";
  readonly stopReason?: string;
  readonly completedTurns: number;
  readonly lastTurn?: WatchTurn;
  readonly pendingInputs: number;
  readonly openQuestions: number;
  readonly lastOutput?: string;
}
interface WatchState {
  readonly source: WatchSource;
  readonly observed?: Record<string, unknown>;
  readonly stalledForSeconds?: number;
}
`;

export class WatchConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchConditionError";
  }
}

export const compileWatchCondition = async (condition: string, signal?: AbortSignal): Promise<WatchPredicate> => {
  if (!condition.trim()) throw new WatchConditionError("Die Weckbedingung darf nicht leer sein.");
  const compiled = await compileVirtualTypeScriptAsync({
    sources: [{ fileName: conditionFile, text: `${watchStateDeclarations}\nconst wake = (now: WatchState, before: WatchState): string | undefined => {\n${condition}\n};\n` }],
    emit: "node",
  }, { signal });
  if (!compiled.valid) {
    throw new WatchConditionError(`Die Weckbedingung ist kein gültiges TypeScript:\n${compiled.diagnostics.map((diagnostic) =>
      `${diagnostic.start ? `${Math.max(1, diagnostic.start.line - watchStateDeclarations.split("\n").length)}:${diagnostic.start.column} ` : ""}TS${diagnostic.code}: ${diagnostic.message}`).join("\n")}`);
  }
  const emitted = compiled.emittedFiles.find((file) => file.fileName.endsWith(".js"));
  if (!emitted) throw new WatchConditionError("Die Weckbedingung hat keinen JavaScript-Code erzeugt.");
  const sandbox = createContext(Object.create(null));
  runInContext(`${emitted.text}\nglobalThis.wake = wake;`, sandbox, { timeout: RUN_TIMEOUT_MS });
  return (now, before) => {
    sandbox.now = now;
    sandbox.before = before;
    const result: unknown = runInContext("wake(now, before)", sandbox, { timeout: RUN_TIMEOUT_MS });
    if (result === undefined || result === null || result === false) return undefined;
    if (typeof result !== "string" || !result.trim()) throw new WatchConditionError(`Die Weckbedingung muss einen Grund als Text oder nichts liefern, nicht ${JSON.stringify(result)}.`);
    return result.trim().slice(0, REASON_CHARS);
  };
};
