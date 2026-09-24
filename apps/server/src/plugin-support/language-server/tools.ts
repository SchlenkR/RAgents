import { Type } from "typebox";
import { defineRunFunction, type ToolContributor } from "@ragents/engine";
import {
  languageServerCloseOperation,
  languageServerDiagnosticsOperation,
  languageServerOpenOperation,
  type LanguageServerAdapter,
} from "@ragents/workspace-executor";
import { toolDescriptorFrom } from "../agent-tool.js";
import { alwaysAvailable } from "../tool-availability.js";
import type { SandboxServices } from "../workspace-sandbox-host.js";

/** Beschreibung und Weiterreichung: der Sprachserver läuft im Executor des Runs, nicht in diesem Plugin. */
export const createLanguageServerToolContributor = (
  adapter: LanguageServerAdapter,
  sandbox: SandboxServices,
): ToolContributor => {
  const { id, label, rootDescription, languages } = adapter;
  const extensions = Object.keys(languages).join(", ");
  const openMetadata = {
    name: languageServerOpenOperation(id),
    nativeTool: true,
    description: `Start a ${label} language server instance for this run's workspace and load ${rootDescription}. `
      + `Afterwards every edit or write of a ${extensions} file gets its diagnostics appended automatically, `
      + `and ${languageServerDiagnosticsOperation(id)} is available. Idempotent for the same root; other roots stay open.`,
  } as const;
  const diagnosticsMetadata = {
    name: languageServerDiagnosticsOperation(id),
    nativeTool: true,
    description: `Current ${label} diagnostics (errors, warnings on request) for ${extensions} files from the running `
      + `language server, without building. Without paths: all changed files of every open root according to git. `
      + `With paths every file is answered by the instance whose root contains it; root asks one instance.`,
  } as const;
  const closeMetadata = {
    name: languageServerCloseOperation(id),
    nativeTool: true,
    description: `Stop the ${label} language server instance of one root; without root every ${label} instance of `
      + "this conversation. Other languages and other conversations stay untouched.",
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
    run: async (scope, toolCallId, input) =>
      await sandbox.execute(scope.caller.runId, openMetadata.name, input, {
        toolCallId,
        ...(scope.signal ? { signal: scope.signal } : {}),
      }) as string,
  });
  const diagnosticsTool = defineRunFunction({
    ...diagnosticsMetadata,
    label: `${label} Diagnostik`,
    schema: Type.Object({
      paths: Type.Optional(Type.Array(Type.String(), {
        description: "Files relative to the workspace root; omit for all changed files",
      })),
      root: Type.Optional(Type.String({ description: "Ask only the instance of this open root" })),
      warnings: Type.Optional(Type.Boolean({ description: "Also list warnings (default: only counted)" })),
    }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async (scope, toolCallId, input) =>
      await sandbox.execute(scope.caller.runId, diagnosticsMetadata.name, input, {
        toolCallId,
        ...(scope.signal ? { signal: scope.signal } : {}),
      }) as string,
  });
  const closeTool = defineRunFunction({
    ...closeMetadata,
    label: `${label} schließen`,
    schema: Type.Object({
      root: Type.Optional(Type.String({ description: "The open root to stop; omit for every instance of this run" })),
    }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async (scope, toolCallId, input) =>
      await sandbox.execute(scope.caller.runId, closeMetadata.name, input, {
        toolCallId,
        ...(scope.signal ? { signal: scope.signal } : {}),
      }) as string,
  });
  return {
    name: `ragents.lsp-${id}`,
    descriptors: [
      toolDescriptorFrom(openMetadata, alwaysAvailable),
      toolDescriptorFrom(diagnosticsMetadata, alwaysAvailable),
      toolDescriptorFrom(closeMetadata, alwaysAvailable),
    ],
    tools: () => [openTool, diagnosticsTool, closeTool],
  };
};
