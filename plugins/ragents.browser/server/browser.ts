import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { safeProcessEnvironment } from "@aicontainer/server/plugin-support/safe-environment.js";
import { RUN_MARKER_ENV } from "@aicontainer/server/plugin-support/run-marker.js";
import { documentsApiPrefix } from "@aicontainer/plugins/ragents.documents/server/files-route.js";
import type { BrowserEvidence, BrowserRuntime, BrowserSnapshot, BrowserTarget } from "./contract.js";

export interface BrowserViewport {
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORT: BrowserViewport = { width: 1920, height: 1080 };

interface BrowserSession {
  browser: Promise<Browser>;
  page?: Page;
  viewport: BrowserViewport;
  queue: Promise<void>;
  closed: boolean;
  errors: string[];
  screenshots: { name: string; url: string }[];
  checkedAt?: string;
}

interface SavedCapture {
  name: string;
  path: string;
}

export interface BrowserOptions {
  filesFor: (runId: string) => Promise<string>;
  executablePath?: string;
  timeoutMs?: number;
  checkTimeoutMs?: number;
  launch?: (runId: string) => Promise<Browser>;
}

export interface BrowserCheck {
  target?: BrowserTarget;
  text?: string;
  url?: string;
  count?: number;
  noErrors?: boolean;
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const maxSnapshotLength = 40_000;
const ambiguityHint = "Wähle mit nth (0-basiert) oder first: true im Ziel einen Treffer, oder prüfe die Anzahl mit count in browser_check.";

const withAmbiguityHint = (error: unknown): never => {
  if (error instanceof Error && error.message.includes("strict mode violation")) throw new Error(`${error.message}\n${ambiguityHint}`, { cause: error });
  throw error;
};

export const browserLocator = (page: Page, target: BrowserTarget): Locator => {
  const selectors = [target.role, target.label, target.text, target.testId, target.css].filter((value) => value !== undefined);
  if (selectors.length !== 1 || (target.name !== undefined && target.role === undefined)) {
    throw new Error("Ein Browserziel braucht genau role (optional name), label, text, testId oder css.");
  }
  if (target.nth !== undefined && target.first) throw new Error("Ein Browserziel verwendet entweder nth oder first, nicht beides.");
  const root = target.frame ? page.frameLocator(target.frame) : page;
  const base = target.role ? root.getByRole(target.role as Parameters<Page["getByRole"]>[0], { name: target.name, exact: true })
    : target.label ? root.getByLabel(target.label, { exact: true })
      : target.text ? root.getByText(target.text, { exact: true })
        : target.testId ? root.getByTestId(target.testId)
          : root.locator(target.css!);
  return target.first ? base.first() : target.nth !== undefined ? base.nth(target.nth) : base;
};

export class RunBrowser implements BrowserRuntime {
  readonly #options: BrowserOptions;
  readonly #sessions = new Map<string, BrowserSession>();
  readonly #lastScreenshots = new Map<string, string>();
  readonly #captures = new Map<string, SavedCapture[]>();
  readonly #captureLoads = new Map<string, Promise<void>>();
  readonly #versions = new Map<string, number>();
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

