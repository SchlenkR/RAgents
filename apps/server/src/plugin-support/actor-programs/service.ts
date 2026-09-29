import { serviceToken, type ActorProgramExecutor, type CommandContext } from "@ragents/engine";
import type { ActorProgramIdentity } from "./contract.js";
export interface ActorProgramSource {
    path: string;
    content: string;
}
export interface ActivatedActorProgram {
    name: string;
    actorId: string;
    actorHandle: string;
    views: number;
}
export interface RunScriptSources {
    entryId: string;
    handle: string;
    files: readonly ActorProgramSource[];
    programs: readonly { name: string; files: readonly ActorProgramSource[] }[];
    sharedPrograms: readonly string[];
}
export interface RunScriptStartInput {
    content: string;
    embedded: boolean;
    startedBy: string;
}
export interface ActorProgramsService extends ActorProgramExecutor {
    workspaceDirectory(runId: string): Promise<string>;
    importPackage(context: CommandContext, runId: string, name: string, files: readonly ActorProgramSource[], signal?: AbortSignal): Promise<ActivatedActorProgram>;
    /** Installs a run script with its bundled programs, or reuses what the same script installed before; a failure leaves the run unchanged. */
    installScript(context: CommandContext, runId: string, script: RunScriptSources, signal?: AbortSignal): Promise<ActivatedActorProgram>;
    /** Queues a start input for the installed script so that its program recognizes it as a start; an embedded start also places its main view. */
    enqueueStart(context: CommandContext, runId: string, handle: string, start: RunScriptStartInput): { count: number };
    /** Whether a run script installed this TypeScript actor's package in the run. */
    isScriptActor(runId: string, actorId: string): boolean;
    /** Which package the actor runs and where it came from; a package changed in the run counts as created in the run. Authorize by this, never by handle. */
    programOf(runId: string, actorId: string): ActorProgramIdentity | undefined;
}
export const actorProgramsToken = serviceToken<ActorProgramsService>("ragents.actor-programs.runtime");
