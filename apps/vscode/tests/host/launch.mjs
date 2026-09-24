import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const serverUrl = process.env.RAGENTS_HOST_TEST_SERVER ?? "http://localhost:4710";
// Mit RAGENTS_HOST_TEST_PROFILE startet die Erweiterung den Host selbst aus dieser Profildatei statt sich mit serverUrl zu verbinden.
const profileFile = process.env.RAGENTS_HOST_TEST_PROFILE;
// Mit RAGENTS_HOST_TEST_SECOND steht ein zweites Ziel daneben; dann prüft der Testläufer beide gleichzeitig.
const secondUrl = process.env.RAGENTS_HOST_TEST_SECOND;
// Mit RAGENTS_HOST_TEST_SETTINGS prüft der Testläufer die Einstellungsseite: VS Code startet ohne Ziel und ohne Host-Pfad, wie nach einer frischen Installation.
const settingsPath = process.env.RAGENTS_HOST_TEST_SETTINGS;
const connections = [
  profileFile ? { name: "test", profileFile } : { name: "test", url: serverUrl },
  ...(secondUrl ? [{ name: "zweit", url: secondUrl }] : []),
];
const executable = process.env.VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const userDataDir = mkdtempSync(path.join(tmpdir(), "ragents-vscode-"));
const output = path.join(userDataDir, "report.json");

// Wie apps/vscode/esbuild.mjs: im CJS-Bundle hat import.meta.url keinen Wert, den createRequire annimmt.
const bundle = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["vscode"], logLevel: "silent",
  define: { "import.meta.url": "__importMetaUrl" },
  banner: { js: 'const __importMetaUrl = require("node:url").pathToFileURL(__filename).href;' } };
await build({ ...bundle, entryPoints: [path.join(root, "src/extension.ts")], outfile: path.join(root, "dist/extension.js") });
await build({ ...bundle, entryPoints: [path.join(root, "tests/host/run.ts")], outfile: path.join(root, "dist/host-tests.js") });
mkdirSync(path.join(userDataDir, "User"), { recursive: true });
writeFileSync(path.join(userDataDir, "User/settings.json"), JSON.stringify({
  "ragents.connections": settingsPath ? [] : connections,
  "ragents.hostPath": settingsPath ? "" : root.replace(/\/apps\/vscode\/?$/, ""),
  "workbench.startupEditor": "none", "security.workspace.trust.enabled": false,
  "update.mode": "none", "telemetry.telemetryLevel": "off", "extensions.autoUpdate": false,
}, null, 2));

// Mit RAGENTS_HOST_TEST_VSIX läuft die gepackte Erweiterung statt des Checkouts; ihr Inhalt liegt in der .vsix unter extension/.
const vsix = process.env.RAGENTS_HOST_TEST_VSIX;
const developmentPath = vsix ? path.join(userDataDir, "vsix", "extension") : root;
if (vsix) {
  execFileSync("unzip", ["-q", "-o", path.resolve(vsix), "-d", path.join(userDataDir, "vsix")], { stdio: "inherit" });
  console.log(`== Erweiterung aus ${path.resolve(vsix)}`);
}

// Die Testinstanz darf keine Variablen des umgebenden VS Code (Task-Terminal, Extension-Host) erben, sonst hängt sie sich an den Aufrufer.
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VSCODE_|ELECTRON_)/.test(name)));
// Mit RAGENTS_HOST_TEST_WORKSPACE prüft der Testläufer zusätzlich die Bindung client; VS Code bekommt den Ordner als Arbeitsbereich.
const workspace = process.env.RAGENTS_HOST_TEST_WORKSPACE;
const child = spawn(executable, [
  `--extensionDevelopmentPath=${developmentPath}`,
  `--extensionTestsPath=${path.join(root, "dist/host-tests.js")}`,
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${path.join(userDataDir, "extensions")}`,
  "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-gpu",
  ...(workspace ? [path.resolve(workspace)] : []),
], { env: { ...environment, RAGENTS_HOST_TEST_OUTPUT: output }, stdio: ["ignore", "pipe", "pipe"] });
// Ein Abbruch des Aufrufers beendet genau diese Testinstanz über ihre eigene PID, nie eine andere.
const stopInstance = () => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 10_000).unref();
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, stopInstance);
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
