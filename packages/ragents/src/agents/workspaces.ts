export interface Workspaces {
    ensure(runId: string, workspacePath: string | null): string;
    /** How the run's workspace is described to a model; undefined when nothing describes it. */
    description(runId: string): string | undefined;
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

    storeAttachment(): Promise<string> {
        return Promise.reject(new Error("A fixed workspace without an executor does not accept file attachments."));
    }
}
