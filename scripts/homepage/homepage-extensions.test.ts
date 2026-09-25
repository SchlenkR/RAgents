import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { env } from "../../apps/server/src/config-definition.ts";
import { resolveAnonymousUser, resolveProfileUsers } from "../../apps/server/src/config-file.ts";
import { accessMode, canStartEntry, createAccessContext, builtinPermissions } from "../../packages/ragents/src/access.ts";
import { overseerPermissions } from "../../plugins/ragents.overseer/contract.ts";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import ts from "typescript";
import { Value } from "typebox/value";
import { agentTools } from "../../packages/ragents/src/agents/tools.ts";
import { appPackageSchema, prepareAppProject, typecheckServerProject } from "../../apps/server/src/plugin-support/actor-programs/app-project.ts";
import { compileClientProject, installClientSdk } from "../../apps/server/src/plugin-support/actor-programs/client-compiler.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { buildHomepageExtensions } from "./homepage-extensions.ts";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

async function contractFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "homepage-extensions-"));
  const source = await readFile(path.join(repoRoot, "scripts/homepage/homepage-extensions.ts"), "utf8");
  const paths = new Set([...source.matchAll(/\bfile: "([^"]+)"/g)].map((match) => match[1]!));
  assert.ok(paths.size > 0, "Die Fixture muss die erfassten Verträge enthalten.");
  for (const relative of paths) {
    const target = path.join(directory, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await readFile(path.join(repoRoot, relative), "utf8"));
  }
  return directory;
}

