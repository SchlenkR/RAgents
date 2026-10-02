export const BROWSER_OPERATIONS = {
  navigate: "browser.navigate",
  snapshot: "browser.snapshot",
  resize: "browser.resize",
  click: "browser.click",
  type: "browser.type",
  selectOption: "browser.selectOption",
  pressKey: "browser.pressKey",
  check: "browser.check",
  takeScreenshot: "browser.takeScreenshot",
  state: "browser.state",
  close: "browser.close",
} as const;

/** Names a custom Chrome; on a server the profile section `ragents.browser` sets it, on a workspace its environment. */
export const BROWSER_EXECUTABLE_VARIABLE = "BROWSER_EXECUTABLE_PATH";

export interface BrowserTarget {
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  testId?: string;
  css?: string;
  frame?: string;
  nth?: number;
  first?: boolean;
}

export interface BrowserViewport {
  width: number;
  height: number;
}

/** What browser_type enters: `text` replaces the field content unless `slowly` types it key by key; `submit` presses Enter afterwards. */
export interface BrowserTyping {
  text: string;
  submit?: boolean;
  slowly?: boolean;
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  snapshot: string;
  truncated: boolean;
  errors: string[];
}

export interface BrowserCheck {
  target?: BrowserTarget;
  text?: string;
  url?: string;
  count?: number;
  noErrors?: boolean;
}

/** What a passed check proves; the time is set by whoever holds the run's evidence. */
export interface BrowserCheckResult {
  url: string;
  assertions: string[];
}

/** The page state after an operation; the caller derives the run's evidence from it. */
export interface BrowserPageState {
  url: string;
  /** A check has passed since the last action or navigation. */
  checked: boolean;
  errors: string[];
  /** The ids of the screenshots since the last action or navigation, as the caller assigned them. */
  screenshots: string[];
}

/** The result of an operation on the page and the state it leaves the page in. */
export interface BrowserStep<T> {
  result: T;
  page: BrowserPageState;
}
