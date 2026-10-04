import { useState, useSyncExternalStore } from "react";
import { accessTokenInstalled } from "@ragents/web/access-token";
import { DOCUMENT_GRANT_LIFETIME_MS, DOCUMENTS_ALIAS } from "../contract";
import { fetchGrant } from "./api";

/** A grant for one root of a run as a view reads it: there, failed, or undefined while it loads. */
export type GrantState = { readonly grant: string } | { readonly error: string } | undefined;

/** What views read in one render; every change brings a new one with a higher revision, so that they resolve their addresses again. */
export interface GrantSnapshot {
  readonly revision: number;
  readonly grantFor: (runId: string, root: string) => GrantState;
}

type GrantEntry =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly grant: string; readonly receivedAt: number; readonly renewing: boolean }
  | { readonly state: "failed"; readonly error: string; readonly failedAt: number };

export interface GrantStoreOptions {
  request: (runId: string, root: string) => Promise<{ grant: string }>;
  now?: () => number;
  schedule?: (task: () => void, delay: number) => void;
}

const RENEW_AFTER_MS = DOCUMENT_GRANT_LIFETIME_MS / 2;
const RETRY_AFTER_MS = 30 * 1000;
// A grant this close to its end is no longer handed out, so that an address keeps working a while after it renders.
const USABLE_UNTIL_MS = DOCUMENT_GRANT_LIFETIME_MS - 60 * 1000;

const keyOf = (runId: string, root: string): string => `${runId}\n${root}`;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** The grants of one page, one per run and root: asked for when an address first needs one, renewed after half their lifetime while a view watches. */
export class DocumentGrantStore {
  readonly #entries = new Map<string, GrantEntry>();
  readonly #listeners = new Set<() => void>();
  readonly #request: GrantStoreOptions["request"];
  readonly #now: () => number;
  readonly #schedule: (task: () => void, delay: number) => void;
  #snapshot: GrantSnapshot;

  constructor({ request, now = Date.now, schedule = (task, delay) => { setTimeout(task, delay); } }: GrantStoreOptions) {
    this.#request = request;
    this.#now = now;
    this.#schedule = schedule;
    this.#snapshot = this.#newSnapshot(0);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  readonly current = (): GrantSnapshot => this.#snapshot;

  #newSnapshot(revision: number): GrantSnapshot {
    return { revision, grantFor: (runId, root) => this.#grantFor(runId, root) };
  }

  #grantFor(runId: string, root: string): GrantState {
    const key = keyOf(runId, root);
    const entry = this.#entries.get(key);
    const now = this.#now();
    if (entry === undefined || (entry.state === "failed" && now - entry.failedAt >= RETRY_AFTER_MS)) {
      this.#fetch(key, runId, root);
      return undefined;
    }
    if (entry.state === "loading") return undefined;
    if (entry.state === "failed") return { error: entry.error };
    const age = now - entry.receivedAt;
    if (age >= RENEW_AFTER_MS && !entry.renewing) this.#fetch(key, runId, root);
    return age < USABLE_UNTIL_MS ? { grant: entry.grant } : undefined;
  }

  #fetch(key: string, runId: string, root: string): void {
    const entry = this.#entries.get(key);
    this.#entries.set(key, entry?.state === "ready" ? { ...entry, renewing: true } : { state: "loading" });
    void Promise.resolve()
      .then(() => this.#request(runId, root))
      .then(({ grant }) => {
        this.#entries.set(key, { state: "ready", grant, receivedAt: this.#now(), renewing: false });
        this.#schedule(() => this.#renewIfWatched(key, runId, root, grant), RENEW_AFTER_MS);
      }, (error: unknown) => {
        this.#entries.set(key, { state: "failed", error: messageOf(error), failedAt: this.#now() });
      })
      .then(() => this.#changed());
  }

  /** A grant nobody watches is forgotten instead of renewed; the next address that needs it asks again. */
  #renewIfWatched(key: string, runId: string, root: string, grant: string): void {
    const entry = this.#entries.get(key);
    if (entry?.state !== "ready" || entry.grant !== grant || entry.renewing) return;
    if (this.#listeners.size > 0) this.#fetch(key, runId, root);
    else this.#entries.delete(key);
  }

  #changed(): void {
    this.#snapshot = this.#newSnapshot(this.#snapshot.revision + 1);
    for (const listener of [...this.#listeners]) listener();
  }
}

/** The page's grants, shared by the Documents view and the run's chat. */
export const documentGrants = new DocumentGrantStore({ request: fetchGrant });

/** The page's grants where it signs in with a token; with a cookie no address needs one. */
export const useDocumentGrants = (): GrantSnapshot | undefined => {
  const snapshot = useSyncExternalStore(documentGrants.subscribe, documentGrants.current, documentGrants.current);
  return accessTokenInstalled() ? snapshot : undefined;
};

/** The roots a chat answer names most: the run's own and the store. */
const RUN_ROOTS = ["", DOCUMENTS_ALIAS] as const;

/** With a token a run waits once until the grants of its roots have settled: quassel resolves an address only when its Markdown first renders. */
export const useRunGrantsSettled = (runId: string): boolean => {
  const grants = useDocumentGrants();
  const [settled, setSettled] = useState<string>();
  const ready = grants === undefined || settled === runId || RUN_ROOTS.map((root) => grants.grantFor(runId, root)).every((state) => state !== undefined);
  if (grants !== undefined && ready && settled !== runId) setSettled(runId);
  return ready;
};
