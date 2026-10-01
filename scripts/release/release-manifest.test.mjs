import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveName } from "./build-standalone.mjs";
import { assembleManifest, targets, validateManifest, verifyArtifacts } from "./release-manifest.mjs";

const version = "1.2.3";
const source = "a".repeat(40);
const fixture = (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-release-manifest-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const target of targets) {
    const file = archiveName(version, target);
    writeFileSync(path.join(directory, file), target);
    writeFileSync(path.join(directory, `${file}.sha256`), `${createHash("sha256").update(target).digest("hex")}  ${file}\n`);
  }
  for (const target of ["universal", ...targets]) {
    writeFileSync(path.join(directory, `ragents-vscode${target === "universal" ? "" : `-${target}`}-${version}.vsix`), target);
  }
  const npm = ["@schlenkr/ragents", ...targets.map((target) => `@schlenkr/ragents-tools-${target}`)].map((name) => {
    const filename = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
    writeFileSync(path.join(directory, filename), name);
    return { name, version, filename, integrity: `sha512-${createHash("sha512").update(name).digest("base64")}` };
  });
  writeFileSync(path.join(directory, "npm-packages.json"), JSON.stringify(npm));
  writeFileSync(path.join(directory, "install.sh"), "shell");
  writeFileSync(path.join(directory, "install.ps1"), "powershell");
  return directory;
};

test("a release binds every channel to its version, source commit, and exact artifact bytes", (t) => {
  const directory = fixture(t);
  const manifest = assembleManifest(directory, version, source);
  verifyArtifacts(directory, manifest, version, source);
  assert.equal(manifest.npm.length, 7);
  assert.equal(manifest.vsix.length, 7);
  assert.throws(() => verifyArtifacts(directory, manifest, version, "b".repeat(40)), /another source/);
  assert.throws(() => verifyArtifacts(directory, manifest, "1.2.4", source), /another source/);
  writeFileSync(path.join(directory, manifest.npm[0].filename), "tampered");
  assert.throws(() => verifyArtifacts(directory, manifest, version, source), /checksum mismatch/);
});

test("missing platforms and archives, foreign paths, and altered npm integrity stop release assembly", (t) => {
  const directory = fixture(t);
  const manifest = assembleManifest(directory, version, source);
  assert.throws(() => validateManifest({ ...manifest, npm: manifest.npm.slice(1) }, version, source), /six npm/);
  assert.throws(() => validateManifest({ ...manifest, vsix: manifest.vsix.slice(1) }, version, source), /seven VSIX/);
  const missing = { ...manifest.files };
  delete missing[archiveName(version, targets[0])];
  assert.throws(() => validateManifest({ ...manifest, files: missing }, version, source), /Incomplete/);
  const outside = { ...manifest, npm: manifest.npm.map((entry, index) => index ? entry : { ...entry, filename: "../outside.tgz" }) };
  assert.throws(() => validateManifest(outside, version, source), /Incomplete/);
  const wrongIntegrity = { ...manifest, npm: manifest.npm.map((entry) => ({ ...entry, integrity: "sha512-YWJj" })) };
  assert.throws(() => verifyArtifacts(directory, wrongIntegrity, version, source), /integrity mismatch/);
});

test("a failed native archive checksum is never promoted into the release manifest", (t) => {
  const directory = fixture(t);
  writeFileSync(path.join(directory, archiveName(version, targets[0])), "corrupt");
  assert.throws(() => assembleManifest(directory, version, source), /Standalone checksum mismatch/);
});
