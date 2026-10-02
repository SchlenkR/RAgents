import { serviceToken, type ActorProgramExecutor, type CommandContext } from "@ragents/engine";
import type { ActorProgramIdentity } from "./contract.js";
export interface ActorProgramSource {
    path: string;
    content: string;
}
/** name is the package key and actorHandle the actor's address, both as seen from the main room: room.name in a room. */
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
/** An activated view as a caller addresses it: its canonical package-name/view-key reference, the surface element ID of its tab, and whether it is shown. */
export interface ActorViewReference {
    reference: string;
    elementId: string;
    visible: boolean;
}
export interface ActorProgramsService extends ActorProgramExecutor {
    workspaceDirectory(runId: string): Promise<string>;
    importPackage(context: CommandContext, runId: string, name: string, files: readonly ActorProgramSource[], signal?: AbortSignal): Promise<ActivatedActorProgram>;
    /** Installs a run script with its bundled programs in a new room opened from `origin`, shared packages in the main room; a failure leaves the run unchanged. */
    installScript(context: CommandContext, runId: string, script: RunScriptSources, origin: string | null, signal?: AbortSignal): Promise<ActivatedActorProgram>;
    /** Queues a start input for the installed script, named by its package key, so that its program recognizes it as a start. */
    enqueueStart(context: CommandContext, runId: string, name: string, start: RunScriptStartInput): { count: number };
    /** Whether a run script installed this TypeScript actor's package in the run. */
    isScriptActor(runId: string, actorId: string): boolean;
    /** Which package the actor runs and where it came from; a package changed in the run counts as created in the run. Authorize by this, never by handle. */
    programOf(runId: string, actorId: string): ActorProgramIdentity | undefined;
    /** Resolves package-name/view-key, @handle/view-key or a unique title, as written from the room of `callerId`; an unknown or ambiguous reference is an error that names the candidates. */
    resolveView(runId: string, reference: string, callerId?: string): ActorViewReference;
}
export const actorProgramsToken = serviceToken<ActorProgramsService>("ragents.actor-programs.runtime");
