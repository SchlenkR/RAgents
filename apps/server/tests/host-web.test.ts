import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HOST_WEB_RECORD, hostWebProblem, hostWebRecordOf } from "../src/host-web.ts";
import { resolvePluginEntries } from "../src/profile/plugin-discovery.ts";
import { isBundleSourceMap, isPublicBundleFile, isWebBundlePath, webBundleFile } from "../src/web-bundles.ts";
import { compileStylesheet, createStylesheet, hostWebClasses } from "../src/web-stylesheet.ts";
import { writeBundle } from "./bundle-fixture.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scratch = (): string => mkdtempSync(path.join(tmpdir(), "ragents-host-web-"));

const webBundle = (folder: string, classes: unknown): string => writeBundle(folder, {
  manifest: { web: { entry: "web/index.js", css: "web/index.css", classes: "web/classes.json" } },
  files: {
    "web/index.js": "export const webPlugin = { id: \"acme.probe\" };\n",
    "web/index.css": ".acme-probe { color: red; }\n",
    "web/classes.json": JSON.stringify(classes),
    "web/chunks/part.js": "export const part = 1;\n",
    "prompt.hbs": "confidential\n",
  },
});

test("the built web is missing, has no source record or no longer matches its sources", () => {
  const host = scratch();
  const web = path.join(host, "apps/web/dist");
  const source = path.join(host, "apps/web/src/main.tsx");
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, "export {};\n");
  assert.match(hostWebProblem(web, host, false) ?? "", /The host's web is missing under .*dist \(index\.html, run-panel\.html\)/);
  mkdirSync(web, { recursive: true });
  writeFileSync(path.join(web, "index.html"), "<!doctype html>\n");
  writeFileSync(path.join(web, "run-panel.html"), "<!doctype html>\n");
  assert.equal(hostWebProblem(web, host, false), undefined, "both routes serve the same application");
  writeFileSync(path.join(web, "run-panel.html"), "different entry");
  assert.match(hostWebProblem(web, host, false) ?? "", /entry pages differ/);
  writeFileSync(path.join(web, "run-panel.html"), "<!doctype html>\n");
  assert.match(hostWebProblem(web, host, true) ?? "", /has no source record \(host-web\.json\)/);
  writeFileSync(path.join(web, HOST_WEB_RECORD), JSON.stringify(hostWebRecordOf(host, [source])));
  assert.equal(hostWebProblem(web, host, true), undefined);
  writeFileSync(source, "export const changed = 1;\n");
  assert.match(hostWebProblem(web, host, true) ?? "", /no longer matches its sources \(changed: apps\/web\/src\/main\.tsx\)/);
});

test("under /plugins/<id>/web/ the host serves only the web half of the profile's bundles, with an ETag", async () => {
  const bundles = scratch();
  const folder = webBundle(path.join(bundles, "acme.probe"), []);
  const folders = new Map([["acme.probe", folder]]);
  const entry = await webBundleFile(folders, "/plugins/acme.probe/web/index.js", undefined);
  assert.equal(entry.status, 200);
  assert.equal(entry.headers["Content-Type"], "text/javascript");
  assert.equal(entry.headers["Cache-Control"], "no-cache");
  assert.match(entry.body!.toString(), /webPlugin/);
  assert.equal((await webBundleFile(folders, "/plugins/acme.probe/web/index.js", entry.headers.ETag)).status, 304);
  const chunk = await webBundleFile(folders, "/plugins/acme.probe/web/chunks/part.js", undefined);
  assert.equal(chunk.status, 200);
  assert.equal(chunk.headers["Cache-Control"], "public, max-age=31536000, immutable", "a chunk carries its hash in its name");
  assert.equal((await webBundleFile(folders, "/plugins/acme.probe/web/index.css", undefined)).headers["Content-Type"], "text/css");
  for (const pathname of [
    "/plugins/acme.probe/server/index.js",
    "/plugins/acme.probe/prompt.hbs",
    "/plugins/acme.probe/web/..%2Fprompt.hbs",
    "/plugins/acme.probe/web/%E0%A4%A",
    "/plugins/acme.probe/web/missing.js",
    "/plugins/acme.other/web/index.js",
  ]) {
    assert.equal((await webBundleFile(folders, pathname, undefined)).status, 404, pathname);
  }
});

test("without a token only the served files of the web halves pass, no source maps and no other paths under /plugins/", () => {
  const folders = new Map([["acme.probe", "/bundles/acme.probe"]]);
  assert.equal(isPublicBundleFile(folders, "/plugins/acme.probe/web/index.js"), true);
  assert.equal(isPublicBundleFile(folders, "/plugins/acme.probe/web/chunks/part-X1.js"), true);
  assert.equal(isPublicBundleFile(folders, "/plugins/acme.probe/web/index.js.map"), false, "the source map carries the source code");
  assert.equal(isBundleSourceMap(folders, "/plugins/acme.probe/web/index.js.map"), true);
  for (const pathname of ["/plugins/acme.probe/data", "/plugins/acme.probe/webhook", "/plugins/acme.other/web/index.js", "/plugins/", "/plugins/acme.probe/web/"]) {
    assert.equal(isPublicBundleFile(folders, pathname), false, pathname);
  }
  assert.equal(isWebBundlePath(folders, "/plugins/acme.probe/web/index.js"), true);
  assert.equal(isWebBundlePath(folders, "/plugins/acme.probe/api"), false, "a plugin route under /plugins/<id>/ stays behind the access check");
});

test("one stylesheet from the candidates of the host and the bundles, in Tailwind order", async () => {
  const css = (await compileStylesheet(root, ["max-md:inline", "hidden", "dark:bg-input/30", "bg-background", "p-2"], false)).css;
  assert.ok(css.indexOf(".hidden") < css.indexOf(".max-md\\:inline"), "a base utility comes before its variant");
  assert.ok(css.indexOf(".bg-background") < css.indexOf(".dark\\:bg-input\\/30"));
  assert.match(css, /--spacing: 0\.235rem/, "the host theme is included");
  assert.ok(hostWebClasses(root).includes("bg-background"), "the sources of the host web provide their classes");

  const bundles = scratch();
  const folder = webBundle(path.join(bundles, "acme.probe"), ["bg-[#123456]"]);
  const plugins = resolvePluginEntries([folder]);
  const fixed = await createStylesheet({ root, bundles: plugins, dev: false });
  const dev = await createStylesheet({ root, bundles: plugins, dev: true });
  assert.match((await fixed()).css, /#123456/);
  assert.doesNotMatch((await fixed()).css, /\n  /, "minified outside dev mode");
  assert.match((await dev()).css, /\n  /);
  const unchanged = await fixed();
  assert.equal(await fixed(), unchanged, "without new classes the compiled stylesheet stays");
  writeFileSync(path.join(folder, "web/classes.json"), JSON.stringify(["bg-[#654321]"]));
  const rebuilt = await fixed();
  assert.match(rebuilt.css, /#654321/, "a rebuilt bundle brings its classes after a reload even without dev mode");
  assert.doesNotMatch(rebuilt.css, /\n  /, "still minified");
  assert.notEqual(rebuilt.etag, unchanged.etag);
  assert.match((await dev()).css, /#654321/, "new on every request in dev mode");

  const broken = webBundle(path.join(bundles, "acme.broken"), { classes: [] });
  await assert.rejects(createStylesheet({ root, bundles: resolvePluginEntries([broken]), dev: false }),
    /The class list .*classes\.json of the bundle acme\.broken is not a list of strings; rebuild with ragents plugin build <source-folder>/);
});
