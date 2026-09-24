import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { announcement, assertGreetingServed, GREETING_PLUGIN, isolatedDirectory, profileSource, stopChild, writeFiles } from "../../apps/server/tests/foreign-plugin-fixture.ts";
import { buildPackage, PACKAGE_FOLDER, PACKAGE_NAME } from "./build-package.ts";

const run = (command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env) => {
  const result = spawnSync(command, [...args], { cwd, env, encoding: "utf8" });
  return { code: result.status, output: `${result.stdout}\n${result.stderr}` };
};

const BROKEN_PLUGIN: Readonly<Record<string, string>> = {
  "ragents-plugin.json": JSON.stringify({ id: "acme.broken" }),
  "server/index.ts": `import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
const count: number = "drei";
export const plugin: PluginModule = { create: () => ({ manifest: { id: "acme.broken" }, register: () => { console.log(count); } }) };
`,
};

test("aus dem installierten Paket baut ein fremder Autor in einem leeren Ordner sein Plugin samt Typprüfung und startet es mit einem eigenen Profil", { timeout: 600_000 }, async () => {
  const directory = isolatedDirectory("ragents-package-plugin-");
  const children: ChildProcess[] = [];
  try {
    const built = await buildPackage(path.join(directory, "build", PACKAGE_FOLDER));
    const packed = run("npm", ["pack", "--pack-destination", path.join(directory, "build")], built.directory);
    assert.equal(packed.code, 0, packed.output);
    const tarball = readdirSync(path.join(directory, "build")).find((name) => name.endsWith(".tgz"));
    assert.ok(tarball, packed.output);
    const prefix = path.join(directory, "prefix");
    const installed = run("npm", ["install", "--global", "--prefix", prefix, "--no-audit", "--no-fund", path.join(directory, "build", tarball)], directory);
    assert.equal(installed.code, 0, installed.output);
    const packageRoot = path.join(prefix, "lib", "node_modules", ...PACKAGE_NAME.split("/"));
    const ragents = path.join(prefix, "bin", "ragents");

    const work = path.join(directory, "work");
    mkdirSync(work);
    writeFiles(path.join(work, "acme.greeting"), GREETING_PLUGIN);
    writeFiles(path.join(work, "acme.broken"), BROKEN_PLUGIN);
    const greeting = run(ragents, ["plugin", "build", "./acme.greeting"], work);
    assert.equal(greeting.code, 0, greeting.output);
    assert.equal(existsSync(path.join(work, "dist/plugins/acme.greeting/ragents-bundle.json")), true, greeting.output);
    const broken = run(ragents, ["plugin", "build", "./acme.broken"], work);
    assert.equal(broken.code, 1, "die Typprüfung läuft auch im Paket");
    assert.match(broken.output, /server\/index\.ts:2:7: Type 'string' is not assignable to type 'number'/);

    writeFileSync(path.join(work, "ragents.config.greeting.ts"),
      profileSource("greeting", ["ragents.orchestration", "ragents.workspace", "ragents.product", "./dist/plugins/acme.greeting"]));
    const host = spawn(ragents, ["start", "./ragents.config.greeting.ts", "--port", "0"], {
      cwd: work,
      env: { ...process.env, ACME_MODEL_KEY: "kein-echter-schluessel", DATA_DIR: path.join(directory, "data"), RAGENTS_DEV: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(host);
    await assertGreetingServed(await announcement(host, []), path.join(packageRoot, "apps/web/dist"));
    for (const entry of ["apps/web/vite.config.ts", "apps/web/index.html"]) {
      assert.equal(existsSync(path.join(packageRoot, entry)), false, `${entry}: das Paket baut kein Web`);
    }
  } finally {
    for (const child of children) await stopChild(child);
    rmSync(directory, { recursive: true, force: true });
  }
});
