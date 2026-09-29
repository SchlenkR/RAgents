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

test("guide links check existing pages and decoded anchor targets", () => {
  const outputs = new Map<string, string>([
    ["guide.html", '<a href="guide-functions.html#gr%C3%BC%C3%9Fe">Chapter</a><a href="guide.md">Markdown</a>'],
    ["guide-functions.html", '<h2 id="grüße">Grüße</h2><a href="#grüße">Here</a><a href="https://example.org/source">Source</a>'],
    ["guide.md", "# Guide"],
  ]);
  assert.doesNotThrow(() => assertHomepageLinks(outputs));
  outputs.set("guide.html", '<a href="guide-functions.html#missing">Missing</a>');
  assert.throws(() => assertHomepageLinks(outputs), /Missing homepage anchor target/);
  outputs.set("guide.html", '<a href="guide-missing.html">Missing</a>');
  assert.throws(() => assertHomepageLinks(outputs), /Missing homepage link target/);
});

test("export contains only public pages and used screenshots, with relative assets", async () => {
  await fixture(async (root, home) => {
    await mkdir(path.join(home, "screenshots"));
    await mkdir(path.join(home, "preview"));
    await writeFile(path.join(home, "screenshots/core.png"), Buffer.from([1, 2, 3]));
    await writeFile(path.join(home, "screenshots/unused.png"), "unused");
    await writeFile(path.join(home, "preview/preview.png"), "preview");
    await writeFile(path.join(home, "reference-ui.tsx"), "source");
    const html = '<a href="guide.html">Guide</a><script src="scroll-vendor.js" defer></script><script src="site.js" defer></script><img src="screenshots/core.png">';
    await writeFile(path.join(home, "index.html"), html);
    await writeFile(path.join(home, "scroll-vendor.js"), "window.gsap = {}; window.ScrollTrigger = {};");
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

test("source links become public, text examples and internal links stay unchanged", async () => {
  await fixture(async (root, home) => {
    await writeFile(path.join(home, "index.html"), '<a href="../../README.md?plain=1#develop">Start</a><a href="../spec/core.md">Core</a>');
    await writeFile(path.join(home, "guide.md"), '[Core](../spec/core.md)\n[Guide](guide.html)\n```md\n[Example](./example.md)\n```\n');
    const outputs = await buildHomepageExport(root);
    assert.equal(outputs.get("index.html"), '<a href="https://github.com/SchlenkR/RAgents/blob/main/README.md?plain=1#develop">Start</a><a href="https://github.com/SchlenkR/RAgents/blob/main/docs/spec/core.md">Core</a>');
    assert.equal(outputs.get("guide.md"), '[Core](https://github.com/SchlenkR/RAgents/blob/main/docs/spec/core.md)\n[Guide](guide.html)\n```md\n[Example](./example.md)\n```\n');
  });
});

test("technical API references stay outside the public website export", async () => {
  await fixture(async (root, home) => {
    const openrpc = JSON.stringify({ openrpc: "1.3.0", methods: [{ name: "example.method" }] }, null, 2);
    const markdown = "# JSON-RPC-API\n\n[OpenRPC](openrpc.json)\n";
    await writeFile(path.join(home, "rpc-api.md"), markdown);
    await writeFile(path.join(home, "openrpc.json"), openrpc);
    await writeFile(path.join(home, "index.html"), "");
    const outputs = await buildHomepageExport(root);
    assert.ok(!outputs.has("rpc-api.md"));
    assert.ok(!outputs.has("openrpc.json"));
  });
});

test("missing files, private content, and unpublished links abort the export", async () => {
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
    await rm(path.join(home, "site.js"));
    await assert.rejects(buildHomepageExport(root), /ENOENT/);
  });
});

test("screenshots must not export files outside the homepage through symlinks", async () => {
  await fixture(async (root, home) => {
    await mkdir(path.join(home, "screenshots"));
    await writeFile(path.join(root, "private.png"), "private");
    await symlink(path.join(root, "private.png"), path.join(home, "screenshots/core.png"));
    await writeFile(path.join(home, "index.html"), '<img src="screenshots/core.png">');
    await assert.rejects(buildHomepageExport(root), /outside the homepage/);
  });
});
