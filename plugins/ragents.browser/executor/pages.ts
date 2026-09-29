import type { Browser, Locator, Page } from "playwright-core";
import type {
  BrowserCheck,
  BrowserCheckResult,
  BrowserPageState,
  BrowserSnapshot,
  BrowserStep,
  BrowserTarget,
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
  /** Adressen, deren fehlgeschlagene Anfrage schon gemeldet ist; HTTP-Status, Konsole und Netzwerk melden dieselbe Ursache nur einmal. */
  failedRequests: Set<string>;
  screenshots: string[];
}

export interface BrowserPagesOptions {
  launch: (runId: string) => Promise<Browser>;
  timeoutMs: number;
  checkTimeoutMs: number;
}

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const endedError = (): Error => new Error("Der Browserdienst dieses Executors ist beendet.");
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

/** Je Run ein Browser mit einer Seite auf dieser Maschine; die Aktionen eines Runs laufen der Reihe nach. */
export class BrowserPages {
  readonly #options: BrowserPagesOptions;
  readonly #sessions = new Map<string, BrowserSession>();
  #shutDown = false;

  constructor(options: BrowserPagesOptions) {
    this.#options = options;
  }

  async open(runId: string, url: string, viewport: BrowserViewport, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    if (this.#shutDown) throw endedError();
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("browser_open braucht eine HTTP- oder HTTPS-Adresse.");
    signal?.throwIfAborted();
    if (!this.#sessions.has(runId)) this.#start(runId, viewport);
    return this.#perform(runId, signal, async (session, page) => {
      this.#resetEvidence(session);
      const response = await page.goto(parsed.href, { waitUntil: "domcontentloaded" });
      if (response && !response.ok()) throw new Error(`Browsernavigation fehlgeschlagen: HTTP ${response.status()} (${page.url()}).`);
      return this.#snapshot(session, page);
    });
  }

  snapshot(runId: string, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#perform(runId, signal, (session, page) => this.#snapshot(session, page));
  }

  viewport(runId: string, viewport: BrowserViewport, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#perform(runId, signal, async (session, page) => {
      await page.setViewportSize(viewport);
      return this.#snapshot(session, page);
    });
  }

  click(runId: string, target: BrowserTarget, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#action(runId, target, signal, (locator) => locator.click());
  }

  fill(runId: string, target: BrowserTarget, value: string, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#action(runId, target, signal, (locator) => locator.fill(value));
  }

  select(runId: string, target: BrowserTarget, label: string, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#action(runId, target, signal, (locator) => locator.selectOption({ label }));
  }

  press(runId: string, target: BrowserTarget, key: string, signal?: AbortSignal): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#action(runId, target, signal, (locator) => locator.press(key));
  }

  check(runId: string, input: BrowserCheck, signal?: AbortSignal): Promise<BrowserStep<BrowserCheckResult>> {
    return this.#perform(runId, signal, async (session, page) => {
      session.checked = false;
      if (!input.target && input.text === undefined && input.url === undefined && input.noErrors !== true) {
        throw new Error("browser_check braucht mindestens target, text, url oder noErrors: true.");
      }
      if (input.count !== undefined && (!input.target || input.target.nth !== undefined || input.target.first)) {
        throw new Error("count in browser_check braucht ein target ohne nth oder first und zählt dessen sichtbare Treffer.");
      }
      const timeout = this.#options.checkTimeoutMs;
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
      session.checked = true;
      return { url: page.url(), assertions };
    });
  }

  /** Nimmt die Seite als PNG auf und liefert es Base64-kodiert; `id` merkt sich die Seite als aktuelle Aufnahme. */
  screenshot(runId: string, id: string, fullPage: boolean, signal?: AbortSignal): Promise<BrowserStep<string>> {
    return this.#perform(runId, signal, async (session, page) => {
      const image = await page.screenshot({ fullPage, type: "png", timeout: this.#options.timeoutMs });
      session.screenshots.push(id);
      return image.toString("base64");
    });
  }

  /** Der Stand der Seite, ohne auf laufende Aktionen zu warten; ohne offene Seite `null`. */
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

  /** Schließt jeden Browser; danach startet keiner mehr, weil niemand ihn schließen würde. */
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
    session.checked = false;
    session.screenshots = [];
    session.errors = [];
    session.failedRequests = new Set();
  }

  async #page(session: BrowserSession): Promise<Page> {
    if (session.closed) throw new Error("Der Browser wurde beendet.");
    if (session.page) return session.page;
    const browser = await session.browser;
    if (session.closed) throw new Error("Der Browser wurde beendet.");
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
      if (source) addRequestError(source, `Konsole: ${message.text()} (${source})`);
      else addError(`Konsole: ${message.text()}`);
    });
    page.on("pageerror", (error) => addError(`JavaScript: ${error.message}`));
    page.on("requestfailed", (request) => addRequestError(request.url(), `Netzwerk: ${request.method()} ${request.url()} ${request.failure()?.errorText}`));
    page.on("response", (response) => { if (response.status() >= 400) addRequestError(response.url(), `HTTP ${response.status()}: ${response.url()}`); });
    page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) this.#resetEvidence(session); });
    page.on("popup", (popup) => {
      addError(`Die Anwendung hat ein neues Fenster geöffnet: ${popup.url()}. Popups werden nicht bedient.`);
      void popup.close().catch((error) => addError(`Fenster schließen: ${errorText(error)}`));
    });
    session.page = page;
    return page;
  }

  #perform<T>(runId: string, signal: AbortSignal | undefined, action: (session: BrowserSession, page: Page) => Promise<T>): Promise<BrowserStep<T>> {
    if (this.#shutDown) return Promise.reject(endedError());
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
        return { result, page: this.#stateOf(session, page) };
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    });
    session.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  #action(runId: string, target: BrowserTarget, signal: AbortSignal | undefined, action: (locator: Locator) => Promise<unknown>): Promise<BrowserStep<BrowserSnapshot>> {
    return this.#perform(runId, signal, async (session, page) => {
      session.checked = false;
      session.screenshots = [];
      await action(browserLocator(page, target)).catch(withAmbiguityHint);
      return this.#snapshot(session, page);
    });
  }

  #stateOf(session: BrowserSession, page: Page): BrowserPageState {
    return { url: page.url(), checked: session.checked, errors: [...session.errors], screenshots: [...session.screenshots] };
  }

  async #snapshot(session: BrowserSession, page: Page): Promise<BrowserSnapshot> {
    const snapshot = await page.locator("body").ariaSnapshot({ mode: "ai", timeout: this.#options.timeoutMs });
    return { url: page.url(), title: await page.title(), snapshot: snapshot.slice(0, maxSnapshotLength),
      truncated: snapshot.length > maxSnapshotLength, errors: [...session.errors] };
  }
}
