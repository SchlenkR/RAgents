import assert from "node:assert/strict";
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
import { BUNDLE_FORMAT, bundleStand, sourceStandOf, type BundleManifest } from "../src/profile/bundle-manifest.ts";
import { importBundles, resolvePluginEntries } from "../src/profile/plugin-discovery.ts";
import { readPluginSource, sourceFileOf } from "../src/plugin-build/plugin-description.ts";
import { pluginsRoot } from "../src/plugin-support/plugins-root.ts";
import { parsePluginArguments } from "../../../scripts/plugin/plugin-cli.ts";

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
  assert.ok(outcome, "kein Ergebnis");
  assert.equal(outcome.kind, "built", outcome.kind === "failed" ? `${outcome.id}:\n${outcome.problems.join("\n")}` : "");
  return outcome as Extract<PluginBuildOutcome, { kind: "built" }>;
};

const problemsOf = (outcomes: readonly PluginBuildOutcome[], id: string): string => {
  const outcome = outcomes.find((candidate) => candidate.id === id);
  assert.ok(outcome, `kein Ergebnis für ${id}`);
  assert.equal(outcome.kind, "failed", `${id} wurde gebaut, obwohl es abgelehnt werden muss`);
  return (outcome as Extract<PluginBuildOutcome, { kind: "failed" }>).problems.join("\n");
};

