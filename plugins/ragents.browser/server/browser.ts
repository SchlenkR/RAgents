import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BYTE_OPERATIONS, type FileBytes } from "@ragents/workspace-executor";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { DOCUMENTS_ALIAS, contentPathOf, documentsApiPrefix } from "@ragents/plugins/ragents.documents/contract.js";
import {
  BROWSER_OPERATIONS,
  type BrowserCheck,
  type BrowserCheckResult,
  type BrowserPageState,
  type BrowserSnapshot,
  type BrowserStep,
  type BrowserTarget,
  type BrowserTyping,
  type BrowserViewport,
} from "../executor/contract.js";
import type { BrowserCallOptions, BrowserEvidence, BrowserRuntime } from "./contract.js";

export const DEFAULT_VIEWPORT: BrowserViewport = { width: 1920, height: 1080 };

/** A stored screenshot: the id the page knows it by and where it lies, named as read names a file. */
interface SavedCapture {
  id: string;
  name: string;
  reference: string;
}

/** The capture list of a run stored before references named its files relative to the document store. */
const formerCapture = /^browser\/([a-f0-9-]{36})\.png$/;

const savedCaptureOf = (entry: unknown): SavedCapture => {
  const { id, name, reference, path: stored } = (entry ?? {}) as { id?: unknown; name?: unknown; reference?: unknown; path?: unknown };
  if (typeof name !== "string") throw new Error("The stored browser screenshot list of this run is corrupt.");
  if (typeof id === "string" && id !== "" && typeof reference === "string" && reference !== "") return { id, name, reference };
  const former = typeof stored === "string" ? formerCapture.exec(stored) : null;
  if (!former) throw new Error("The stored browser screenshot list of this run is corrupt.");
  return { id: former[1]!, name, reference: `${DOCUMENTS_ALIAS}/${stored}` };
};

/** What the server knows about a run's page: the last reported state and the time of the last passed check. */
interface ObservedPage {
  url: string;
  checkedAt?: string;
  errors: string[];
  screenshots: string[];
}

export interface BrowserOptions {
  sandbox: Pick<SandboxServices, "execute">;
  /** The document store, where the capture list of a run lies. */
  filesFor: (runId: string) => Promise<string>;
}

