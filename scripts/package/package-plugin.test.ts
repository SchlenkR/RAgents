import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { announcement, assertGreetingServed, GREETING_PLUGIN, isolatedDirectory, profileSource, stopChild, writeFiles } from "../../apps/server/tests/foreign-plugin-fixture.ts";
import { WORKSPACE_TOOL_TARGETS } from "../../packages/workspace-executor/src/bundled-tools.ts";
import { buildPackage, PACKAGE_FOLDER, PACKAGE_NAME } from "./build-package.ts";
import { buildToolsPackage } from "./tools-package.ts";

const run = (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env) => {
  const npmCli = command === "npm" && process.platform === "win32" ? windowsNpmCli(env) : undefined;
  const result = spawnSync(npmCli ? process.execPath : command, npmCli ? [npmCli, ...args] : [...args], { cwd, env, encoding: "utf8" });
  return { code: result.status, output: `${result.stdout}\n${result.stderr}` };
};

const windowsNpmCli = (env: NodeJS.ProcessEnv): string => {
  const located = spawnSync("where.exe", ["npm.cmd"], { env, encoding: "utf8" });
  const cli = (located.stdout ?? "").trim().split(/\r?\n/)
    .map((shim) => path.join(path.dirname(shim), "node_modules", "npm", "bin", "npm-cli.js"))
    .find((file) => existsSync(file));
  if (!cli) throw new Error("The package test needs Node's npm installation on PATH.");
  return cli;
};

const BROKEN_PLUGIN: Readonly<Record<string, string>> = {
  "ragents-plugin.json": JSON.stringify({ id: "acme.broken" }),
  "server/index.ts": `import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
const count: number = "three";
export const plugin: PluginModule = { create: () => ({ manifest: { id: "acme.broken" }, register: () => { console.log(count); } }) };
`,
};

