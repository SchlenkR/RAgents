import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function readContracts(repoRoot: string): { names: string[]; files: Record<string, string> } {
  const filename = path.join(repoRoot, "plugins/ragents.actor-programs/client-ui/contracts.d.ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, esModuleInterop: true,
    declaration: true, emitDeclarationOnly: true,
  };
  const program = ts.createProgram([filename], options);
  const source = program.getSourceFile(filename);
  if (!source) throw new Error("Der öffentliche UI-Vertrag fehlt.");
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(source);
  if (!module) throw new Error("Der öffentliche UI-Vertrag ist kein Modul.");
  const names = checker.getExportsOfModule(module).filter((entry) => {
    const symbol = entry.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(entry) : entry;
    return /^[A-Z]/.test(entry.name) && (symbol.flags & ts.SymbolFlags.Value) && checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? source).getCallSignatures().length > 0;
  }).map((entry) => entry.name).sort((a, b) => a.localeCompare(b, "en"));
  if (!names.length) throw new Error("Der öffentliche UI-Vertrag exportiert keine Komponenten.");
  const files: Record<string, string> = {};
  const visited = new Set<string>();
  const diagnostics: ts.Diagnostic[] = [...program.getOptionsDiagnostics()];
  const collect = (file: ts.SourceFile) => {
    if (visited.has(file.fileName)) return;
    visited.add(file.fileName);
    const relative = path.relative(repoRoot, file.fileName).replaceAll(path.sep, "/");
    if (relative.startsWith("../") || relative.includes("node_modules/")) throw new Error("Ein lokaler UI-Typverweis verlässt die öffentlichen Repository-Quellen.");
    diagnostics.push(...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file));
    let text = file.isDeclarationFile ? file.text : "";
    if (!file.isDeclarationFile) {
      const emitted = program.emit(file, (filename, content) => { if (filename.endsWith(".d.ts")) text = content; }, undefined, true);
      diagnostics.push(...emitted.diagnostics);
      if (!text) throw new Error(`UI-Typdeklarationen fehlen: ${relative}`);
    }
    files[relative.replace(/(?<!\.d)\.tsx?$/, ".d.ts")] = text;
    const declaration = ts.createSourceFile(file.fileName, text, ts.ScriptTarget.Latest, true);
    const references = ts.preProcessFile(text, true, true);
    for (const reference of references.importedFiles) {
      if (!reference.fileName.startsWith(".")) continue;
      const resolved = ts.resolveModuleName(reference.fileName, file.fileName, options, ts.sys).resolvedModule;
      const dependency = resolved && program.getSourceFile(resolved.resolvedFileName);
      if (!dependency) throw new Error(`Nicht auflösbarer lokaler UI-Typverweis: ${relative}: ${reference.fileName}`);
      collect(dependency);
    }
    for (const reference of declaration.referencedFiles) {
      const dependency = program.getSourceFile(path.resolve(path.dirname(file.fileName), reference.fileName));
      if (!dependency) throw new Error(`Nicht auflösbarer UI-Typdateiverweis: ${relative}: ${reference.fileName}`);
      collect(dependency);
    }
  };
  collect(source);
  if (diagnostics.length) throw new Error(`Der öffentliche UI-Vertrag kann nicht geprüft werden: ${diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")).join("; ")}`);
  return { names, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b, "en"))) };
}

let cached: ReturnType<typeof readContracts> | undefined;
const contracts = (repoRoot?: string) => repoRoot === undefined
  ? cached ??= readContracts(fileURLToPath(new URL("../../../", import.meta.url)))
  : readContracts(repoRoot);

export function readClientUiContractFiles(repoRoot?: string): Record<string, string> {
  return { ...contracts(repoRoot).files };
}

export function readClientUiComponentNames(repoRoot?: string): string[] {
  return [...contracts(repoRoot).names];
}

export function readClientUiComponentContracts(component: string, repoRoot?: string): Record<string, string> {
  if (!contracts(repoRoot).names.includes(component)) throw new Error(`Unbekanntes Control ${component}. Gültig: ${contracts(repoRoot).names.join(", ")}`);
  return readClientUiExportContracts(component, repoRoot);
}

