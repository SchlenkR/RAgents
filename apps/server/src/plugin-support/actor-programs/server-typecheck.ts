import path from "node:path";
import ts from "typescript";
import { programGuardDiagnostics } from "./program-guards.js";

export interface ServerTypecheck {
  readonly lines: string[];
  readonly files: string[];
}

export const typecheckServerProgram = (input: { readonly directory: string; readonly backend?: string | undefined }): ServerTypecheck => {
  const { directory, backend } = input;
  const configPath = path.join(directory, "tsconfig.server.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory, { noEmit: true }, configPath);
  const rootNames = [...new Set([...parsed.fileNames, ...(backend ? [path.resolve(directory, backend)] : [])])];
  const program = ts.createProgram(rootNames, parsed.options);
  const configErrors = parsed.errors.filter((diagnostic) => !(backend && diagnostic.code === 18003));
  const lines = [...[...(config.error ? [config.error] : []), ...configErrors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => {
    const start = diagnostic.file && diagnostic.start !== undefined ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
    return `${diagnostic.file ? path.relative(directory, diagnostic.file.fileName) : "tsconfig.server.json"}${start ? `:${start.line + 1}:${start.character + 1}` : ""} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
  }), ...programGuardDiagnostics(program, directory)];
  return { lines, files: program.getSourceFiles().map((file) => file.fileName) };
};

export const typecheckServerProject = (directory: string, backend?: string): string[] => typecheckServerProgram({ directory, backend }).lines;
