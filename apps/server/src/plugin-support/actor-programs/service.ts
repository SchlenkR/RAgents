import { serviceToken, type ActorProgramExecutor, type CommandContext } from "@aicontainer/ragents";
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
export interface ActorProgramsService extends ActorProgramExecutor {
    workspaceDirectory(runId: string): Promise<string>;
    importPackage(context: CommandContext, runId: string, name: string, files: readonly ActorProgramSource[], signal?: AbortSignal, scriptEntryId?: string): Promise<ActivatedActorProgram>;
}
export const actorProgramsToken = serviceToken<ActorProgramsService>("ragents.actor-programs.runtime");
