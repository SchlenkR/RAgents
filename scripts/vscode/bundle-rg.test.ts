import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bundleRipgrep,
  RIPGREP_LICENSE_FILES,
  RIPGREP_TARGETS,
  RIPGREP_VERSION,
  ripgrepAsset,
  ripgrepBundleFolder,
  ripgrepExecutable,
  type RipgrepTarget,
} from "./bundle-rg.ts";

test("rg comes for every platform of the extension from a pinned, hashed release archive", () => {
  assert.equal(RIPGREP_VERSION, "15.2.0");
  assert.deepEqual(Object.keys(RIPGREP_TARGETS).sort(), ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-arm64", "win32-x64"]);
  for (const source of Object.values(RIPGREP_TARGETS)) assert.match(source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(new Set(Object.values(RIPGREP_TARGETS).map((source) => source.sha256)).size, 6, "every archive has its own hash");
  assert.equal(ripgrepAsset("win32-x64"), "ripgrep-15.2.0-x86_64-pc-windows-msvc.zip");
  assert.equal(ripgrepAsset("win32-arm64"), "ripgrep-15.2.0-aarch64-pc-windows-msvc.zip");
  assert.equal(ripgrepAsset("darwin-arm64"), "ripgrep-15.2.0-aarch64-apple-darwin.tar.gz");
  assert.equal(ripgrepAsset("darwin-x64"), "ripgrep-15.2.0-x86_64-apple-darwin.tar.gz");
  assert.equal(ripgrepAsset("linux-x64"), "ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz", "statically linked, without glibc");
  assert.equal(ripgrepAsset("linux-arm64"), "ripgrep-15.2.0-aarch64-unknown-linux-musl.tar.gz");
  assert.equal(ripgrepExecutable("win32-arm64"), "rg.exe");
  assert.equal(ripgrepExecutable("linux-x64"), "rg");
  assert.deepEqual([...RIPGREP_LICENSE_FILES], ["COPYING", "LICENSE-MIT", "UNLICENSE"]);
  assert.equal(ripgrepBundleFolder("darwin-arm64", "/ext"), path.join("/ext", "dist", "rg", "darwin-arm64"));
});

/** Builds from the archives in the cache, without network; without a cache (fresh machine) `pnpm bundle:rg` fetches them first. */
const cache = path.join(tmpdir(), "ragents-rg-cache");
const cached = (target: RipgrepTarget): boolean => existsSync(path.join(cache, ripgrepAsset(target)));

test("the bundle carries the unchanged rg, the license texts and a notice of the source", { skip: !cached("linux-x64") || !cached("win32-x64") }, async () => {
  const output = mkdtempSync(path.join(tmpdir(), "ragents-rg-bundle-"));
  try {
    for (const target of ["linux-x64", "win32-x64"] as const) {
      const folder = path.join(output, target);
      const bundle = await bundleRipgrep(target, { output: folder, cache });
      assert.equal(bundle.executable, path.join(folder, ripgrepExecutable(target)));
      assert.ok(bundle.bytes > 1_000_000 && bundle.deflatedBytes < bundle.bytes);
      for (const file of RIPGREP_LICENSE_FILES) assert.ok(existsSync(path.join(folder, "licenses", file)), file);
      const notice = readFileSync(path.join(folder, "NOTICE.txt"), "utf8");
      assert.match(notice, new RegExp(`${ripgrepAsset(target).replace(/\./g, "\\.")}\\n  SHA-256 ${RIPGREP_TARGETS[target].sha256}`));
      assert.match(notice, /MIT license or the Unlicense/);
    }
    assert.equal(statSync(path.join(output, "linux-x64", "rg")).mode & 0o777, 0o755);
    assert.equal(readFileSync(path.join(output, "win32-x64", "rg.exe")).subarray(0, 2).toString("latin1"), "MZ");
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
