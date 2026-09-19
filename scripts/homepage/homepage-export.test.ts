import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertHomepageLinks, buildHomepageExport, homepageFiles, writeHomepageExport } from "./homepage-export.js";

async function fixture(run: (root: string, home: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), "ragents-homepage-export-"));
  const home = path.join(root, "docs/homepage");
  try {
    await mkdir(home, { recursive: true });
    for (const name of homepageFiles) await writeFile(path.join(home, name), "");
    await run(root, home);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("Guide-Verweise prüfen vorhandene Seiten und dekodierte Sprungziele", () => {
  const outputs = new Map<string, string>([
    ["guide.html", '<a href="guide-functions.html#gr%C3%BC%C3%9Fe">Kapitel</a><a href="guide.md">Markdown</a>'],
    ["guide-functions.html", '<h2 id="grüße">Grüße</h2><a href="#grüße">Hier</a><a href="https://example.org/source">Quelle</a>'],
    ["guide.md", "# Guide"],
  ]);
  assert.doesNotThrow(() => assertHomepageLinks(outputs));
  outputs.set("guide.html", '<a href="guide-functions.html#missing">Fehlt</a>');
  assert.throws(() => assertHomepageLinks(outputs), /Fehlendes Homepage-Sprungziel/);
  outputs.set("guide.html", '<a href="guide-missing.html">Fehlt</a>');
  assert.throws(() => assertHomepageLinks(outputs), /Fehlendes Homepage-Linkziel/);
});

test("Export enthält nur öffentliche Seiten und verwendete Screenshots, mit relativen Assets", async () => {
  await fixture(async (root, home) => {
    await mkdir(path.join(home, "screenshots"));
    await mkdir(path.join(home, "preview"));
    await writeFile(path.join(home, "screenshots/core.png"), Buffer.from([1, 2, 3]));
    await writeFile(path.join(home, "screenshots/unused.png"), "unused");
    await writeFile(path.join(home, "preview/preview.png"), "preview");
    await writeFile(path.join(home, "reference-ui.tsx"), "source");
    const html = '<a href="reference.html#ui">UI</a><script src="scroll-vendor.js" defer></script><script src="site.js" defer></script><script src="reference-ui.js"></script><link rel="stylesheet" href="reference-ui.css"><img src="screenshots/core.png">';
    await writeFile(path.join(home, "index.html"), html);
    await writeFile(path.join(home, "scroll-vendor.js"), "window.gsap = {}; window.ScrollTrigger = {};");
    await writeFile(path.join(home, "reference-ui.css"), 'body { background: url("screenshots/core.png"); }');
    const outputs = await buildHomepageExport(root);
    assert.deepEqual([...outputs.keys()], [...homepageFiles, "screenshots/core.png"]);
    assert.equal(outputs.get("index.html"), html);
    assert.equal(outputs.get("scroll-vendor.js"), "window.gsap = {}; window.ScrollTrigger = {};");
    assert.deepEqual(outputs.get("screenshots/core.png"), Buffer.from([1, 2, 3]));
    for (const base of ["https://example.org/", "https://example.org/help/", "https://example.org/project/docs/"]) {
      for (const [, reference] of String(outputs.get("index.html")).matchAll(/(?:href|src)="([^"]+)"/g)) {
        const resolved = new URL(reference, base);
        assert.ok(resolved.href.startsWith(base));
        assert.ok(outputs.has(resolved.pathname.slice(new URL(base).pathname.length)));
      }
    }
    await writeHomepageExport(root, outputs);
    await writeFile(path.join(home, "dist/stale.txt"), "stale");
    await writeHomepageExport(root, outputs);
    assert.ok(!(await readdir(path.join(home, "dist"))).includes("stale.txt"));
    assert.equal(await readFile(path.join(home, "dist/index.html"), "utf8"), html);
    assert.deepEqual(await buildHomepageExport(root), outputs);
  });
});

test("Quelllinks werden öffentlich, Textbeispiele und interne Links bleiben unverändert", async () => {
  await fixture(async (root, home) => {
    await writeFile(path.join(home, "index.html"), '<a href="../../README.md?plain=1#entwickeln">Start</a><a href="../spec/core.md">Core</a>');
    await writeFile(path.join(home, "developer.md"), '[Core](../spec/core.md)\n[API](run-api.d.ts)\n```md\n[Beispiel](./example.md)\n```\n');
    const outputs = await buildHomepageExport(root);
    assert.equal(outputs.get("index.html"), '<a href="https://github.com/SchlenkR/RAgents/blob/main/README.md?plain=1#entwickeln">Start</a><a href="https://github.com/SchlenkR/RAgents/blob/main/docs/spec/core.md">Core</a>');
    assert.equal(outputs.get("developer.md"), '[Core](https://github.com/SchlenkR/RAgents/blob/main/docs/spec/core.md)\n[API](run-api.d.ts)\n```md\n[Beispiel](./example.md)\n```\n');
  });
});

test("API-Dokumentation und OpenRPC bleiben als zusammengehörige öffentliche Dateien erhalten", async () => {
  await fixture(async (root, home) => {
    const openrpc = JSON.stringify({ openrpc: "1.3.0", methods: [{ name: "example.method" }] }, null, 2);
    const markdown = "# JSON-RPC-API\n\n[OpenRPC](openrpc.json)\n";
    await writeFile(path.join(home, "rpc-api.md"), markdown);
    await writeFile(path.join(home, "openrpc.json"), openrpc);
    await writeFile(path.join(home, "index.html"), '<a href="rpc-api.md">JSON-RPC-API</a><a href="openrpc.json">OpenRPC</a>');
    const outputs = await buildHomepageExport(root);
    assert.equal(outputs.get("rpc-api.md"), markdown);
    assert.equal(outputs.get("openrpc.json"), openrpc);
    assert.deepEqual(JSON.parse(String(outputs.get("openrpc.json"))), JSON.parse(openrpc));
    await rm(path.join(home, "openrpc.json"));
    await assert.rejects(buildHomepageExport(root), /ENOENT/);
  });
});

test("fehlende Dateien, private Inhalte und nicht veröffentlichte Links brechen den Export ab", async () => {
  await fixture(async (root, home) => {
    for (const html of [
      '<img src="screenshots/missing.png">', '<script src="https://example.org/app.js"></script>',
      '<img src="/screenshots/core.png">', '<a href="preview/preview.png">Preview</a>',
      '<a href="reference-ui.tsx">Source</a>', '<a href="../../plugins/private.product/server/index.ts">Private</a>',
      '<img src="../../README.md">',
      '<iframe src="https://example.org/app.html"></iframe>', '<iframe src="/mini-app.html"></iframe>',
    ]) {
      await writeFile(path.join(home, "index.html"), html);
      await assert.rejects(buildHomepageExport(root));
    }
    await writeFile(path.join(home, "index.html"), "");
    await rm(path.join(home, "run-api.d.ts"));
    await assert.rejects(buildHomepageExport(root), /ENOENT/);
  });
});

test("Screenshots dürfen keine Dateien außerhalb der Homepage über Symlinks exportieren", async () => {
  await fixture(async (root, home) => {
    await mkdir(path.join(home, "screenshots"));
    await writeFile(path.join(root, "private.png"), "private");
    await symlink(path.join(root, "private.png"), path.join(home, "screenshots/core.png"));
    await writeFile(path.join(home, "index.html"), '<img src="screenshots/core.png">');
    await assert.rejects(buildHomepageExport(root), /außerhalb/);
  });
});
