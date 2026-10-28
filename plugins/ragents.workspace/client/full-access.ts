import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DomainError } from "../../../packages/ragents/src/runtime/domain-error";

export type FullAccessPolicy = "ask" | "allow" | "deny";

export interface FullAccessRun {
  readonly runId: string;
  readonly name: string;
}

export interface FullAccessOptions {
  readonly fullAccess?: () => FullAccessPolicy;
  readonly confirmFullAccess?: (run: FullAccessRun) => Promise<boolean>;
}

const refused = (): DomainError => new DomainError("workspace-full-access-refused",
  "This workstation has not allowed full access. Switch the run back to Isolated, confirm full access in VS Code "
    + "(ragents.workstation.fullAccess), or start the headless workstation with --allow-full-access.", 403);

export class FullAccessConfirmations {
  readonly #pending = new Map<string, Promise<void>>();
  readonly #revisions = new Map<string, number>();

  constructor(
    private readonly runsDirectory: string,
    private readonly origin: string,
    private readonly options: FullAccessOptions,
  ) {}

  async confirmedRuns(): Promise<readonly string[]> {
    try {
      return (await readdir(this.#directory())).flatMap((name) => {
        const match = /^([A-Za-z0-9_-]{1,64})\.txt$/.exec(name);
        return match ? [match[1]!] : [];
      }).sort();
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
  }

  async accept(run: FullAccessRun): Promise<void> {
    const policy = this.options.fullAccess?.() ?? "ask";
    if (policy === "deny") throw refused();
    const pending = this.#pending.get(run.runId);
    if (pending) return pending;
    const accepting = this.#accept(run, policy, this.#revisions.get(run.runId) ?? 0).finally(() => { this.#pending.delete(run.runId); });
    this.#pending.set(run.runId, accepting);
    return accepting;
  }

  async forget(runId: string): Promise<void> {
    this.#revisions.set(runId, (this.#revisions.get(runId) ?? 0) + 1);
    await rm(this.#file(runId), { force: true });
  }

  async #accept(run: FullAccessRun, policy: FullAccessPolicy, revision: number): Promise<void> {
    const file = this.#file(run.runId);
    try {
      if (await readFile(file, "utf8") === "confirmed\n") {
        if (this.options.fullAccess?.() === "deny") throw refused();
        return;
      }
      throw new DomainError("workspace-full-access-confirmation-invalid", "The local full access confirmation is invalid. Remove it and confirm the run again in VS Code.", 409);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    }
    if (policy !== "allow" && !await this.options.confirmFullAccess?.(run)) throw refused();
    if (this.options.fullAccess?.() === "deny" || (this.#revisions.get(run.runId) ?? 0) !== revision) throw refused();
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, "confirmed\n", { mode: 0o600 });
    if ((this.#revisions.get(run.runId) ?? 0) !== revision) {
      await rm(file, { force: true });
      throw refused();
    }
  }

  #file(runId: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(runId)) throw new DomainError("workspace-run-id-invalid", "The run ID is not usable as a folder name.", 400);
    return join(this.#directory(), `${runId}.txt`);
  }

  #directory(): string {
    const server = createHash("sha256").update(this.origin).digest("hex");
    return join(this.runsDirectory, "..", "full-access", server);
  }
}
