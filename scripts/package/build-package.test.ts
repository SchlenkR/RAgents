import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { readPackageVersion } from "../../apps/server/src/host-version.ts";
import { WORKSPACE_TOOL_TARGETS, workspaceToolsPackageName } from "../../packages/workspace-executor/src/bundled-tools.ts";
import { buildPackage, PACKAGE_AUTHOR, PACKAGE_FOLDER, PACKAGE_KEYWORDS, PACKAGE_LICENSE, PACKAGE_NAME, PACKAGE_ROOT_FILES, PACKAGED_PROFILES } from "./build-package.ts";
import { commands } from "./ragents.mjs";

const built = async (t: TestContext) => {
  const target = path.join(await mkdtemp(path.join(tmpdir(), "ragents-package-")), PACKAGE_FOLDER);
  t.after(() => rm(path.dirname(target), { recursive: true, force: true }));
  return { target, result: await buildPackage(target) };
};

test("the package carries entry point, host version and the files the host loads", async (t) => {
  const { target, result } = await built(t);
  const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(manifest.name, PACKAGE_NAME);
  assert.equal(manifest.version, readPackageVersion(), "the version comes from the repository's root package.json");
  assert.equal(manifest.type, "module");
  assert.deepEqual(manifest.bin, { ragents: "scripts/package/ragents.mjs" });
  assert.deepEqual(manifest.publishConfig, { access: "public" }, "a scoped package is private otherwise");
  assert.match((manifest.ragents as { hostVersion: string }).hostVersion, /^[0-9a-f]{40}$/);
  assert.equal(result.manifest.version, manifest.version);
  assert.deepEqual(manifest.optionalDependencies,
    Object.fromEntries(WORKSPACE_TOOL_TARGETS.map((target) => [workspaceToolsPackageName(target), manifest.version])));
  for (const command of Object.values(commands)) assert.equal(existsSync(path.join(target, command)), true, command);
  for (const file of ["apps/server/src/main.ts", "plugins/ragents.workspace/client/workspace-client.ts", "packages/workspace-executor/src/index.ts", "apps/web/src/rpc/client.ts"]) {
    assert.equal(existsSync(path.join(target, file)), true, file);
  }
  for (const profile of PACKAGED_PROFILES) {
    assert.equal(existsSync(path.join(target, `ragents.config.${profile}.ts`)), true, `ragents start ${profile} needs the profile file in the package`);
  }
  assert.equal(existsSync(path.join(target, "plugins/ragents.ask/web/QuestionCard.tsx")), true, "third-party plugins build against the exports of the built-in sources");
  for (const id of ["ragents.orchestration", "ragents.workspace", "ragents.lsp-roslyn", "ragents.acp"]) {
    assert.equal(existsSync(path.join(target, "bundles", id, "ragents-bundle.json")), true, `the server loads ${id} only as a bundle`);
  }
  for (const file of ["packages/ai/dist/index.d.ts", "packages/agent/dist/index.d.ts"]) {
    assert.equal(existsSync(path.join(target, file)), true, `${file}: the build tool checks third-party plugins against the types of the agent runtime`);
  }
  assert.equal(existsSync(path.join(target, "packages/ai/dist/index.js")), false, "the agent runtime runs from its sources, only types are included built");
});

test("the package brings the built web and builds nothing: no Vite, no entry pages, but Tailwind for the stylesheet", async (t) => {
  const { target, result } = await built(t);
  for (const file of ["apps/web/dist/index.html", "apps/web/dist/run-panel.html", "apps/web/dist/host-web.json"]) {
    assert.equal(existsSync(path.join(target, file)), true, `the host serves ${file}`);
  }
  for (const file of ["apps/web/vite.config.ts", "apps/web/index.html", "apps/server/src/web-build.ts"]) {
    assert.equal(existsSync(path.join(target, file)), false, `${file} belonged to the web build per profile`);
  }
  assert.equal(await readFile(path.join(target, "apps/web/dist/run-panel.html"), "utf8"),
    await readFile(path.join(target, "apps/web/dist/index.html"), "utf8"));
  const dependencies = result.manifest.dependencies as Record<string, string>;
  for (const name of ["vite", "@vitejs/plugin-react", "@tailwindcss/vite"]) {
    assert.equal(dependencies[name], undefined, `the package no longer needs ${name}`);
  }
  for (const name of ["tailwindcss", "tw-animate-css", "@tailwindcss/node", "@tailwindcss/oxide", "react", "react-dom"]) {
    assert.equal(dependencies[name] !== undefined, true, `the host needs ${name} for the stylesheet, mini-apps or the build tool`);
  }
});

