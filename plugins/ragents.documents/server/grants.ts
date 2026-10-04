import { randomBytes } from "node:crypto";
import { DomainError, type AccessContext } from "@ragents/engine";
import { DOCUMENT_GRANT_LIFETIME_MS, rootOfReference } from "../contract.js";

interface Grant {
  readonly runId: string;
  readonly root: string;
  readonly access: AccessContext;
  readonly expiresAt: number;
}

const rootName = (root: string): string => root === "" ? "the run's root" : root;

/** Short-lived, read-only grants for the files of one root of a run, bound to the access that asked for them; they live only in memory. */
export class DocumentGrants {
  readonly #grants = new Map<string, Grant>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  issue(access: AccessContext, runId: string, root: string): string {
    const now = this.#now();
    for (const [grant, entry] of this.#grants) if (entry.expiresAt <= now) this.#grants.delete(grant);
    const grant = randomBytes(32).toString("base64url");
    this.#grants.set(grant, { runId, root, access, expiresAt: now + DOCUMENT_GRANT_LIFETIME_MS });
    return grant;
  }

  /** The access a grant stands for at a reference of its run; without a reference only the grant itself is checked. */
  accessFor(runId: string, grant: string, reference: string | undefined): AccessContext {
    const entry = this.#grants.get(grant);
    if (!entry || entry.runId !== runId || entry.expiresAt <= this.#now()) {
      throw new DomainError("document-grant-invalid", "The grant in this address is unknown or expired; open the document again.", 403);
    }
    if (reference !== undefined && rootOfReference(reference) !== entry.root) {
      throw new DomainError("document-grant-outside", `The grant in this address covers ${rootName(entry.root)}, not ${reference}.`, 403);
    }
    return entry.access;
  }
}
