import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";
import { relativeStorePath, type DocumentSources } from "./sources.js";

export const documentWriteToolMetadata = {
  name: "document_write",
  label: "Store document",
  description: "Stores a file in this run's file store, from text you wrote or as an unchanged copy of a file read reaches.",
  longDescription: "Documents, reports and intermediate products belong in the file store, not in the "
    + "working directory - that only holds what belongs to the task itself. The user sees the "
    + "store in the \"Documents\" area, grouped by subdirectory. To put an existing file into the store, name it "
    + "by its path and never retype its content; the copy is read where the workspace lies, also on a workstation. "
    + "The store is not a bash path: it does not live in the workspace and can only be written through this tool.",
} as const;

const sourceRule = "content and file_path exclude each other: valid are { storePath, content } for text you wrote and "
  + "{ storePath, file_path } for a copy of an existing file; exactly one of the two must be set.";

const sourceOf = (input: { content?: string; file_path?: string }): { kind: "content"; content: string } | { kind: "file"; filePath: string } => {
  if (input.content !== undefined && input.file_path === undefined) return { kind: "content", content: input.content };
  if (input.file_path !== undefined && input.content === undefined) return { kind: "file", filePath: input.file_path };
  throw new Error(sourceRule);
};

export const createDocumentWriteTool = (sources: DocumentSources): RunFunction =>
  defineRunFunction({
    ...documentWriteToolMetadata,
    schema: Type.Object({
      storePath: Type.String({ minLength: 1, description: "Where the file goes in this run's file store, one subdirectory per topic, e.g. topic/report.md" }),
      content: Type.Optional(Type.String({ description: "The complete content of the file, as text you wrote yourself. " + sourceRule })),
      file_path: Type.Optional(Type.String({
        minLength: 1,
        description: "An existing file to copy unchanged, named as read names it: relative to the working directory, absolute, or starting "
          + "with a workspace alias such as @actors. " + sourceRule,
      })),
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => {
      const source = sourceOf(input);
      const relative = relativeStorePath(input.storePath);
      const content = source.kind === "content"
        ? source.content
        : await sources.workspaceText(caller.runId, source.filePath, { toolCallId, ...(signal ? { signal } : {}) });
      const target = path.join(await sources.storeFor(caller.runId), relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return `Stored in the file store (${Buffer.byteLength(content, "utf8")} bytes).`;
    },
  });
