import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { HOST_API_VERSION, HOST_MODULES_GLOBAL, providedByHost } from "../src/host-api.ts";
import { readHostApiRecord } from "../src/host-version.ts";
import { buildPlugins, watchPlugins, type PluginBuildOutcome } from "../src/plugin-build/build.ts";
import { BUNDLE_FORMAT, bundleRevision, sourceRevisionOf, type BundleManifest } from "../src/profile/bundle-manifest.ts";
import { importBundles, loadPlugins, resolvePluginEntries } from "../src/profile/plugin-discovery.ts";
import { readPluginSource, sourceFileOf } from "../src/plugin-build/plugin-description.ts";
import { pluginsRoot } from "../src/plugin-support/plugins-root.ts";
import { parsePluginArguments } from "../../../scripts/plugin/plugin-cli.ts";
import { EXECUTOR_CONTRIBUTION_FILE, prepareExecutorContribution } from "@ragents/workspace-executor";

const scratch = (): string => mkdtempSync(path.join(tmpdir(), "ragents-plugin-build-"));

const writeFiles = (root: string, files: Readonly<Record<string, string>>): void => {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
};

/** Module specifiers a built file imports, from its syntax tree so that strings with import text do not count. */
const importsOf = (file: string): readonly string[] => {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) found.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const scriptsBelow = (folder: string): readonly string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? scriptsBelow(full) : entry.name.endsWith(".js") ? [full] : [];
  });