test("the package names license, author and location and carries license and README at its root", async (t) => {
  const { target, result } = await built(t);
  const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(manifest.license, PACKAGE_LICENSE, "the SPDX id of the PolyForm Shield License 1.0.0");
  assert.equal(manifest.author, PACKAGE_AUTHOR);
  assert.deepEqual(manifest.repository, { type: "git", url: "git+https://github.com/SchlenkR/RAgents.git" });
  assert.equal(manifest.homepage, "https://schlenkr.github.io/RAgents/");
  assert.deepEqual(manifest.bugs, { url: "https://github.com/SchlenkR/RAgents/issues" });
  assert.deepEqual(manifest.keywords, [...PACKAGE_KEYWORDS]);
  assert.equal(result.manifest.license, manifest.license);
  for (const [, packaged] of PACKAGE_ROOT_FILES) assert.equal(existsSync(path.join(target, packaged)), true, `${packaged} belongs at the root of the package`);
  const license = await readFile(path.join(target, "LICENSE"), "utf8");
  assert.match(license, /^Required Notice: Copyright 2026 Ronald Schlenker$/m);
  assert.match(license, /# PolyForm Shield License 1\.0\.0/);
  const readme = await readFile(path.join(target, "README.md"), "utf8");
  assert.match(readme, /npm install -g @schlenkr\/ragents/);
  assert.match(readme, /PolyForm Shield License 1\.0\.0/);
  assert.equal(existsSync(path.join(target, "scripts/package/README.md")), false, "the listing README is only at the root");
});

test("the package contains no sources nobody needs and no foreign dependencies", async (t) => {
  const { target, result } = await built(t);
  for (const entry of ["apps/vscode", "docs", "selftest", "build", "node_modules", "packages/agent/tests", "ragents.config.example.ts", "pnpm-workspace.yaml"]) {
    assert.equal(existsSync(path.join(target, entry)), false, entry);
  }
  for (const entry of ["scripts/remote/connect.test.ts", "scripts/agent/journal.test.ts", "scripts/package/build-package.test.ts", "scripts/workspace-client/run-workspace-client.test.ts",
    "scripts/package/build-package.ts", "scripts/package/publish-package.ts", "scripts/package/tools-package.ts"]) {
    assert.equal(existsSync(path.join(target, entry)), false, `${entry} tests the checkout, not the package`);
  }
  assert.equal(existsSync(path.join(target, "plugins/ragents.reference/run-scripts/word-game/tests/program.test.ts")), true,
    "the run scripts' tests belong to the shown example");
  const dependencies = result.manifest.dependencies as Record<string, string>;
  assert.equal(dependencies.tsx !== undefined, true, "tsx loads the TypeScript sources at runtime");
  assert.equal(dependencies["@agentclientprotocol/sdk"], "1.7.0", "the ACP command uses the stable SDK shipped in the package");
  assert.equal(dependencies["typescript-language-server"] !== undefined, true, "the TypeScript contribution resolves it from the host's packages");
  assert.equal(dependencies.react !== undefined, true, "the mini-apps are built at runtime");
  assert.equal(dependencies.gsap, undefined, "gsap belongs to the homepage, which does not go into the package");
  for (const [name, version] of Object.entries(dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+/, `${name} needs a fixed version`);
    assert.equal(name.startsWith("@ragents/"), false, `${name} is in the package itself`);
  }
  assert.equal(result.fileCount > 100, true, `${result.fileCount} files`);
});

test("a trial release uses the proposed version in the built manifest and every optional tools dependency", async (t) => {
  const target = path.join(await mkdtemp(path.join(tmpdir(), "ragents-package-release-")), PACKAGE_FOLDER);
  t.after(() => rm(path.dirname(target), { recursive: true, force: true }));
  const originalVersion = readPackageVersion();
  const result = await buildPackage(target, undefined, "9.8.7");
  const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(result.manifest.version, "9.8.7");
  assert.equal(manifest.version, "9.8.7");
  assert.deepEqual(manifest.optionalDependencies,
    Object.fromEntries(WORKSPACE_TOOL_TARGETS.map((target) => [workspaceToolsPackageName(target), "9.8.7"])));
  assert.equal(readPackageVersion(), originalVersion);
});
