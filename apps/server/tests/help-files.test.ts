import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { readHelpResponse } from "../src/help-files.js";

let dist: string;
const request = (pathname: string, method = "GET") => readHelpResponse(new URL(pathname, "http://localhost"), dist, method);

before(async () => {
  dist = await mkdtemp(path.join(os.tmpdir(), "ragents-help-files-"));
  await mkdir(path.join(dist, "help", "screenshots"), { recursive: true });
  await Promise.all([
    writeFile(path.join(dist, "index.html"), "APP"),
    ...Object.entries({
      "index.html": "HOMEPAGE",
      "reference.html": "REFERENCE",
      "reference-ui.js": "JAVASCRIPT",
      "reference-ui.css": "CSS",
      "reference.md": "MARKDOWN",
      "llms.txt": "TEXT",
      "run-api.d.ts": "DECLARATIONS",
      "http-api.md": "HTTP API",
      "openapi.json": "{\"openapi\":\"3.1.0\"}",
      "screenshots/core.png": "PNG",
    }).map(([name, content]) => writeFile(path.join(dist, "help", name), content)),
  ]);
});
after(async () => { await rm(dist, { recursive: true, force: true }); });

test("help canonicalizes its base URL so standalone relative links resolve", async () => {
  assert.deepEqual(await request("/help?view=reference"), {
    status: 302,
    headers: { Location: "/help/?view=reference" },
  });
  for (const pathname of ["/help/", "/help/index.html"]) {
    const response = await request(pathname);
    assert.equal(response?.status, 200);
    assert.equal(response?.body?.toString(), "HOMEPAGE");
    assert.equal(response?.headers["Content-Type"], "text/html; charset=utf-8");
  }
});

test("help serves reference pages, demos, text contracts and nested screenshots with matching MIME types", async () => {
  for (const [name, content, type] of [
    ["reference.html", "REFERENCE", "text/html; charset=utf-8"],
    ["reference-ui.js", "JAVASCRIPT", "text/javascript; charset=utf-8"],
    ["reference-ui.css", "CSS", "text/css; charset=utf-8"],
    ["reference.md", "MARKDOWN", "text/plain; charset=utf-8"],
    ["llms.txt", "TEXT", "text/plain; charset=utf-8"],
    ["run-api.d.ts", "DECLARATIONS", "text/plain; charset=utf-8"],
    ["http-api.md", "HTTP API", "text/plain; charset=utf-8"],
    ["openapi.json", "{\"openapi\":\"3.1.0\"}", "application/json; charset=utf-8"],
    ["screenshots/core.png", "PNG", "image/png"],
  ]) {
    const response = await request(`/help/${name}`);
    assert.equal(response?.status, 200, name);
    assert.equal(response?.body?.toString(), content, name);
    assert.equal(response?.headers["Content-Type"], type, name);
  }
});

test("help never substitutes the app for missing files or escaped paths", async () => {
  for (const pathname of ["/help/missing.html", "/help/missing.js", "/help/screenshots/", "/help/..%2Findex.html", "/help/%2Findex.html", "/help/%00"]) {
    assert.equal((await request(pathname))?.status, 404, pathname);
  }
  assert.equal((await request("/help/%xx"))?.status, 400);
});

test("help supports HEAD, rejects mutations and leaves all other app paths alone", async () => {
  const head = await request("/help/", "HEAD");
  assert.equal(head?.status, 200);
  assert.equal(head?.body, undefined);
  assert.equal((await request("/help/missing.js", "HEAD"))?.body, undefined);
  assert.deepEqual(await request("/help/", "POST"), { status: 405, headers: { Allow: "GET, HEAD" } });
  for (const pathname of ["/", "/chat/example", "/helpful", "/assets/app.js"]) {
    assert.equal(await request(pathname), undefined, pathname);
  }
});
