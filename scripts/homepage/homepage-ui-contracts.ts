import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { readClientUiContractFiles } from "../../plugins/ragents.actor-programs/server/client-contracts.js";

export interface HomepageUiProp {
  name: string;
  type: string;
  optional: boolean;
  description?: string;
}

export interface HomepageUiComponent {
  name: string;
  variants: { name: string; props: HomepageUiProp[] }[];
  hasDemo: boolean;
  description?: string;
}

const contractEntry = "plugins/ragents.actor-programs/client-ui/contracts.d.ts";
const runtimeEntry = "plugins/ragents.actor-programs/client-ui/index.tsx";
const demoEntry = "docs/homepage/reference-ui.tsx";
const sharedLibrary = /\/apps\/web\/src\/ui\/(?!ListDetail\.tsx$|SvgEdge\.tsx$)/;
const hostPackagePaths = {
  "@aicontainer/server/*": ["apps/server/src/*"],
  "@aicontainer/web/*": ["apps/web/src/*"],
  "@aicontainer/plugins/*": ["plugins/*"],
};

function demoExports(repoRoot: string): Set<string> {
  const source = ts.createSourceFile(demoEntry, readFileSync(path.join(repoRoot, demoEntry), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "data-component") {
      if (!node.initializer || !ts.isStringLiteral(node.initializer)) throw new Error("UI-Demos benötigen literale data-component-Namen.");
      node.initializer.text.split(/\s+/).filter(Boolean).forEach((name) => names.add(name));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

export function readHomepageUiContracts(repoRoot: string): { components: HomepageUiComponent[]; files: Record<string, string> } {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
    strict: true, skipLibCheck: true, esModuleInterop: true,
    declaration: true, emitDeclarationOnly: true,
    baseUrl: repoRoot, paths: hostPackagePaths,
  };
  const program = ts.createProgram([contractEntry, runtimeEntry].map((file) => path.join(repoRoot, file)), options);
  const source = program.getSourceFile(path.join(repoRoot, contractEntry));
  const runtime = program.getSourceFile(path.join(repoRoot, runtimeEntry));
  if (!source || !runtime) throw new Error("Der öffentliche UI-Vertrag oder seine Implementierung fehlt.");
  const checker = program.getTypeChecker();
  const exportsOf = (file: ts.SourceFile) => {
    const symbol = checker.getSymbolAtLocation(file);
    if (!symbol) throw new Error("Der öffentliche UI-Vertrag ist kein Modul.");
    return checker.getExportsOfModule(symbol).map((entry) => ({ name: entry.name,
      symbol: entry.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(entry) : entry }));
  };
  const exported = exportsOf(source).filter(({ symbol }) => symbol.flags & ts.SymbolFlags.Value);
  const implementations = new Map(exportsOf(runtime).filter(({ symbol }) => symbol.flags & ts.SymbolFlags.Value).map((entry) => [entry.name, entry.symbol]));
  for (const name of new Set([...exported.map((entry) => entry.name), ...implementations.keys()])) {
    if (!exported.some((entry) => entry.name === name) || !implementations.has(name)) throw new Error(`UI.${name}: öffentlicher Vertrag und Runtime-Export stimmen nicht überein.`);
  }
  const contracts = exported.filter(({ name, symbol }) => /^[A-Z]/.test(name)
    && !symbol.declarations?.some((declaration) => sharedLibrary.test(declaration.getSourceFile().fileName)));
  const demos = demoExports(repoRoot);
  const description = (symbol: ts.Symbol) => {
    const text = ts.displayPartsToString(symbol.getDocumentationComment(checker));
    return text ? { description: text } : {};
  };
  const components = contracts.map(({ name, symbol }): HomepageUiComponent => {
    const type = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? source);
    const implementation = implementations.get(name)!;
    if (!checker.isTypeAssignableTo(checker.getTypeOfSymbolAtLocation(implementation, implementation.valueDeclaration ?? runtime), type)) {
      throw new Error(`UI.${name}: Die Implementierung erfüllt den öffentlichen Typvertrag nicht.`);
    }
    const signatures = type.getCallSignatures();
    if (!signatures.length) throw new Error(`UI.${name} ist keine aufrufbare Komponente.`);
    const variants = signatures.flatMap((signature) => {
      const parameter = signature.getParameters()[0];
      if (!parameter) throw new Error(`UI.${name} hat keinen Props-Vertrag.`);
      const propsType = checker.getTypeOfSymbolAtLocation(parameter, parameter.valueDeclaration ?? source);
      return (propsType.isUnion() ? propsType.types : [propsType]).map((props) => ({
        name: props.aliasSymbol?.name ?? props.getSymbol()?.name ?? `${name}Props`,
        props: checker.getPropertiesOfType(props).map((property) => {
          const location = property.valueDeclaration ?? source;
          const declaredNever = ts.isPropertySignature(location) && location.type?.kind === ts.SyntaxKind.NeverKeyword;
          const text = declaredNever ? "never" : checker.typeToString(checker.getTypeOfSymbolAtLocation(property, location), location,
            ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
          if (text.includes("import(") || text.includes(repoRoot)) throw new Error(`UI.${name}.${property.name} enthält einen nicht öffentlichen Typverweis.`);
          return { name: property.name, type: text, optional: Boolean(property.flags & ts.SymbolFlags.Optional), ...description(property) };
        }),
      }));
    });
    return { name, variants, hasDemo: demos.has(name), ...description(symbol) };
  });
  if (!components.length) throw new Error("Der öffentliche UI-Vertrag exportiert keine Komponenten.");
  for (const name of demos) if (!exported.some((entry) => entry.name === name)) throw new Error(`Die UI-Demo verwendet den fehlenden Export ${name}.`);

  return { components, files: readClientUiContractFiles(repoRoot) };
}
