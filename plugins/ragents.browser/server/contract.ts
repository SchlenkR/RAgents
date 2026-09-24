import { serviceToken } from "@ragents/engine";
import type { BrowserSnapshot } from "@ragents/workspace-executor";

export type { BrowserSnapshot, BrowserTarget } from "@ragents/workspace-executor";

export interface BrowserEvidence {
  checkedAt?: string;
  url?: string;
  screenshots: { name: string; url: string }[];
  currentScreenshots: { name: string; url: string }[];
  errors: string[];
}

/** Wer eine Operation an der Seite auslöst: bei einem Werkzeugaufruf dessen Kennung, dazu der Abbruch. */
export interface BrowserCallOptions {
  signal?: AbortSignal;
  toolCallId?: string;
}

export interface BrowserRuntime {
  open: (runId: string, url: string, options?: BrowserCallOptions) => Promise<BrowserSnapshot>;
  evidence: (runId: string) => BrowserEvidence;
}

export const browserRuntimeToken = serviceToken<BrowserRuntime>("ragents.browser.runtime");
