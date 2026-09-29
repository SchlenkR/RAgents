import type { Browser } from "playwright-core";

/** What a test page shows; a click can change the page, navigate, or raise a console error. */
export interface StubElement {
  readonly role: string;
  readonly name: string;
  readonly label?: string;
  readonly onClick?: (page: StubPageControl) => void | Promise<void>;
}

export interface StubDocument {
  readonly title: string;
  readonly elements: readonly StubElement[];
}

/** Reaches into the open page from outside, the way the application would between two calls. */
export interface StubPageControl {
  navigate: (target: string) => void;
  consoleError: (text: string) => void;
  show: (element: StubElement) => void;
}

export interface StubBrowserLog {
  launches: number;
  contexts: number;
  closes: number;
  actions: string[];
}

interface Viewport {
  width: number;
  height: number;
}

type Handler = (value: unknown) => void;

interface StubPageParts {
  readonly log: StubBrowserLog;
  readonly control: StubPageControl;
  readonly snapshot: () => string;
  /** Fails as soon as the browser is closed; this is how hanging actions end, as in Playwright. */
  readonly closed: Promise<never>;
}

const stubLocator = (description: string, match: () => StubElement[], parts: StubPageParts): unknown => {
  const { log, control, snapshot, closed } = parts;
  const single = (): StubElement => {
    const found = match();
    if (found.length > 1) throw new Error(`strict mode violation: ${description} resolved to ${found.length} elements`);
    if (found.length === 0) throw new Error(`Timeout exceeded waiting for ${description}`);
    return found[0]!;
  };
  const derived = (suffix: string, subset: () => StubElement[]) => stubLocator(`${description} ${suffix}`, subset, parts);
  return {
    click: async () => {
      const element = single();
      log.actions.push(`click ${element.name}`);
      await Promise.race([Promise.resolve(element.onClick?.(control)), closed]);
    },
    fill: async (value: string) => { log.actions.push(`fill ${single().name}=${value}`); },
    selectOption: async ({ label }: { label: string }) => { log.actions.push(`select ${single().name}=${label}`); },
    press: async (key: string) => { log.actions.push(`press ${single().name} ${key}`); },
    waitFor: async () => { single(); },
    count: async () => match().length,
    first: () => derived("first", () => match().slice(0, 1)),
    nth: (index: number) => derived(`nth=${index}`, () => match().slice(index, index + 1)),
    filter: ({ hasText }: { hasText?: string }) =>
      derived(hasText === undefined ? "visible" : `with ${hasText}`, () => match().filter((element) => hasText === undefined || element.name.includes(hasText))),
    ariaSnapshot: async () => snapshot(),
  };
};

/** A page without Chrome: addresses from `site`, every unknown one answers with 404; a screenshot names the viewport. */
const stubPage = (
  site: Readonly<Record<string, StubDocument>>,
  initial: Viewport,
  log: StubBrowserLog,
  closed: Promise<never>,
  expose: (control: StubPageControl) => void,
): unknown => {
  const handlers = new Map<string, Handler[]>();
  const emit = (event: string, value: unknown): void => {
    for (const handler of handlers.get(event) ?? []) handler(value);
  };
  const mainFrame = {};
  let url = "about:blank";
  let viewport = initial;
  let document: StubDocument = { title: "", elements: [] };
  const navigate = (target: string): number => {
    url = target;
    const found = site[new URL(target).pathname];
    document = found ?? { title: "Not found", elements: [] };
    emit("framenavigated", mainFrame);
    if (!found) emit("response", { status: () => 404, url: () => target });
    return found ? 200 : 404;
  };
  const control: StubPageControl = {
    navigate: (target) => { navigate(new URL(target, url).href); },
    consoleError: (text) => emit("console", { type: () => "error", text: () => text }),
    show: (element) => { document = { ...document, elements: [...document.elements, element] }; },
  };
  expose(control);
  const snapshot = (): string =>
    [`- document "${document.title}"`, ...document.elements.map((element, index) => `  - ${element.role} "${element.name}" [ref=e${index + 1}]`)].join("\n");
  const locator = (description: string, match: (element: StubElement) => boolean) =>
    stubLocator(description, () => document.elements.filter(match), { log, control, snapshot, closed });
  const page = {
    on: (event: string, handler: Handler) => { handlers.set(event, [...handlers.get(event) ?? [], handler]); },
    goto: async (target: string) => {
      const status = navigate(target);
      return { ok: () => status < 400, status: () => status };
    },
    url: () => url,
    title: async () => document.title,
    mainFrame: () => mainFrame,
    setViewportSize: async (size: Viewport) => { viewport = size; },
    screenshot: async ({ fullPage }: { fullPage: boolean }) => Buffer.from(`PNG ${viewport.width}x${viewport.height}${fullPage ? " full page" : ""}`),
    waitForURL: async (expected: string) => {
      if (expected !== url) throw new Error(`Timeout exceeded waiting for URL ${expected}`);
    },
    locator: (css: string) => locator(css, () => css === "body"),
    getByRole: (role: string, { name }: { name?: string }) =>
      locator(`role=${role}`, (element) => element.role === role && (name === undefined || element.name === name)),
    getByText: (text: string, { exact }: { exact: boolean }) =>
      locator(`text=${text}`, (element) => exact ? element.name === text : element.name.includes(text)),
    getByLabel: (label: string) => locator(`label=${label}`, (element) => element.label === label),
    getByTestId: (testId: string) => locator(`testId=${testId}`, () => false),
    frameLocator: () => page,
  };
  return page;
};

/** A browser for tests without Chrome; `page()` reaches into the most recently opened page. */
export const stubBrowser = (site: Readonly<Record<string, StubDocument>>) => {
  const log: StubBrowserLog = { launches: 0, contexts: 0, closes: 0, actions: [] };
  let current: StubPageControl | undefined;
  const launch = async (): Promise<Browser> => {
    log.launches += 1;
    let close!: (error: Error) => void;
    const closed = new Promise<never>((_resolve, reject) => { close = reject; });
    closed.catch(() => undefined);
    return {
      newContext: async ({ viewport }: { viewport: Viewport }) => {
        log.contexts += 1;
        return {
          setDefaultTimeout: () => undefined,
          setDefaultNavigationTimeout: () => undefined,
          newPage: async () => stubPage(site, viewport, log, closed, (control) => { current = control; }),
        };
      },
      close: async () => {
        log.closes += 1;
        close(new Error("Target page, context or browser has been closed"));
      },
    } as unknown as Browser;
  };
  const page = (): StubPageControl => {
    if (!current) throw new Error("No page is open in the test browser yet");
    return current;
  };
  return { launch, log, page };
};
