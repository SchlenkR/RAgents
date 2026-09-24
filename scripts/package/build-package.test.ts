import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { readPackageVersion } from "../../apps/server/src/host-version.ts";
import { buildPackage, PACKAGE_AUTHOR, PACKAGE_FOLDER, PACKAGE_KEYWORDS, PACKAGE_LICENSE, PACKAGE_NAME, PACKAGE_ROOT_FILES, PACKAGED_PROFILES } from "./build-package.ts";
import { commands } from "./ragents.mjs";

const built = async (t: TestContext) => {
  const target = path.join(await mkdtemp(path.join(tmpdir(), "ragents-package-")), PACKAGE_FOLDER);
  t.after(() => rm(path.dirname(target), { recursive: true, force: true }));
  return { target, result: await buildPackage(target) };
};

test("das Paket trägt Einstiegspunkt, Host-Version und die Dateien, die der Host lädt", async (t) => {
  const { target, result } = await built(t);
  const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(manifest.name, PACKAGE_NAME);
  assert.equal(manifest.version, readPackageVersion(), "die Fassung kommt aus der Wurzel-package.json des Repositories");
  assert.equal(manifest.type, "module");
  assert.deepEqual(manifest.bin, { ragents: "scripts/package/ragents.mjs" });
  assert.deepEqual(manifest.publishConfig, { access: "public" }, "ein Paket mit Scope ist sonst privat");
  assert.match((manifest.ragents as { hostVersion: string }).hostVersion, /^[0-9a-f]{40}$/);
  assert.equal(result.manifest.version, manifest.version);
  for (const command of Object.values(commands)) assert.equal(existsSync(path.join(target, command)), true, command);
  for (const file of ["apps/server/src/main.ts", "plugins/ragents.workspace/client/workspace-client.ts", "packages/workspace-executor/src/index.ts", "apps/web/src/rpc/client.ts"]) {
    assert.equal(existsSync(path.join(target, file)), true, file);
  }
  for (const profile of PACKAGED_PROFILES) {
    assert.equal(existsSync(path.join(target, `ragents.config.${profile}.ts`)), true, `ragents start ${profile} braucht die Profildatei im Paket`);
  }
  assert.equal(existsSync(path.join(target, "plugins/ragents.ask/web/QuestionCard.tsx")), true, "fremde Plugins bauen gegen die Exporte der eingebauten Quellen");
  for (const id of ["ragents.orchestration", "ragents.workspace", "ragents.lsp-roslyn"]) {
    assert.equal(existsSync(path.join(target, "bundles", id, "ragents-bundle.json")), true, `der Server lädt ${id} nur als Bundle`);
  }
  for (const file of ["packages/ai/dist/index.d.ts", "packages/agent/dist/index.d.ts"]) {
    assert.equal(existsSync(path.join(target, file)), true, `${file}: das Bauwerkzeug prüft fremde Plugins gegen die Typen der Agentenlaufzeit`);
  }
  assert.equal(existsSync(path.join(target, "packages/ai/dist/index.js")), false, "die Agentenlaufzeit läuft aus ihren Quellen, gebaut liegen nur Typen bei");
});

test("das Paket bringt das fertige Web mit und baut nichts: kein Vite, keine Einstiegsseiten, dafür Tailwind für das Stylesheet", async (t) => {
  const { target, result } = await built(t);
  for (const file of ["apps/web/dist/index.html", "apps/web/dist/run-panel.html", "apps/web/dist/host-web.json"]) {
    assert.equal(existsSync(path.join(target, file)), true, `${file} liefert der Host aus`);
  }
  for (const file of ["apps/web/vite.config.ts", "apps/web/index.html", "apps/web/run-panel.html", "apps/server/src/web-build.ts"]) {
    assert.equal(existsSync(path.join(target, file)), false, `${file} gehörte zum Web-Build je Profil`);
  }
  const dependencies = result.manifest.dependencies as Record<string, string>;
  for (const name of ["vite", "@vitejs/plugin-react", "@tailwindcss/vite"]) {
    assert.equal(dependencies[name], undefined, `${name} braucht das Paket nicht mehr`);
  }
  for (const name of ["tailwindcss", "tw-animate-css", "@tailwindcss/node", "@tailwindcss/oxide", "react", "react-dom"]) {
    assert.equal(dependencies[name] !== undefined, true, `${name} braucht der Host für Stylesheet, Mini-Apps oder das Bauwerkzeug`);
  }
});

