import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";

export const documentWriteToolMetadata = {
  name: "document_write",
  label: "Store document",
  nativeTool: true,
  description: "Stores a file with the given content in this run's file store.",
  longDescription: "Documents, reports and intermediate products belong in the file store, not in the "
    + "working directory - that only holds what belongs to the task itself. The user sees the "
    + "store in the \"Documents\" area, grouped by subdirectory. To put a file from the "
    + "workspace into the store, read it first with read and pass the content here as content. "
    + "The store is not a bash path: it does not live in the workspace and can only be written "
    + "through this tool.",
} as const;

const relativeStorePath = (value: string): string => {
  const normalized = value.replace(/^\.\//, "");
  if (path.isAbsolute(normalized) || normalized.split("/").includes("..") || normalized.trim() === "") {
    throw new Error("path must be relative to the file store, without a leading / and without ..");
  }
  return normalized;
};

export const createDocumentWriteTool = (filesFor: (runId: string) => Promise<string>): RunFunction =>
  defineRunFunction({
    ...documentWriteToolMetadata,
    schema: Type.Object({
      path: Type.String({ minLength: 1, description: "Path in the file store, e.g. topic/report.md" }),
      content: Type.String({ description: "The complete content of the file" }),
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async (scope, _toolCallId, input) => {
      const relative = relativeStorePath(input.path);
      const target = path.join(await filesFor(scope.caller.runId), relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, input.content, "utf8");
      return `Stored in the file store: ${relative} (${Buffer.byteLength(input.content, "utf8")} bytes)`;
    },
  });
