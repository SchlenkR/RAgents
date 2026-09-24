import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { hostApiModules, hostOnly, providedByHost, type HostApiHalf } from "../src/host-api.ts";
import { readHostApiRecord } from "../src/plugin-build/host-api-names.ts";
import { pluginsRoot } from "../src/plugin-support/plugins-root.ts";

interface PluginDescription {
  readonly id: string;
  readonly exports?: Partial<Record<HostApiHalf, readonly string[]>>;
}

const repositoryRoot = path.dirname(pluginsRoot);
const pluginIds = readdirSync(pluginsRoot).filter((entry) => statSync(path.join(pluginsRoot, entry)).isDirectory()).sort();
const descriptionOf = (id: string): PluginDescription =>
  JSON.parse(readFileSync(path.join(pluginsRoot, id, "ragents-plugin.json"), "utf8")) as PluginDescription;

const sourceFile = (base: string): string | undefined => {
  const stem = base.replace(/\.(js|ts|tsx)$/, "");
  return [`${stem}.ts`, `${stem}.tsx`, `${stem}.d.ts`, path.join(stem, "index.ts"), path.join(stem, "index.tsx")].find((candidate) => existsSync(candidate));
};

interface Use {
  readonly file: string;
  readonly specifier: string;
}

/** Import specifiers and file-location constructs of one source file, from its syntax tree. */
const scan = (file: string): { specifiers: string[]; locations: string[] } => {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const locations: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      specifiers.push(node.arguments[0].text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      locations.push("import.meta");
    } else if (ts.isIdentifier(node) && ["__dirname", "__filename", "createRequire"].includes(node.text)) {
      locations.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { specifiers, locations };
};

/** Everything a half of a plugin would bundle: its entries and all files reached through relative imports. */
const reach = (folder: string, entries: readonly string[]): { uses: Use[]; problems: string[] } => {
  const pending = [...entries];
  const seen = new Set<string>();
  const uses: Use[] = [];
  const problems: string[] = [];
  while (pending.length > 0) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const relativeFile = path.relative(pluginsRoot, file);
    const { specifiers, locations } = scan(file);
    for (const location of new Set(locations)) problems.push(`${relativeFile}: ${location}; Dateien des Plugins gehen über pluginFolder(id)`);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) {
        uses.push({ file: relativeFile, specifier });
        continue;
      }
      const target = sourceFile(path.resolve(path.dirname(file), specifier));
      if (!target) problems.push(`${relativeFile}: ${specifier} ist keine Quelldatei`);
      else if (!target.startsWith(folder + path.sep)) problems.push(`${relativeFile}: ${specifier} liegt außerhalb des Plugin-Ordners`);
      else pending.push(target);
    }
  }
  return { uses, problems };
};

const entriesOf = (id: string, half: HostApiHalf): string[] => {
  const folder = path.join(pluginsRoot, id);
  const own = half === "server" ? ["server/index", "provision"] : ["web/index"];
  const exported = descriptionOf(id).exports?.[half] ?? [];
  return [...own, ...exported].map((name) => sourceFile(path.join(folder, name))).filter((file): file is string => file !== undefined);
};

/** The requires of the module contract, read from the source so that no plugin code runs. */
const requiresOf = (id: string): readonly string[] => {
  const file = path.join(pluginsRoot, id, "server/index.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "requires") {
      assert.ok(ts.isArrayLiteralExpression(node.initializer) && node.initializer.elements.every(ts.isStringLiteral), `${id}: requires ist keine Liste fester Kennungen`);
      found.push(node.initializer.elements.map((element) => (element as ts.StringLiteral).text));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found.length <= 1, `${id}: requires steht mehrfach im Modulvertrag`);
  return found[0] ?? [];
};

test("jedes eingebaute Plugin beschreibt sich in ragents-plugin.json mit seiner Kennung und vorhandenen Exporten", () => {
  for (const id of pluginIds) {
    const description = descriptionOf(id);
    assert.equal(description.id, id, `${id}: die Kennung in ragents-plugin.json weicht vom Ordnernamen ab`);
    for (const [half, names] of Object.entries(description.exports ?? {})) {
      for (const name of names) assert.ok(sourceFile(path.join(pluginsRoot, id, name)), `${id} exportiert ${name} für ${half}, die Datei fehlt`);
    }
  }
});

test("eingebaute Plugins importieren nur die Host-API, ihren eigenen Ordner und deklarierte Exporte anderer Plugins", () => {
  const problems: string[] = [];
  for (const id of pluginIds) {
    const requires = requiresOf(id);
    for (const half of ["server", "web"] as const) {
      const reached = reach(path.join(pluginsRoot, id), entriesOf(id, half));
      problems.push(...reached.problems);
      for (const { file, specifier } of reached.uses) {
        const plugin = /^@ragents\/plugins\/([^/]+)\/(.+?)(\.js|\.ts|\.tsx)?$/.exec(specifier);
        if (plugin) {
          const [, owner, name] = plugin;
          if (owner === id) problems.push(`${file}: ${specifier} importiert das eigene Plugin über den Paketnamen`);
          else if (!(descriptionOf(owner!).exports?.[half] ?? []).includes(name!)) problems.push(`${file}: ${owner} exportiert ${name} für die ${half}-Hälfte nicht`);
          else if (!requires.includes(owner!)) problems.push(`${file}: ${owner} fehlt in requires von ${id}`);
        } else if (hostOnly(specifier) && !providedByHost(half, specifier)) {
          problems.push(`${file}: ${specifier} steht nicht in der ${half}-Liste der Host-API`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("das Register des Webs legt genau die Module der Web-Liste mit Werten unter ihrem Bezeichner ab", () => {
  const file = path.join(repositoryRoot, "apps/web/src/host-modules.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const namespaces = new Map(source.statements.filter(ts.isImportDeclaration).flatMap((declaration) => {
    const bindings = declaration.importClause?.namedBindings;
    return bindings && ts.isNamespaceImport(bindings) ? [[bindings.name.text, (declaration.moduleSpecifier as ts.StringLiteral).text] as const] : [];
  }));
  const entries: [string, string][] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && ts.isIdentifier(node.initializer)) entries.push([node.name.text, node.initializer.text]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const withValues = Object.entries(readHostApiRecord().web).filter(([, names]) => names.length > 0).map(([specifier]) => specifier);
  assert.deepEqual(entries.map(([specifier]) => specifier).sort(), withValues.sort());
  for (const [specifier, name] of entries) assert.equal(namespaces.get(name), specifier, `${specifier} zeigt auf ${name}, das ${namespaces.get(name)} importiert`);
});

test("die Host-API nennt nur Module, die es gibt", () => {
  const places = { server: ["apps/server/tsconfig.json", "apps/server/src/main.ts"], web: ["apps/web/tsconfig.json", "apps/web/src/main.tsx"] } as const;
  for (const half of ["server", "web"] as const) {
    const [config, importer] = places[half].map((file) => path.join(repositoryRoot, file)) as [string, string];
    const options = ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    } })!.options;
    for (const specifier of hostApiModules(half)) {
      assert.ok(ts.resolveModuleName(specifier, importer, options, ts.sys).resolvedModule, `${specifier} ist für die ${half}-Hälfte nicht auflösbar`);
    }
  }
});
