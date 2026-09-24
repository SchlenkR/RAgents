import { pathToFileURL } from "node:url";
import { createRunContext } from "../../../../packages/ragents/src/typescript/run-context.ts";
import { createScriptStd } from "../../../../packages/ragents/src/script/std.ts";
import type { NativeTypeScriptRequest } from "../../../../packages/ragents/src/typescript/native-executor.ts";
import { assertJsonValue, type JsonValue } from "../../../../packages/ragents/src/domain/json.ts";

const send = (message: unknown): void => {
  if (!process.send || !process.connected) throw new Error("Die Run-Verbindung ist geschlossen.");
  process.send(message as Parameters<NonNullable<typeof process.send>>[0]);
};
const errors = (error: unknown): string => error instanceof Error ? error.message : String(error);
const calls = new Map<number, { resolve(value: JsonValue): void; reject(error: Error): void }>();
let nextCall = 0;
let loaded: Record<string, unknown> | undefined;
let active: AbortController | undefined;

process.on("disconnect", () => process.exit(0));
process.on("message", (raw: unknown) => {
  const message = raw as { kind: string; entry?: string; callId?: number; value?: JsonValue; error?: string; request?: NativeTypeScriptRequest };
  if (message.kind === "load") {
    void import(pathToFileURL(message.entry!).href).then((module: Record<string, unknown>) => {
      loaded = module;
      send({ kind: "ready" });
    }, (error: unknown) => send({ kind: "failed", error: errors(error) }));
    return;
  }
  if (message.kind === "reply") {
    const pending = calls.get(message.callId!);
    calls.delete(message.callId!);
    if (message.error !== undefined) pending?.reject(new Error(message.error));
    else pending?.resolve(message.value!);
    return;
  }
  if (message.kind === "cancel") {
    active?.abort(new Error("Der Run-Aufruf wurde abgebrochen."));
    return;
  }
  if (message.kind !== "execute") return;
  if (!loaded || active) {
    send({ kind: "failed", error: "Der Backendprozess ist nicht bereit." });
    return;
  }
  const request = message.request!;
  const controller = new AbortController();
  active = controller;
  void (async () => {
    let state = structuredClone(request.state);
    const statePort = { read: () => structuredClone(state), replace: (value: unknown) => { state = structuredClone(value); } };
    const capabilities = {
      descriptors: () => request.context.capabilities,
      call: (name: string, input: JsonValue): Promise<JsonValue> => new Promise((resolve, reject) => {
        const callId = ++nextCall;
        calls.set(callId, { resolve, reject });
        send({ kind: "call", callId, name, input });
      }),
    };
    const context = createRunContext({
      ...request.context,
      state: statePort,
      capabilities,
      log: (value) => send({ kind: "log", value }),
      signal: controller.signal,
    });
    const std = request.std ? createScriptStd({
      turnStartedAt: request.std.now,
      idPrefix: request.std.idPrefix,
      state: statePort,
      capabilities,
    }) : undefined;
    const handle = loaded![request.program.exportName ?? "handle"];
    if (typeof handle !== "function") throw new Error(`Backend-Export ${request.program.exportName ?? "handle"} ist keine Funktion.`);
    const result: unknown = await handle(request.input, { ...context, actor: request.context.actor, ...(std ? { std } : {}) });
    controller.signal.throwIfAborted();
    if (result !== undefined) assertJsonValue(result, "TypeScript result");
    if (state !== undefined) assertJsonValue(state, "TypeScript state");
    send({ kind: "result", result, state });
  })().catch((error: unknown) => send({ kind: "failed", error: errors(error) })).finally(() => { active = undefined; });
});