  async open(runId: string, url: string, signal?: AbortSignal): Promise<BrowserSnapshot> {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("browser_open braucht eine HTTP- oder HTTPS-Adresse.");
    signal?.throwIfAborted();
    if (this.#shutdown) throw new Error("Der Browserdienst ist beendet.");
    const version = this.#versions.get(runId) ?? 0;
    await this.restore(runId);
    signal?.throwIfAborted();
    if (this.#shutdown) throw new Error("Der Browserdienst ist beendet.");
    if (version !== (this.#versions.get(runId) ?? 0)) throw new Error("Der Browser wurde beendet.");
    if (!this.#sessions.has(runId)) {
      const session: BrowserSession = {
        browser: this.#launch(runId),
        queue: Promise.resolve(),
        closed: false,
        errors: [],
        screenshots: [],
        viewport: DEFAULT_VIEWPORT,
      };
      this.#sessions.set(runId, session);
      void session.browser.catch(() => {
        session.closed = true;
        if (this.#sessions.get(runId) === session) this.#sessions.delete(runId);
      });
    }
    return this.#perform(runId, signal, async (session, page) => {
      this.#resetEvidence(session);
      const response = await page.goto(parsed.href, { waitUntil: "domcontentloaded" });
      if (response && !response.ok()) throw new Error(`Browsernavigation fehlgeschlagen: HTTP ${response.status()} (${page.url()}).`);
      return this.#snapshot(session, page);
    });
  }

  snapshot(runId: string, signal?: AbortSignal): Promise<BrowserSnapshot> {
    return this.#perform(runId, signal, (session, page) => this.#snapshot(session, page));
  }

  viewport(runId: string, viewport: BrowserViewport, signal?: AbortSignal): Promise<BrowserSnapshot> {
    return this.#perform(runId, signal, async (session, page) => {
      session.viewport = viewport;
      await page.setViewportSize(viewport);
      return this.#snapshot(session, page);
    });
  }

  click(runId: string, target: BrowserTarget, signal?: AbortSignal): Promise<BrowserSnapshot> {
    return this.#action(runId, target, signal, (locator) => locator.click());
  }

  fill(runId: string, target: BrowserTarget, value: string, signal?: AbortSignal): Promise<BrowserSnapshot> {
    return this.#action(runId, target, signal, (locator) => locator.fill(value));
  }

  select(runId: string, target: BrowserTarget, label: string, signal?: AbortSignal): Promise<BrowserSnapshot> {
    return this.#action(runId, target, signal, (locator) => locator.selectOption({ label }));
  }

  press(runId: string, target: BrowserTarget, key: string, signal?: AbortSignal): Promise<BrowserSnapshot> {
    return this.#action(runId, target, signal, (locator) => locator.press(key));
  }

  check(runId: string, input: BrowserCheck, signal?: AbortSignal): Promise<{ checkedAt: string; url: string; assertions: string[] }> {
    return this.#perform(runId, signal, async (session, page) => {
      session.checkedAt = undefined;
      if (!input.target && input.text === undefined && input.url === undefined && input.noErrors !== true) {
        throw new Error("browser_check braucht mindestens target, text, url oder noErrors: true.");
      }
      if (input.count !== undefined && (!input.target || input.target.nth !== undefined || input.target.first)) {
        throw new Error("count in browser_check braucht ein target ohne nth oder first und zählt dessen sichtbare Treffer.");
      }
      const timeout = this.#checkTimeout();
      const assertions: string[] = [];
      if (input.target && input.count !== undefined) {
        const visible = browserLocator(page, input.target).filter({ visible: true });
        const found = await this.#waitForCount(visible, input.count, timeout);
        if (found !== input.count) throw new Error(`Erwartet ${input.count} sichtbare Treffer, gefunden ${found}.`);
        assertions.push(`${input.count} sichtbare Treffer`);
      } else if (input.target) {
        const locator = browserLocator(page, input.target);
        await locator.waitFor({ state: "visible", timeout }).catch(withAmbiguityHint);
        assertions.push("Ziel ist sichtbar");
        if (input.text !== undefined) {
          try { await locator.filter({ hasText: input.text }).waitFor({ state: "visible", timeout }); }
          catch (error) { throw new Error(`Erwarteter Text fehlt im Ziel: ${input.text}`, { cause: error }); }
          assertions.push(`Text im Ziel: ${input.text}`);
        }
      } else if (input.text !== undefined) {
        await page.getByText(input.text, { exact: false }).first().waitFor({ state: "visible", timeout });
        assertions.push(`Sichtbarer Text: ${input.text}`);
      }
      if (input.url !== undefined) {
        await page.waitForURL(input.url, { timeout });
        assertions.push(`Adresse: ${input.url}`);
      }
      if (input.noErrors !== false) {
        if (session.errors.length > 0) throw new Error(`Browserfehler: ${session.errors.join("\n")}`);
        assertions.push("Keine erfassten Browser- oder Netzwerkfehler seit der Navigation");
      }
      const checkedAt = new Date().toISOString();
      session.checkedAt = checkedAt;
      return { checkedAt, url: page.url(), assertions };
    });
  }

