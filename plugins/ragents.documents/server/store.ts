import { mkdir } from "node:fs/promises";
import path from "node:path";
import { isRunId } from "@ragents/engine";
import type { DocumentStore, DocumentStoreDescription } from "@ragents/host/ragents/document-store.js";

export interface RunDocumentStoreOptions {
  sessionDirectory: (runId: string) => string;
  sessionsDirectoryPattern: string;
  externalRoot: string | undefined;
}

export class RunDocumentStore implements DocumentStore {
  readonly #options: RunDocumentStoreOptions;

  constructor(options: RunDocumentStoreOptions) {
    this.#options = options;
  }

  async directoryFor(runId: string): Promise<string> {
    if (!isRunId(runId)) throw new Error(`Ungültige Run-ID: ${runId}`);
    const directory = this.#options.externalRoot
      ? path.join(this.#options.externalRoot, runId)
      : this.#options.sessionDirectory(runId);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  describe(): DocumentStoreDescription {
    return {
      directoryPattern: this.#options.externalRoot
        ? path.join(this.#options.externalRoot, "{runId}")
        : this.#options.sessionsDirectoryPattern,
    };
  }
}
