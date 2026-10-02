import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

const bundle = process.argv[2];
if (!bundle || process.argv.length !== 3) throw new Error("Usage: node scripts/release/check-standalone.mjs <extracted bundle directory>");
const root = path.resolve(bundle);
const app = path.join(root, "app");
const windows = process.platform === "win32";
const node = path.join(root, "runtime", windows ? "node.exe" : "bin/node");
const cli = path.join(app, "scripts/package/ragents.mjs");
const launcher = path.join(root, "bin", windows ? "ragents.cmd" : "ragents");
for (const file of [node, cli, launcher]) assert.ok(existsSync(file), `Missing bundle file: ${file}`);

const temporary = mkdtempSync(path.join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "ragents standalone check "));
const work = path.join(temporary, "unrelated working directory");
mkdirSync(work);
const inherited = new Set(["PATH", "HOME", "USERPROFILE", "LOCALAPPDATA", "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "PATHEXT", "TMP", "TEMP", "TMPDIR", "LANG", "LC_ALL"]);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => inherited.has(key.toUpperCase()) && key.toUpperCase() !== "PATH"));
env.PATH = `${path.dirname(node)}${path.delimiter}${process.env.PATH ?? ""}`;
env.DATA_DIR = path.join(temporary, "data");
env.ACME_MODEL_KEY = "not-a-real-key";
const children = new Set();
let cancelled = false;
const scope = path.join(app, "node_modules/@ragents");
const originalLinks = new Set(existsSync(scope) ? readdirSync(scope) : []);

const stop = (child) => {
  if (!child.pid) return;
  if (windows) {
    if (child.exitCode === null && child.signalCode === null) {
      const killed = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8", timeout: 15_000 });
      if (killed.status !== 0 && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
};

const launch = (file, args, options = {}) => {
  if (cancelled) throw new Error("Standalone check interrupted");
  const child = spawn(file, args, { cwd: work, env, detached: !windows, stdio: ["ignore", "pipe", "pipe"], ...options });
  children.add(child);
  return child;
};

const command = (args) => windows
  ? [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `""${launcher}" ${args.map((argument) => `"${argument}"`).join(" ")}"`], { windowsVerbatimArguments: true }]
  : [launcher, args];

const run = async (file, args, options = {}) => {
  const child = launch(file, args, options);
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        stop(child);
        reject(new Error(`Command timed out: ${file}\n${output}`));
      }, 120_000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Command exited with ${code}: ${file}\n${output}`));
      });
    });
    return output;
  } finally {
    stop(child);
    children.delete(child);
  }
};

const write = (relative, content) => {
  const file = path.join(work, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};

const announcement = (child) => new Promise((resolve, reject) => {
  const lines = [];
  const timer = setTimeout(() => reject(new Error(`Host startup timed out:\n${lines.slice(-40).join("\n")}`)), 90_000);
  child.once("error", (error) => { clearTimeout(timer); reject(error); });
  child.once("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`Host exited with ${code}:\n${lines.slice(-40).join("\n")}`));
  });
  createInterface({ input: child.stderr }).on("line", (line) => lines.push(line));
  createInterface({ input: child.stdout }).on("line", (line) => {
    lines.push(line);
    if (!line.startsWith('{"ragents"')) return;
    clearTimeout(timer);
    try { resolve(JSON.parse(line).ragents); } catch (error) { reject(error); }
  });
});

const get = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, url);
  return response;
};

const rpc = async (host, method) => {
  const response = await get(`${host.url}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${host.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: {} }),
  });
  const body = await response.json();
  assert.equal(body.error, undefined, `${method}: ${JSON.stringify(body.error)}`);
  return body.result;
};

const interrupted = () => {
  cancelled = true;
  for (const child of children) stop(child);
  process.exitCode = 1;
};
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);

