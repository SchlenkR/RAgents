import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertPublicOutput, publicPackageFiles, showcasePluginIds } from "./homepage-catalog.js";
import { readHomepageUiContracts } from "./homepage-ui-contracts.js";
import { readClientUiComponentNames, readClientUiContractFiles } from "../../apps/server/src/plugin-support/actor-programs/client-contracts.js";

test("Profilinventar liest ausschließlich literale IDs und führt die Konfiguration nicht aus", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-profile-reference-"));
  try {
    writeFileSync(path.join(root, "ragents.config.showcase.ts"), 'throw new Error("nicht ausführen"); const config = { host: { PLUGINS: ["ragents.example"] }, token: process.env.SECRET };');
    assert.deepEqual(showcasePluginIds(root), ["ragents.example"]);
    for (const plugins of ['["private.product"]', '["ragents.example", "ragents.example"]', 'loadPlugins()', '[]', '[...otherPlugins]']) {
      writeFileSync(path.join(root, "ragents.config.showcase.ts"), `const config = { host: { PLUGINS: ${plugins} } };`);
      assert.throws(() => showcasePluginIds(root));
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("öffentliche Artefakte lehnen private Produktnamen und lokale Pfade ab", () => {
  for (const value of ["plugins/private.product", "plugins/Private.Product", "/Users/example/repo", "/private/tmp/example", "/tmp/example", "PRIVATE_MODEL_API_KEY"]) {
    assert.throws(() => assertPublicOutput(value));
  }
  assert.doesNotThrow(() => assertPublicOutput("ragents.reference / plugins/ragents.actor-programs / UI.Chat"));
});

test("Run-Pakete enthalten unveränderte verschachtelte Dateien und folgen keinen Verweisen", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-package-reference-"));
  try {
    mkdirSync(path.join(root, "apps/example/src"), { recursive: true });
    writeFileSync(path.join(root, "RUN.md"), "---\ntitle: Beispiel\n---\n");
    writeFileSync(path.join(root, "apps/example/src/client.tsx"), "const view = <p>Grüße</p>;\n");
    const files = publicPackageFiles(root);
    assert.equal(files["RUN.md"], "---\ntitle: Beispiel\n---\n");
    assert.equal(files["apps/example/src/client.tsx"], "const view = <p>Grüße</p>;\n");
    assert.deepEqual(files, publicPackageFiles(root));
    symlinkSync(path.join(root, "RUN.md"), path.join(root, "alias.md"));
    assert.throws(() => publicPackageFiles(root), /Ungültiger Dateityp/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function uiFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-ui-contracts-"));
  const write = (file: string, text: string) => {
    const filename = path.join(root, file);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, text);
  };
  const ui = "apps/web/src/actor-programs/client-ui/";
  write(ui + "contracts.d.ts", 'export { Widget } from "./widget-contracts";\n');
  write(ui + "widget-contracts.d.ts", `import type { Details } from "./nested/details";
interface Base {
  /** Inhalt des Eintrags. */
  details: Details;
}
export interface Editable extends Base { mode: "edit"; onChange: (value: Details) => void; }
export interface ReadonlyProps extends Base { mode: "read"; onChange?: never; }
export type WidgetProps = Editable | ReadonlyProps;
/** Ein öffentlicher Baustein. */
export declare function Widget(props: WidgetProps): null;
`);
  write(ui + "nested/details.d.ts", 'import type { Payload } from "../payload";\nexport interface Details { payload: Payload; next?: Details; }\n');
  write(ui + "payload.ts", 'export interface Payload { name: string; next?: import("./nested/details").Details; }\nconst internal = "IMPLEMENTATION_SECRET";\nvoid internal;\n');
  write(ui + "index.tsx", 'export function Widget(props: import("./widget-contracts").WidgetProps): null { void props; return null; }');
  write("docs/homepage/reference-ui.tsx", '<section data-component="Widget" />');
  return { root, write, ui };
}

test("UI-Referenz folgt Reexports und lokalen Typabhängigkeiten ohne Komponentenliste", () => {
  const { root, ui, write } = uiFixture();
  try {
    const result = readHomepageUiContracts(root);
    assert.deepEqual(result.files, readClientUiContractFiles(root));
    assert.deepEqual(readClientUiComponentNames(root), ["Widget"]);
    assert.deepEqual(Object.keys(result.files), ["contracts.d.ts", "nested/details.d.ts", "payload.d.ts", "widget-contracts.d.ts"].map((file) => ui + file));
    assert.ok(!JSON.stringify(result.files).includes("IMPLEMENTATION_SECRET"));
    assert.ok(result.files[ui + "payload.d.ts"].includes("interface Payload"));
    assert.equal(result.components[0].name, "Widget");
    assert.equal(result.components[0].hasDemo, true);
    assert.equal(result.components[0].description, "Ein öffentlicher Baustein.");
    assert.equal(result.components[0].variants.length, 2);
    const props = result.components[0].variants.flatMap((variant) => variant.props);
    assert.ok(props.some((prop) => prop.name === "details" && prop.type === "Details" && prop.description === "Inhalt des Eintrags."));
    assert.ok(props.some((prop) => prop.name === "onChange" && prop.type === "never" && prop.optional));
    write(ui + "extra-contracts.d.ts", 'export declare function Extra(props: { enabled?: boolean }): null;');
    write(ui + "contracts.d.ts", 'export { Widget } from "./widget-contracts"; export { Extra } from "./extra-contracts";');
    write(ui + "index.tsx", 'export function Widget(props: import("./widget-contracts").WidgetProps): null { void props; return null; } export function Extra(props: {enabled?: boolean}): null { void props; return null; }');
    const expanded = readHomepageUiContracts(root);
    assert.deepEqual(expanded.components.map((component) => component.name), ["Widget", "Extra"]);
    assert.equal(expanded.components[1].hasDemo, false);
    assert.deepEqual(readClientUiComponentNames(root), ["Extra", "Widget"]);
    assert.ok(expanded.files[ui + "extra-contracts.d.ts"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("UI-Referenz lehnt fehlende Runtime-Exporte, widersprüchliche Props und verlorene Typdateien ab", () => {
  const { root, ui, write } = uiFixture();
  try {
    write(ui + "index.tsx", 'export function Other(props: { value: string }): null { void props; return null; }');
    assert.throws(() => readHomepageUiContracts(root), /Runtime-Export/);
    write(ui + "index.tsx", 'export function Widget(props: { incompatible: number }): null { void props; return null; }');
    assert.throws(() => readHomepageUiContracts(root), /Typvertrag nicht/);
    rmSync(path.join(root, ui, "nested/details.d.ts"));
    assert.throws(() => readClientUiContractFiles(root), /Nicht auflösbarer lokaler UI-Typverweis/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
