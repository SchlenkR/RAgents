import path from "node:path";
import ts from "typescript";

const PRIMITIVES = new Set(["useState", "useStateWith", "step", "waitUntil", "receive", "watch", "when", "forEach"]);
const AWAITED = new Set(["step", "waitUntil", "receive", "watch", "when", "forEach"]);
const IO_MODULES = new Set(["fs", "fs/promises", "net", "child_process", "http", "https", "http2", "dgram", "tls"]);
const TIMERS = new Set(["setTimeout", "setInterval", "setImmediate", "fetch"]);
const MUTATORS = new Set(["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin", "set", "add", "delete", "clear"]);
const WHEN_ADVICE = "use ctx.when(condition, () => ..., ctx.elsePreserve or ctx.elseForget)";

interface Finding { readonly node: ts.Node; readonly code: "RAG1001" | "RAG1002" | "RAG1003"; readonly message: string }

const isSdkFile = (file: ts.SourceFile): boolean => file.fileName.split(path.sep).join("/").endsWith("/node_modules/@ragents/server/index.d.ts");
const unwrapped = (node: ts.Node): ts.Node => {
  let current = node;
  while (ts.isParenthesizedExpression(current.parent) || ts.isAsExpression(current.parent) || ts.isNonNullExpression(current.parent) || ts.isSatisfiesExpression(current.parent)) current = current.parent;
  return current;
};
const isLoop = (node: ts.Node): node is ts.IterationStatement => ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node);
const isLogical = (kind: ts.SyntaxKind): boolean => [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(kind);
const moduleName = (specifier: string): string => specifier.replace(/^node:/, "");

/** The checks that keep a state-aware program replayable: primitives by position, no hidden nondeterminism, no module state. */
export const programGuardDiagnostics = (program: ts.Program, directory: string): string[] => {
  const checker = program.getTypeChecker();
  const sources = program.getSourceFiles().filter((file) => !file.isDeclarationFile && !file.fileName.split(path.sep).includes("node_modules")
    && path.resolve(file.fileName).startsWith(`${path.resolve(directory)}${path.sep}`));
  const fromSdk = (declaration: ts.Declaration | undefined, owner: string): boolean => {
    const parent = declaration?.parent;
    return Boolean(parent && ts.isInterfaceDeclaration(parent) && parent.name.text === owner && isSdkFile(parent.getSourceFile()));
  };
  const primitiveOf = (call: ts.CallExpression): string | undefined => {
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    if (!declaration || !ts.isMethodSignature(declaration) || !fromSdk(declaration, "ProgramContext")) return undefined;
    const name = declaration.name.getText();
    return PRIMITIVES.has(name) ? name : undefined;
  };
  const isDefineProgram = (call: ts.CallExpression): boolean => {
    const declaration = checker.getResolvedSignature(call)?.getDeclaration();
    return Boolean(declaration && ts.isFunctionDeclaration(declaration) && declaration.name?.text === "defineProgram" && isSdkFile(declaration.getSourceFile()));
  };
  const isProgramContext = (expression: ts.Expression): boolean => {
    const symbol = checker.getTypeAtLocation(expression).getSymbol();
    return Boolean(symbol?.name === "ProgramContext" && symbol.declarations?.some((declaration) => isSdkFile(declaration.getSourceFile())));
  };
  const argumentOf = (fn: ts.Node): { call: ts.CallExpression; index: number } | undefined => {
    const parent = unwrapped(fn).parent;
    if (!parent || !ts.isCallExpression(parent)) return undefined;
    const index = parent.arguments.findIndex((argument) => argument === fn || unwrapped(fn) === argument);
    return index < 0 ? undefined : { call: parent, index };
  };
  const bodies = new Set<ts.Node>();
  const allowed = (fn: ts.Node): boolean => {
    if (bodies.has(fn)) return true;
    const owner = argumentOf(fn);
    if (!owner) return false;
    const primitive = primitiveOf(owner.call);
    return primitive === "when" && owner.index === 1 || primitive === "forEach" && owner.index === 2;
  };
  const nestedProblem = (fn: ts.Node): string => {
    const owner = argumentOf(fn);
    const primitive = owner ? primitiveOf(owner.call) : undefined;
    if (primitive === "step" && owner?.index === 0) return "inside a ctx.step callback; a step runs once, so call primitives in the program body and pass their values into the step";
    if (primitive === "forEach" && owner?.index === 1) return "inside the forEach key function";
    if (primitive === "useStateWith") return "inside the useStateWith factory";
    return "inside a nested function; call it directly in the program body or in a when or forEach callback";
  };
  const placement = (call: ts.CallExpression, name: string): string | undefined => {
    if (AWAITED.has(name)) {
      const outer = unwrapped(call);
      const parent = outer.parent;
      if (!ts.isAwaitExpression(parent) && !ts.isReturnStatement(parent) && !(ts.isArrowFunction(parent) && parent.body === outer))
        return `ctx.${name}(...) is not awaited; await every primitive directly, as in await ctx.${name}(...)`;
    }
    let node: ts.Node = call;
    for (let parent = node.parent; parent; node = parent, parent = parent.parent) {
      if (ts.isFunctionLike(parent)) return allowed(parent) ? undefined : `ctx.${name} is ${nestedProblem(parent)}`;
      if (ts.isIfStatement(parent) && node !== parent.expression) return `ctx.${name} is inside an if statement; ${WHEN_ADVICE}`;
      if (ts.isConditionalExpression(parent) && node !== parent.condition) return `ctx.${name} is inside a conditional expression; ${WHEN_ADVICE}`;
      if (ts.isBinaryExpression(parent) && isLogical(parent.operatorToken.kind) && node === parent.right) return `ctx.${name} is on the right of ${parent.operatorToken.getText()}; ${WHEN_ADVICE}`;
      if (ts.isCaseClause(parent) || ts.isDefaultClause(parent)) return `ctx.${name} is inside a switch case; ${WHEN_ADVICE}`;
      if (isLoop(parent) && !(ts.isForStatement(parent) && node === parent.initializer) && !((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && node === parent.expression))
        return `ctx.${name} is inside a loop; use ctx.forEach(items, key, (item) => ...) so that every item keeps its own state`;
      if (ts.isTryStatement(parent) || ts.isCatchClause(parent)) return `ctx.${name} is inside try/catch/finally; a waiting primitive ends the evaluation by throwing, so catch errors inside ctx.step instead`;
    }
    return `ctx.${name} is outside a defineProgram body`;
  };
  const globalName = (node: ts.Expression, name: string): boolean => {
    if (!ts.isIdentifier(node) || node.text !== name) return false;
    const declarations = checker.getSymbolAtLocation(node)?.declarations ?? [];
    return declarations.length === 0 || declarations.every((declaration) => declaration.getSourceFile().isDeclarationFile);
  };
  const importedFrom = (identifier: ts.Identifier): { module: string; name: string } | undefined => {
    const declaration = checker.getSymbolAtLocation(identifier)?.declarations?.[0];
    if (!declaration) return undefined;
    const importDeclaration = ts.isImportSpecifier(declaration) ? declaration.parent.parent.parent
      : ts.isNamespaceImport(declaration) ? declaration.parent.parent : ts.isImportClause(declaration) ? declaration.parent : undefined;
    if (!importDeclaration || !ts.isStringLiteral(importDeclaration.moduleSpecifier)) return undefined;
    const name = ts.isImportSpecifier(declaration) ? (declaration.propertyName ?? declaration.name).text : "*";
    return { module: moduleName(importDeclaration.moduleSpecifier.text), name };
  };
  const nondeterminism = (node: ts.Node): string | undefined => {
    if (ts.isNewExpression(node) && globalName(node.expression, "Date") && (node.arguments?.length ?? 0) === 0) return "new Date() reads the clock";
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        const member = callee.name.text;
        if (globalName(callee.expression, "Date") && member === "now") return "Date.now() reads the clock";
        if (globalName(callee.expression, "Math") && member === "random") return "Math.random() is random";
        if (globalName(callee.expression, "performance") && member === "now") return "performance.now() reads the clock";
        if ((globalName(callee.expression, "crypto") || ts.isIdentifier(callee.expression) && importedFrom(callee.expression)?.module === "crypto") && /^(random|getRandomValues)/.test(member)) return `crypto.${member}() is random`;
        if (ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === "functions" && isProgramContext(callee.expression.expression))
          return `ctx.functions.${member}(...) is an effect; run it inside ctx.step so that it runs once`;
        if (globalName(callee.expression, "globalThis") && TIMERS.has(member)) return `${member}() depends on time or the network`;
      }
      if (ts.isIdentifier(callee)) {
        if (TIMERS.has(callee.text) && globalName(callee, callee.text)) return `${callee.text}() depends on time or the network`;
        const imported = importedFrom(callee);
        if (imported?.module === "crypto" && /^(random|getRandomValues)/.test(imported.name)) return `${imported.name}() is random`;
      }
    }
    if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent) && !ts.isImportClause(node.parent) && !ts.isNamespaceImport(node.parent)) {
      const imported = importedFrom(node);
      if (imported && IO_MODULES.has(imported.module)) return `${node.text} from node:${imported.module} reaches files, processes or the network`;
    }
    return undefined;
  };
  const findings: Finding[] = [];
  const programFiles = sources.filter((file) => {
    let found = false;
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isDefineProgram(node)) {
        found = true;
        const body = node.arguments[1];
        if (body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body))) bodies.add(body);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
  });
  if (programFiles.length === 0) return [];
  for (const file of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = primitiveOf(node);
        const problem = name && placement(node, name);
        if (problem) findings.push({ node, code: "RAG1001", message: problem });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const stepCallbacks = (node: ts.Node): boolean => {
    const owner = argumentOf(node);
    return Boolean(owner && owner.index === 0 && primitiveOf(owner.call) === "step");
  };
  for (const body of bodies) {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionLike(node) && stepCallbacks(node)) return;
      const problem = nondeterminism(node);
      if (problem) findings.push({ node, code: "RAG1002", message: `${problem}; a re-evaluation must compute the same values, so do it inside ctx.step` });
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
  }
  for (const file of sources.filter((source) => !path.relative(directory, source.fileName).split(path.sep).includes("tests"))) {
    const moduleBindings = new Map<ts.Symbol, string>();
    for (const statement of file.statements) {
      const variables = ts.isVariableStatement(statement) ? statement.declarationList : undefined;
      if (!variables) continue;
      const constant = (variables.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of variables.declarations) {
        const names = ts.isIdentifier(declaration.name) ? [declaration.name] : [];
        for (const name of names) {
          if (!constant) findings.push({ node: name, code: "RAG1003", message: `${variables.flags & ts.NodeFlags.Let ? "let" : "var"} ${name.text} is module state that no re-evaluation restores; keep program state in ctx.useState` });
          const symbol = checker.getSymbolAtLocation(name);
          if (symbol) moduleBindings.set(symbol, name.text);
        }
      }
    }
    const rootOf = (expression: ts.Expression): ts.Identifier | undefined => {
      let current = expression;
      while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current) || ts.isParenthesizedExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
      return ts.isIdentifier(current) ? current : undefined;
    };
    const moduleRoot = (expression: ts.Expression): string | undefined => {
      const root = rootOf(expression);
      const symbol = root && checker.getSymbolAtLocation(root);
      return symbol ? moduleBindings.get(symbol) : undefined;
    };
    const mutated = (target: ts.Expression, node: ts.Node): void => {
      const name = (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) ? moduleRoot(target) : undefined;
      if (name) findings.push({ node, code: "RAG1003", message: `this changes module-level ${name}, state that no re-evaluation restores; keep program state in ctx.useState` });
    };
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) mutated(node.left, node);
      if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) mutated(node.operand, node);
      if (ts.isDeleteExpression(node)) mutated(node.expression, node);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const receiver = node.expression.expression;
        const member = node.expression.name.text;
        const name = MUTATORS.has(member) ? moduleRoot(receiver) : undefined;
        if (name) findings.push({ node, code: "RAG1003", message: `${member}() changes module-level ${name}, state that no re-evaluation restores; keep program state in ctx.useState` });
        const first = node.arguments[0];
        if (globalName(receiver, "Object") && member === "assign" && first && moduleRoot(first)) findings.push({ node, code: "RAG1003", message: `Object.assign changes module-level ${moduleRoot(first)}, state that no re-evaluation restores; keep program state in ctx.useState` });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const seen = new Set<string>();
  return findings.flatMap(({ node, code, message }) => {
    const file = node.getSourceFile();
    const start = file.getLineAndCharacterOfPosition(node.getStart(file));
    const line = `${path.relative(directory, file.fileName).split(path.sep).join("/")}:${start.line + 1}:${start.character + 1} ${code}: ${message}.`;
    if (seen.has(line)) return [];
    seen.add(line);
    return [line];
  });
};
