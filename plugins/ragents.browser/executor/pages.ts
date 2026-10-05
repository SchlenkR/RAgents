import type { Browser, Locator, Page } from "playwright-core";
import type {
  BrowserCheck,
  BrowserCheckResult,
  BrowserMeasurement,
  BrowserPageState,
  BrowserSnapshot,
  BrowserStep,
  BrowserTarget,
  BrowserTyping,
  BrowserViewport,
} from "./contract.js";

interface BrowserSession {
  readonly browser: Promise<Browser>;
  readonly viewport: BrowserViewport;
  page?: Page;
  queue: Promise<void>;
  closed: boolean;
  checked: boolean;
  errors: string[];
  /** Addresses whose failed request is already reported; HTTP status, console and network report the same cause only once. */
  failedRequests: Set<string>;
  screenshots: string[];
  matchedTargets: Set<string>;
}

export interface BrowserPagesOptions {
  launch: (runId: string) => Promise<Browser>;
  timeoutMs: number;
  checkTimeoutMs: number;
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const endedError = (): Error => new Error("The browser service of this executor has ended.");
const maxSnapshotLength = 40_000;
const maxActionSnapshotLength = 2_000;
const targetKey = (target: BrowserTarget): string => JSON.stringify([target.frame, target.role, target.name, target.label, target.text, target.testId, target.css]);
const concise = (text: string): string => text.replace(/\s+/g, " ").trim().slice(0, 300);
const reportedErrors = (errors: readonly string[]): string[] => [
  ...errors.slice(0, 5).map(concise),
  ...(errors.length > 5 ? [`${errors.length - 5} more page errors`] : []),
];

const conciseFailure = (error: unknown): Error => {
  const message = errorText(error);
  if (!/Timeout|strict mode violation/.test(message)) return error instanceof Error ? error : new Error(message);
  const lines = message.split("\n").map((line) => line.trim());
  if (message.includes("strict mode violation")) return new Error("Target matches several elements. Choose target.nth (0-based), first: true, or a more specific text or role/name target.");
  const cause = lines.findLast((line) => /not visible|not enabled|not editable|intercepts pointer/.test(line))
    ?? lines.findLast((line) => /waiting for|waiting until/.test(line));
  return new Error(`Timed out: ${concise(cause ?? lines[0]!)}. Check that the target exists and is visible and operable.`, { cause: error });
};

const targetFailure = async (error: unknown, locator: Locator): Promise<never> => {
  if (!errorText(error).includes("strict mode violation")) throw conciseFailure(error);
  const candidates = await locator.evaluateAll((elements) => elements.slice(0, 5).map((element, index) => {
    const name = element.getAttribute("aria-label") || element.textContent || element.getAttribute("title") || "";
    return `[${index}] ${element.getAttribute("role") || element.tagName.toLowerCase()} "${name.replace(/\s+/g, " ").trim().slice(0, 80)}"`;
  })).catch(() => []);
  throw new Error(`Target matches several elements${candidates.length ? `: ${candidates.join("; ")}` : ""}.\nChoose target.nth (0-based), first: true, or a more specific text or role/name target.`, { cause: error });
};

export const browserLocator = (page: Page, target: BrowserTarget): Locator => {
  const selectors = [target.role, target.label, target.text, target.testId, target.css].filter((value) => value !== undefined);
  if (selectors.length !== 1 || (target.name !== undefined && target.role === undefined)) {
    throw new Error("A browser target needs exactly one of role (optional name), label, text, testId or css.");
  }
  if (target.nth !== undefined && target.first) throw new Error("A browser target uses either nth or first, not both.");
  const root = target.frame ? page.frameLocator(target.frame) : page;
  const base = target.role ? root.getByRole(target.role as Parameters<Page["getByRole"]>[0], { name: target.name, exact: true })
    : target.label ? root.getByLabel(target.label, { exact: true })
      : target.text ? root.getByText(target.text, { exact: true })
        : target.testId ? root.getByTestId(target.testId)
          : root.locator(target.css!);
  return target.first ? base.first() : target.nth !== undefined ? base.nth(target.nth) : base;
};

/** One browser with one page per run on this machine; a run's actions run one after another. */
export class BrowserPages {
  readonly #options: BrowserPagesOptions;
  readonly #sessions = new Map<string, BrowserSession>();
  #shutDown = false;

