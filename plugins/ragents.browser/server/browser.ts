import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BROWSER_OPERATIONS,
  type BrowserCheck,
  type BrowserCheckResult,
  type BrowserPageState,
  type BrowserSnapshot,
  type BrowserStep,
  type BrowserTarget,
  type BrowserViewport,
} from "@ragents/workspace-executor";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { documentsApiPrefix } from "@ragents/plugins/ragents.documents/contract.js";
import type { BrowserCallOptions, BrowserEvidence, BrowserRuntime } from "./contract.js";

export const DEFAULT_VIEWPORT: BrowserViewport = { width: 1920, height: 1080 };

interface SavedCapture {
  name: string;
  path: string;
}

/** Was der Server von der Seite eines Runs weiß: den zuletzt gemeldeten Stand und die Zeit der letzten bestandenen Prüfung. */
interface ObservedPage {
  url: string;
  checkedAt?: string;
  errors: string[];
  screenshots: string[];
}

export interface BrowserOptions {
  sandbox: Pick<SandboxServices, "execute">;
  filesFor: (runId: string) => Promise<string>;
}

const capturePath = (id: string): string => `browser/${id}.png`;

/** Die Browserprüfung eines Runs: die Seite lebt beim Executor des Runs, Evidenz, Aufnahmen und Viewport hält der Server. */
export class RunBrowser implements BrowserRuntime {
  readonly #options: BrowserOptions;
  readonly #pages = new Map<string, ObservedPage>();
  readonly #viewports = new Map<string, BrowserViewport>();
  readonly #captures = new Map<string, SavedCapture[]>();
  readonly #captureLoads = new Map<string, Promise<void>>();
  readonly #captureWrites = new Map<string, Promise<void>>();
  readonly #generations = new Map<string, number>();
  #shutdown = false;

  constructor(options: BrowserOptions) {
    this.#options = options;
  }

  restore(runId: string): Promise<void> {
    const loading = this.#captureLoads.get(runId);
    if (loading) return loading;
    const pending = this.#restore(runId).catch((error) => { this.#captureLoads.delete(runId); throw error; });
    this.#captureLoads.set(runId, pending);
    return pending;
  }

  async open(runId: string, url: string, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    options.signal?.throwIfAborted();
    this.#assertRunning();
    const generation = this.#generation(runId);
    await this.restore(runId);
    options.signal?.throwIfAborted();
    this.#assertRunning();
    if (generation !== this.#generation(runId)) throw new Error("Der Browser wurde beendet.");
    return this.#run(runId, BROWSER_OPERATIONS.open, { url, viewport: this.#viewports.get(runId) ?? DEFAULT_VIEWPORT }, options);
  }

  snapshot(runId: string, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.snapshot, null, options);
  }

  /** Der gewählte Viewport gilt für den Run, auch für einen später neu gestarteten Browser. */
  async viewport(runId: string, viewport: BrowserViewport, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    const snapshot = await this.#run<BrowserSnapshot>(runId, BROWSER_OPERATIONS.viewport, viewport, options);
    this.#viewports.set(runId, viewport);
    return snapshot;
  }

