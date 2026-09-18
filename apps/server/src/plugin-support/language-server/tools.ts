import { Type } from "typebox";
import { defineRunFunction, type ToolContributor } from "@aicontainer/ragents";
import { toolDescriptorFrom } from "../agent-tool.js";
import { alwaysAvailable } from "../tool-availability.js";
import type { LanguageServerHost } from "./host.js";

export const createLanguageServerToolContributor = (host: LanguageServerHost): ToolContributor => {
  const { id, label, rootDescription, languages } = host.adapter;
  const extensions = Object.keys(languages).join(", ");
  const openMetadata = {
    name: `${id}_open`,
    description: `Start the ${label} language server for this conversation's workspace and load ${rootDescription}. `
      + `Afterwards every edit or write of a ${extensions} file gets its diagnostics appended automatically, `
      + `and ${id}_diagnostics is available. Idempotent for the same root; a different root replaces the server.`,
  } as const;
  const diagnosticsMetadata = {
    name: `${id}_diagnostics`,
    nativeTool: true,
    description: `Current ${label} diagnostics (errors, warnings on request) for ${extensions} files from the running `
      + `language server, without building. Without paths: all changed files of the workspace according to git.`,
  } as const;
  const openTool = defineRunFunction({
    ...openMetadata,
    label: `${label} öffnen`,
    schema: Type.Object({
      root: Type.String({ description: `${rootDescription}, relative to the workspace root` }),
    }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: (scope, _toolCallId, input) => host.open(scope.caller.runId, input.root),
  });
  const diagnosticsTool = defineRunFunction({
    ...diagnosticsMetadata,
    label: `${label} Diagnostik`,
    schema: Type.Object({
      paths: Type.Optional(Type.Array(Type.String(), {
        description: "Files relative to the workspace root; omit for all changed files",
      })),
      warnings: Type.Optional(Type.Boolean({ description: "Also list warnings (default: only counted)" })),
    }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: (scope, _toolCallId, input) => host.diagnostics(scope.caller.runId, input.paths, input.warnings ?? false),
  });
  return {
    name: `ragents.lsp-${id}`,
    descriptors: [
      toolDescriptorFrom(openMetadata, alwaysAvailable),
      toolDescriptorFrom(diagnosticsMetadata, alwaysAvailable),
    ],
    tools: () => [openTool, diagnosticsTool],
  };
};
