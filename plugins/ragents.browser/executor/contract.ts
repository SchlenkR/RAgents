export const BROWSER_OPERATIONS = {
  open: "browser.open",
  snapshot: "browser.snapshot",
  viewport: "browser.viewport",
  click: "browser.click",
  fill: "browser.fill",
  select: "browser.select",
  press: "browser.press",
  check: "browser.check",
  screenshot: "browser.screenshot",
  state: "browser.state",
  close: "browser.close",
} as const;

/** Nennt einen eigenen Chrome; auf einem Server setzt ihn die Profilsektion `ragents.browser`, auf einem Arbeitsplatz seine Umgebung. */
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

/** Was eine bestandene Prüfung belegt; die Zeit setzt, wer die Evidenz des Runs hält. */
export interface BrowserCheckResult {
  url: string;
  assertions: string[];
}

/** Der Stand der Seite nach einer Operation; der Aufrufer hält daraus die Evidenz des Runs. */
export interface BrowserPageState {
  url: string;
  /** Seit der letzten Aktion oder Navigation hat eine Prüfung bestanden. */
  checked: boolean;
  errors: string[];
  /** Die Kennungen der Aufnahmen seit der letzten Aktion oder Navigation, so wie der Aufrufer sie vergeben hat. */
  screenshots: string[];
}

/** Das Ergebnis einer Operation an der Seite und der Stand, in dem sie die Seite hinterlässt. */
export interface BrowserStep<T> {
  result: T;
  page: BrowserPageState;
}
