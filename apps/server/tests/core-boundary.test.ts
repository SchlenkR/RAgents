import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { hostRoot } from "../src/host-version.ts";

/** The core knows no plugin and no language server (docs/spec/plugins.md, Core boundary); plugin-support holds shared building blocks of the plugins. */
const CORE = ["packages/workspace-executor/src", "packages/ragents/src", "apps/server/src", "apps/vscode/src", "apps/web/src"];
const OUTSIDE_CORE = ["apps/server/src/plugin-support"];

const LANGUAGE_SERVERS = [
  "roslyn", "Microsoft.CodeAnalysis.LanguageServer", "omnisharp", "fsautocomplete", "fsac", "typescript-language-server", "tsserver",
  "jdtls", "gopls", "rust-analyzer", "pyright", "pylsp", "clangd",
];

/** What was already in the core before this check; an entry disappears as soon as the spot is cleaned up (TODO.md). */
const BASELINE = [
  "apps/vscode/src/extension.ts: ragents.profile-distribution",
  "apps/vscode/src/extension.ts: ragents.workspace",
  "apps/vscode/src/sessions.ts: ragents.workspace",
];

const pluginIds = (root: string): readonly string[] => readdirSync(path.join(root, "plugins"))
  .filter((name) => existsSync(path.join(root, "plugins", name, "ragents-plugin.json")))
  .map((name) => (JSON.parse(readFileSync(path.join(root, "plugins", name, "ragents-plugin.json"), "utf8")) as { id: string }).id);

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A name counts only as a whole: ragents.product-runtime does not name ragents.product, ragents.workspace.binding names ragents.workspace. */
const forbiddenNames = (names: readonly string[]): RegExp =>
  new RegExp(`(?<![\\w.-])(${names.map(escaped).join("|")})(?![\\w-])`, "gi");

const codeFiles = (root: string, folder: string): readonly string[] =>
  readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(folder, entry.name);
    if (OUTSIDE_CORE.includes(relative)) return [];
    if (entry.isDirectory()) return codeFiles(root, relative);
    return /\.(ts|tsx|mts|mjs|js)$/.test(entry.name) ? [relative] : [];
  });

const findings = (root: string): readonly string[] => {
  const pattern = forbiddenNames([...pluginIds(root), ...LANGUAGE_SERVERS]);
  const found = CORE.flatMap((folder) => codeFiles(root, folder)).flatMap((file) =>
    [...readFileSync(path.join(root, file), "utf8").matchAll(pattern)].map((match) => `${file}: ${match[1]}`));
  return [...new Set(found)].sort();
};

test("the core names no plugin id and no language server; only the frozen legacy spots remain until they are cleaned up", () => {
  const found = findings(hostRoot());
  assert.deepEqual(found.filter((entry) => !BASELINE.includes(entry)), [],
    "New knowledge about a plugin or a language server in the core; it belongs in the plugin, its bundle or an executor contribution");
  assert.deepEqual(BASELINE.filter((entry) => !found.includes(entry)), [],
    "A frozen spot is cleaned up; remove it from BASELINE and from TODO.md");
});

test("the check recognizes ids and language servers only as whole names", () => {
  const pattern = forbiddenNames(["ragents.product", "ragents.lsp-roslyn", ...LANGUAGE_SERVERS]);
  const names = (text: string): readonly string[] => [...text.matchAll(pattern)].map((match) => match[1]!);
  assert.deepEqual(names(`import x from "../../plugins/ragents.lsp-roslyn/executor";`), ["ragents.lsp-roslyn"]);
  assert.deepEqual(names(`"ragents.product.start" and "ragents.product-runtime" and "acme.ragents.product"`), ["ragents.product"]);
  assert.deepEqual(names("starts Roslyn, JDTLS or typescript-language-server"), ["Roslyn", "JDTLS", "typescript-language-server"]);
  assert.deepEqual(names("roslynish, fsac-extra, my-gopls"), []);
});

test("the check notices a new plugin at once, in the core yes, in the building blocks under plugin-support no", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-core-boundary-"));
  try {
    for (const folder of CORE) mkdirSync(path.join(root, folder), { recursive: true });
    mkdirSync(path.join(root, "plugins", "ragents.lsp-demo"), { recursive: true });
    writeFileSync(path.join(root, "plugins", "ragents.lsp-demo", "ragents-plugin.json"), JSON.stringify({ id: "ragents.lsp-demo" }));
    mkdirSync(path.join(root, "apps/server/src/plugin-support"), { recursive: true });
    writeFileSync(path.join(root, "apps/server/src/plugin-support/factory.ts"), `export const id = "ragents.lsp-demo";\n`);
    writeFileSync(path.join(root, "packages/workspace-executor/src/modules.ts"), `export const servers = ["ragents.lsp-demo", "jdtls"];\n`);
    assert.deepEqual(findings(root), ["packages/workspace-executor/src/modules.ts: jdtls", "packages/workspace-executor/src/modules.ts: ragents.lsp-demo"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
