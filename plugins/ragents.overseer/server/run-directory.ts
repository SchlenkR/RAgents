import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DomainError, isRunId } from "@aicontainer/ragents";
import type { SessionInfo } from "@aicontainer/server/chat-handler.js";

export class RunDirectory {
  private references: string[] | undefined;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  async describe(runs: readonly SessionInfo[]): Promise<Array<SessionInfo & { reference: string }>> {
    const operation = this.pending.then(async () => {
      if (!this.references) {
        try {
          const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
          if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string" && isRunId(entry))
            || new Set(parsed).size !== parsed.length) throw new Error("Die Laufreferenzen haben ein ungültiges Format");
          this.references = parsed;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          this.references = [];
        }
      }
      const references = [...this.references];
      for (const run of runs) if (!references.includes(run.id)) references.push(run.id);
      if (references.length !== this.references.length) {
        await mkdir(path.dirname(this.file), { recursive: true });
        await writeFile(`${this.file}.tmp`, JSON.stringify(references), { mode: 0o600 });
        await rename(`${this.file}.tmp`, this.file);
        this.references = references;
      }
      return runs.map((run) => ({ ...run, reference: `Lauf ${references.indexOf(run.id) + 1}` }));
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }

  async resolve(name: string, runs: readonly SessionInfo[]): Promise<SessionInfo & { reference: string }> {
    const entries = await this.describe(runs);
    const wanted = name.trim().toLocaleLowerCase("de");
    const exactReference = entries.find((entry) => entry.reference.toLocaleLowerCase("de") === wanted);
    if (exactReference) return exactReference;
    const matching = entries.filter((entry) => entry.title.toLocaleLowerCase("de") === wanted);
    if (matching.length === 1) return matching[0];
    const valid = (matching.length > 1 ? matching : entries).map((entry) => `${entry.reference}: ${entry.title}`).join(", ");
    throw new DomainError(matching.length > 1 ? "ambiguous-run" : "run-not-found", `${matching.length > 1 ? "Der Lauftitel ist mehrdeutig" : "Der Lauf ist unbekannt"}. Verfügbare Läufe: ${valid || "keine"}`, matching.length > 1 ? 409 : 404);
  }
}
