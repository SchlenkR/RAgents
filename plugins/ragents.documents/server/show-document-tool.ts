import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { FILE_OPERATIONS } from "@ragents/workspace-executor";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";

export const showDocumentToolMetadata = {
  name: "show_document",
  label: "Show document",
  description: "Shows a file or a document completely in the interface: any file read reaches, also an image, or text you wrote.",
  longDescription: "ALWAYS use this tool when the user wants to see the content of a file or a longer document, instead of copying or "
    + "paraphrasing it in the chat answer. Name an existing file by its path and never retype its content: the display reads the file itself, "
    + "where it lies, also on a workstation or under @documents. Relative links and images inside a shown document resolve against its folder. "
    + "Text goes in as content only when you produced it yourself.",
} as const;

const sourceRule = "file_path and content exclude each other: valid are { title, file_path } for a file read reaches "
  + "and { title, content } for text you wrote, each with an optional format; exactly one of the two must be set.";

const filePathOf = (input: { file_path?: string; content?: string }): string | undefined => {
  if ((input.file_path === undefined) === (input.content === undefined)) throw new Error(sourceRule);
  return input.file_path;
};

export const createShowDocumentTool = (sandbox: Pick<SandboxServices, "execute">): RunFunction =>
  defineRunFunction({
    ...showDocumentToolMetadata,
    schema: Type.Object({
      title: Type.String({ description: "Title of the display, e.g. the file name" }),
      file_path: Type.Optional(Type.String({
        minLength: 1,
        description: "The file to show, named as read names it: relative to the working directory, absolute, or starting with an alias "
          + "such as @documents; the display reads it, so its content is never retyped. " + sourceRule,
      })),
      content: Type.Optional(Type.String({
        description: "The complete text you produced yourself; never the content of an existing file, which file_path names instead. " + sourceRule,
      })),
      format: Type.Optional(Type.Union(
        [Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")],
        { description: "Rendering; defaults to the file extension for a file and to markdown for content" })),
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "parallel",
    run: async ({ caller, signal }, toolCallId, input) => {
      const filePath = filePathOf(input);
      if (filePath !== undefined) await sandbox.execute(caller.runId, FILE_OPERATIONS.text, { path: filePath }, { toolCallId, ...(signal ? { signal } : {}) });
      return "Shown to the user.";
    },
  });
