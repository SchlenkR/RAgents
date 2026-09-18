import { serviceToken } from "@aicontainer/ragents";

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

export interface BrowserEvidence {
  checkedAt?: string;
  url?: string;
  screenshots: { name: string; url: string }[];
  currentScreenshots: { name: string; url: string }[];
  errors: string[];
}

export interface BrowserSnapshot {
  url: string;
  title: string;
  snapshot: string;
  truncated: boolean;
  errors: string[];
}

export interface BrowserRuntime {
  open: (runId: string, url: string, signal?: AbortSignal) => Promise<BrowserSnapshot>;
  evidence: (runId: string) => BrowserEvidence;
}

export const browserRuntimeToken = serviceToken<BrowserRuntime>("ragents.browser.runtime");
