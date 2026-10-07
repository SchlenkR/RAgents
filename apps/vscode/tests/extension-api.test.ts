import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { runContracts } from "../../../packages/ragents/src/http/contracts";
import { processesContracts } from "../../../plugins/ragents.processes/contract";
import { profileDistributionContracts } from "../../../plugins/ragents.profile-distribution/contract";
import { workspaceClientContracts, workspaceContracts } from "../../../plugins/ragents.workspace/contract";
import { coreContracts } from "../../server/src/api/contracts";
import { EXTENSION_API_VERSION } from "../../server/src/extension-api";
import { extensionApi } from "../../../scripts/vscode/extension-api";
import { describeExtensionApiChange, extensionApiChanges, extensionApiRecord, readExtensionApiRecord, type ExtensionApiRecord } from "../../../scripts/vscode/extension-api-record";

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const root = path.resolve(extensionRoot, "../..");

/** The contract objects the extension's sources name by path. */
const registries: Readonly<Record<string, unknown>> = {
  coreContracts, runContracts, processesContracts, profileDistributionContracts, workspaceContracts, workspaceClientContracts,
};

/** The run panel names the tunnel method at runtime; the extension calls it with the shape from host-contract.ts. */
const namedAtRuntime: ReadonlyMap<string, { readonly id: string }> = new Map([["apps/vscode/src/service-tunnels.ts", processesContracts.tunnel]]);

/** Every source file the extension ships, as its bundle resolves them. */
const bundledSources = async (): Promise<readonly string[]> => {
  const result = await build({
    entryPoints: [path.join(extensionRoot, "src/extension.ts")],
    absWorkingDir: extensionRoot,
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["vscode"],
    logLevel: "silent",
  });
  return Object.keys(result.metafile.inputs).map((input) => path.resolve(extensionRoot, input))
    .filter((file) => !file.split(path.sep).includes("node_modules") && /\.(ts|tsx|js|mjs)$/.test(file));
};

/** The first argument of every rpc.call, rpc.subscribe, and rpc.handle in a source file. */
const contractArguments = (file: string): readonly string[] => {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["call", "subscribe", "handle"].includes(node.expression.name.text)) {
      const receiver = node.expression.expression;
      const name = ts.isPropertyAccessExpression(receiver) ? receiver.name.text : ts.isIdentifier(receiver) ? receiver.text : undefined;
      if (name === "rpc" && node.arguments[0]) found.push(node.arguments[0].getText(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const contractOf = (file: string, expression: string): { readonly id: string } | undefined => {
  const [head, ...rest] = expression.split(".");
  const registry = head === undefined ? undefined : registries[head];
  if (registry === undefined) return namedAtRuntime.get(file);
  const value = rest.reduce<unknown>((current, key) => (current as Record<string, unknown> | undefined)?.[key], registry);
  return typeof (value as { id?: unknown } | undefined)?.id === "string" ? value as { id: string } : undefined;
};

test("extension-api.json records the contract between VS Code extension and server; every change requires a decision about EXTENSION_API_VERSION", () => {
  const stored = readExtensionApiRecord(root);
  const changes = extensionApiChanges(stored, extensionApiRecord(root)).map(describeExtensionApiChange);
  assert.deepEqual(changes, [], [
    `The contract between VS Code extension and server has changed: ${changes.join(", ")}.`,
    "If an older extension or server breaks with it, raise EXTENSION_API_VERSION in apps/server/src/extension-api.ts.",
    "Then run pnpm update:extension-api.",
  ].join(" "));
  assert.equal(stored.version, EXTENSION_API_VERSION, "extension-api.json belongs to a different EXTENSION_API_VERSION; pnpm update:extension-api");
});

test("the list names exactly the contracts the bundled extension calls, serves, or subscribes to", async () => {
  const sources = await bundledSources();
  for (const helper of ["extension-api.ts", "extension-api-record.ts"]) {
    assert.equal(sources.includes(path.join(root, "scripts/vscode", helper)), false, `${helper} only belongs to build and test tooling`);
  }
  const references = sources.flatMap((file) => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    return contractArguments(file).map((expression) => ({ where: `${relative}: ${expression}`, contract: contractOf(relative, expression) }));
  });
  assert.deepEqual(references.filter(({ contract }) => contract === undefined).map(({ where }) => where), [],
    "Unknown contract references: name their registry in this test, or the contract the server names at runtime");
  const used = [...new Set(references.map(({ contract }) => contract!.id))].sort();
  assert.deepEqual(used, extensionApi.contracts.map((contract) => contract.id).sort(),
    "scripts/vscode/extension-api.ts lists exactly the contracts the extension uses; then run pnpm update:extension-api");
});

test("changes name added, removed, and changed contracts and files", () => {
  const before: ExtensionApiRecord = { version: 1, contracts: { a: "1", gone: "2" }, files: { "x.ts": "3" } };
  const after: ExtensionApiRecord = { version: 1, contracts: { a: "4", b: "5" }, files: { "x.ts": "3" } };
  assert.deepEqual(extensionApiChanges(before, after).map(describeExtensionApiChange), [
    "contract a changed",
    "contract b added",
    "contract gone removed",
  ]);
});