test("from the installed package a third-party author builds their plugin in an empty folder including type checking and starts it with an own profile", { timeout: 600_000 }, async () => {
  const directory = isolatedDirectory("ragents-package-plugin-");
  const children: ChildProcess[] = [];
  try {
    const built = await buildPackage(path.join(directory, "build", PACKAGE_FOLDER));
    const packed = run("npm", ["pack", "--pack-destination", path.join(directory, "build")], built.directory);
    assert.equal(packed.code, 0, packed.output);
    const tarball = readdirSync(path.join(directory, "build")).find((name) => name.endsWith(".tgz"));
    assert.ok(tarball, packed.output);
    const target = WORKSPACE_TOOL_TARGETS.find((entry) => entry === `${process.platform}-${process.arch}`);
    assert.ok(target, "the installed package needs a supported workstation platform");
    const tools = await buildToolsPackage(target, built.manifest.version as string, path.join(directory, "tools"));
    const packedTools = run("npm", ["pack", "--pack-destination", directory], tools.directory);
    assert.equal(packedTools.code, 0, packedTools.output);
    const toolsTarball = readdirSync(directory).find((name) => name.endsWith(".tgz"));
    assert.ok(toolsTarball, packedTools.output);
    const prefix = path.join(directory, "prefix");
    const installed = run("npm", ["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", path.join(directory, "build", tarball), path.join(directory, toolsTarball)], directory);
    assert.equal(installed.code, 0, installed.output);
    const packageRoot = path.join(prefix, ...process.platform === "win32" ? [] : ["lib"], "node_modules", ...PACKAGE_NAME.split("/"));
    const ragents = path.join(packageRoot, "scripts/package/ragents.mjs");
    const toolsResolver = path.join(packageRoot, "packages/workspace-executor/src/bundled-tools.ts");
    const resolvedTools = run(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
      `import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const { resolveBundledTools } = await import(${JSON.stringify(pathToFileURL(toolsResolver).href)});
const tools = resolveBundledTools({ root: ${JSON.stringify(packageRoot)}, distribution: "package" });
assert.ok(tools.rg);
const rg = spawnSync(tools.rg, ["--version"], { encoding: "utf8" });
assert.equal(rg.status, 0, rg.stderr);
assert.match(rg.stdout, /^ripgrep /);
if (process.platform === "win32") {
  assert.ok(tools.bash);
  const bash = spawnSync(tools.bash, ["--noprofile", "--norc", "-c", "printf bundled-bash"], { encoding: "utf8" });
  assert.equal(bash.status, 0, bash.stderr);
  assert.equal(bash.stdout, "bundled-bash");
}`], path.join(packageRoot, "apps/server"));
    assert.equal(resolvedTools.code, 0, `the installed package executes its platform tools: ${resolvedTools.output}`);

    const compiler = path.join(packageRoot, "packages/ragents/src/typescript/async-compiler.ts");
    const compiled = run(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
      `const { compileVirtualTypeScriptAsync } = await import(${JSON.stringify(pathToFileURL(compiler).href)});
const result = await compileVirtualTypeScriptAsync({ sources: [{ fileName: "main.ts", text: "export const answer: number = 42;" }] });
if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));`], path.join(packageRoot, "apps/server"));
    assert.equal(compiled.code, 0, `the compiler worker starts under node_modules: ${compiled.output}`);

    const clientCompiler = path.join(packageRoot, "apps/server/src/plugin-support/actor-programs/client-compiler.ts");
    const appProject = path.join(packageRoot, "apps/server/src/plugin-support/actor-programs/app-project.ts");
    const actor = writeFiles(path.join(directory, "actor"), {
      "package.json": JSON.stringify({ private: true, type: "module", ragents: { title: "Example", views: [{ id: "main", client: "src/client.tsx" }] } }),
      "index.html": '<!doctype html><html><body><div id="root"></div></body></html>',
      "src/client.tsx": 'import { createRoot } from "react-dom/client"; import { Button } from "@ragents/client/ui"; createRoot(document.getElementById("root")!).render(<Button>Installed view</Button>);',
    });
    const client = run(process.execPath, ["--import", "tsx", "--input-type=module", "--eval",
      `const { ensureHostLinks } = await import(${JSON.stringify(pathToFileURL(path.join(packageRoot, "scripts/package/host-links.mjs")).href)});
ensureHostLinks(${JSON.stringify(packageRoot)});
const { prepareAppProject } = await import(${JSON.stringify(pathToFileURL(appProject).href)});
const { installClientSdk, compileClientProject } = await import(${JSON.stringify(pathToFileURL(clientCompiler).href)});
const directory = ${JSON.stringify(actor)};
const contracts = { stateSchema: { type: "object", properties: {} }, actions: [] };
await prepareAppProject(directory);
await installClientSdk(directory, contracts);
const result = await compileClientProject({ directory, entryPoint: "src/client.tsx", ...contracts });
if (!result.valid) throw new Error(JSON.stringify(result.diagnostics));
if (!result.javaScript.includes("Installed view")) throw new Error("The installed host produced no view bundle.");`], path.join(packageRoot, "apps/server"));
    assert.equal(client.code, 0, `a client view compiles from the installed package: ${client.output}`);

    const work = path.join(directory, "work");
    mkdirSync(work);
    writeFiles(path.join(work, "acme.greeting"), GREETING_PLUGIN);
    writeFiles(path.join(work, "acme.broken"), BROKEN_PLUGIN);
    const greeting = run(process.execPath, [ragents, "plugin", "build", "./acme.greeting"], work);
    assert.equal(greeting.code, 0, greeting.output);
    assert.equal(existsSync(path.join(work, "dist/plugins/acme.greeting/ragents-bundle.json")), true, greeting.output);
    const broken = run(process.execPath, [ragents, "plugin", "build", "./acme.broken"], work);
    assert.equal(broken.code, 1, "type checking also runs in the package");
    assert.match(broken.output, /server\/index\.ts:2:7: Type 'string' is not assignable to type 'number'/);

    writeFileSync(path.join(work, "ragents.config.greeting.ts"),
      profileSource("greeting", ["ragents.orchestration", "ragents.workspace", "ragents.product", "./dist/plugins/acme.greeting"]));
    const host = spawn(process.execPath, [ragents, "start", "./ragents.config.greeting.ts", "--port", "0"], {
      cwd: work,
      env: { ...process.env, ACME_MODEL_KEY: "not-a-real-key", DATA_DIR: path.join(directory, "data"), RAGENTS_DEV: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(host);
    await assertGreetingServed(await announcement(host, []), path.join(packageRoot, "apps/web/dist"));
    for (const entry of ["apps/web/vite.config.ts", "apps/web/index.html"]) {
      assert.equal(existsSync(path.join(packageRoot, entry)), false, `${entry}: the package builds no web`);
    }
  } finally {
    for (const child of children) await stopChild(child);
    rmSync(directory, { recursive: true, force: true });
  }
});
