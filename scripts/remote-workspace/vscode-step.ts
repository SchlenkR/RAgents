import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { mustRun } from "./processes.ts";
import type { KnownTask } from "./script-model.ts";

const GREETING_BEFORE = "Hallo aus dem Prüfprojekt";

/** TASK und SLEEP_TASK aus apps/vscode/tests/host/run.ts als Programme; ändert sich dort der Wortlaut, ruft das Modell keine Werkzeuge mehr. */
export const hostTestTasks: readonly KnownTask[] = [
  {
    marker: "ändere in src/greeter.ts die Grußzeile auf 'Hallo aus VS Code'",
    program: {
      id: "vscode-auftrag",
      steps: [
        { tool: "read", input: { path: "README.md" } },
        { tool: "edit", input: { path: "src/greeter.ts", edits: [{ oldText: GREETING_BEFORE, newText: "Hallo aus VS Code" }] } },
        { tool: "bash", input: { command: "ls -1 src" } },
        { tool: "typescript_open", input: { root: "." } },
        { tool: "typescript_diagnostics", input: {} },
        { tool: "document_write", input: { path: "bericht.md", content: "Grußzeile geändert, Diagnose gelaufen.\n" } },
      ],
    },
  },
  {
    marker: "bash mit dem Befehl sleep 120",
    program: { id: "vscode-sleep", steps: [{ tool: "bash", input: { command: "sleep 120" } }] },
  },
];

/** Ein kleines TypeScript-Projekt unter Git, wie es der Host-Test als Arbeitsbereich des Fensters erwartet. */
export const prepareVscodeProject = async (folder: string): Promise<void> => {
  await mkdir(path.join(folder, "src"), { recursive: true });
  await writeFile(path.join(folder, "README.md"), "# Prüfprojekt\n\nEin kleines Projekt für den VS-Code-Schritt des Prüfläufers.\n");
  await writeFile(path.join(folder, "src/greeter.ts"), `export const greeting = "${GREETING_BEFORE}";\n\nexport const greet = (name: string): string => \`\${greeting}, \${name}\`;\n`);
  await writeFile(path.join(folder, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "ESNext", noEmit: true }, include: ["src"] }, null, 2)}\n`);
  const git = (...args: string[]) => mustRun("git", ["-C", folder, "-c", "user.name=Prüflauf", "-c", "user.email=pruefung@example.invalid", "-c", "commit.gpgsign=false", ...args]);
  await git("init", "--quiet");
  await git("add", "--all");
  await git("commit", "--quiet", "--message", "Prüfprojekt");
};

export interface VscodeRun {
  readonly child: ChildProcess;
  readonly logFile: string;
}

/** Startet apps/vscode/tests/host/launch.mjs in eigener Prozessgruppe; der Launcher beendet seine Testinstanz nur über deren PID. */
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

/** Liest den Bericht, den launch.mjs als JSON ausgibt; ohne Bericht nennt das Ergebnis das Ende des Protokolls. */
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
  return { ok: false, detail: `launch.mjs endete mit ${code}: ${reason}` };
};
