import type { JsonValue } from "../domain/json.ts";
import type { RunCapabilityDescriptor, RunInvocationKind, RunPrincipalKind } from "./run-context.ts";
import type { NativeTypeScriptProgram } from "./native-program.ts";

export type { NativeTypeScriptProgram } from "./native-program.ts";

export interface NativeTypeScriptRequest {
    readonly program: NativeTypeScriptProgram;
    readonly input: unknown;
    readonly state?: unknown;
    readonly context: {
        readonly runId: string;
        readonly invocationId: string;
        readonly invocationKind: RunInvocationKind;
        readonly actor?: { readonly id: string; readonly handle: string };
        readonly principal: { readonly id: string; readonly kind: RunPrincipalKind };
        readonly capabilities: readonly RunCapabilityDescriptor[];
    };
    readonly std?: { readonly now: string; readonly idPrefix: string };
    readonly cwd?: string;
    readonly instanceId?: string;
}

export interface NativeTypeScriptBinding {
    readonly signal?: AbortSignal | undefined;
    readonly call: (name: string, input: JsonValue) => Promise<JsonValue>;
    readonly log: (value: unknown) => void;
}

export interface NativeTypeScriptResult {
    readonly result: unknown;
    readonly state: unknown;
}

export interface NativeTypeScriptExecutor {
    execute(request: NativeTypeScriptRequest, binding: NativeTypeScriptBinding): Promise<NativeTypeScriptResult>;
    stopRun(runId: string): Promise<void>;
    stopInstance(runId: string, instanceId: string): Promise<void>;
    shutdown(): Promise<void>;
}
