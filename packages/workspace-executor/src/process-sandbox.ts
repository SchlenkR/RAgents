import type { WorkspaceProcessContext } from "./context.js";

/** A program with its arguments, as it is started. */
export interface ProcessLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

/** How an executor puts the processes of a run into its sandbox; the context carries it, every start asks it. */
export interface ProcessSandbox {
  readonly wrap: (launch: ProcessLaunch) => Promise<ProcessLaunch>;
}

/** The start of a process in the context of a run: wrapped with a sandbox, unchanged without one. */
export const sandboxedLaunch = (context: WorkspaceProcessContext, launch: ProcessLaunch): Promise<ProcessLaunch> =>
  context.sandbox ? context.sandbox.wrap(launch) : Promise.resolve(launch);
