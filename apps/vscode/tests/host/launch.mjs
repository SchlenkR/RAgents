import { build } from "esbuild";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const serverUrl = process.env.RAGENTS_HOST_TEST_SERVER ?? "http://localhost:4710";
// With RAGENTS_HOST_TEST_PROFILE, the extension starts the host itself from this profile file instead of connecting to serverUrl.
const profileFile = process.env.RAGENTS_HOST_TEST_PROFILE;
// With RAGENTS_HOST_TEST_SECOND, a second target sits next to it; then the test runner checks both at the same time.
const secondUrl = process.env.RAGENTS_HOST_TEST_SECOND;
// With RAGENTS_HOST_TEST_SETTINGS, the test runner checks the settings page: VS Code starts without a target and without a host path, as after a fresh installation.
const settingsPath = process.env.RAGENTS_HOST_TEST_SETTINGS;
const connections = [
  profileFile ? { name: "test", profileFile } : { name: "test", url: serverUrl },
  ...(secondUrl ? [{ name: "second", url: secondUrl }] : []),
];
const executable = process.env.VSCODE_EXECUTABLE ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code";
const userDataDir = mkdtempSync(path.join(tmpdir(), "ragents-vscode-"));
const output = path.join(userDataDir, "report.json");

// Like apps/vscode/esbuild.mjs: in the CJS bundle, import.meta.url has no value that createRequire accepts.
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

// With RAGENTS_HOST_TEST_VSIX, the packaged extension runs instead of the checkout; its content is in the .vsix under extension/.
const vsix = process.env.RAGENTS_HOST_TEST_VSIX;
const developmentPath = vsix ? path.join(userDataDir, "vsix", "extension") : root;
if (vsix) {
  execFileSync("unzip", ["-q", "-o", path.resolve(vsix), "-d", path.join(userDataDir, "vsix")], { stdio: "inherit" });
  console.log(`== Extension from ${path.resolve(vsix)}`);
}

// The test instance must not inherit variables of the surrounding VS Code (task terminal, extension host), otherwise it attaches to the caller.
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VSCODE_|ELECTRON_)/.test(name)));
// With RAGENTS_HOST_TEST_WORKSPACE, the test runner also checks the client binding; VS Code gets the folder as workspace.
const workspace = process.env.RAGENTS_HOST_TEST_WORKSPACE;
const child = spawn(executable, [
  `--extensionDevelopmentPath=${developmentPath}`,
  `--extensionTestsPath=${path.join(root, "dist/host-tests.js")}`,
  `--user-data-dir=${userDataDir}`,
  `--extensions-dir=${path.join(userDataDir, "extensions")}`,
  "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-gpu",
  ...(workspace ? [path.resolve(workspace)] : []),
], { env: { ...environment, RAGENTS_HOST_TEST_OUTPUT: output }, stdio: ["ignore", "pipe", "pipe"] });
// A cancel by the caller ends exactly this test instance via its own PID, never another one.
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
let report = "no report";
try { report = readFileSync(output, "utf8"); } catch {}
console.log(report);
if (code !== 0) console.error(log.join("").split("\n").filter((line) => /error|Error|Timeout/.test(line)).slice(-20).join("\n"));
rmSync(userDataDir, { recursive: true, force: true });
process.exit(code ?? 1);