try {
  const help = await run(...command(["--help"]));
  assert.match(help, /Usage: ragents/);
  const version = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8")).version;
  assert.equal((await run(...command(["--version"]))).trim(), version);
  console.log("ok: launcher works from an unrelated directory with spaces and reports its version");

  const resolver = pathToFileURL(path.join(app, "packages/workspace-executor/src/bundled-tools.ts")).href;
  const toolCheck = `import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const { resolveBundledTools } = await import(${JSON.stringify(resolver)});
const tools = resolveBundledTools({ root: ${JSON.stringify(app)}, distribution: "package" });
assert.ok(tools.rg, "The bundle contains ripgrep");
const rg = spawnSync(tools.rg, ["--version"], { encoding: "utf8", timeout: 10_000 });
assert.equal(rg.status, 0, rg.stderr);
assert.match(rg.stdout, /^ripgrep /);
if (process.platform === "win32") {
  assert.ok(tools.bash, "The Windows bundle contains Bash");
  const bash = spawnSync(tools.bash, ["--noprofile", "--norc", "-c", "printf bundled-bash"], { encoding: "utf8", timeout: 10_000 });
  assert.equal(bash.status, 0, bash.stderr);
  assert.equal(bash.stdout, "bundled-bash");
}`;
  await run(node, ["--import", "tsx", "--input-type=module", "--eval", toolCheck], { cwd: path.join(app, "apps/server") });
  console.log(`ok: bundled ripgrep${windows ? " and Bash" : ""} execute`);

  write("acme.greeting/ragents-plugin.json", JSON.stringify({ id: "acme.greeting" }));
  write("acme.greeting/server/index.ts", `import { Type } from "typebox";
import { implement } from "@ragents/engine";
import { defineOperation } from "@ragents/engine/src/rpc/contract";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
const hello = defineOperation({ id: "acme.greeting.hello", description: "Greets from the bundle.", rights: [], input: Type.Object({}), result: Type.Object({ text: Type.String() }) });
export const plugin: PluginModule = { create: () => ({ manifest: { id: "acme.greeting" }, register: (host) => host.methods(implement(hello, () => ({ text: "Hello from the bundle" }))) }) };
`);
  write("acme.greeting/web/index.tsx", `import { Badge } from "@ragents/web/ui";
import type { WebPlugin } from "@ragents/web/PluginRegistry";
export const Greeting = () => <Badge className="bg-[#0b5f4a]">Hello</Badge>;
export const webPlugin: WebPlugin = { id: "acme.greeting" };
`);
  await run(...command(["plugin", "build", "./acme.greeting"]));
  assert.ok(existsSync(path.join(work, "dist/plugins/acme.greeting/ragents-bundle.json")));
  console.log("ok: bundled TypeScript and native esbuild compile a foreign plugin");

  write("ragents.config.smoke.ts", `import { env } from "@ragents/host/config-definition.js";
export const config = {
  host: { PORT: 4790, PRODUCT_PROFILE: "smoke", PRODUCT_ID: "acme", PRODUCT_TITLE: "Acme", PLUGINS: ["ragents.orchestration", "ragents.workspace", "ragents.product", "./dist/plugins/acme.greeting"] },
  "ragents.workspace": { PROCESS_SANDBOX: "off" },
  "ragents.product": { OPENROUTER_API_KEY: env("ACME_MODEL_KEY"), AGENT_MODEL: "z-ai/glm-5.3-flash", AGENT_COORDINATOR_MODEL: "z-ai/glm-5.3-flash" },
};
`);
  console.log("check: process sandbox explicitly off for the isolated packaging fixture; no model or workspace-tool calls");
  const child = launch(...command(["start", "./ragents.config.smoke.ts", "--port", "0"]));
  const host = await announcement(child);
  assert.match(host.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.ok(host.token);
  const bootstrap = await rpc(host, "ragents.plugins.bootstrap");
  const entry = bootstrap.plugins.find((plugin) => plugin.id === "acme.greeting")?.web?.entry;
  assert.equal(entry, "/plugins/acme.greeting/web/index.js");
  assert.deepEqual(await rpc(host, "acme.greeting.hello"), { text: "Hello from the bundle" });
  assert.match(await (await get(`${host.url}${entry}`)).text(), /webPlugin/);
  const html = await (await get(`${host.url}/?access=${host.token}`)).text();
  assert.equal(html, readFileSync(path.join(app, "apps/web/dist/index.html"), "utf8"));
  const assets = [...html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))"/g)].map((match) => match[1]);
  assert.ok(assets.length > 0, "The prebuilt web names its assets");
  for (const asset of assets) await get(new URL(asset, host.url));
  assert.match(await (await get(`${host.url}/ragents.css`)).text(), /bg-\\\[\\#0b5f4a\\\]/);
  console.log("ok: isolated host serves bootstrap, plugin RPC, prebuilt web assets and native Tailwind CSS");
} finally {
  for (const child of children) stop(child);
  await Promise.all([...children].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    const timer = setTimeout(resolve, 10_000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
  })));
  for (const name of existsSync(scope) ? readdirSync(scope) : []) {
    const link = path.join(scope, name);
    if (!originalLinks.has(name) && lstatSync(link).isSymbolicLink()) rmSync(link, { force: true });
  }
  rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
}