  screenshot(runId: string, input: { label?: string; fullPage?: boolean }, signal?: AbortSignal): Promise<{
    name: string;
    path: string;
    url: string;
    markdown: string;
    capturedAt: string;
  }> {
    return this.#perform(runId, signal, async (session, page) => {
      const directory = await this.#options.filesFor(runId);
      const filename = `browser/${randomUUID()}.png`;
      const absolute = path.join(directory, filename);
      await mkdir(path.dirname(absolute), { recursive: true });
      await page.screenshot({ path: absolute, fullPage: input.fullPage ?? false, type: "png", timeout: this.#timeout() });
      const name = input.label?.trim() || "Browseraufnahme";
      const url = this.#captureUrl(runId, filename);
      const captures = [...this.#captures.get(runId) ?? [], { name, path: filename }];
      const manifest = path.join(directory, "browser", ".captures.json");
      const temporary = `${manifest}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(captures), "utf8");
      await rename(temporary, manifest);
      this.#captures.set(runId, captures);
      this.#lastScreenshots.set(runId, absolute);
      session.screenshots.push({ name, url });
      return { name, path: filename, url, markdown: `![${name.replace(/[\[\]\\]/g, "")}](${url})`, capturedAt: new Date().toISOString() };
    });
  }

  async image(runId: string): Promise<Buffer> {
    const filename = this.#lastScreenshots.get(runId);
    if (!filename) throw new Error("Für diesen Run gibt es noch keinen Browser-Screenshot. Zuerst browser_screenshot aufrufen.");
    return readFile(filename);
  }

  evidence(runId: string): BrowserEvidence {
    const session = this.#sessions.get(runId);
    const screenshots = (this.#captures.get(runId) ?? []).map((entry) => ({ name: entry.name, url: this.#captureUrl(runId, entry.path) }));
    if (!session || session.closed) return { screenshots, currentScreenshots: [], errors: [] };
    return {
      ...(session.checkedAt ? { checkedAt: session.checkedAt } : {}),
      ...(session.page ? { url: session.page.url() } : {}),
      screenshots,
      currentScreenshots: [...session.screenshots],
      errors: [...session.errors],
    };
  }

  async close(runId: string): Promise<void> {
    this.#versions.set(runId, (this.#versions.get(runId) ?? 0) + 1);
    const session = this.#sessions.get(runId);
    if (!session) return;
    session.closed = true;
    this.#sessions.delete(runId);
    const browser = await session.browser.catch(() => undefined);
    if (browser) await browser.close();
    await session.queue;
  }

  async delete(runId: string): Promise<void> {
    await this.close(runId);
    this.#lastScreenshots.delete(runId);
    this.#captures.delete(runId);
    this.#captureLoads.delete(runId);
  }

  async shutdown(): Promise<void> {
    this.#shutdown = true;
    const results = await Promise.allSettled([...this.#sessions.keys()].map((runId) => this.delete(runId)));
    this.#lastScreenshots.clear();
    this.#captures.clear();
    this.#captureLoads.clear();
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  async #launch(runId: string): Promise<Browser> {
    if (this.#options.launch) return this.#options.launch(runId);
    const executablePath = this.#options.executablePath ?? chromium.executablePath();
    try { await access(executablePath, constants.X_OK); }
    catch { throw new Error("Kein ausführbarer Browser vorhanden. BROWSER_EXECUTABLE_PATH in ragents.browser konfigurieren "
      + "(z.B. Google Chrome) oder im Repo pnpm exec playwright-core install chromium ausführen."); }
    return chromium.launch({
      executablePath,
      headless: true,
      timeout: this.#timeout(),
      env: { ...safeProcessEnvironment(process.env), HOME: homedir(), [RUN_MARKER_ENV]: runId },
    });
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
    const latest = captures.at(-1) as SavedCapture | undefined;
    if (latest) this.#lastScreenshots.set(runId, path.join(directory, latest.path));
  }

  #timeout(): number { return this.#options.timeoutMs ?? 15_000; }

  #checkTimeout(): number { return this.#options.checkTimeoutMs ?? Math.min(5_000, this.#timeout()); }

  async #waitForCount(locator: Locator, expected: number, timeout: number): Promise<number> {
    const deadline = Date.now() + timeout;
    let found = await locator.count();
    while (found !== expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      found = await locator.count();
    }
    return found;
  }

  #resetEvidence(session: BrowserSession): void {
    session.checkedAt = undefined;
    session.screenshots = [];
    session.errors = [];
  }

  async #page(session: BrowserSession): Promise<Page> {
    if (session.closed) throw new Error("Der Browser wurde beendet.");
    if (session.page) return session.page;
    const browser = await session.browser;
    if (session.closed) throw new Error("Der Browser wurde beendet.");
    const context = await browser.newContext({ viewport: session.viewport });
    context.setDefaultTimeout(this.#timeout());
    context.setDefaultNavigationTimeout(this.#timeout());
    const page = await context.newPage();
    const addError = (text: string) => {
      session.errors.push(text.slice(0, 2000));
      if (session.errors.length > 100) session.errors.shift();
    };
    page.on("console", (message) => { if (message.type() === "error") addError(`Konsole: ${message.text()}`); });
    page.on("pageerror", (error) => addError(`JavaScript: ${error.message}`));
    page.on("requestfailed", (request) => addError(`Netzwerk: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
    page.on("response", (response) => { if (response.status() >= 400) addError(`HTTP ${response.status()}: ${response.url()}`); });
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) this.#resetEvidence(session); });
    page.on("popup", (popup) => {
      addError(`Die Anwendung hat ein neues Fenster geöffnet: ${popup.url()}. Popups werden nicht bedient.`);
      void popup.close().catch((error) => addError(`Fenster schließen: ${errorText(error)}`));
    });
    session.page = page;
    return page;
  }

  #perform<T>(runId: string, signal: AbortSignal | undefined, action: (session: BrowserSession, page: Page) => Promise<T>): Promise<T> {
    const session = this.#sessions.get(runId);
    if (!session || session.closed) return Promise.reject(new Error("Für diesen Run ist kein Browser offen. Zuerst browser_open aufrufen."));
    const pending = session.queue.then(async () => {
      signal?.throwIfAborted();
      const abort = () => { void this.close(runId).catch((error) => console.error("Browserstopp fehlgeschlagen:", errorText(error))); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const page = await this.#page(session);
        signal?.throwIfAborted();
        const result = await action(session, page);
        signal?.throwIfAborted();
        if (session.closed) throw new Error("Der Browser wurde beendet.");
        return result;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    });
    session.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  #action(runId: string, target: BrowserTarget, signal: AbortSignal | undefined, action: (locator: Locator) => Promise<unknown>): Promise<BrowserSnapshot> {
    return this.#perform(runId, signal, async (session, page) => {
      session.checkedAt = undefined;
      session.screenshots = [];
      await action(browserLocator(page, target)).catch(withAmbiguityHint);
      return this.#snapshot(session, page);
    });
  }

  async #snapshot(session: BrowserSession, page: Page): Promise<BrowserSnapshot> {
    const snapshot = await page.locator("body").ariaSnapshot({ mode: "ai", timeout: this.#timeout() });
    return { url: page.url(), title: await page.title(), snapshot: snapshot.slice(0, maxSnapshotLength),
      truncated: snapshot.length > maxSnapshotLength, errors: [...session.errors] };
  }
}
