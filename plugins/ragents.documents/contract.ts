import { Type, type Static } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";

export const documentsApiPrefix = "/api/plugins/ragents.documents";

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
    description: "Die Dateiablage eines Runs als Gruppen und lose Dateien. Recht: runs.read.",
    rights: ["runs.read"],
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64, description: "Kennung des Runs" }),
    }, { additionalProperties: false }),
    result: filesListing,
  }),
};