const requiresOf = (folder: string): readonly string[] => {
  const file = path.join(folder, "server/index.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "requires" && ts.isArrayLiteralExpression(node.initializer)) {
      found.push(...node.initializer.elements.filter(ts.isStringLiteral).map((element) => element.text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const built = (outcome: PluginBuildOutcome | undefined): Extract<PluginBuildOutcome, { kind: "built" }> => {
  assert.ok(outcome, "no outcome");
  assert.equal(outcome.kind, "built", outcome.kind === "failed" ? `${outcome.id}:\n${outcome.problems.join("\n")}` : "");
  return outcome as Extract<PluginBuildOutcome, { kind: "built" }>;
};

const problemsOf = (outcomes: readonly PluginBuildOutcome[], id: string): string => {
  const outcome = outcomes.find((candidate) => candidate.id === id);
  assert.ok(outcome, `no outcome for ${id}`);
  assert.equal(outcome.kind, "failed", `${id} was built although it must be rejected`);
  return (outcome as Extract<PluginBuildOutcome, { kind: "failed" }>).problems.join("\n");
};

test("all built-in plugins build into bundles with exactly one entry point, using only the host API and declared exports", async () => {
  const out = scratch();
  try {
    const folders = readdirSync(pluginsRoot).map((entry) => path.join(pluginsRoot, entry)).filter((folder) => statSync(folder).isDirectory());
    const outcomes = await buildPlugins(folders, { out, typecheck: false });
    const record = readHostApiRecord();
    assert.equal(outcomes.length, folders.length);
    for (const folder of folders) {
      const source = readPluginSource(folder);
      const id = source.description.id;
      const { manifest, bundle } = built(outcomes.find((outcome) => outcome.id === id));
      assert.deepEqual(JSON.parse(readFileSync(path.join(bundle, "ragents-bundle.json"), "utf8")) as BundleManifest, manifest);
      assert.equal(manifest.format, BUNDLE_FORMAT);
      assert.equal(manifest.api, HOST_API_VERSION);
      assert.equal(manifest.sourceRevision, sourceRevisionOf(folder), `${id}: the source revision names the folder the bundle is built from`);
      assert.equal("source" in manifest, false, "a bundle names no path to its sources");
      assert.equal(manifest.id, id);
      assert.equal(manifest.revision, bundleRevision(bundle), `${id}: the revision does not cover all files`);
      assert.ok(existsSync(path.join(bundle, manifest.server)), `${id}: ${manifest.server} is missing`);
      assert.equal(manifest.web !== undefined, sourceFileOf(path.join(folder, "web/index")) !== undefined, `${id}: web half`);
      if (manifest.web) {
        assert.ok(existsSync(path.join(bundle, manifest.web.entry)));
        assert.ok(Array.isArray(JSON.parse(readFileSync(path.join(bundle, manifest.web.classes), "utf8"))));
      }
      assert.equal(manifest.executor !== undefined, sourceFileOf(path.join(folder, "executor")) !== undefined, `${id}: executor contribution`);
      if (manifest.executor) {
        assert.deepEqual(importsOf(path.join(bundle, manifest.executor)).filter((specifier) => !isBuiltin(specifier)), [],
          `${id}: the executor contribution loads without the host and imports only node:*`);
      }
      for (const half of ["server", "web"] as const) {
        assert.deepEqual(Object.keys(manifest.exports[half]), source.description.exports[half], `${id}: exports ${half}`);
        for (const file of Object.values(manifest.exports[half])) assert.ok(existsSync(path.join(bundle, file)), `${id}: ${file} is missing`);
      }
      for (const asset of manifest.assets) assert.ok(existsSync(path.join(bundle, asset)), `${id}: asset ${asset} is missing`);
      for (const half of ["server", "web"] as const) {
        for (const [specifier, names] of Object.entries(manifest.hostNames[half])) {
          assert.deepEqual(names.filter((name) => !record[half][specifier]?.includes(name)), [], `${id}: ${half} ${specifier} names names outside the host API`);
        }
      }
      const requires = requiresOf(folder);
      for (const used of manifest.uses) assert.ok(requires.includes(used), `${id} uses ${used}, which is not in requires`);

      for (const file of scriptsBelow(path.join(bundle, "server"))) {
        for (const specifier of importsOf(file)) {
          if (specifier.startsWith(".") || isBuiltin(specifier)) continue;
          const cross = /^@ragents\/plugins\/([^/]+)\/(.+)$/.exec(specifier);
          if (cross) {
            assert.ok(manifest.uses.includes(cross[1]!), `${id}: ${specifier} is missing in uses`);
            assert.ok(readPluginSource(path.join(pluginsRoot, cross[1]!)).description.exports.server.includes(cross[2]!), `${id}: ${specifier} is not an export`);
          } else {
            assert.ok(providedByHost("server", specifier), `${id}: ${path.relative(bundle, file)} imports ${specifier}`);
          }
        }
      }
      if (manifest.web) {
        for (const file of scriptsBelow(path.join(bundle, "web"))) {
          for (const specifier of importsOf(file)) {
            const cross = /^\/plugins\/([^/]+)\/web\/exports\/(.+)\.js$/.exec(specifier);
            const own = specifier.startsWith(".") || specifier.startsWith(`/plugins/${id}/web/`);
            assert.ok(own || (cross && manifest.uses.includes(cross[1]!)), `${id}: ${path.relative(bundle, file)} imports ${specifier}`);
          }
        }
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

const BASE_PLUGIN = {
  "acme.base/ragents-plugin.json": JSON.stringify({ id: "acme.base", exports: { server: ["server/contract"], web: ["web/api"] } }),
  "acme.base/server/index.ts": `import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
export const plugin: PluginModule = { create: () => ({ manifest: { id: "acme.base" }, register: () => {} }) };
`,
  "acme.base/server/contract.ts": `export const baseContract = "acme.base.contract";\n`,
  "acme.base/server/internal.ts": `export const hidden = 1;\n`,
  "acme.base/web/api.ts": `export const baseLabel = "Base";\n`,
  "acme.base/web/secret.ts": `export const secret = 2;\n`,
  "shared/util.ts": `export const shared = 3;\n`,
} as const;

const SERVER_INDEX = (id: string, body: string): string => `import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
${body}
export const plugin: PluginModule = { create: () => ({ manifest: { id: "${id}" }, register: () => {} }) };
`;

const plainPlugin = (id: string, files: Readonly<Record<string, string>>): Record<string, string> => ({
  [`${id}/ragents-plugin.json`]: JSON.stringify({ id }),
  [`${id}/server/index.ts`]: SERVER_INDEX(id, ""),
  ...Object.fromEntries(Object.entries(files).map(([name, content]) => [`${id}/${name}`, content])),
});

test("a plugin outside the host bundles libraries from the host, imports siblings through exports and brings assets, classes and provisioning", async () => {
  const root = scratch();
  try {
    writeFiles(root, {
      ...BASE_PLUGIN,
      "acme.app/ragents-plugin.json": JSON.stringify({ id: "acme.app", assets: ["data"] }),
      "acme.app/prompt.hbs": "Hello {{name}}\n",
      "acme.app/data/table.json": "{}\n",
      "acme.app/skills/probe/SKILL.md": "# Probe\n",
      "acme.app/actors/notes/package.json": "{}\n",
      "acme.app/actors/notes/src/server.ts": "export const notes: string[] = [];\n",
      "acme.app/server/index.ts": `import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import { baseContract } from "../../acme.base/server/contract.ts";
export const tablePath = (): string => pluginAsset("acme.app", "data/table.json");
export const plugin: PluginModule = { requires: ["acme.base"], create: () => ({ manifest: { id: "acme.app" }, register: () => { void baseContract; } }) };
`,
      "acme.app/provision.ts": `import type { PluginProvision } from "@ragents/host/plugin-support/provision.js";
export const provision: PluginProvision = { check: async () => ({ kind: "ready" }), apply: async () => {} };
`,
      "acme.app/web/index.tsx": `import { useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "@ragents/web/ui";
import type { WebPlugin } from "@ragents/web/PluginRegistry";
import { baseLabel } from "@ragents/plugins/acme.base/web/api";
const Logo = () => {
  const [open, setOpen] = useState(false);
  return <Badge className="acme-probe-class" onClick={() => setOpen(!open)}><Check />{baseLabel}{open ? "open" : "closed"}</Badge>;
};
export const webPlugin: WebPlugin = { id: "acme.app", brand: { title: "Acme", Logo } };
`,
    });
    const outcomes = await buildPlugins([path.join(root, "acme.base"), path.join(root, "acme.app")], { out: path.join(root, "dist"), typecheck: true });
    built(outcomes[0]);
    const { manifest, bundle } = built(outcomes[1]);
    assert.deepEqual(manifest.uses, ["acme.base"]);
    assert.deepEqual(manifest.assets, ["skills", "actors", "prompt.hbs", "data"]);
    for (const asset of ["prompt.hbs", "data/table.json", "skills/probe/SKILL.md", "actors/notes/src/server.ts"]) assert.ok(existsSync(path.join(bundle, asset)), asset);

    const server = readFileSync(path.join(bundle, "server/index.js"), "utf8");
    assert.deepEqual([...importsOf(path.join(bundle, "server/index.js"))].sort(), [
      "@ragents/host/plugin-support/plugin-folder.js",
      "@ragents/plugins/acme.base/server/contract",
      "node:module",
    ], "node:module only for require of bundled CommonJS libraries");
    assert.match(server, /export \{[^}]*\bprovision\b[^}]*\}/, "provision is an export of the server entry");
    assert.match(server, /\bplugin\b/);

    const web = readFileSync(path.join(bundle, "web/index.js"), "utf8");
    assert.deepEqual(importsOf(path.join(bundle, "web/index.js")), ["/plugins/acme.base/web/exports/web/api.js"]);
    assert.match(web, /__ragentsHostModules/);
    assert.match(web, /"useState"/);
    assert.doesNotMatch(web, /"useReducer"|"act"/, "unused names of the host modules are dropped");
    assert.ok(web.length < 30_000, `lucide-react is bundled whole (${web.length} characters)`);
    assert.ok((JSON.parse(readFileSync(path.join(bundle, "web/classes.json"), "utf8")) as string[]).includes("acme-probe-class"));
    assert.deepEqual(manifest.hostNames.server, { "@ragents/host/plugin-support/plugin-folder": ["pluginAsset"] }, "the manifest names the host API names the bundle uses");
    assert.deepEqual(Object.keys(manifest.hostNames.web), ["@ragents/web/ui", "react", "react/jsx-runtime"]);
    assert.deepEqual(manifest.hostNames.web["@ragents/web/ui"], ["Badge"]);
    assert.ok(manifest.hostNames.web.react!.includes("useState") && manifest.hostNames.web.react!.includes("forwardRef"), "also what bundled libraries take from the host");
    assert.equal(manifest.hostNames.web.react!.includes("useReducer"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the build tool rejects every spot that does not hold up in a bundle, with its cause", async () => {
  const root = scratch();
  try {
    const nativePackage = {
      "node_modules/native-probe/package.json": JSON.stringify({ name: "native-probe", version: "1.0.0", main: "index.js", os: ["darwin"] }),
      "node_modules/native-probe/index.js": "module.exports = { native: true };\n",
    };
    const requiringPackage = {
      "node_modules/requiring-probe/package.json": JSON.stringify({ name: "requiring-probe", version: "1.0.0", main: "index.js" }),
      "node_modules/requiring-probe/index.js": "module.exports = require(\"typebox\");\n",
    };
    const locatingPackage = {
      "node_modules/locating-probe/package.json": JSON.stringify({ name: "locating-probe", version: "1.0.0", main: "index.js" }),
      "node_modules/locating-probe/index.js": "module.exports = { here: __dirname };\n",
    };
    const cases: Record<string, { readonly files: Record<string, string>; readonly expected: RegExp }> = {
      "acme.not-listed": { files: { "server/index.ts": SERVER_INDEX("acme.not-listed", `import { Provider } from "@ragents/host/provider.js";\nvoid Provider;`) }, expected: /@ragents\/host\/provider\.js is not in the server list of the host API/ },
      "acme.wrong-half": { files: { "web/index.ts": `import { readBody } from "@ragents/host/plugin-support/http";\nexport const webPlugin = { id: "acme.wrong-half", readBody };\n` }, expected: /@ragents\/host\/plugin-support\/http is not in the web list/ },
      "acme.relative-internal": { files: { "server/index.ts": SERVER_INDEX("acme.relative-internal", `import { hidden } from "../../acme.base/server/internal.ts";\nvoid hidden;`) }, expected: /acme\.base does not export server\/internal for the server half/ },
      "acme.package-internal": { files: { "web/index.ts": `import { secret } from "@ragents/plugins/acme.base/web/secret";\nexport const webPlugin = { id: "acme.package-internal", secret };\n` }, expected: /acme\.base does not export web\/secret for the web half/ },
      "acme.outside": { files: { "server/index.ts": SERVER_INDEX("acme.outside", `import { shared } from "../../shared/util.ts";\nvoid shared;`) }, expected: /is outside the plugin folder/ },
      "acme.meta-url": { files: { "server/index.ts": SERVER_INDEX("acme.meta-url", `export const here = new URL(".", import.meta.url);`) }, expected: /server\/index\.ts:\d+:\d+: import\.meta is not allowed in a bundle/ },
      "acme.dirname": { files: { "server/index.ts": SERVER_INDEX("acme.dirname", `export const here = __dirname;`) }, expected: /__dirname is not allowed in a bundle/ },
      "acme.create-require": { files: { "server/index.ts": SERVER_INDEX("acme.create-require", `import { createRequire } from "node:module";\nexport const load = createRequire("/");`) }, expected: /createRequire is not allowed in a bundle/ },
      "acme.binary": { files: { "server/index.ts": SERVER_INDEX("acme.binary", `import addon from "./addon.node";\nvoid addon;`), "server/addon.node": "" }, expected: /addon\.node is a platform-dependent binary/ },
      "acme.unknown-name": { files: { "web/index.ts": `import { act } from "react";\nexport const webPlugin = { id: "acme.unknown-name", act };\n` }, expected: /No matching export in "ragents-host:react" for import "act"/ },
      "acme.missing-asset": { files: { "server/index.ts": SERVER_INDEX("acme.missing-asset", `import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";\nexport const table = () => pluginAsset("acme.missing-asset", "data/x.json");`), "data/x.json": "{}" }, expected: /pluginAsset names data\/x\.json, which does not go into the bundle/ },
      "acme.platform": { files: { "server/index.ts": SERVER_INDEX("acme.platform", `import probe from "native-probe";\nvoid probe;`), ...nativePackage }, expected: /The package native-probe is bound to an operating system or processor/ },
      "acme.locating": { files: { "server/index.ts": SERVER_INDEX("acme.locating", `import probe from "locating-probe";\nvoid probe;`), ...locatingPackage }, expected: /index\.js in locating-probe locates files through its own location \(__dirname\)/ },
      "acme.self": { files: { "server/index.ts": SERVER_INDEX("acme.self", `import { own } from "@ragents/plugins/acme.self/server/own";\nvoid own;`), "server/own.ts": "export const own = 1;\n" }, expected: /imports the plugin itself through the package name/ },
      "acme.named-default": { files: { "server/index.ts": SERVER_INDEX("acme.named-default", `import { compile } from "handlebars";\nexport const render = compile("{{x}}");`) }, expected: /server\/index\.js imports compile from handlebars, which the host API does not offer/ },
      "acme.unlisted-name": { files: { "server/index.ts": SERVER_INDEX("acme.unlisted-name", `import { ToolContributionRegistry } from "@ragents/engine";\nexport const registry = new ToolContributionRegistry();`) }, expected: /server\/index\.js imports ToolContributionRegistry from @ragents\/engine, which the host API does not offer/ },
      "acme.unlisted-web-name": { files: { "web/index.ts": `import { PageOpenerProvider } from "@ragents/web/page-opener";\nexport const webPlugin = { id: "acme.unlisted-web-name", PageOpenerProvider };\n` }, expected: /No matching export in "ragents-host:@ragents\/web\/page-opener" for import "PageOpenerProvider"/ },
      "acme.node-in-web": { files: { "web/index.ts": `import { readFileSync } from "node:fs";\nexport const webPlugin = { id: "acme.node-in-web", readFileSync };\n` }, expected: /node:fs is a Node module and does not exist in the browser/ },
      "acme.namespace-name": { files: { "server/index.ts": SERVER_INDEX("acme.namespace-name", `import * as folder from "@ragents/host/plugin-support/plugin-folder";\nexport const skills = folder.folderSkills;`) }, expected: /server\/index\.js imports folderSkills from @ragents\/host\/plugin-support\/plugin-folder, which the host API does not offer/ },
      "acme.namespace-whole": { files: { "server/index.ts": SERVER_INDEX("acme.namespace-whole", `import * as folder from "@ragents/host/plugin-support/plugin-folder";\nexport const all = { folder };`) }, expected: /uses the namespace \w+ from @ragents\/host\/plugin-support\/plugin-folder as a whole/ },
      "acme.dynamic-server": { files: { "server/index.ts": SERVER_INDEX("acme.dynamic-server", `export const later = async () => (await import("@ragents/host/plugin-support/plugins-root")).bundlesRoot;`) }, expected: /server\/index\.ts:\d+:\d+: import\(\) of @ragents\/host\/plugin-support\/plugins-root: a host module is imported statically/ },
      "acme.namespace-web": { files: { "web/index.ts": `import * as ui from "@ragents/web/ui";\nexport const webPlugin = { id: "acme.namespace-web", button: ui.Button, missing: ui.Whatever };\n` }, expected: /web\/index\.ts:\d+:\d+: Import "Whatever" will always be undefined/ },
      "acme.dynamic-web": { files: { "web/index.ts": `export const webPlugin = { id: "acme.dynamic-web", load: () => import("@ragents/web/ui") };\n` }, expected: /import\(\) of @ragents\/web\/ui: a host module is imported statically/ },
      "acme.require-host": { files: { "server/index.ts": SERVER_INDEX("acme.require-host", `import probe from "requiring-probe";\nvoid probe;`), ...requiringPackage }, expected: /require\("typebox"\): the host provides typebox only through import/ },
      "acme.executor-host": { files: { "executor.ts": `import { RUN_MARKER_ENV } from "@ragents/workspace-executor";\nexport const executor = () => ({ marker: RUN_MARKER_ENV });\n` },
        expected: /executor: .*@ragents\/workspace-executor: the executor contribution loads in every Node process without the host's resolution/ },
      "acme.executor-sibling": { files: { "executor.ts": `import { baseContract } from "../acme.base/server/contract.ts";\nexport const executor = () => ({ baseContract });\n` },
        expected: /@ragents\/plugins\/acme\.base\/server\/contract: the executor contribution loads in every Node process/ },
      "acme.executor-require": { files: { "executor.ts": `import { createRequire } from "node:module";\nexport const executor = () => ({ load: createRequire("/") });\n` },
        expected: /executor\.ts:\d+:\d+: createRequire is not allowed in a bundle/ },
    };
    writeFiles(root, {
      ...BASE_PLUGIN,
      ...Object.assign({}, ...Object.entries(cases).map(([id, { files }]) => plainPlugin(id, files))),
      "acme.no-server/ragents-plugin.json": JSON.stringify({ id: "acme.no-server" }),
    });
    const outcomes = await buildPlugins([...Object.keys(cases), "acme.no-server"].map((id) => path.join(root, id)), { out: path.join(root, "dist"), typecheck: false });
    for (const [id, { expected }] of Object.entries(cases)) assert.match(problemsOf(outcomes, id), expected, id);
    assert.match(problemsOf(outcomes, "acme.no-server"), /server\/index\.ts is missing/);
    assert.deepEqual(readdirSync(path.join(root, "dist")), [], "a rejected plugin leaves nothing behind");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an executor contribution becomes a self-contained file that the server loads with the bundle and that the server half shares", async () => {
  const root = scratch();
  try {
    writeFiles(root, plainPlugin("acme.lsp-demo", {
      "executor.ts": `import path from "node:path";
import type { LanguageServerDescription, WorkspaceExecutorContribution } from "@ragents/workspace-executor";
export const demoLanguageServer: LanguageServerDescription = { id: "demo", label: "Demo", languages: { ".demo": "demo" }, rootDescription: "the directory" };
export const executor: WorkspaceExecutorContribution = (machine) => ({ languageServers: [{
  ...demoLanguageServer,
  resolveRoot: machine.resolveRootDirectory,
  rootDirectory: (root) => root,
  launch: async (context, root) => ({ label: "Demo", command: path.join(machine.toolsDirectory, "demo"), args: [], cwd: root, env: context.env, rootUri: root, languages: demoLanguageServer.languages }),
  open: async () => "open",
}] });
`,
      "server/index.ts": SERVER_INDEX("acme.lsp-demo", `import { demoLanguageServer } from "../executor.ts";\nexport const label = demoLanguageServer.label;`),
    }));
    const [outcome] = await buildPlugins([path.join(root, "acme.lsp-demo")], { out: path.join(root, "dist"), typecheck: true });
    const { manifest, bundle } = built(outcome);
    assert.equal(manifest.executor, EXECUTOR_CONTRIBUTION_FILE);
    const file = path.join(bundle, EXECUTOR_CONTRIBUTION_FILE);
    assert.deepEqual(importsOf(file), ["node:module", "node:path"]);
    assert.deepEqual(readdirSync(path.join(bundle, "executor")).sort(), ["index.mjs", "index.mjs.map"], "one file, no chunks");
    const loaded = await loadPlugins([bundle]);
    assert.equal(loaded.modules.get("acme.lsp-demo") !== undefined, true);
    assert.deepEqual(loaded.executor.map(({ plugin, revision }) => ({ plugin, revision })), [
      { plugin: "acme.lsp-demo", revision: createHash("sha256").update(readFileSync(file)).digest("hex") },
    ]);
    const { parts } = prepareExecutorContribution(loaded.executor[0]!, "/tools/acme.lsp-demo");
    assert.deepEqual(parts.languageServers?.map((server) => server.id), ["demo"]);
    assert.equal((await parts.languageServers![0]!.launch({ env: {} } as never, "/project")).command, path.join("/tools/acme.lsp-demo", "demo"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a CommonJS library that loads Node modules with require builds and runs in the server half", async () => {
  const root = scratch();
  try {
    writeFiles(root, plainPlugin("acme.cjs-library", {
      "server/index.ts": SERVER_INDEX("acme.cjs-library", `import { StreamMessageReader } from "vscode-jsonrpc/node";\nexport const reader = StreamMessageReader;`),
    }));
    const [outcome] = await buildPlugins([path.join(root, "acme.cjs-library")], { out: path.join(root, "dist"), typecheck: false });
    const { bundle } = built(outcome);
    const loaded = await importBundles(resolvePluginEntries([bundle]));
    assert.equal(typeof loaded.get("acme.cjs-library")?.reader, "function", "vscode-jsonrpc loads util, net and path with require");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a name the host's register does not have is an error with its cause in the web, never undefined", async () => {
  const root = scratch();
  try {
    writeFiles(root, plainPlugin("acme.shim", { "web/index.ts": `import { cn } from "@ragents/web/ui";\nexport const webPlugin = { id: "acme.shim", cn };\n` }));
    const [outcome] = await buildPlugins([path.join(root, "acme.shim")], { out: path.join(root, "dist"), typecheck: false });
    const { bundle, manifest } = built(outcome);
    assert.deepEqual(manifest.hostNames.web, { "@ragents/web/ui": ["cn"] });
    const code = readFileSync(path.join(bundle, "web/index.js"), "utf8");
    const load = (register: Record<string, object> | undefined, attempt: string) => {
      Object.assign(globalThis, { [HOST_MODULES_GLOBAL]: register });
      return import(`data:text/javascript,${encodeURIComponent(`${code}\n// ${attempt}`)}`) as Promise<{ webPlugin: { cn: unknown } }>;
    };
    try {
      await assert.rejects(load(undefined, "without register"), /The host does not provide @ragents\/web\/ui/);
      await assert.rejects(load({ "@ragents/web/ui": {} }, "without name"), /The host does not provide cn from @ragents\/web\/ui; the bundle was built against a newer host/);
      const cn = () => "";
      assert.equal((await load({ "@ragents/web/ui": { cn } }, "matching")).webPlugin.cn, cn);
    } finally {
      Object.assign(globalThis, { [HOST_MODULES_GLOBAL]: undefined });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a plugin receives the shared data grid from the host without bundling its table or virtualizer", async () => {
  const root = scratch();
  try {
    writeFiles(root, plainPlugin("acme.grid", {
      "web/index.ts": `import { DataGrid } from "@ragents/web/ui";\nexport const webPlugin = { id: "acme.grid", Grid: DataGrid };\n`,
    }));
    const [outcome] = await buildPlugins([path.join(root, "acme.grid")], { out: path.join(root, "dist"), typecheck: true });
    const { bundle, manifest } = built(outcome);
    assert.deepEqual(manifest.hostNames.web, { "@ragents/web/ui": ["DataGrid"] });
    const code = readFileSync(path.join(bundle, "web/index.js"), "utf8");
    const map = JSON.parse(readFileSync(path.join(bundle, "web/index.js.map"), "utf8")) as { sources: string[] };
    assert.deepEqual(importsOf(path.join(bundle, "web/index.js")), []);
    assert.equal(map.sources.some((source) => /@tanstack|ui\/data-grid/.test(source)), false,
      "the plugin retains only the host shim, with no shared grid implementation");
    const DataGrid = () => null;
    const previous = Reflect.get(globalThis, HOST_MODULES_GLOBAL);
    try {
      Object.assign(globalThis, { [HOST_MODULES_GLOBAL]: { "@ragents/web/ui": { DataGrid } } });
      const loaded = await import(`data:text/javascript,${encodeURIComponent(code)}`) as { webPlugin: { Grid: unknown } };
      assert.equal(loaded.webPlugin.Grid, DataGrid, "the loaded plugin uses the host's exact grid instance");
    } finally {
      Object.assign(globalThis, { [HOST_MODULES_GLOBAL]: previous });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("type errors, a wrong id and unknown fields are build errors", async () => {
  const root = scratch();
  try {
    writeFiles(root, {
      ...plainPlugin("acme.typed", { "server/index.ts": SERVER_INDEX("acme.typed", `export const count: number = "three";\nexport const here = __dirname;`) }),
      "acme.renamed/ragents-plugin.json": JSON.stringify({ id: "acme.other" }),
      "acme.renamed/server/index.ts": SERVER_INDEX("acme.renamed", ""),
      "acme.extra/ragents-plugin.json": JSON.stringify({ id: "acme.extra", entry: "server/main.ts" }),
      "acme.extra/server/index.ts": SERVER_INDEX("acme.extra", ""),
      "acme.missing-export/ragents-plugin.json": JSON.stringify({ id: "acme.missing-export", exports: { server: ["server/nothing"] } }),
      "acme.reserved-asset/ragents-plugin.json": JSON.stringify({ id: "acme.reserved-asset", assets: ["web/source.tsx"] }),
      "acme.reserved-asset/server/index.ts": SERVER_INDEX("acme.reserved-asset", ""),
      "acme.reserved-asset/web/source.tsx": "export const secret = 1;\n",
      "acme.missing-export/server/index.ts": SERVER_INDEX("acme.missing-export", ""),
    });
    const outcomes = await buildPlugins([path.join(root, "acme.typed")], { out: path.join(root, "dist"), typecheck: true });
    assert.match(problemsOf(outcomes, "acme.typed"), /Types: server\/index\.ts:2:14: Type 'string' is not assignable to type 'number'/);
    assert.match(problemsOf(outcomes, "acme.typed"), /__dirname is not allowed in a bundle/, "type errors do not hide the other findings");
    assert.equal(existsSync(path.join(root, "dist/acme.typed")), false);
    await assert.rejects(buildPlugins([path.join(root, "acme.renamed")], { out: path.join(root, "dist"), typecheck: false }), /the id acme\.other differs from the folder name acme\.renamed/);
    await assert.rejects(buildPlugins([path.join(root, "acme.extra")], { out: path.join(root, "dist"), typecheck: false }), /unknown fields entry/);
    await assert.rejects(buildPlugins([path.join(root, "acme.missing-export")], { out: path.join(root, "dist"), typecheck: false }), /the export server\/nothing for server has no source file/);
    await assert.rejects(buildPlugins([path.join(root, "acme.reserved-asset")], { out: path.join(root, "dist"), typecheck: false }), /the asset web\/source\.tsx is under web, which the build tool writes itself/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("react from a plugin's own node_modules is never bundled, it always comes from the host", async () => {
  const root = scratch();
  try {
    writeFiles(root, plainPlugin("acme.own-react", {
      "node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.0", main: "index.js" }),
      "node_modules/react/index.js": `module.exports = { marker: "bundled-own-react", useState: () => [] };\n`,
      "web/index.ts": `import { useState } from "react";\nexport const webPlugin = { id: "acme.own-react", useState };\n`,
    }));
    const [outcome] = await buildPlugins([path.join(root, "acme.own-react")], { out: path.join(root, "dist"), typecheck: false });
    const web = readFileSync(path.join(built(outcome).bundle, "web/index.js"), "utf8");
    assert.doesNotMatch(web, /bundled-own-react/);
    assert.match(web, /__ragentsHostModules/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--watch rebuilds after every change in the plugin folder", async () => {
  const root = scratch();
  const outcomes: PluginBuildOutcome[] = [];
  const waitFor = async (count: number): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (outcomes.length < count) {
      if (Date.now() > deadline) throw new Error(`only ${outcomes.length} builds after 10 s`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    writeFiles(root, plainPlugin("acme.watched", { "server/greeting.ts": `export const greeting = "first version";\n`, "server/index.ts": SERVER_INDEX("acme.watched", `export { greeting } from "./greeting.ts";`) }));
    const watching = await watchPlugins([path.join(root, "acme.watched")], { out: path.join(root, "dist") }, (outcome) => outcomes.push(outcome));
    try {
      await waitFor(1);
      const bundle = built(outcomes[0]).bundle;
      assert.match(readFileSync(path.join(bundle, "server/index.js"), "utf8"), /first version/);
      writeFileSync(path.join(root, "acme.watched/server/greeting.ts"), `export const greeting = "second version";\n`);
      await waitFor(2);
      built(outcomes[1]);
      assert.match(readFileSync(path.join(bundle, "server/index.js"), "utf8"), /second version/);
    } finally {
      await watching.stop();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--watch rereads the description, assets, entries and sibling exports on every change", async () => {
  const root = scratch();
  const outcomes: PluginBuildOutcome[] = [];
  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`no build with ${what} after 10 s:\n${JSON.stringify(outcomes.at(-1))}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const lastBuilt = (id: string) => outcomes.findLast((outcome) => outcome.id === id);
  try {
    writeFiles(root, {
      ...plainPlugin("acme.sibling", { "server/names.ts": `export const first = 1;\n` }),
      ...plainPlugin("acme.grown", { "server/index.ts": SERVER_INDEX("acme.grown", "") }),
    });
    const folders = [path.join(root, "acme.sibling"), path.join(root, "acme.grown")];
    const watching = await watchPlugins(folders, { out: path.join(root, "dist") }, (outcome) => outcomes.push(outcome));
    try {
      await waitFor(() => lastBuilt("acme.grown")?.kind === "built" && lastBuilt("acme.sibling")?.kind === "built", "both plugins");
      writeFiles(root, {
        "acme.grown/data/table.json": "{}\n",
        "acme.grown/prompt.hbs": "Hello\n",
        "acme.grown/web/index.ts": `export const webPlugin = { id: "acme.grown" };\n`,
        "acme.grown/server/index.ts": SERVER_INDEX("acme.grown", `import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import { first } from "../../acme.sibling/server/names.ts";
export const table = () => pluginAsset("acme.grown", "data/table.json");
void first;`),
      });
      await writeFile(path.join(root, "acme.sibling/ragents-plugin.json"), JSON.stringify({ id: "acme.sibling", exports: { server: ["server/names"] } }));
      await writeFile(path.join(root, "acme.grown/ragents-plugin.json"), JSON.stringify({ id: "acme.grown", assets: ["data"] }));
      await waitFor(() => {
        const outcome = lastBuilt("acme.grown");
        return outcome?.kind === "built" && outcome.manifest.web !== undefined && outcome.manifest.assets.includes("data");
      }, "web half and new asset");
      const { manifest, bundle } = built(lastBuilt("acme.grown"));
      assert.deepEqual(manifest.assets, ["prompt.hbs", "data"]);
      assert.deepEqual(manifest.uses, ["acme.sibling"], "the sibling's new export applies immediately");
      for (const file of ["data/table.json", "prompt.hbs", "web/index.js"]) assert.ok(existsSync(path.join(bundle, file)), file);
    } finally {
      await watching.stop();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pnpm build:plugins builds only what is outdated and swaps files one by one, the bundle folder stays the same", async () => {
  const root = scratch();
  try {
    writeFiles(root, {
      ...plainPlugin("acme.kept", { "prompt.hbs": "stays\n" }),
      ...plainPlugin("acme.changed", { "prompt.hbs": "stays\n", "server/greeting.ts": `export const greeting = "old";\n`, "server/index.ts": SERVER_INDEX("acme.changed", `export { greeting } from "./greeting.ts";`) }),
    });
    const out = path.join(root, "dist");
    const folders = [path.join(root, "acme.kept"), path.join(root, "acme.changed")];
    await buildPlugins(folders, { out, typecheck: false });
    const inode = (file: string): number => statSync(path.join(out, file)).ino;
    const before = { kept: inode("acme.kept/server/index.js"), folder: inode("acme.changed"), prompt: inode("acme.changed/prompt.hbs"), entry: inode("acme.changed/server/index.js") };
    writeFileSync(path.join(root, "acme.changed/server/greeting.ts"), `export const greeting = "new";\n`);
    const outcomes = await buildPlugins(folders, { out, typecheck: false, onlyOutdated: true });
    assert.deepEqual(outcomes.map((outcome) => outcome.id), ["acme.changed"], "a current bundle stays in place");
    assert.equal(inode("acme.kept/server/index.js"), before.kept);
    assert.equal(inode("acme.changed"), before.folder, "the folder is never removed, not even briefly");
    assert.equal(inode("acme.changed/prompt.hbs"), before.prompt, "an unchanged file stays as it is");
    assert.notEqual(inode("acme.changed/server/index.js"), before.entry);
    assert.match(readFileSync(path.join(out, "acme.changed/server/index.js"), "utf8"), /"new"/);
    assert.equal(built(outcomes[0]).manifest.revision, bundleRevision(path.join(out, "acme.changed")), "no leftovers of the old version");
    writeFileSync(path.join(out, "acme.kept/prompt.hbs"), "changed by hand\n");
    assert.deepEqual((await buildPlugins(folders, { out, typecheck: false, onlyOutdated: true })).map((outcome) => outcome.id), ["acme.kept"], "a damaged bundle is outdated");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parallel builds into the same folder wait for each other and do not collide", async () => {
  const root = scratch();
  try {
    writeFiles(root, { ...plainPlugin("acme.first", {}), ...plainPlugin("acme.second", {}) });
    const out = path.join(root, "dist");
    const folders = [path.join(root, "acme.first"), path.join(root, "acme.second")];
    const runs = await Promise.all([1, 2, 3].map(() => buildPlugins(folders, { out, typecheck: false })));
    for (const outcomes of runs) for (const outcome of outcomes) built(outcome);
    assert.deepEqual(readdirSync(out).sort(), ["acme.first", "acme.second"], "no leftovers of intermediate states or locks");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--watch builds only bundles at startup that are missing or do not match their sources", async () => {
  const root = scratch();
  const outcomes: PluginBuildOutcome[] = [];
  try {
    writeFiles(root, plainPlugin("acme.current", { "server/index.ts": SERVER_INDEX("acme.current", "") }));
    writeFiles(root, plainPlugin("acme.stale", { "server/index.ts": SERVER_INDEX("acme.stale", "") }));
    const out = path.join(root, "dist");
    await buildPlugins([path.join(root, "acme.current"), path.join(root, "acme.stale")], { out, typecheck: false });
    writeFileSync(path.join(root, "acme.stale/server/extra.ts"), "export const extra = 1;\n");
    const watching = await watchPlugins([path.join(root, "acme.current"), path.join(root, "acme.stale")], { out }, (outcome) => outcomes.push(outcome));
    try {
      const deadline = Date.now() + 10_000;
      while (outcomes.length < 1 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      await new Promise((resolve) => setTimeout(resolve, 300));
      // The Mac sometimes reports the change shortly before the start late, then acme.stale builds a second time.
      assert.ok(outcomes.some((outcome) => outcome.id === "acme.stale"));
      assert.equal(outcomes.some((outcome) => outcome.id === "acme.current"), false, "a current bundle stays in place at startup so that a starting server does not lose it");
    } finally {
      await watching.stop();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the source revision leaves out a target inside the plugin folder so that a second build yields the same revision", async () => {
  const root = scratch();
  try {
    const folder = path.join(root, "acme.inside");
    writeFiles(folder, {
      "ragents-plugin.json": JSON.stringify({ id: "acme.inside" }),
      "server/index.ts": "export const plugin = { create: () => ({ manifest: { id: \"acme.inside\" }, register: () => {} }) };\n",
    });
    const out = path.join(folder, "dist");
    const first = built((await buildPlugins([folder], { out, typecheck: false }))[0]).manifest.sourceRevision;
    const second = built((await buildPlugins([folder], { out, typecheck: false }))[0]).manifest.sourceRevision;
    assert.equal(second, first);
    assert.equal(first, sourceRevisionOf(folder, [out]));
    writeFileSync(path.join(folder, "server/index.ts"), "export const plugin = { create: () => ({ manifest: { id: \"acme.inside\" }, register: () => {} }) };\n// new\n");
    assert.notEqual(built((await buildPlugins([folder], { out, typecheck: false }))[0]).manifest.sourceRevision, first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugin build reads folders, target and switches relative to the caller", () => {
  assert.deepEqual(parsePluginArguments(["build", "plugins/acme", "../b"], "/work/repo"), {
    folders: ["/work/repo/plugins/acme", "/work/b"], out: "/work/repo/dist/plugins", watch: false, typecheck: true,
  });
  assert.deepEqual(parsePluginArguments(["build", "a", "--out", "/tmp/x", "--no-typecheck"], "/w"), { folders: ["/w/a"], out: "/tmp/x", watch: false, typecheck: false });
  assert.equal(parsePluginArguments(["build", "a", "--watch"], "/w").typecheck, false, "--watch checks no types");
  assert.throws(() => parsePluginArguments(["build"], "/w"), /at least one plugin folder/);
  assert.throws(() => parsePluginArguments(["build", "a", "--minify"], "/w"), /Unknown argument: --minify/);
  assert.throws(() => parsePluginArguments(["pack", "a"], "/w"), /Unknown command: plugin pack/);
});