export function readClientUiExportContracts(component: string, repoRoot?: string): Record<string, string> {
  const root = repoRoot ?? fileURLToPath(new URL("../../../", import.meta.url));
  const catalog = contracts(repoRoot);
  const files = new Map(Object.entries(catalog.files).map(([name, text]) => [path.resolve(root, name), text]));
  const options: ts.CompilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host);
  const originalExists = host.fileExists.bind(host);
  host.readFile = (name) => files.get(path.resolve(name)) ?? originalRead(name);
  host.fileExists = (name) => {
    const absolute = path.resolve(name);
    if (files.has(absolute)) return true;
    if (files.has(absolute.replace(/(?<!\.d)\.tsx?$/, ".d.ts"))) return false;
    return originalExists(name);
  };
  host.getSourceFile = (name, languageVersion) => {
    const text = host.readFile(name);
    return text === undefined ? undefined : ts.createSourceFile(name, text, languageVersion, true);
  };
  const entry = path.join(root, "plugins/ragents.actor-programs/client-ui/contracts.d.ts");
  const program = ts.createProgram([entry], options, host);
  const checker = program.getTypeChecker();
  const selected = new Set<ts.Statement>();
  const imported = new Set<ts.Declaration>();
  const bridges = new Map<ts.SourceFile, Map<string, ts.Symbol>>();
  const visitedExports = new Set<string>();
  const resolve = (symbol: ts.Symbol) => symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const local = (file: ts.SourceFile) => files.has(path.resolve(file.fileName));
  const exportFrom = (file: ts.SourceFile, name: string): void => {
    const key = `${file.fileName}:${name}`;
    if (visitedExports.has(key)) return;
    visitedExports.add(key);
    const module = checker.getSymbolAtLocation(file);
    const symbol = module && checker.getExportsOfModule(module).find((item) => item.name === name);
    if (!symbol) throw new Error(`UI-Typverweis fehlt: ${file.fileName}: ${name}`);
    const target = resolve(symbol);
    const declaration = target.declarations?.find((item) => local(item.getSourceFile()));
    if (!declaration) return;
    if (declaration.getSourceFile() !== file || target.name !== name) {
      const exports = bridges.get(file) ?? new Map<string, ts.Symbol>();
      exports.set(name, target);
      bridges.set(file, exports);
    }
    visit(target);
  };
  const visit = (symbol: ts.Symbol): void => {
    if (symbol.flags & ts.SymbolFlags.Alias) {
      for (const declaration of symbol.declarations ?? []) {
        if (!local(declaration.getSourceFile())) continue;
        imported.add(declaration);
        if (ts.isImportSpecifier(declaration) || ts.isImportClause(declaration)) {
          const clause = ts.isImportSpecifier(declaration) ? declaration.parent.parent : declaration;
          const statement = clause.parent;
          const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
          const file = module?.declarations?.find(ts.isSourceFile);
          if (file && local(file)) exportFrom(file, ts.isImportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).text : "default");
        }
      }
      visit(resolve(symbol));
      return;
    }
    for (const declaration of symbol.declarations ?? []) {
      if (!local(declaration.getSourceFile())) continue;
      let node: ts.Node = declaration;
      while (node.parent && !ts.isSourceFile(node.parent)) node = node.parent;
      if (!ts.isStatement(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || selected.has(node)) continue;
      selected.add(node);
      const scan = (child: ts.Node): void => {
        if (ts.isIdentifier(child)) {
          const dependency = checker.getSymbolAtLocation(child);
          if (dependency) visit(dependency);
        }
        ts.forEachChild(child, scan);
      };
      scan(node);
    }
  };
  const source = program.getSourceFile(entry);
  if (!source) throw new Error("Der öffentliche UI-Vertrag fehlt.");
  exportFrom(source, component);
  const printer = ts.createPrinter();
  const result: Record<string, string> = {};
  for (const file of program.getSourceFiles().filter(local)) {
    const declarations = file.statements.filter((statement) => selected.has(statement));
    const exported = bridges.get(file);
    if (!declarations.length && !exported) continue;
    const lines: string[] = [];
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
      const clause = statement.importClause;
      const name = imported.has(clause) ? clause.name : undefined;
      const bindings = clause.namedBindings;
      const named = bindings && ts.isNamedImports(bindings)
        ? ts.factory.updateNamedImports(bindings, bindings.elements.filter((item) => imported.has(item)))
        : bindings && imported.has(bindings) ? bindings : undefined;
      if (!name && (!named || ts.isNamedImports(named) && named.elements.length === 0)) continue;
      lines.push(printer.printNode(ts.EmitHint.Unspecified, ts.factory.updateImportDeclaration(statement, statement.modifiers, ts.factory.updateImportClause(clause, clause.isTypeOnly, name, named), statement.moduleSpecifier, statement.attributes), file));
    }
    lines.push(...declarations.map((statement) => statement.getFullText(file).trim()));
    for (const [name, target] of exported ?? []) {
      const declaration = target.declarations!.find((item) => local(item.getSourceFile()))!;
      const targetFile = declaration.getSourceFile();
      const relative = path.relative(path.dirname(file.fileName), targetFile.fileName).replaceAll(path.sep, "/").replace(/\.d\.ts$/, "");
      const specifier = relative.startsWith(".") ? relative : `./${relative}`;
      lines.push(`export { ${target.name}${name === target.name ? "" : ` as ${name}`} }${targetFile === file ? "" : ` from ${JSON.stringify(specifier)}`};`);
    }
    result[path.relative(root, file.fileName).replaceAll(path.sep, "/")] = `${lines.join("\n\n")}\n`;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, "en")));
}
