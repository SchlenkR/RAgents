export interface Workspaces {
    ensure(runId: string, workspacePath: string | null): string;
}

export class FixedWorkspaces implements Workspaces {
    readonly #path: string;

    constructor(path: string = process.cwd()) {
        this.#path = path;
    }

    ensure() {
        return this.#path;
    }
}
