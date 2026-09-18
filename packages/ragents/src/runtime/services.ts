import type { ActorProgramExecutor } from "../script/programs.ts";
import { randomUUID } from "node:crypto";
import type { NativeTypeScriptExecutor } from "../typescript/native-executor.ts";

export type RuntimeServices = {
    now: () => string;
    newId: (kind: string) => string;
    actorPrograms?: ActorProgramExecutor;
    nativeTypeScriptExecutor?: NativeTypeScriptExecutor;
};

export const runtimeServices: RuntimeServices = {
    now: () => new Date().toISOString(),
    newId: (kind) => `${kind}_${randomUUID()}`,
};
