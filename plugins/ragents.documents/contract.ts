import { Type, type Static } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";

export const documentsApiPrefix = "/api/plugins/ragents.documents";

/** The alias of the document store, a root of the server in every binding. */
export const DOCUMENTS_ALIAS = "@documents";

const encodedReference = (reference: string): string => reference.split("/").map(encodeURIComponent).join("/");

/** The address of a file's bytes; the reference names the file as read does, so relative addresses inside a document follow URL semantics. */
export const contentPathOf = (routePrefix: string, runId: string, reference: string): string =>
  `${routePrefix}/runs/${encodeURIComponent(runId)}/raw/${encodedReference(reference)}`;

/** The same address with a grant in its path instead of a sign-in, so that the relative addresses of a document keep it. */
export const grantedPathOf = (routePrefix: string, runId: string, grant: string, reference: string): string =>
  `${routePrefix}/runs/${encodeURIComponent(runId)}/grant/${encodeURIComponent(grant)}/${encodedReference(reference)}`;

/** How long a grant of the content route is valid; a page renews its grants after half of it. */
export const DOCUMENT_GRANT_LIFETIME_MS = 10 * 60 * 1000;

/** The root a reference names: its alias, or empty for the run's root. */
export const rootOfReference = (reference: string): string => reference.startsWith("@") ? reference.split("/")[0]! : "";

const fileEntry = Type.Object({
  path: Type.String({ minLength: 1 }),
  size: Type.Integer({ minimum: 0 }),
  modifiedAt: Type.String({ minLength: 1 }),
}, { additionalProperties: false });

const filesListing = Type.Object({
  groups: Type.Array(Type.Object({
    directory: Type.String({ minLength: 1 }),
    files: Type.Array(fileEntry),
  }, { additionalProperties: false })),
  loose: Type.Array(fileEntry),
  truncated: Type.Boolean(),
}, { additionalProperties: false });

export type RunFileEntry = Static<typeof fileEntry>;

export type RunFilesListing = Static<typeof filesListing>;

export const documentsContracts = {
  files: defineOperation({
    id: "ragents.documents.files",
    description: "A run's file store as groups and loose files. Right: runs.read.",
    rights: ["runs.read"],
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64, description: "Run id" }),
    }, { additionalProperties: false }),
    result: filesListing,
  }),
  grant: defineOperation({
    id: "ragents.documents.grant",
    description: "A short-lived, read-only grant for the files of one root of a run, bound to the caller; the content route accepts it in its path where the page signs in with a token instead of a cookie. Rights: runs.read, for the run's root also runs.inspect and access to its workspace.",
    rights: ["runs.read"],
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64, description: "Run id" }),
      root: Type.String({ pattern: "^(@[a-z][a-z0-9-]*)?$", description: "The alias of a root of the server, or empty for the run's root" }),
    }, { additionalProperties: false }),
    result: Type.Object({ grant: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
  }),
};
