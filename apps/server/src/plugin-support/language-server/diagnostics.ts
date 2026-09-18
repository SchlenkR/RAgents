import type { LanguageServerDiagnostic, LanguageServerSeverity } from "./contract.js";
import type { Diagnostic } from "./session.js";

const ERROR = 1;
const WARNING = 2;
const MAX_LINES = 30;
const MAX_ENTRIES = 200;

const severityNames: Readonly<Record<number, LanguageServerSeverity>> = {
  1: "error",
  2: "warning",
  3: "information",
  4: "hint",
};

const severityOf = (diagnostic: Diagnostic): number => diagnostic.severity ?? ERROR;

const byPlace = (left: Diagnostic, right: Diagnostic): number =>
  severityOf(left) - severityOf(right)
  || left.range.start.line - right.range.start.line
  || left.range.start.character - right.range.start.character;

const firstLine = (message: string): string => message.split("\n")[0].trim();

const lineOf = (relativePath: string, diagnostic: Diagnostic): string => {
  const { line, character } = diagnostic.range.start;
  const kind = severityOf(diagnostic) === ERROR ? "error" : "warning";
  const code = diagnostic.code === undefined ? "" : ` ${diagnostic.code}`;
  return `${relativePath}:${line + 1}:${character + 1} ${kind}${code}: ${firstLine(diagnostic.message)}`;
};

export const diagnosticEntries = (diagnostics: readonly Diagnostic[]): LanguageServerDiagnostic[] =>
  [...diagnostics]
    .sort(byPlace)
    .slice(0, MAX_ENTRIES)
    .map((diagnostic) => ({
      line: diagnostic.range.start.line + 1,
      character: diagnostic.range.start.character + 1,
      severity: severityNames[severityOf(diagnostic)] ?? "error",
      ...(diagnostic.code === undefined ? {} : { code: String(diagnostic.code) }),
      message: firstLine(diagnostic.message),
    }));

export const formatDiagnostics = (
  label: string,
  relativePath: string,
  diagnostics: readonly Diagnostic[],
  includeWarnings: boolean,
): string => {
  const errors = diagnostics.filter((diagnostic) => severityOf(diagnostic) === ERROR);
  const warnings = diagnostics.filter((diagnostic) => severityOf(diagnostic) === WARNING);
  const warningNote = warnings.length === 0
    ? ""
    : `, ${warnings.length} ${warnings.length === 1 ? "Warnung" : "Warnungen"}`;
  const heading = errors.length === 0
    ? `Diagnostik (${label}) ${relativePath}: keine Fehler${warningNote}`
    : `Diagnostik (${label}) ${relativePath}: ${errors.length} Fehler${warningNote}`;
  const listed = [...errors, ...(includeWarnings ? warnings : [])].sort(byPlace);
  const lines = listed.slice(0, MAX_LINES).map((diagnostic) => lineOf(relativePath, diagnostic));
  if (listed.length > MAX_LINES) lines.push(`... und ${listed.length - MAX_LINES} weitere`);
  return [heading, ...lines].join("\n");
};
