import type { WorkspaceProcessContext } from "./context.js";

/** Ein Programm mit seinen Argumenten, so wie es gestartet wird. */
export interface ProcessLaunch {
  readonly command: string;
  readonly args: readonly string[];
}

/** Wie ein Executor die Prozesse eines Runs in seine Sandbox steckt; der Kontext trägt sie, jeder Start fragt sie. */
export interface ProcessSandbox {
  readonly wrap: (launch: ProcessLaunch) => Promise<ProcessLaunch>;
}

/** Der Start eines Prozesses im Kontext eines Runs: mit Sandbox eingepackt, ohne unverändert. */
export const sandboxedLaunch = (context: WorkspaceProcessContext, launch: ProcessLaunch): Promise<ProcessLaunch> =>
  context.sandbox ? context.sandbox.wrap(launch) : Promise.resolve(launch);