for (const mutation of [
  { file: "packages/ragents/src/plugin-types.ts", declaration: "export interface PluginRegistration {", key: "host.homepageTestContribution" },
  { file: "apps/web/src/PluginRegistry.tsx", declaration: "export interface WebPlugin extends WebPluginDescriptor {", key: "web.homepageTestContribution" },
  { file: "apps/server/src/config-definition.ts", declaration: "export interface ProfileAnonymousUser {", key: "profileUser.homepageTestContribution" },
]) {
  test(`nicht dokumentierter Beitrag ${mutation.key} stoppt die Generierung`, async () => {
    const root = await contractFixture();
    try {
      const target = path.join(root, mutation.file);
      const source = await readFile(target, "utf8");
      assert.ok(source.includes(mutation.declaration));
      await writeFile(target, source.replace(mutation.declaration, `${mutation.declaration}\n  homepageTestContribution?: boolean;`));
      await assert.rejects(buildHomepageExtensions(root), (error: unknown) => error instanceof Error && error.message.includes(mutation.key));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("entferntes dokumentiertes Feld stoppt die Generierung", async () => {
  const root = await contractFixture();
  try {
    const target = path.join(root, "apps/web/src/PluginRegistry.tsx");
    const source = await readFile(target, "utf8");
    assert.ok(source.includes("  needsRunView?: boolean;"));
    await writeFile(target, source.replace("  needsRunView?: boolean;", ""));
    await assert.rejects(buildHomepageExtensions(root), /entfernt: web\.needsRunView/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function literal(node: ts.Node): unknown {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map((property) => {
    assert.ok(ts.isPropertyAssignment(property));
    return [ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(), literal(property.initializer)];
  }));
  throw new Error("Das Vertragsbeispiel muss literale Eingabewerte verwenden.");
}

test("gezeigte Actor- und Subscription-Aufrufe entsprechen den echten Werkzeugverträgen", async () => {
  const { extensions } = await buildHomepageExtensions(repoRoot);
  const examples = extensions.filter((entry) => entry.id === "run-capabilities" || entry.id === "subscriptions");
  let checked = 0;
  for (const example of examples) {
    const source = ts.createSourceFile(example.id + ".ts", example.example, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === "context.functions") {
        const name = node.expression.name;
        const [input] = node.arguments;
        assert.ok(input);
        const tool = agentTools.find((tool) => tool.name === name.text);
        assert.ok(tool, `Werkzeug ${name.text} ist vorhanden.`);
        assert.ok(Value.Check(tool.schema, literal(input)), `Beispiel für ${name.text} muss dessen aktuelles Schema erfüllen.`);
        checked += 1;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.equal(checked, 2);
});

test("das dokumentierte Actor-Programm-Paket entspricht dem Autorenvertrag", async () => {
  const { extensions } = await buildHomepageExtensions(repoRoot);
  const example = extensions.find((extension) => extension.id === "app-package");
  assert.ok(example);
  assert.ok(Value.Check(appPackageSchema, JSON.parse(example.example).ragents));
});

test("Server- und Web-Beispiele erfüllen mit ihrem benannten Kontext die echten TypeScript-Verträge", async () => {
  const { extensions } = await buildHomepageExtensions(repoRoot);
  const examples = extensions.filter((entry) => entry.category === "Serverbeiträge" || entry.category === "Web-Beiträge"
    || ["product-policy", "workspace-policy", "document-store", "driver", "language-server"].includes(entry.id));
  assert.ok(examples.length >= 32);
  const prelude = `
import { Type } from "typebox";
import { serviceToken, type PluginRegistration, type OperationContext, type ScriptContribution } from "../../packages/ragents/src/plugin-types.ts";
import { defineRunFunction, defineToolAvailability } from "../../packages/ragents/src/agents/tools.ts";
import { defineChannel, defineOperation } from "../../packages/ragents/src/rpc/contract.ts";
import { implement, implementChannel } from "../../packages/ragents/src/rpc/contribution.ts";
import type { AgentDriver } from "../../packages/ragents/src/drivers/types.ts";
import type { WebPlugin } from "../../apps/web/src/PluginRegistry.tsx";
import { useAccess } from "../../apps/web/src/AccessContext.tsx";
import { accessMode } from "../../packages/ragents/src/access.ts";
import { productRuntimeToken, type ProductRuntimePolicy } from "../../apps/server/src/ragents/product-runtime.ts";
import { workspaceResolverToken, gitWorkspaceViewToken, type GitWorkspaceView } from "../../apps/server/src/ragents/workspace-runtime.ts";
import { documentStoreToken, type DocumentStore } from "../../apps/server/src/ragents/document-store.ts";
import type { PluginModule } from "../../apps/server/src/plugin-support/plugin-module.ts";
import { resolveRootDirectory, type LanguageServerAdapter } from "../../packages/workspace-executor/src/index.ts";
import { createLanguageServerPlugin } from "../../apps/server/src/plugin-support/language-server/plugin.ts";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
declare const host: PluginRegistration;
declare const runId: string;
declare const modelId: string;
declare const skillDirectory: string;
declare const operationContext: OperationContext;
declare const store: DocumentStore;
declare const gitView: GitWorkspaceView;
declare const exampleTabs: NonNullable<WebPlugin["workspaceTabsFor"]>;
declare const answerQuestion: (id: string, callId: string, payload: unknown) => Promise<void>;
declare const service: {
  initialize(): Promise<void>; prepare(runId: string): Promise<void>;
  started(runId: string, startEntry: { id: string; action: "skill" | "script" } | null): Promise<void>;
  stop(runId: string, signal: AbortSignal): Promise<void>;
  remove(runId: string): Promise<void>; shutdown(): Promise<void>;
  ready(): boolean; onBeat(listener: (at: string) => void): () => void;
};
`;
  const files = new Map(examples.map((entry) => [path.join(repoRoot, "scripts/homepage", `.homepage-example-${entry.id}.tsx`), `${prelude}\n${entry.example}`]));
  for (const id of ["profile-access", "profile-anonymous"]) {
    const profileExample = extensions.find((entry) => entry.id === id);
    assert.ok(profileExample);
    files.set(path.join(repoRoot, `.homepage-example-${id}.tsx`), profileExample.example);
  }
  const configPath = path.join(repoRoot, "scripts/homepage/tsconfig.homepage.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (filename, languageVersion, onError, shouldCreateNewSourceFile) => files.has(filename)
    ? ts.createSourceFile(filename, files.get(filename)!, languageVersion, true, ts.ScriptKind.TSX)
    : getSourceFile(filename, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([...files.keys()], parsed.options, host);
  const diagnostics = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()];
  for (const filename of files.keys()) {
    const source = program.getSourceFile(filename);
    assert.ok(source);
    diagnostics.push(...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source));
  }
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => "\n",
  }));
});


test("Rechtebeispiele führen Profilauflösung und Plugin-Prüfung mit echten Verträgen aus", async () => {
  const result = await buildHomepageExtensions(repoRoot);
  assert.deepEqual(result.permissions, [...builtinPermissions, ...overseerPermissions]);
  assert.deepEqual(result.methodRights.find((method) => method.id === coreContracts.runs.delete.id),
    { id: coreContracts.runs.delete.id, rights: [...coreContracts.runs.delete.rights] });
  for (const method of result.methodRights) assert.ok(result.html.includes(method.id), method.id);
  for (const permission of result.permissions) assert.ok(result.html.includes(permission.id));
  const example = result.extensions.find((entry) => entry.id === "profile-access")!;
  const source = ts.transpileModule(example.example.replace(/^import .*;$/gm, "").replace("export const users", "const users") + "\nusers;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const declared = JSON.parse(JSON.stringify(vm.runInNewContext(source, { env })));
  const users = resolveProfileUsers("public-example", declared, {
    EXAMPLE_READER_PASSWORD: "synthetic-reader", EXAMPLE_OPERATOR_PASSWORD: "synthetic-operator",
    EXAMPLE_DEVELOPER_PASSWORD: "synthetic-developer", EXAMPLE_DEVELOPER_TOKEN: "synthetic-developer-token",
  })!;
  assert.equal(accessMode({ enabled: true, user: users[0]! }, "runs.read", "runs.write"), "readonly");
  assert.equal(accessMode({ enabled: true, user: users[1]! }, "runs.read", "runs.write"), "write");
  const operator = createAccessContext({ enabled: true, user: users[1]! });
  assert.equal(canStartEntry(operator, "ragents.reference.word-game"), true);
  assert.equal(canStartEntry(operator, "ragents.reference.balcony-wizard"), false);
  assert.equal(operator.can("runs.create"), false);
  assert.equal(operator.can("runs.inspect"), false);
  assert.equal(users[2]!.token, "synthetic-developer-token");
  assert.equal(accessMode({ enabled: true, user: users[2]! }, "runs.read", "runs.write"), "hidden");
  const anonymousExample = result.extensions.find((entry) => entry.id === "profile-anonymous")!;
  const anonymousSource = ts.transpileModule(anonymousExample.example.replace(/^import .*;$/gm, "").replace("export const anonymousUser", "const anonymousUser") + "\nanonymousUser;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const anonymousUser = resolveAnonymousUser("public-example", JSON.parse(JSON.stringify(vm.runInNewContext(anonymousSource))))!;
  const anonymous = createAccessContext({ enabled: false, user: anonymousUser });
  assert.equal(canStartEntry(anonymous, "ragents.reference.word-game"), true);
  assert.equal(anonymous.can("runs.create"), false);
  assert.equal(anonymous.can("settings.read"), false);
  assert.equal(accessMode({ enabled: true, user: users[0]! }, "ragents.example.read", "ragents.example.write"), "hidden");
  const routeExample = result.extensions.find((entry) => entry.id === "access-route")!;
  const routes: { requiredRights(request: { method: string }): readonly string[]; handle(context: unknown): void }[] = [];
  vm.runInNewContext(ts.transpileModule(routeExample.example, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    host: { http: (route: typeof routes[number]) => routes.push(route) },
  });
  const route = routes[0]!;
  assert.deepEqual(Array.from(route.requiredRights({ method: "GET" })), ["ragents.example.read"]);
  assert.deepEqual(Array.from(route.requiredRights({ method: "POST" })), ["ragents.example.read", "ragents.example.write"]);
  let body = "";
  route.handle({ access: createAccessContext({ enabled: true, user: users[0]! }), response: { setHeader() {}, end(value: string) { body = value; } } });
  assert.deepEqual(JSON.parse(body), { editable: false });
});

test("native Actor-Programm-Beispiele bauen mit dem SDK und bestehen ihre Fachtests", async () => {
  const { extensions } = await buildHomepageExtensions(repoRoot);
  const source = (id: string): string => {
    const example = extensions.find((entry) => entry.id === id);
    assert.ok(example, id);
    return example.example;
  };
  const directory = await mkdtemp(path.join(os.tmpdir(), "homepage-native-app-"));
  try {
    const files = {
      "package.json": source("app-package"),
      "src/contract.ts": source("app-contract"),
      "src/server.ts": source("app-handler"),
      "src/client.tsx": source("app-client"),
      "src/styles.css": "body { margin: 0; }\n",
      "tests/program.test.ts": source("app-tests"),
    };
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
      await writeFile(path.join(directory, name), text);
    }
    await prepareAppProject(directory);
    const { default: app } = await import(pathToFileURL(path.join(directory, "src/server.ts")).href);
    const clientContracts = {
      stateSchema: app.contract.state,
      actions: Object.entries(app.contract.functions).map(([id, value]) => {
        const action = value as { input: object; output: object };
        return { id, inputSchema: action.input, resultSchema: action.output };
      }),
    };
    await installClientSdk(directory, clientContracts);
    assert.deepEqual(typecheckServerProject(directory), []);
    const client = await compileClientProject({ directory, entryPoint: "src/client.tsx", ...clientContracts });
    assert.equal(client.valid, true, JSON.stringify(client.diagnostics));
    await promisify(execFile)(process.execPath, ["--import", "tsx", "--test", "tests/program.test.ts"], { cwd: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
