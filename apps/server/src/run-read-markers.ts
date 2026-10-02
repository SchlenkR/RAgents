import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isRunId } from "@ragents/engine";

/** Changes within this time go to the file together. */
export const READ_MARKERS_WRITE_DELAY_MS = 1_000;

const FORMAT_VERSION = 1;

interface Marker {
  readonly userId: string | null;
  readonly runId: string;
  readonly revision: number;
}

const keyOf = (userId: string | null, runId: string): string => JSON.stringify([userId, runId]);

const validRevision = (revision: unknown): revision is number => Number.isSafeInteger(revision) && (revision as number) >= 0;

const markerFrom = (value: unknown): Marker | undefined => {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || Object.keys(raw).length !== 3) return undefined;
  if ((raw.userId !== null && typeof raw.userId !== "string") || typeof raw.runId !== "string" || !isRunId(raw.runId) || !validRevision(raw.revision)) return undefined;
  return { userId: raw.userId, runId: raw.runId, revision: raw.revision };
};

const markersFrom = (source: string, file: string): Marker[] => {
  const invalid = (cause: string) => new Error(`The read markers in ${file} are invalid (${cause}); delete the file to reset every read marker.`);
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== "object" || raw === null || raw.version !== FORMAT_VERSION || !Array.isArray(raw.markers)) throw invalid(`expected version ${FORMAT_VERSION} with a list of markers`);
  return raw.markers.map((entry, index) => {
    const marker = markerFrom(entry);
    if (!marker) throw invalid(`marker ${index} needs userId, runId, and a revision of at least 0`);
    return marker;
  });
};

/** The highest viewed revision per user and run, kept in one file of the profile's data directory; null is the user without sign-in. */
export class RunReadMarkers {
  readonly #file: string;
  readonly #markers: Map<string, Marker>;
  #dirty = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #writing: Promise<void> = Promise.resolve();

  private constructor(file: string, markers: readonly Marker[]) {
    this.#file = file;
    this.#markers = new Map(markers.map((marker) => [keyOf(marker.userId, marker.runId), marker]));
  }

  static async load(file: string): Promise<RunReadMarkers> {
    try {
      return new RunReadMarkers(file, markersFrom(await readFile(file, "utf8"), file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return new RunReadMarkers(file, []);
    }
  }

  seenRevision(userId: string | null, runId: string): number | undefined {
    return this.#markers.get(keyOf(userId, runId))?.revision;
  }

  /** Only a higher revision counts; the result says whether the marker changed. */
  markViewed(userId: string | null, runId: string, revision: number): boolean {
    if (!validRevision(revision)) throw new Error(`Invalid revision ${revision} for the read marker of run ${runId}`);
    if (revision <= (this.seenRevision(userId, runId) ?? -1)) return false;
    this.#markers.set(keyOf(userId, runId), { userId, runId, revision });
    this.#schedule();
    return true;
  }

  /** Removes the markers of every user for these runs. */
  forgetRuns(runIds: ReadonlySet<string>): void {
    const forgotten = [...this.#markers].filter(([, marker]) => runIds.has(marker.runId));
    for (const [key] of forgotten) this.#markers.delete(key);
    if (forgotten.length > 0) this.#schedule();
  }

  /** Writes what is still pending; the shutdown waits for it. */
  async flush(): Promise<void> {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#dirty) await this.#write();
    await this.#writing;
  }

  #schedule(): void {
    this.#dirty = true;
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#write().catch((error: unknown) => console.warn(`Read markers could not be written to ${this.#file}:`, error));
    }, READ_MARKERS_WRITE_DELAY_MS);
    this.#timer.unref();
  }

  #write(): Promise<void> {
    this.#dirty = false;
    const content = `${JSON.stringify({ version: FORMAT_VERSION, markers: [...this.#markers.values()] })}\n`;
    const written = this.#writing.then(async () => {
      const temporary = `${this.#file}.tmp-${randomUUID()}`;
      try {
        await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
        await writeFile(temporary, content, { mode: 0o600 });
        await rename(temporary, this.#file);
      } catch (error) {
        this.#dirty = true;
        await rm(temporary, { force: true });
        throw error;
      }
    });
    this.#writing = written.catch(() => undefined);
    return written;
  }
}