  click(runId: string, target: BrowserTarget, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.click, { target }, options);
  }

  fill(runId: string, target: BrowserTarget, value: string, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.fill, { target, value }, options);
  }

  select(runId: string, target: BrowserTarget, label: string, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.select, { target, label }, options);
  }

  press(runId: string, target: BrowserTarget, key: string, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.press, { target, key }, options);
  }

  /** Die Zeit einer bestandenen Prüfung ist die des Servers, damit sie sich mit seinen übrigen Zeiten vergleichen lässt. */
  async check(runId: string, input: BrowserCheck, options: BrowserCallOptions = {}): Promise<{ checkedAt: string; url: string; assertions: string[] }> {
    const generation = this.#generation(runId);
    const { result, page } = await this.#execute<BrowserCheckResult>(runId, generation, BROWSER_OPERATIONS.check, input, options);
    const checkedAt = new Date().toISOString();
    this.#observe(runId, generation, page, checkedAt);
    return { checkedAt, url: result.url, assertions: result.assertions };
  }

  async screenshot(runId: string, input: { label?: string; fullPage?: boolean }, options: BrowserCallOptions = {}): Promise<{
    name: string;
    path: string;
    url: string;
    markdown: string;
    capturedAt: string;
  }> {
    await this.restore(runId);
    const id = randomUUID();
    const image = await this.#run<string>(runId, BROWSER_OPERATIONS.screenshot, { id, fullPage: input.fullPage ?? false }, options);
    const capture = { name: input.label?.trim() || "Browseraufnahme", path: capturePath(id) };
    await this.#store(runId, capture, Buffer.from(image, "base64"));
    const url = this.#captureUrl(runId, capture.path);
    return {
      ...capture,
      url,
      markdown: `![${capture.name.replace(/[\[\]\\]/g, "")}](${url})`,
      capturedAt: new Date().toISOString(),
    };
  }

  async image(runId: string): Promise<Buffer> {
    const latest = this.#captures.get(runId)?.at(-1);
    if (!latest) throw new Error("Für diesen Run gibt es noch keinen Browser-Screenshot. Zuerst browser_screenshot aufrufen.");
    return readFile(path.join(await this.#options.filesFor(runId), latest.path));
  }

  evidence(runId: string): BrowserEvidence {
    const captures = this.#captures.get(runId) ?? [];
    const shown = (capture: SavedCapture) => ({ name: capture.name, url: this.#captureUrl(runId, capture.path) });
    const screenshots = captures.map(shown);
    const page = this.#pages.get(runId);
    if (!page) return { screenshots, currentScreenshots: [], errors: [] };
    const current = page.screenshots
      .map((id) => captures.find((capture) => capture.path === capturePath(id)))
      .filter((capture): capture is SavedCapture => capture !== undefined);
    return {
      ...(page.checkedAt ? { checkedAt: page.checkedAt } : {}),
      url: page.url,
      screenshots,
      currentScreenshots: current.map(shown),
      errors: [...page.errors],
    };
  }

  /** Schließt den Browser beim Executor des Runs; ein nicht verbundener Arbeitsplatz hält nichts, was sich jetzt schließen ließe. */
  async close(runId: string): Promise<void> {
    this.#forget(runId);
    await this.#options.sandbox.execute(runId, BROWSER_OPERATIONS.close, null, { whenReachable: true });
  }

  async delete(runId: string): Promise<void> {
    await this.close(runId);
    this.#viewports.delete(runId);
    this.#captures.delete(runId);
    this.#captureLoads.delete(runId);
    this.#captureWrites.delete(runId);
  }

  async shutdown(): Promise<void> {
    this.#shutdown = true;
    const results = await Promise.allSettled([...this.#pages.keys()].map((runId) => this.close(runId)));
    this.#viewports.clear();
    this.#captures.clear();
    this.#captureLoads.clear();
    this.#captureWrites.clear();
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  #assertRunning(): void {
    if (this.#shutdown) throw new Error("Der Browserdienst ist beendet.");
  }

  #generation(runId: string): number {
    return this.#generations.get(runId) ?? 0;
  }

  /** Ein geschlossener Browser hat keine Seite mehr; Ergebnisse, die vorher begonnen haben, zählen danach nicht. */
  #forget(runId: string): void {
    this.#generations.set(runId, this.#generation(runId) + 1);
    this.#pages.delete(runId);
  }

  async #run<T>(runId: string, operation: string, input: unknown, options: BrowserCallOptions): Promise<T> {
    const generation = this.#generation(runId);
    const { result, page } = await this.#execute<T>(runId, generation, operation, input, options);
    this.#observe(runId, generation, page);
    return result;
  }

  async #execute<T>(runId: string, generation: number, operation: string, input: unknown, options: BrowserCallOptions): Promise<BrowserStep<T>> {
    try {
      return await this.#options.sandbox.execute(runId, operation, input, options) as BrowserStep<T>;
    } catch (error) {
      await this.#resync(runId, generation);
      throw error;
    }
  }

  /** Nach einem gescheiterten Aufruf fragt der Server den Stand der Seite nach; wer ihn nicht nennen kann, hat keine Seite. */
  async #resync(runId: string, generation: number): Promise<void> {
    const page = await this.#options.sandbox.execute(runId, BROWSER_OPERATIONS.state, null, { whenReachable: true })
      .then((value) => value as BrowserPageState | null, () => null);
    this.#observe(runId, generation, page);
  }

  /** Nur eine bestandene Prüfung setzt die Zeit; jeder andere Stand behält sie, solange die Seite geprüft bleibt. */
  #observe(runId: string, generation: number, page: BrowserPageState | null, checkedAt?: string): void {
    if (generation !== this.#generation(runId)) return;
    if (!page) {
      this.#pages.delete(runId);
      return;
    }
    const stamp = page.checked ? checkedAt ?? this.#pages.get(runId)?.checkedAt : undefined;
    this.#pages.set(runId, {
      url: page.url,
      errors: page.errors,
      screenshots: page.screenshots,
      ...(stamp ? { checkedAt: stamp } : {}),
    });
  }

  /** Legt eine Aufnahme in die Dateiablage des Runs und schreibt die Aufnahmeliste atomar; die Aufnahmen eines Runs der Reihe nach. */
  #store(runId: string, capture: SavedCapture, image: Buffer): Promise<void> {
    const previous = this.#captureWrites.get(runId) ?? Promise.resolve();
    const pending = previous.then(async () => {
      const directory = await this.#options.filesFor(runId);
      await mkdir(path.join(directory, "browser"), { recursive: true });
      await writeFile(path.join(directory, capture.path), image);
      const captures = [...this.#captures.get(runId) ?? [], capture];
      const manifest = path.join(directory, "browser", ".captures.json");
      const temporary = `${manifest}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(captures), "utf8");
      await rename(temporary, manifest);
      this.#captures.set(runId, captures);
    });
    this.#captureWrites.set(runId, pending.then(() => undefined, () => undefined));
    return pending;
  }

  #captureUrl(runId: string, filename: string): string {
    return `${documentsApiPrefix}/runs/${encodeURIComponent(runId)}/files/content?path=${encodeURIComponent(filename)}`;
  }

  async #restore(runId: string): Promise<void> {
    const directory = await this.#options.filesFor(runId);
    const manifest = path.join(directory, "browser", ".captures.json");
    let content: string;
    try { content = await readFile(manifest, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#captures.set(runId, []);
      return;
    }
    const captures: unknown = JSON.parse(content);
    if (!Array.isArray(captures) || captures.some((entry) => !entry || typeof entry.name !== "string"
      || typeof entry.path !== "string" || !/^browser\/[a-f0-9-]{36}\.png$/.test(entry.path))) {
      throw new Error("Die gespeicherte Browser-Aufnahmeliste dieses Runs ist beschädigt.");
    }
    this.#captures.set(runId, captures);
  }
}
