import { realpath } from "node:fs/promises";

/** A node:test reporter that writes one JSON line per passed test, failed test and stderr line of a test file. */
const reporterSource = `
import { inspect } from "node:util";
const shown = (value) => inspect(value, { depth: 4, breakLength: Infinity, maxArrayLength: 20, maxStringLength: 200 }).slice(0, 300);
export default async function* (source) {
  for await (const { type, data } of source) {
    if (type === "test:pass" && data.details?.type !== "suite") yield JSON.stringify({ kind: "pass" }) + "\\n";
    if (type === "test:fail" && data.details?.type !== "suite" && data.details?.error?.failureType !== "subtestsFailed") {
      const error = data.details.error;
      const cause = error.cause instanceof Error ? error.cause : error;
      const assertion = cause.code === "ERR_ASSERTION";
      yield JSON.stringify({ kind: "fail", name: data.name, file: data.file ?? null, line: data.line ?? null, column: data.column ?? null,
        message: String(cause.message), generated: cause.generatedMessage === true, stack: String(cause.stack ?? ""),
        ...(assertion ? { expected: shown(cause.expected), actual: shown(cause.actual) } : {}) }) + "\\n";
    }
    if (type === "test:stderr") yield JSON.stringify({ kind: "stderr", file: data.file ?? null, message: String(data.message) }) + "\\n";
  }
}
`;

export const testReporterArgument = `--test-reporter=data:text/javascript,${encodeURIComponent(reporterSource)}`;

type TestRecord =
    | { kind: "pass" }
    | { kind: "fail"; name: string; file: string | null; line: number | null; column: number | null; message: string; generated: boolean; stack: string; expected?: string; actual?: string }
    | { kind: "stderr"; file: string | null; message: string };

const maxDetailed = 10;
const frameLine = /^\s+at /;

/** The lines of an error output that name the error, without stack frames, code excerpts and the Node version. */
const errorLines = (lines: readonly string[]): string[] => {
    const meaningful = lines.map((line) => line.trimEnd()).filter((line) => line.trim() !== "" && !frameLine.test(line) && !/^Node\.js v\d/.test(line) && !/^\s*\^+$/.test(line));
    const named = meaningful.filter((line) => /^[A-Za-z]*Error\b/.test(line));
    return (named.length > 0 ? named : meaningful.slice(-5)).slice(0, 5);
};

/** Collects the reporter lines of a test run and turns them into a short failure report: counts, and per failed test its name, message, expected and actual values and its place in the program. */
export const createTestReport = async (directory: string) => {
    const roots = [...new Set([directory, await realpath(directory)])].sort((left, right) => right.length - left.length);
    const relative = (text: string): string => roots.reduce((result, root) => result.replaceAll(`file://${root}/`, "").replaceAll(`${root}/`, ""), text);
    const failures: Extract<TestRecord, { kind: "fail" }>[] = [];
    const stderrByFile = new Map<string, string[]>();
    const unparsed: string[] = [];
    let passed = 0;
    let failed = 0;
    let pending = "";

    const record = (line: string): void => {
        if (line.trim() === "") return;
        let parsed: TestRecord;
        try {
            parsed = JSON.parse(line) as TestRecord;
        } catch {
            unparsed.push(line);
            return;
        }
        if (parsed.kind === "pass") passed += 1;
        if (parsed.kind === "fail") {
            failed += 1;
            if (failures.length < maxDetailed) failures.push(parsed);
        }
        if (parsed.kind === "stderr") {
            const lines = stderrByFile.get(parsed.file ?? "") ?? [];
            stderrByFile.set(parsed.file ?? "", [...lines, ...parsed.message.split("\n")].slice(-50));
        }
    };

    const placeOf = (failure: Extract<TestRecord, { kind: "fail" }>): string => {
        const frame = failure.stack.split("\n").filter((line) => frameLine.test(line)).map(relative)
            .map((line) => /\(?([^\s()]+:\d+:\d+)\)?\s*$/.exec(line)?.[1])
            .find((place) => place !== undefined && !place.startsWith("/") && !place.startsWith("node:") && !place.includes("node_modules/"));
        const declared = failure.file === null ? failure.name : `${relative(failure.file)}${failure.line === null ? "" : `:${failure.line}:${failure.column ?? 1}`}`;
        return frame ?? declared;
    };

    const describe = (failure: Extract<TestRecord, { kind: "fail" }>): string => {
        const fileOutput = failure.message === "test failed" && failure.file !== null ? stderrByFile.get(failure.file) ?? stderrByFile.get(relative(failure.file)) : undefined;
        const message = fileOutput ? errorLines(fileOutput).join("; ") : failure.generated ? failure.message.split("\n")[0]!.replace(/:$/, "") : failure.message.trim().slice(0, 500);
        const values = failure.expected === undefined ? "" : ` - erwartet ${failure.expected}, tatsächlich ${failure.actual}`;
        return `- ${failure.name} (${placeOf(failure)}): ${relative(message)}${relative(values)}`;
    };

    return {
        stdout: (chunk: string): void => {
            const lines = (pending + chunk).split("\n");
            pending = lines.pop() ?? "";
            lines.forEach(record);
        },
        report: (name: string, outcome: { code: number | null; timedOut: boolean; stderr: string }): string => {
            record(pending);
            pending = "";
            const summary = outcome.timedOut
                ? `Tests für ${name} nach Zeitüberschreitung abgebrochen: ${passed} bestanden, ${failed} fehlgeschlagen.`
                : `Tests für ${name} fehlgeschlagen: ${passed} bestanden, ${failed} fehlgeschlagen.`;
            const details = failures.map(describe);
            const more = failed > failures.length ? [`... und ${failed - failures.length} weitere`] : [];
            const withoutResult = failed === 0
                ? [`Der Testlauf endete${outcome.code === null ? "" : ` mit Code ${outcome.code}`} ohne fehlgeschlagenen Test:`, ...errorLines([...unparsed, ...outcome.stderr.split("\n")]).map(relative)]
                : [];
            return [summary, ...details, ...more, ...withoutResult].join("\n");
        },
    };
};
