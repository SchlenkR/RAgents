export interface Workspaces {
    ensure(runId: string, workspacePath: string | null): string;
    /** How the run's workspace is described to a model; undefined when nothing describes it. */
    description(runId: string): string | undefined;
    /** The folder on this machine where a driver keeps its own work; the workspace itself may lie on another machine. */
    runtimeDirectory(runId: string): Promise<string>;
    /** Stores an attached file under attachments/ of the workspace, on the machine where the workspace lies; returns its name there. */
    storeAttachment(runId: string, name: string, content: Uint8Array): Promise<string>;
}

export class FixedWorkspaces implements Workspaces {
    readonly #path: string;

    constructor(path: string = process.cwd()) {
        this.#path = path;
    }

    ensure() {
        return this.#path;
    }

    description() {
        return undefined;
    }

    runtimeDirectory() {
        return Promise.resolve(this.#path);
    }

    storeAttachment(): Promise<string> {
        return Promise.reject(new Error("Ein fester Arbeitsbereich ohne Executor nimmt keine Dateianhänge an."));
    }
}
