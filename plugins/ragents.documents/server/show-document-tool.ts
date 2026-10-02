import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { runFileExists } from "./files-route.js";
import { relativeStorePath, type DocumentSources } from "./sources.js";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";

export const showDocumentToolMetadata = {
  name: "show_document",
  label: "Show document",
  description: "Shows a file or a document completely in the interface, for any file read reaches, a file of this run's file store, or text you wrote.",
  longDescription: "ALWAYS use this tool when the user wants to see the content of a file or a longer document, instead of copying or "
    + "paraphrasing it in the chat answer. Name an existing file by its path and never retype its content: the display reads the file itself, "
    + "where the workspace lies, also on a workstation. Text goes in as content only when you produced it yourself.",
} as const;

const sourceRule = "file_path, storePath and content exclude each other: valid are { title, file_path } for a file read reaches, "
  + "{ title, storePath } for a file of the file store and { title, content } for text you wrote, each with an optional format; "
  + "exactly one of the three must be set.";

const documentSource = (input: { file_path?: string; storePath?: string; content?: string }):
  | { kind: "workspace"; filePath: string }
  | { kind: "store"; storePath: string }
  | { kind: "content" } => {
  const given = [input.file_path, input.storePath, input.content].filter((value) => value !== undefined);
  if (given.length !== 1) throw new Error(sourceRule);
  if (input.file_path !== undefined) return { kind: "workspace", filePath: input.file_path };
  if (input.storePath !== undefined) return { kind: "store", storePath: input.storePath };
  return { kind: "content" };
};

export const createShowDocumentTool = (sources: DocumentSources): RunFunction =>
  defineRunFunction({
    ...showDocumentToolMetadata,
    schema: Type.Object({
      title: Type.String({ description: "Title of the display, e.g. the file name" }),
      file_path: Type.Optional(Type.String({
        minLength: 1,
        description: "The file to show, named as read names it: relative to the working directory, absolute, or starting with a workspace alias "
          + "such as @actors; the display reads it, so its content is never retyped. " + sourceRule,
      })),
      storePath: Type.Optional(Type.String({
        minLength: 1,
        description: "A file of this run's file store, relative to the store as document_write stored it, e.g. topic/report.md. " + sourceRule,
      })),
      content: Type.Optional(Type.String({
        description: "The complete text you produced yourself; never the content of an existing file, which file_path or storePath names instead. " + sourceRule,
      })),
      format: Type.Optional(Type.Union(
        [Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")],
        { description: "Rendering; defaults to the file extension for a file and to markdown for content" })),
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "parallel",
    run: async ({ caller, signal }, toolCallId, input) => {
      const source = documentSource(input);

      if (source.kind === "workspace")
        await sources.workspaceText(caller.runId, source.filePath, { toolCallId, ...(signal ? { signal } : {}) });

      if (source.kind === "store") {
        const relative = relativeStorePath(source.storePath);
        if (!await runFileExists(await sources.storeFor(caller.runId), relative))
          throw new Error(`${relative} is not in this run's file store; a file of the working directory goes in as file_path.`);
      }

      return "Shown to the user.";
    },
  });