  constructor(options: BrowserPagesOptions) {
    this.#options = options;
  }

  async navigate(runId: string, url: string, viewport: BrowserViewport, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    if (this.#shutDown) throw endedError();
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("browser_navigate needs an HTTP or HTTPS address.");
    signal?.throwIfAborted();
    if (!this.#sessions.has(runId)) this.#start(runId, viewport);
    return this.#perform(runId, signal, async (session, page) => {
      this.#resetEvidence(session);
      const response = await page.goto(parsed.href, { waitUntil: "domcontentloaded" });
      if (response && !response.ok()) throw new Error(`Browser navigation failed: HTTP ${response.status()} (${page.url()}).`);
      return this.#snapshot(session, page);
    });
  }

  snapshot(runId: string, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#perform(runId, signal, (session, page) => this.#snapshot(session, page));
  }

  resize(runId: string, viewport: BrowserViewport, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#pageAction(runId, signal, (page) => page.setViewportSize(viewport));
  }

  click(runId: string, target: BrowserTarget, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#action(runId, target, signal, (locator) => locator.click());
  }

  type(runId: string, target: BrowserTarget, typing: BrowserTyping, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#action(runId, target, signal, async (locator) => {
      await (typing.slowly ? locator.pressSequentially(typing.text) : locator.fill(typing.text));
      if (typing.submit) await locator.press("Enter");
    });
  }

  selectOption(runId: string, target: BrowserTarget, values: readonly string[], signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#action(runId, target, signal, (locator) => locator.selectOption([...values]));
  }

  /** Without a target the key goes to the focused element. */
  pressKey(runId: string, target: BrowserTarget | undefined, key: string, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return target
      ? this.#action(runId, target, signal, (locator) => locator.press(key))
      : this.#pageAction(runId, signal, (page) => page.keyboard.press(key));
  }

  check(runId: string, input: BrowserCheck, signal?: AbortSignal): Promise<BrowserStep<BrowserCheckResult>> {
    return this.#perform(runId, signal, async (session, page) => {
      session.checked = false;
      if (!input.target && input.text === undefined && input.url === undefined && input.noErrors !== true) {
        throw new Error("browser_check needs at least target, text, url or noErrors: true.");
      }
      if (input.count !== undefined && (!input.target || input.target.nth !== undefined || input.target.first)) {
        throw new Error("count in browser_check needs a target without nth or first and counts its visible matches.");
      }
      if (input.frame !== undefined && (!input.text || input.target)) {
        throw new Error("frame in browser_check requires text without target; use target.frame with a target.");
      }
      if (input.measure === true && (!input.target || input.count !== undefined)) {
        throw new Error("measure in browser_check needs a target without count.");
      }
      const timeout = this.#options.checkTimeoutMs;
      const assertions: string[] = [];
      const warnings: string[] = [];
      let measurement: BrowserMeasurement | undefined;
      if (input.target && input.count !== undefined) {
        const matches = browserLocator(page, input.target);
        const key = targetKey(input.target);
        if (await matches.count() > 0) session.matchedTargets.add(key);
        else if (input.count > 0) throw new Error(`0 matches for ${concise(JSON.stringify(input.target))}`);
        const visible = (input.text === undefined ? matches : matches.filter({ hasText: input.text })).filter({ visible: true });
        const found = await this.#waitForCount(visible, input.count, timeout, async () => {
          if (await matches.count() > 0) session.matchedTargets.add(key);
        });
        if (found !== input.count) throw new Error(`Expected ${input.count} visible matches, found ${found}.`);
        assertions.push("Visible match count matches");
        if (input.count === 0 && !session.matchedTargets.has(key)) {
          warnings.push("The target has never matched any elements on this page. count: 0 may reflect a wrong selector; verify it with a positive check.");
        }
      } else if (input.target) {
        const matches = await this.#target(session, page, input.target);
        const locator = input.text === undefined ? matches : matches.filter({ hasText: input.text });
        await locator.waitFor({ state: "visible", timeout }).catch(async (error: unknown) => {
          if (input.text !== undefined && !errorText(error).includes("strict mode violation")) throw new Error("Expected text is missing in the target. Check its text or narrow the target.", { cause: error });
          return targetFailure(error, locator);
        });
        assertions.push(input.text === undefined ? "Target is visible" : "Target text is visible");
        if (input.measure === true) {
          const box = await locator.boundingBox({ timeout });
          if (!box) throw new Error("Cannot measure the target: it is no longer visible.");
          const widths = await locator.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }), undefined, { timeout });
          measurement = { box, ...widths, overflowX: Math.max(0, widths.scrollWidth - widths.clientWidth) };
        }
      } else if (input.text !== undefined) {
        const root = input.frame ? page.frameLocator(input.frame) : page;
        const matches = root.getByText(input.text, { exact: false });
        if (await matches.count() === 0) throw new Error(`0 matches for ${concise(JSON.stringify({ text: input.text, ...(input.frame ? { frame: input.frame } : {}) }))}`);
        const locator = matches.filter({ visible: true }).first();
        await locator.waitFor({ state: "visible", timeout });
        assertions.push("Visible text found");
      }
      if (input.url !== undefined) {
        await page.waitForURL(input.url, { timeout });
        assertions.push("Address matches");
      }
      if (input.noErrors === true) {
        if (session.errors.length > 0) throw new Error(`Browser errors: ${concise(session.errors[0]!)}${session.errors.length > 1 ? ` (${session.errors.length} captured)` : ""}. Use browser_snapshot to inspect page errors.`);
        assertions.push("No captured browser or network errors since the navigation");
      }
      session.checked = true;
      return { url: page.url(), assertions, errors: reportedErrors(session.errors),
        ...(warnings.length ? { warnings } : {}), ...(measurement ? { measurement } : {}) };
    });
  }

  /** Captures the page as PNG and returns it Base64-encoded; the page remembers `id` as the current screenshot. */
  takeScreenshot(runId: string, id: string, fullPage: boolean, signal?: AbortSignal): Promise<BrowserStep<string>> {
    return this.#perform(runId, signal, async (session, page) => {
      const image = await page.screenshot({ fullPage, type: "png", timeout: this.#options.timeoutMs });
      session.screenshots.push(id);
      return image.toString("base64");
    });
  }

  /** The page state without waiting for running actions; `null` without an open page. */
  state(runId: string): BrowserPageState | null {
    const session = this.#sessions.get(runId);
    return session && !session.closed && session.page ? this.#stateOf(session, session.page) : null;
  }

  async close(runId: string): Promise<void> {
    const session = this.#sessions.get(runId);
    if (!session) return;
    session.closed = true;
    this.#sessions.delete(runId);
    const browser = await session.browser.catch(() => undefined);
    if (browser) await browser.close();
    await session.queue;
  }

  /** Closes every browser; afterwards none starts anymore because nobody would close it. */
  async shutdown(): Promise<void> {
    this.#shutDown = true;
    const results = await Promise.allSettled([...this.#sessions.keys()].map((runId) => this.close(runId)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
  }

  #start(runId: string, viewport: BrowserViewport): void {
    const session: BrowserSession = {
      browser: this.#launch(runId),
      viewport,
      queue: Promise.resolve(),
      closed: false,
      checked: false,
      errors: [],
      failedRequests: new Set(),
      screenshots: [],
      matchedTargets: new Set(),
    };
    this.#sessions.set(runId, session);
    void session.browser.catch(() => {
      session.closed = true;
      if (this.#sessions.get(runId) === session) this.#sessions.delete(runId);
    });
  }

  async #launch(runId: string): Promise<Browser> {
    return this.#options.launch(runId);
  }

  async #waitForCount(locator: Locator, expected: number, timeout: number, observe: () => Promise<void>): Promise<number> {
    const deadline = Date.now() + timeout;
    await observe();
    let found = await locator.count();
    while (found !== expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await observe();
      found = await locator.count();
    }
    return found;
  }

  #resetEvidence(session: BrowserSession): void {
    session.checked = false;
    session.screenshots = [];
    session.errors = [];
    session.failedRequests = new Set();
    session.matchedTargets = new Set();
  }

  async #page(session: BrowserSession): Promise<Page> {
    if (session.closed) throw new Error("The browser was closed.");
    if (session.page) return session.page;
    const browser = await session.browser;
    if (session.closed) throw new Error("The browser was closed.");
    const context = await browser.newContext({ viewport: session.viewport });
    context.setDefaultTimeout(this.#options.timeoutMs);
    context.setDefaultNavigationTimeout(this.#options.timeoutMs);
    const page = await context.newPage();
    const addError = (text: string) => {
      session.errors.push(text.slice(0, 2000));
      if (session.errors.length > 100) session.errors.shift();
    };
    const addRequestError = (url: string, text: string) => {
      if (session.failedRequests.has(url)) return;
      session.failedRequests.add(url);
      addError(text);
    };
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const source = message.text().startsWith("Failed to load resource") ? message.location().url : "";
      if (source) addRequestError(source, `Console: ${message.text()} (${source})`);
      else addError(`Console: ${message.text()}`);
    });
    page.on("pageerror", (error) => addError(`JavaScript: ${error.message}`));
    page.on("requestfailed", (request) => addRequestError(request.url(), `Network: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
    page.on("response", (response) => { if (response.status() >= 400) addRequestError(response.url(), `HTTP ${response.status()}: ${response.url()}`); });
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) this.#resetEvidence(session); });
    page.on("popup", (popup) => {
      addError(`The application opened a new window: ${popup.url()}. Popups are not operated.`);
      void popup.close().catch((error) => addError(`Closing window: ${errorText(error)}`));
    });
    session.page = page;
    return page;
  }

  #perform<T>(runId: string, signal: AbortSignal | undefined, action: (session: BrowserSession, page: Page) => Promise<T>): Promise<BrowserStep<T>> {
    if (this.#shutDown) return Promise.reject(endedError());
    const session = this.#sessions.get(runId);
    if (!session || session.closed) return Promise.reject(new Error("No browser is open for this run. Call browser_navigate first."));
    const pending = session.queue.then(async () => {
      signal?.throwIfAborted();
      const abort = () => { void this.close(runId).catch((error) => console.error("Browser stop failed:", errorText(error))); };
      signal?.addEventListener("abort", abort, { once: true });
      try {
        const page = await this.#page(session);
        signal?.throwIfAborted();
        const result = await action(session, page);
        signal?.throwIfAborted();
        if (session.closed) throw new Error("The browser was closed.");
        return { result, page: this.#stateOf(session, page) };
      } catch (error) {
        throw conciseFailure(error);
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    });
    session.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  #action(runId: string, target: BrowserTarget, signal: AbortSignal | undefined, action: (locator: Locator) => Promise<unknown>): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#pageAction(runId, signal, async (page, session) => {
      const locator = await this.#target(session, page, target);
      return action(locator).catch((error) => targetFailure(error, locator));
    });
  }

  async #target(session: BrowserSession, page: Page, target: BrowserTarget): Promise<Locator> {
    const locator = browserLocator(page, target);
    if (await locator.count() === 0) throw new Error(`0 matches for ${concise(JSON.stringify(target))}`);
    session.matchedTargets.add(targetKey(target));
    return locator;
  }

  #pageAction(runId: string, signal: AbortSignal | undefined, action: (page: Page, session: BrowserSession) => Promise<unknown>): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#perform(runId, signal, async (session, page) => {
      session.checked = false;
      session.screenshots = [];
      await action(page, session);
      return this.#snapshot(session, page, true);
    });
  }

  #stateOf(session: BrowserSession, page: Page): BrowserPageState {
    return { url: page.url(), checked: session.checked, errors: [...session.errors], screenshots: [...session.screenshots] };
  }

  async #snapshot(session: BrowserSession, page: Page, afterAction = false): Promise<BrowserSnapshot> {
    const full = await page.locator("body").ariaSnapshot({ mode: "ai", timeout: this.#options.timeoutMs });
    const snapshot = afterAction
      ? full.split("\n").slice(0, 40).map((line) => line.slice(0, 300)).join("\n").slice(0, maxActionSnapshotLength)
      : full.slice(0, maxSnapshotLength);
    return { url: page.url(), title: await page.title(), snapshot,
      truncated: snapshot !== full, errors: reportedErrors(session.errors) };
  }
}
