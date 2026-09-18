import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const serverUrl = process.env.RAGENTS_HOST_TEST_SERVER ?? "http://localhost:4710";
const executable = process.env.VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const userDataDir = mkdtempSync(path.join(tmpdir(), "ragents-vscode-"));
const output = path.join(userDataDir, "report.json");

await build({ entryPoints: [path.join(root, "src/extension.ts")], bundle: true, outfile: path.join(root, "dist/extension.js"), platform: "node", format: "cjs", target: "node22", external: ["vscode"], logLevel: "silent" });
await build({ entryPoints: [path.join(root, "tests/host/run.ts")], bundle: true, outfile: path.join(root, "dist/host-tests.js"), platform: "node", format: "cjs", target: "node22", external: ["vscode"], logLevel: "silent" });
mkdirSync(path.join(userDataDir, "User"), { recursive: true });
writeFileSync(path.join(userDataDir, "User/settings.json"), JSON.stringify({
  "ragents.serverUrl": serverUrl, "workbench.startupEditor": "none", "security.workspace.trust.enabled": false,
  "update.mode": "none", "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false,
}, null, 2));

const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
const child = spawn(executable, [
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${path.join(root, "dist/host-tests.js")}`,
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${path.join(userDataDir, "extensions")}`,
  "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-gpu",
], { env: { ...environment, RAGENTS_HOST_TEST_OUTPUT: output }, stdio: ["ignore", "pipe", "pipe"] });
const log = [];
child.stdout.on("data", (chunk) => log.push(chunk.toString()));
child.stderr.on("data", (chunk) => log.push(chunk.toString()));
const code = await new Promise((resolve) => child.on("exit", resolve));
let report = "kein Bericht";
try { report = readFileSync(output, "utf8"); } catch {}
console.log(report);
if (code !== 0) console.error(log.join("").split("\n").filter((line) => /error|Error|Zeitüberschreitung/.test(line)).slice(-20).join("\n"));
rmSync(userDataDir, { recursive: true, force: true });
process.exit(code ?? 1);