test("das Paket nennt Lizenz, Autor und Fundstelle und trägt Lizenz und README an seiner Wurzel", async (t) => {
  const { target, result } = await built(t);
  const manifest = JSON.parse(await readFile(path.join(target, "package.json"), "utf8")) as Record<string, unknown>;
  assert.equal(manifest.license, PACKAGE_LICENSE, "die SPDX-Kennung der PolyForm Shield License 1.0.0");
  assert.equal(manifest.author, PACKAGE_AUTHOR);
  assert.deepEqual(manifest.repository, { type: "git", url: "git+https://github.com/SchlenkR/RAgents.git" });
  assert.equal(manifest.homepage, "https://schlenkr.github.io/RAgents/");
  assert.deepEqual(manifest.bugs, { url: "https://github.com/SchlenkR/RAgents/issues" });
  assert.deepEqual(manifest.keywords, [...PACKAGE_KEYWORDS]);
  assert.equal(result.manifest.license, manifest.license);
  for (const [, packaged] of PACKAGE_ROOT_FILES) assert.equal(existsSync(path.join(target, packaged)), true, `${packaged} gehört an die Wurzel des Pakets`);
  const license = await readFile(path.join(target, "LICENSE"), "utf8");
  assert.match(license, /^Required Notice: Copyright 2026 Ronald Schlenker$/m);
  assert.match(license, /# PolyForm Shield License 1\.0\.0/);
  const readme = await readFile(path.join(target, "README.md"), "utf8");
  assert.match(readme, /npm install -g @schlenkr\/ragents/);
  assert.match(readme, /PolyForm Shield License 1\.0\.0/);
  assert.equal(existsSync(path.join(target, "scripts/package/README.md")), false, "die Listing-README liegt nur an der Wurzel");
});

test("das Paket enthält keine Quellen, die niemand braucht, und keine fremden Abhängigkeiten", async (t) => {
  const { target, result } = await built(t);
  for (const entry of ["apps/vscode", "docs", "selftest", "build", "node_modules", "packages/agent/tests", "ragents.config.example.ts", "pnpm-workspace.yaml"]) {
    assert.equal(existsSync(path.join(target, entry)), false, entry);
  }
  for (const entry of ["scripts/remote/connect.test.ts", "scripts/agent/journal.test.ts", "scripts/package/build-package.test.ts", "scripts/workspace-client/run-workspace-client.test.ts"]) {
    assert.equal(existsSync(path.join(target, entry)), false, `${entry} prüft den Checkout, nicht das Paket`);
  }
  assert.equal(existsSync(path.join(target, "plugins/ragents.reference/run-scripts/word-game/tests/program.test.ts")), true,
    "die Prüfungen der Run-Scripts gehören zum gezeigten Beispiel");
  const dependencies = result.manifest.dependencies as Record<string, string>;
  assert.equal(dependencies.tsx !== undefined, true, "tsx lädt die TypeScript-Quellen zur Laufzeit");
  assert.equal(dependencies["typescript-language-server"] !== undefined, true, "der Executor löst ihn über require.resolve auf");
  assert.equal(dependencies.react !== undefined, true, "die Mini-Apps werden zur Laufzeit gebaut");
  assert.equal(dependencies.gsap, undefined, "gsap gehört zur Homepage, die nicht ins Paket geht");
  for (const [name, version] of Object.entries(dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+/, `${name} braucht eine feste Fassung`);
    assert.equal(name.startsWith("@ragents/"), false, `${name} liegt im Paket selbst`);
  }
  assert.equal(result.fileCount > 100, true, `${result.fileCount} Dateien`);
});