/** A run's browser testing: the page lives in the run's executor, the server holds evidence, screenshots and viewport. */
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

  async navigate(runId: string, url: string, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    options.signal?.throwIfAborted();
    this.#assertRunning();
    const generation = this.#generation(runId);
    await this.restore(runId);
    options.signal?.throwIfAborted();
    this.#assertRunning();
    if (generation !== this.#generation(runId)) throw new Error("The browser was closed.");
    return this.#run(runId, BROWSER_OPERATIONS.navigate, { url, viewport: this.#viewports.get(runId) ?? DEFAULT_VIEWPORT }, options);
  }

  snapshot(runId: string, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.snapshot, null, options);
  }

  /** The chosen viewport applies to the run, including a browser restarted later. */
  async resize(runId: string, viewport: BrowserViewport, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    const snapshot = await this.#run<BrowserSnapshot>(runId, BROWSER_OPERATIONS.resize, viewport, options);
    this.#viewports.set(runId, viewport);
    return snapshot;
  }

  click(runId: string, target: BrowserTarget, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.click, { target }, options);
  }

  type(runId: string, target: BrowserTarget, typing: BrowserTyping, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.type, { target, ...typing }, options);
  }

  selectOption(runId: string, target: BrowserTarget, values: readonly string[], options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.selectOption, { target, values }, options);
  }

  pressKey(runId: string, target: BrowserTarget | undefined, key: string, options: BrowserCallOptions = {}): Promise<BrowserSnapshot> {
    return this.#run(runId, BROWSER_OPERATIONS.pressKey, { ...(target ? { target } : {}), key }, options);
  }

  /** The time of a passed check is the server's, so it compares with its other times. */
  async check(runId: string, input: BrowserCheck, options: BrowserCallOptions = {}): Promise<{ checkedAt: string; url: string; assertions: string[] }> {
    const generation = this.#generation(runId);
    const { result, page } = await this.#execute<BrowserCheckResult>(runId, generation, BROWSER_OPERATIONS.check, input, options);
    const checkedAt = new Date().toISOString();
    this.#observe(runId, generation, page, checkedAt);
    return { checkedAt, url: result.url, assertions: result.assertions };
  }

  /** Stores the PNG where `filename` names it, at the machine of that root; without one under the document store. */
  async takeScreenshot(runId: string, input: { label?: string; fullPage?: boolean; filename?: string }, options: BrowserCallOptions = {}): Promise<{
    name: string;
    reference: string;
    url: string;
  }> {
    await this.restore(runId);
    const id = randomUUID();
    const image = await this.#run<string>(runId, BROWSER_OPERATIONS.takeScreenshot, { id, fullPage: input.fullPage ?? false }, options);
    const capture = { id, name: input.label?.trim() || "Browser screenshot", reference: input.filename ?? `${DOCUMENTS_ALIAS}/browser/${id}.png` };
    await this.#store(runId, capture, image, options);
    return { name: capture.name, reference: capture.reference, url: this.#captureUrl(runId, capture.reference) };
  }

  /** The latest screenshot, read where it lies. */
  async image(runId: string, options: BrowserCallOptions = {}): Promise<Buffer> {
    const latest = this.#captures.get(runId)?.at(-1);
    if (!latest) throw new Error("There is no browser screenshot for this run yet. Call browser_take_screenshot first.");
    const bytes = await this.#options.sandbox.execute(runId, BYTE_OPERATIONS.read, { path: latest.reference }, options) as FileBytes;
    if (bytes.kind !== "file") throw new Error(`The latest browser screenshot ${latest.reference} is no longer a file.`);
    return Buffer.from(bytes.content, "base64");
  }

  evidence(runId: string): BrowserEvidence {
    const captures = this.#captures.get(runId) ?? [];
    const shown = (capture: SavedCapture) => ({ name: capture.name, url: this.#captureUrl(runId, capture.reference) });
    const screenshots = captures.map(shown);
    const page = this.#pages.get(runId);
    if (!page) return { screenshots, currentScreenshots: [], errors: [] };
    const current = page.screenshots
      .map((id) => captures.find((capture) => capture.id === id))
      .filter((capture): capture is SavedCapture => capture !== undefined);
    return {
      ...(page.checkedAt ? { checkedAt: page.checkedAt } : {}),
      url: page.url,
      screenshots,
      currentScreenshots: current.map(shown),
      errors: [...page.errors],
    };
  }

  /** Closes the browser in the run's executor; a disconnected workspace holds nothing that could be closed now. */
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
    if (this.#shutdown) throw new Error("The browser service has ended.");
  }

  #generation(runId: string): number {
    return this.#generations.get(runId) ?? 0;
  }

  /** A closed browser has no page anymore; results that started before no longer count afterwards. */
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

  /** After a failed call the server asks for the page state; whoever cannot report it has no page. */
  async #resync(runId: string, generation: number): Promise<void> {
    const page = await this.#options.sandbox.execute(runId, BROWSER_OPERATIONS.state, null, { whenReachable: true })
      .then((value) => value as BrowserPageState | null, () => null);
    this.#observe(runId, generation, page);
  }

  /** Only a passed check sets the time; every other state keeps it as long as the page stays checked. */
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

  /** Writes a screenshot (Base64) where its reference names it and the screenshot list atomically; a run's screenshots one after another. */
  #store(runId: string, capture: SavedCapture, image: string, options: BrowserCallOptions): Promise<void> {
    const previous = this.#captureWrites.get(runId) ?? Promise.resolve();
    const pending = previous.then(async () => {
      await this.#options.sandbox.execute(runId, BYTE_OPERATIONS.write, { path: capture.reference, content: { kind: "file", content: image } }, options);
      const directory = await this.#options.filesFor(runId);
      await mkdir(path.join(directory, "browser"), { recursive: true });
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

  #captureUrl(runId: string, reference: string): string {
    return contentPathOf(documentsApiPrefix, runId, reference);
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
    if (!Array.isArray(captures)) throw new Error("The stored browser screenshot list of this run is corrupt.");
    this.#captures.set(runId, captures.map(savedCaptureOf));
  }
}