test("alle eingebauten Plugins bauen zu Bundles mit genau einem Einsprungpunkt, nur mit Host-API und deklarierten Exporten", async () => {
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
      assert.equal(manifest.sourceStand, sourceStandOf(folder), `${id}: der Quellstand nennt den Ordner, aus dem das Bundle gebaut ist`);
      assert.equal("source" in manifest, false, "ein Bundle nennt keinen Pfad zu seinen Quellen");
      assert.equal(manifest.id, id);
      assert.equal(manifest.stand, bundleStand(bundle), `${id}: der Stand deckt nicht alle Dateien`);
      assert.ok(existsSync(path.join(bundle, manifest.server)), `${id}: ${manifest.server} fehlt`);
      assert.equal(manifest.web !== undefined, sourceFileOf(path.join(folder, "web/index")) !== undefined, `${id}: Web-Hälfte`);
      if (manifest.web) {
        assert.ok(existsSync(path.join(bundle, manifest.web.entry)));
        assert.ok(Array.isArray(JSON.parse(readFileSync(path.join(bundle, manifest.web.classes), "utf8"))));
      }
      for (const half of ["server", "web"] as const) {
        assert.deepEqual(Object.keys(manifest.exports[half]), source.description.exports[half], `${id}: Exporte ${half}`);
        for (const file of Object.values(manifest.exports[half])) assert.ok(existsSync(path.join(bundle, file)), `${id}: ${file} fehlt`);
      }
      for (const asset of manifest.assets) assert.ok(existsSync(path.join(bundle, asset)), `${id}: Asset ${asset} fehlt`);
      for (const half of ["server", "web"] as const) {
        for (const [specifier, names] of Object.entries(manifest.hostNames[half])) {
          assert.deepEqual(names.filter((name) => !record[half][specifier]?.includes(name)), [], `${id}: ${half} ${specifier} nennt Namen außerhalb der Host-API`);
        }
      }
      const requires = requiresOf(folder);
      for (const used of manifest.uses) assert.ok(requires.includes(used), `${id} nutzt ${used}, das nicht in requires steht`);

      for (const file of scriptsBelow(path.join(bundle, "server"))) {
        for (const specifier of importsOf(file)) {
          if (specifier.startsWith(".") || isBuiltin(specifier)) continue;
          const cross = /^@ragents\/plugins\/([^/]+)\/(.+)$/.exec(specifier);
          if (cross) {
            assert.ok(manifest.uses.includes(cross[1]!), `${id}: ${specifier} fehlt in uses`);
            assert.ok(readPluginSource(path.join(pluginsRoot, cross[1]!)).description.exports.server.includes(cross[2]!), `${id}: ${specifier} ist kein Export`);
          } else {
            assert.ok(providedByHost("server", specifier), `${id}: ${path.relative(bundle, file)} importiert ${specifier}`);
          }
        }
      }
      if (manifest.web) {
        for (const file of scriptsBelow(path.join(bundle, "web"))) {
          for (const specifier of importsOf(file)) {
            const cross = /^\/plugins\/([^/]+)\/web\/exports\/(.+)\.js$/.exec(specifier);
            const own = specifier.startsWith(".") || specifier.startsWith(`/plugins/${id}/web/`);
            assert.ok(own || (cross && manifest.uses.includes(cross[1]!)), `${id}: ${path.relative(bundle, file)} importiert ${specifier}`);
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
  "acme.base/web/api.ts": `export const baseLabel = "Basis";\n`,
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

test("ein Plugin außerhalb des Hosts bündelt Bibliotheken aus dem Host, importiert Geschwister über Exporte und bringt Assets, Klassen und Provisionierung mit", async () => {
  const root = scratch();
  try {
    writeFiles(root, {
      ...BASE_PLUGIN,
      "acme.app/ragents-plugin.json": JSON.stringify({ id: "acme.app", assets: ["data"] }),
      "acme.app/prompt.hbs": "Hallo {{name}}\n",
      "acme.app/data/table.json": "{}\n",
      "acme.app/skills/probe/SKILL.md": "# Probe\n",
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
  return <Badge className="acme-probe-class" onClick={() => setOpen(!open)}><Check />{baseLabel}{open ? "auf" : "zu"}</Badge>;
};
export const webPlugin: WebPlugin = { id: "acme.app", brand: { title: "Acme", Logo } };
`,
    });
    const outcomes = await buildPlugins([path.join(root, "acme.base"), path.join(root, "acme.app")], { out: path.join(root, "dist"), typecheck: true });
    built(outcomes[0]);
    const { manifest, bundle } = built(outcomes[1]);
    assert.deepEqual(manifest.uses, ["acme.base"]);
    assert.deepEqual(manifest.assets, ["skills", "prompt.hbs", "data"]);
    for (const asset of ["prompt.hbs", "data/table.json", "skills/probe/SKILL.md"]) assert.ok(existsSync(path.join(bundle, asset)), asset);

    const server = readFileSync(path.join(bundle, "server/index.js"), "utf8");
    assert.deepEqual([...importsOf(path.join(bundle, "server/index.js"))].sort(), [
      "@ragents/host/plugin-support/plugin-folder.js",
      "@ragents/plugins/acme.base/server/contract",
      "node:module",
    ], "node:module nur für require gebündelter CommonJS-Bibliotheken");
    assert.match(server, /export \{[^}]*\bprovision\b[^}]*\}/, "provision ist Export des Server-Einstiegs");
    assert.match(server, /\bplugin\b/);

    const web = readFileSync(path.join(bundle, "web/index.js"), "utf8");
    assert.deepEqual(importsOf(path.join(bundle, "web/index.js")), ["/plugins/acme.base/web/exports/web/api.js"]);
    assert.match(web, /__ragentsHostModules/);
    assert.match(web, /"useState"/);
    assert.doesNotMatch(web, /"useReducer"|"act"/, "unbenutzte Namen der Host-Module fallen weg");
    assert.ok(web.length < 30_000, `lucide-react ist ganz gebündelt (${web.length} Zeichen)`);
    assert.ok((JSON.parse(readFileSync(path.join(bundle, "web/classes.json"), "utf8")) as string[]).includes("acme-probe-class"));
    assert.deepEqual(manifest.hostNames.server, { "@ragents/host/plugin-support/plugin-folder": ["pluginAsset"] }, "das Manifest nennt die Namen der Host-API, die das Bundle benutzt");
    assert.deepEqual(Object.keys(manifest.hostNames.web), ["@ragents/web/ui", "react", "react/jsx-runtime"]);
    assert.deepEqual(manifest.hostNames.web["@ragents/web/ui"], ["Badge"]);
    assert.ok(manifest.hostNames.web.react!.includes("useState") && manifest.hostNames.web.react!.includes("forwardRef"), "auch was gebündelte Bibliotheken vom Host nehmen");
    assert.equal(manifest.hostNames.web.react!.includes("useReducer"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("das Bauwerkzeug lehnt jede Stelle, die im Bundle nicht trägt, mit Ursache ab", async () => {
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
      "acme.not-listed": { files: { "server/index.ts": SERVER_INDEX("acme.not-listed", `import { Provider } from "@ragents/host/provider.js";\nvoid Provider;`) }, expected: /@ragents\/host\/provider\.js steht nicht in der server-Liste der Host-API/ },
      "acme.wrong-half": { files: { "web/index.ts": `import { readBody } from "@ragents/host/plugin-support/http";\nexport const webPlugin = { id: "acme.wrong-half", readBody };\n` }, expected: /@ragents\/host\/plugin-support\/http steht nicht in der web-Liste/ },
      "acme.relative-internal": { files: { "server/index.ts": SERVER_INDEX("acme.relative-internal", `import { hidden } from "../../acme.base/server/internal.ts";\nvoid hidden;`) }, expected: /acme\.base exportiert server\/internal für die server-Hälfte nicht/ },
      "acme.package-internal": { files: { "web/index.ts": `import { secret } from "@ragents/plugins/acme.base/web/secret";\nexport const webPlugin = { id: "acme.package-internal", secret };\n` }, expected: /acme\.base exportiert web\/secret für die web-Hälfte nicht/ },
      "acme.outside": { files: { "server/index.ts": SERVER_INDEX("acme.outside", `import { shared } from "../../shared/util.ts";\nvoid shared;`) }, expected: /außerhalb des Plugin-Ordners/ },
      "acme.meta-url": { files: { "server/index.ts": SERVER_INDEX("acme.meta-url", `export const here = new URL(".", import.meta.url);`) }, expected: /server\/index\.ts:\d+:\d+: import\.meta ist im Bundle nicht erlaubt/ },
      "acme.dirname": { files: { "server/index.ts": SERVER_INDEX("acme.dirname", `export const here = __dirname;`) }, expected: /__dirname ist im Bundle nicht erlaubt/ },
      "acme.create-require": { files: { "server/index.ts": SERVER_INDEX("acme.create-require", `import { createRequire } from "node:module";\nexport const load = createRequire("/");`) }, expected: /createRequire ist im Bundle nicht erlaubt/ },
      "acme.binary": { files: { "server/index.ts": SERVER_INDEX("acme.binary", `import addon from "./addon.node";\nvoid addon;`), "server/addon.node": "" }, expected: /addon\.node ist eine plattformabhängige Binärdatei/ },
      "acme.unknown-name": { files: { "web/index.ts": `import { act } from "react";\nexport const webPlugin = { id: "acme.unknown-name", act };\n` }, expected: /No matching export in "ragents-host:react" for import "act"/ },
      "acme.missing-asset": { files: { "server/index.ts": SERVER_INDEX("acme.missing-asset", `import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";\nexport const table = () => pluginAsset("acme.missing-asset", "data/x.json");`), "data/x.json": "{}" }, expected: /pluginAsset nennt data\/x\.json, das nicht ins Bundle kommt/ },
      "acme.platform": { files: { "server/index.ts": SERVER_INDEX("acme.platform", `import probe from "native-probe";\nvoid probe;`), ...nativePackage }, expected: /Das Paket native-probe ist an Betriebssystem oder Prozessor gebunden/ },
      "acme.locating": { files: { "server/index.ts": SERVER_INDEX("acme.locating", `import probe from "locating-probe";\nvoid probe;`), ...locatingPackage }, expected: /index\.js in locating-probe sucht Dateien über den eigenen Ort \(__dirname\)/ },
      "acme.self": { files: { "server/index.ts": SERVER_INDEX("acme.self", `import { own } from "@ragents/plugins/acme.self/server/own";\nvoid own;`), "server/own.ts": "export const own = 1;\n" }, expected: /importiert das eigene Plugin über den Paketnamen/ },
      "acme.named-default": { files: { "server/index.ts": SERVER_INDEX("acme.named-default", `import { compile } from "handlebars";\nexport const render = compile("{{x}}");`) }, expected: /server\/index\.js importiert compile aus handlebars, das die Host-API nicht anbietet/ },
      "acme.unlisted-name": { files: { "server/index.ts": SERVER_INDEX("acme.unlisted-name", `import { ToolContributionRegistry } from "@ragents/engine";\nexport const registry = new ToolContributionRegistry();`) }, expected: /server\/index\.js importiert ToolContributionRegistry aus @ragents\/engine, das die Host-API nicht anbietet/ },
      "acme.unlisted-web-name": { files: { "web/index.ts": `import { PageOpenerProvider } from "@ragents/web/page-opener";\nexport const webPlugin = { id: "acme.unlisted-web-name", PageOpenerProvider };\n` }, expected: /No matching export in "ragents-host:@ragents\/web\/page-opener" for import "PageOpenerProvider"/ },
      "acme.node-in-web": { files: { "web/index.ts": `import { readFileSync } from "node:fs";\nexport const webPlugin = { id: "acme.node-in-web", readFileSync };\n` }, expected: /node:fs ist ein Node-Modul und gibt es im Browser nicht/ },
      "acme.namespace-name": { files: { "server/index.ts": SERVER_INDEX("acme.namespace-name", `import * as folder from "@ragents/host/plugin-support/plugin-folder";\nexport const skills = folder.folderSkills;`) }, expected: /server\/index\.js importiert folderSkills aus @ragents\/host\/plugin-support\/plugin-folder, das die Host-API nicht anbietet/ },
      "acme.namespace-whole": { files: { "server/index.ts": SERVER_INDEX("acme.namespace-whole", `import * as folder from "@ragents/host/plugin-support/plugin-folder";\nexport const all = { folder };`) }, expected: /benutzt den Namensraum \w+ aus @ragents\/host\/plugin-support\/plugin-folder als Ganzes/ },
      "acme.dynamic-server": { files: { "server/index.ts": SERVER_INDEX("acme.dynamic-server", `export const later = async () => (await import("@ragents/host/plugin-support/plugins-root")).bundlesRoot;`) }, expected: /server\/index\.ts:\d+:\d+: import\(\) von @ragents\/host\/plugin-support\/plugins-root: ein Modul des Hosts wird statisch importiert/ },
      "acme.namespace-web": { files: { "web/index.ts": `import * as ui from "@ragents/web/ui";\nexport const webPlugin = { id: "acme.namespace-web", button: ui.Button, missing: ui.Irgendwas };\n` }, expected: /web\/index\.ts:\d+:\d+: Import "Irgendwas" will always be undefined/ },
      "acme.dynamic-web": { files: { "web/index.ts": `export const webPlugin = { id: "acme.dynamic-web", load: () => import("@ragents/web/ui") };\n` }, expected: /import\(\) von @ragents\/web\/ui: ein Modul des Hosts wird statisch importiert/ },
      "acme.require-host": { files: { "server/index.ts": SERVER_INDEX("acme.require-host", `import probe from "requiring-probe";\nvoid probe;`), ...requiringPackage }, expected: /require\("typebox"\): der Host liefert typebox nur per import/ },
    };
    writeFiles(root, {
      ...BASE_PLUGIN,
      ...Object.assign({}, ...Object.entries(cases).map(([id, { files }]) => plainPlugin(id, files))),
      "acme.no-server/ragents-plugin.json": JSON.stringify({ id: "acme.no-server" }),
    });
    const outcomes = await buildPlugins([...Object.keys(cases), "acme.no-server"].map((id) => path.join(root, id)), { out: path.join(root, "dist"), typecheck: false });
    for (const [id, { expected }] of Object.entries(cases)) assert.match(problemsOf(outcomes, id), expected, id);
    assert.match(problemsOf(outcomes, "acme.no-server"), /server\/index\.ts fehlt/);
    assert.deepEqual(readdirSync(path.join(root, "dist")), [], "ein abgelehntes Plugin hinterlässt nichts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("eine CommonJS-Bibliothek, die Node-Module per require lädt, baut und läuft in der Server-Hälfte", async () => {
  const root = scratch();
  try {
    writeFiles(root, plainPlugin("acme.cjs-library", {
      "server/index.ts": SERVER_INDEX("acme.cjs-library", `import { StreamMessageReader } from "vscode-jsonrpc/node";\nexport const reader = StreamMessageReader;`),
    }));
    const [outcome] = await buildPlugins([path.join(root, "acme.cjs-library")], { out: path.join(root, "dist"), typecheck: false });
    const { bundle } = built(outcome);
    const loaded = await importBundles(resolvePluginEntries([bundle]));
    assert.equal(typeof loaded.get("acme.cjs-library")?.reader, "function", "vscode-jsonrpc lädt util, net und path per require");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ein Name, den das Register des Hosts nicht hat, ist im Web ein Fehler mit Ursache, nie undefined", async () => {
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
      await assert.rejects(load(undefined, "ohne Register"), /Der Host stellt @ragents\/web\/ui nicht bereit/);
      await assert.rejects(load({ "@ragents/web/ui": {} }, "ohne Namen"), /Der Host stellt cn aus @ragents\/web\/ui nicht bereit; das Bundle ist gegen einen neueren Host gebaut/);
      const cn = () => "";
      assert.equal((await load({ "@ragents/web/ui": { cn } }, "passend")).webPlugin.cn, cn);
    } finally {
      Object.assign(globalThis, { [HOST_MODULES_GLOBAL]: undefined });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Typfehler, eine falsche Kennung und unbekannte Felder sind Baufehler", async () => {
  const root = scratch();
  try {
    writeFiles(root, {
      ...plainPlugin("acme.typed", { "server/index.ts": SERVER_INDEX("acme.typed", `export const count: number = "drei";\nexport const here = __dirname;`) }),
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
    assert.match(problemsOf(outcomes, "acme.typed"), /Typen: server\/index\.ts:2:14: Type 'string' is not assignable to type 'number'/);
    assert.match(problemsOf(outcomes, "acme.typed"), /__dirname ist im Bundle nicht erlaubt/, "Typfehler verdecken die übrigen Befunde nicht");
    assert.equal(existsSync(path.join(root, "dist/acme.typed")), false);
    await assert.rejects(buildPlugins([path.join(root, "acme.renamed")], { out: path.join(root, "dist"), typecheck: false }), /die Kennung acme\.other weicht vom Ordnernamen acme\.renamed ab/);
    await assert.rejects(buildPlugins([path.join(root, "acme.extra")], { out: path.join(root, "dist"), typecheck: false }), /unbekannte Felder entry/);
    await assert.rejects(buildPlugins([path.join(root, "acme.missing-export")], { out: path.join(root, "dist"), typecheck: false }), /der Export server\/nothing für server hat keine Quelldatei/);
    await assert.rejects(buildPlugins([path.join(root, "acme.reserved-asset")], { out: path.join(root, "dist"), typecheck: false }), /das Asset web\/source\.tsx liegt unter web, das schreibt das Bauwerkzeug selbst/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("react aus einem eigenen node_modules des Plugins wird nie gebündelt, es kommt immer vom Host", async () => {
  const root = scratch();
  try {
    writeFiles(root, plainPlugin("acme.own-react", {
      "node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.0", main: "index.js" }),
      "node_modules/react/index.js": `module.exports = { marker: "eigenes-react", useState: () => [] };\n`,
      "web/index.ts": `import { useState } from "react";\nexport const webPlugin = { id: "acme.own-react", useState };\n`,
    }));
    const [outcome] = await buildPlugins([path.join(root, "acme.own-react")], { out: path.join(root, "dist"), typecheck: false });
    const web = readFileSync(path.join(built(outcome).bundle, "web/index.js"), "utf8");
    assert.doesNotMatch(web, /eigenes-react/);
    assert.match(web, /__ragentsHostModules/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--watch baut nach jeder Änderung im Plugin-Ordner neu", async () => {
  const root = scratch();
  const outcomes: PluginBuildOutcome[] = [];
  const waitFor = async (count: number): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (outcomes.length < count) {
      if (Date.now() > deadline) throw new Error(`nach 10 s erst ${outcomes.length} Bauläufe`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  try {
    writeFiles(root, plainPlugin("acme.watched", { "server/greeting.ts": `export const greeting = "erste Fassung";\n`, "server/index.ts": SERVER_INDEX("acme.watched", `export { greeting } from "./greeting.ts";`) }));
    const watching = await watchPlugins([path.join(root, "acme.watched")], { out: path.join(root, "dist") }, (outcome) => outcomes.push(outcome));
    try {
      await waitFor(1);
      const bundle = built(outcomes[0]).bundle;
      assert.match(readFileSync(path.join(bundle, "server/index.js"), "utf8"), /erste Fassung/);
      writeFileSync(path.join(root, "acme.watched/server/greeting.ts"), `export const greeting = "zweite Fassung";\n`);
      await waitFor(2);
      built(outcomes[1]);
      assert.match(readFileSync(path.join(bundle, "server/index.js"), "utf8"), /zweite Fassung/);
    } finally {
      await watching.stop();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--watch liest Beschreibung, Assets, Einstiege und Exporte der Geschwister bei jeder Änderung neu", async () => {
  const root = scratch();
  const outcomes: PluginBuildOutcome[] = [];
  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`nach 10 s kein Bau mit ${what}:\n${JSON.stringify(outcomes.at(-1))}`);
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
      await waitFor(() => lastBuilt("acme.grown")?.kind === "built" && lastBuilt("acme.sibling")?.kind === "built", "beiden Plugins");
      writeFiles(root, {
        "acme.grown/data/table.json": "{}\n",
        "acme.grown/prompt.hbs": "Hallo\n",
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
      }, "Web-Hälfte und neuem Asset");
      const { manifest, bundle } = built(lastBuilt("acme.grown"));
      assert.deepEqual(manifest.assets, ["prompt.hbs", "data"]);
      assert.deepEqual(manifest.uses, ["acme.sibling"], "der neue Export des Geschwisters gilt sofort");
      for (const file of ["data/table.json", "prompt.hbs", "web/index.js"]) assert.ok(existsSync(path.join(bundle, file)), file);
    } finally {
      await watching.stop();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pnpm build:plugins baut nur Veraltetes und tauscht Dateien einzeln, der Bundle-Ordner bleibt derselbe", async () => {
  const root = scratch();
  try {
    writeFiles(root, {
      ...plainPlugin("acme.kept", { "prompt.hbs": "bleibt\n" }),
      ...plainPlugin("acme.changed", { "prompt.hbs": "bleibt\n", "server/greeting.ts": `export const greeting = "alt";\n`, "server/index.ts": SERVER_INDEX("acme.changed", `export { greeting } from "./greeting.ts";`) }),
    });
    const out = path.join(root, "dist");
    const folders = [path.join(root, "acme.kept"), path.join(root, "acme.changed")];
    await buildPlugins(folders, { out, typecheck: false });
    const inode = (file: string): number => statSync(path.join(out, file)).ino;
    const before = { kept: inode("acme.kept/server/index.js"), folder: inode("acme.changed"), prompt: inode("acme.changed/prompt.hbs"), entry: inode("acme.changed/server/index.js") };
    writeFileSync(path.join(root, "acme.changed/server/greeting.ts"), `export const greeting = "neu";\n`);
    const outcomes = await buildPlugins(folders, { out, typecheck: false, onlyOutdated: true });
    assert.deepEqual(outcomes.map((outcome) => outcome.id), ["acme.changed"], "ein aktuelles Bundle bleibt liegen");
    assert.equal(inode("acme.kept/server/index.js"), before.kept);
    assert.equal(inode("acme.changed"), before.folder, "der Ordner wird nie weggenommen, auch nicht kurz");
    assert.equal(inode("acme.changed/prompt.hbs"), before.prompt, "eine unveränderte Datei bleibt, wie sie ist");
    assert.notEqual(inode("acme.changed/server/index.js"), before.entry);
    assert.match(readFileSync(path.join(out, "acme.changed/server/index.js"), "utf8"), /"neu"/);
    assert.equal(built(outcomes[0]).manifest.stand, bundleStand(path.join(out, "acme.changed")), "keine Reste der alten Fassung");
    writeFileSync(path.join(out, "acme.kept/prompt.hbs"), "von Hand geändert\n");
    assert.deepEqual((await buildPlugins(folders, { out, typecheck: false, onlyOutdated: true })).map((outcome) => outcome.id), ["acme.kept"], "ein beschädigtes Bundle ist veraltet");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parallele Bauläufe in denselben Ordner warten aufeinander und kollidieren nicht", async () => {
  const root = scratch();
  try {
    writeFiles(root, { ...plainPlugin("acme.first", {}), ...plainPlugin("acme.second", {}) });
    const out = path.join(root, "dist");
    const folders = [path.join(root, "acme.first"), path.join(root, "acme.second")];
    const runs = await Promise.all([1, 2, 3].map(() => buildPlugins(folders, { out, typecheck: false })));
    for (const outcomes of runs) for (const outcome of outcomes) built(outcome);
    assert.deepEqual(readdirSync(out).sort(), ["acme.first", "acme.second"], "keine Reste von Zwischenständen oder Sperren");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--watch baut beim Start nur Bundles, die fehlen oder nicht zu ihren Quellen passen", async () => {
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
      // Der Mac meldet die Änderung kurz vor dem Start manchmal nach, dann baut acme.stale ein zweites Mal.
      assert.ok(outcomes.some((outcome) => outcome.id === "acme.stale"));
      assert.equal(outcomes.some((outcome) => outcome.id === "acme.current"), false, "ein aktuelles Bundle bleibt beim Start liegen, damit ein startender Server es nicht verliert");
    } finally {
      await watching.stop();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("der Quellstand lässt ein Ziel im Plugin-Ordner aus, damit ein zweiter Bau denselben Stand ergibt", async () => {
  const root = scratch();
  try {
    const folder = path.join(root, "acme.inside");
    writeFiles(folder, {
      "ragents-plugin.json": JSON.stringify({ id: "acme.inside" }),
      "server/index.ts": "export const plugin = { create: () => ({ manifest: { id: \"acme.inside\" }, register: () => {} }) };\n",
    });
    const out = path.join(folder, "dist");
    const first = built((await buildPlugins([folder], { out, typecheck: false }))[0]).manifest.sourceStand;
    const second = built((await buildPlugins([folder], { out, typecheck: false }))[0]).manifest.sourceStand;
    assert.equal(second, first);
    assert.equal(first, sourceStandOf(folder, [out]));
    writeFileSync(path.join(folder, "server/index.ts"), "export const plugin = { create: () => ({ manifest: { id: \"acme.inside\" }, register: () => {} }) };\n// neu\n");
    assert.notEqual(built((await buildPlugins([folder], { out, typecheck: false }))[0]).manifest.sourceStand, first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugin build liest Ordner, Ziel und Schalter relativ zum Aufrufer", () => {
  assert.deepEqual(parsePluginArguments(["build", "plugins/acme", "../b"], "/work/repo"), {
    folders: ["/work/repo/plugins/acme", "/work/b"], out: "/work/repo/dist/plugins", watch: false, typecheck: true,
  });
  assert.deepEqual(parsePluginArguments(["build", "a", "--out", "/tmp/x", "--no-typecheck"], "/w"), { folders: ["/w/a"], out: "/tmp/x", watch: false, typecheck: false });
  assert.equal(parsePluginArguments(["build", "a", "--watch"], "/w").typecheck, false, "--watch prüft keine Typen");
  assert.throws(() => parsePluginArguments(["build"], "/w"), /mindestens einen Plugin-Ordner/);
  assert.throws(() => parsePluginArguments(["build", "a", "--minify"], "/w"), /Unbekanntes Argument: --minify/);
  assert.throws(() => parsePluginArguments(["pack", "a"], "/w"), /Unbekannter Befehl: plugin pack/);
});
