import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mustRun } from "./processes.ts";
import type { KnownTask } from "./script-model.ts";

const GREETING_BEFORE = "Hello from the check project";

/** TASK and SLEEP_TASK from apps/vscode/tests/host/run.ts as programs; if the wording changes there, the model no longer calls tools. */
export const hostTestTasks: readonly KnownTask[] = [
  {
    marker: "change the greeting line in src/greeter.ts to 'Hello from VS Code'",
    program: {
      id: "vscode-task",
      steps: [
        { tool: "read", input: { file_path: "README.md" } },
        { tool: "edit", input: { file_path: "src/greeter.ts", old_string: GREETING_BEFORE, new_string: "Hello from VS Code" } },
        { tool: "bash", input: { command: "ls -1 src" } },
        { tool: "typescript_open", input: { root: "." } },
        { tool: "typescript_diagnostics", input: {} },
        { tool: "write", input: { file_path: "@documents/report.md", content: "Greeting line changed, diagnostics ran.\n" } },
      ],
    },
  },
  {
    marker: "bash with the command sleep 120",
    program: { id: "vscode-sleep", steps: [{ tool: "bash", input: { command: "sleep 120" } }] },
  },
];

/** A small TypeScript project under Git, as the host test expects it as the window's workspace. */
export const prepareVscodeProject = async (folder: string): Promise<void> => {
  await mkdir(path.join(folder, "src"), { recursive: true });
  await writeFile(path.join(folder, "README.md"), "# Check project\n\nA small project for the check runner's VS Code step.\n");
  await writeFile(path.join(folder, "src/greeter.ts"), `export const greeting = "${GREETING_BEFORE}";\n\nexport const greet = (name: string): string => \`\${greeting}, \${name}\`;\n`);
  await writeFile(path.join(folder, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", noEmit: true }, include: ["src"] }, null, 2)}\n`);
  const git = (...args: string[]) => mustRun("git", ["-C", folder, "-c", "user.name=Check run", "-c", "user.email=check@example.invalid", "-c", "commit.gpgsign=false", ...args]);
  await git("init", "--quiet");
  await git("add", "--all");
  await git("commit", "--quiet", "--message", "Check project");
};

export interface VscodeRun {
  readonly child: ChildProcess;
  readonly logFile: string;
}

/** Starts apps/vscode/tests/host/launch.mjs in its own process group; the launcher ends its test instance only through its PID. */
export const startVscodeHostTest = (root: string, environment: NodeJS.ProcessEnv, logFile: string): VscodeRun => {
  const log = openSync(logFile, "a");
  const child = spawn(process.execPath, [path.join(root, "apps/vscode/tests/host/launch.mjs")], {
    cwd: path.join(root, "apps/vscode"),
    env: environment,
    detached: true,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  return { child, logFile };
};

export interface VscodeOutcome {
  readonly ok: boolean;
  readonly detail: string;
}

/** Reads the report that launch.mjs prints as JSON; without a report the result names the end of the log. */
export const vscodeOutcome = (logFile: string, code: number | null): VscodeOutcome => {
  const log = readFileSync(logFile, "utf8");
  const printed = /^\{[\s\S]*?^\}$/m.exec(log)?.[0];
  const report = printed === undefined ? undefined : (() => {
    try { return JSON.parse(printed) as { ok?: boolean; error?: string; workspace?: { runId?: string; firstTurn?: { completed?: string[] } } }; }
    catch { return undefined; }
  })();
  if (report?.ok === true && code === 0) {
    const completed = report.workspace?.firstTurn?.completed ?? [];
    return { ok: true, detail: `Run ${report.workspace?.runId?.slice(0, 8) ?? "?"}: ${completed.join(", ")}` };
  }
  const reason = report?.error ?? log.trim().split("\n").slice(-12).join("\n");
  return { ok: false, detail: `launch.mjs ended with ${code}: ${reason}` };
};
