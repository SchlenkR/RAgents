import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { runFileExists } from "./files-route.js";
import { facesOperator } from "@ragents/host/plugin-support/tool-availability.js";

export const showDocumentToolMetadata = {
  name: "show_document",
  label: "Show document",
  nativeTool: true,
  description: "Shows documents completely in the interface; file paths only apply to this run's file store.",
  longDescription: "ALWAYS use this tool when the user wants to see the "
    + "content of a file or a longer document - instead of copying or paraphrasing the content in the "
    + "chat answer. path only shows a file from "
    + "this run's file store, NOT from your working directory. "
    + "Everything else - files of the working directory and content you produced yourself - goes through "
    + "content; if the content comes from a file, take it VERBATIM from the last "
    + "read or write result, never retyped from memory.",
} as const;

const sourceRule = "content and path exclude each other: valid are { title, content, format } for "
  + "self-produced content and files of the working directory, and { title, path, format } for files "
  + "of the file store - exactly one of the two must be set.";

const titleSchema = Type.String({ description: "Title of the display, e.g. the file name" });
const formatSchema = Type.Optional(Type.Union(
  [Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")],
  { description: "Rendering, default markdown" }));

const documentSource = (input: { content?: string; path?: string }):
  | { kind: "content" }
  | { kind: "file"; path: string } => {
  if ((input.content === undefined) === (input.path === undefined)) throw new Error(sourceRule);

  return input.path === undefined ? { kind: "content" } : { kind: "file", path: input.path };
};

export const createShowDocumentTool = (filesFor: (runId: string) => Promise<string>): RunFunction =>
  defineRunFunction({
    ...showDocumentToolMetadata,
    schema: Type.Object({
      title: titleSchema,
      content: Type.Optional(Type.String({
        description: "The complete content - for files from the working directory and for "
          + "self-produced content, i.e. everything that is not in the file store. " + sourceRule,
      })),
      path: Type.Optional(Type.String({
        description: "File from this run's file store, relative to the store (e.g. topic/file.md). "
          + "Only files stored there can be shown this way - for paths of the working directory "
          + "use content. The content is shown directly from the file and never has to be "
          + "retyped. " + sourceRule,
      })),
      format: formatSchema,
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: facesOperator,
    run: async ({ caller }, _toolCallId, input) => {
      const source = documentSource(input);

      if (source.kind === "content")
        return `Shown to the user: ${input.title}`;

      const path = source.path;
      if (path.startsWith("/") || path.split("/").includes(".."))
        throw new Error("path must be relative to the file store, without a leading / and without ..");
      if (!await runFileExists(await filesFor(caller.runId), path))
        throw new Error(
          `${source.path} is not in this run's file store. Only files of the `
          + "file store can be shown via path - for files from the working directory and for self-produced "
          + "content, pass the content via content.",
        );
      return `Shown to the user: ${input.title} (file ${path} from the file store)`;
    },
  });
