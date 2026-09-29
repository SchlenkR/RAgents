import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { hostRoot } from "../src/host-version.ts";

/** Der Kern kennt kein Plugin und keinen Sprachserver (docs/spec/plugins.md, Core boundary); plugin-support sind geteilte Bausteine der Plugins. */
const CORE = ["packages/workspace-executor/src", "packages/ragents/src", "apps/server/src", "apps/vscode/src", "apps/web/src"];
const OUTSIDE_CORE = ["apps/server/src/plugin-support"];

const LANGUAGE_SERVERS = [
  "roslyn", "Microsoft.CodeAnalysis.LanguageServer", "omnisharp", "fsautocomplete", "fsac", "typescript-language-server", "tsserver",
  "jdtls", "gopls", "rust-analyzer", "pyright", "pylsp", "clangd",
];

/** Was schon vor dieser Prüfung im Kern stand; ein Eintrag verschwindet, sobald die Stelle bereinigt ist (TODO.md). */
const BASELINE = [
  "apps/server/src/access-projection.ts: ragents.actor-programs",
  "apps/server/src/config-file.ts: ragents.reference",
  "apps/server/src/provider.ts: ragents.overseer",
  "apps/vscode/src/extension.ts: ragents.profile-distribution",
  "apps/vscode/src/extension.ts: ragents.workspace",
  "apps/vscode/src/sessions.ts: ragents.workspace",
];

const pluginIds = (root: string): readonly string[] => readdirSync(path.join(root, "plugins"))
  .filter((name) => existsSync(path.join(root, "plugins", name, "ragents-plugin.json")))
  .map((name) => (JSON.parse(readFileSync(path.join(root, "plugins", name, "ragents-plugin.json"), "utf8")) as { id: string }).id);

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Ein Name zählt nur ganz: ragents.product-runtime nennt ragents.product nicht, ragents.workspace.binding nennt ragents.workspace. */
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

test("der Kern nennt keine Plugin-Kennung und keinen Sprachserver; nur die eingefrorenen Altlasten bleiben, bis sie bereinigt sind", () => {
  const found = findings(hostRoot());
  assert.deepEqual(found.filter((entry) => !BASELINE.includes(entry)), [],
    "Neues Wissen über ein Plugin oder einen Sprachserver im Kern; es gehört ins Plugin, sein Bundle oder einen Beitrag zum Executor");
  assert.deepEqual(BASELINE.filter((entry) => !found.includes(entry)), [],
    "Eine eingefrorene Stelle ist bereinigt; sie gehört aus BASELINE und aus TODO.md");
});

test("die Prüfung erkennt Kennungen und Sprachserver nur als ganze Namen", () => {
  const pattern = forbiddenNames(["ragents.product", "ragents.lsp-roslyn", ...LANGUAGE_SERVERS]);
  const names = (text: string): readonly string[] => [...text.matchAll(pattern)].map((match) => match[1]!);
  assert.deepEqual(names(`import x from "../../plugins/ragents.lsp-roslyn/executor";`), ["ragents.lsp-roslyn"]);
  assert.deepEqual(names(`"ragents.product.start" und "ragents.product-runtime" und "acme.ragents.product"`), ["ragents.product"]);
  assert.deepEqual(names("startet Roslyn, JDTLS oder typescript-language-server"), ["Roslyn", "JDTLS", "typescript-language-server"]);
  assert.deepEqual(names("roslynish, fsac-extra, my-gopls"), []);
});

test("ein neues Plugin fällt der Prüfung sofort auf, im Kern ja, in den Bausteinen unter plugin-support nicht", () => {
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
