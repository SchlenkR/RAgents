import { Type, type Static } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";

export const documentsApiPrefix = "/api/plugins/ragents.documents";

/** The alias of the document store, a root of the server in every binding. */
export const DOCUMENTS_ALIAS = "@documents";

/** The address of a file's bytes; the reference names the file as read does, so relative addresses inside a document follow URL semantics. */
export const contentPathOf = (routePrefix: string, runId: string, reference: string): string =>
  `${routePrefix}/runs/${encodeURIComponent(runId)}/raw/${reference.split("/").map(encodeURIComponent).join("/")}`;

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
};
