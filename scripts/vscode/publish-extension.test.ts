import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readPackageVersion } from "../../apps/server/src/host-version.ts";
import { nextVersion, readVersion, versionLine, writeVersion } from "../publish-version.ts";
import { type NpmRunner } from "../package/publish-package.ts";
import {
  assertHostPackageVersion,
  expectedHostPackageVersion,
  EXTENSION_ID,
  EXTENSION_NAME,
  bundledFolders,
  ignoreRules,
  oneLine,
  packageArguments,
  PUBLISHER,
  publishedVersions,
  publishEnvironment,
  publishPlan,
  publisherAdvice,
  publishVsix,
  redacting,
  verifyToken,
  VSIX_TARGETS,
  vsixName,
  type VsceResult,
  type VsceRunner,
} from "./publish-extension.ts";

const manifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: EXTENSION_NAME,
  publisher: PUBLISHER,
  displayName: "RAgents",
  description: "Workshop for AI agents in VS Code.",
  version: "0.1.0",
  license: "PolyForm-Shield-1.0.0",
  icon: "media/icon.png",
  repository: { type: "git", url: "git+https://github.com/SchlenkR/RAgents.git" },
  engines: { vscode: "^1.134.0" },
  categories: ["AI"],
  keywords: ["agents"],
  ragents: { packageVersion: readPackageVersion() },
  ...over,
});

const fakeVsce = (answers: Record<string, VsceResult>) => {
  const calls: { args: readonly string[]; cwd: string; token: string | undefined }[] = [];
  const vsce: VsceRunner = (args, options) => {
    calls.push({ args, cwd: options.cwd, token: options.token });
    const answer = answers[args[0]!];
    if (!answer) throw new Error(`The fake does not know vsce ${args.join(" ")}`);
    return answer;
  };
  return { vsce, calls };
};

/** An npm that knows only the versions of the host package. */
const fakeNpmVersions = (versions: readonly string[]): NpmRunner => () => ({ status: 0, stdout: JSON.stringify(versions), stderr: "" });

const gallery = (versions: readonly string[]): string => JSON.stringify({ versions: versions.map((version) => ({ version })) });

test("the versions in the Marketplace: list, several platforms of the same version, unknown extension, broken call", () => {
  const listed = fakeVsce({ show: { status: 0, stdout: `${gallery(["0.2.0", "0.1.0"])}\n`, stderr: "" } });
  assert.deepEqual(publishedVersions(EXTENSION_ID, listed.vsce), ["0.2.0", "0.1.0"]);
  assert.deepEqual(listed.calls[0]!.args, ["show", EXTENSION_ID, "--json"]);
  assert.equal(listed.calls[0]!.token, undefined, "reading does not need the token");
  const repeated = fakeVsce({ show: { status: 0, stdout: gallery(["0.1.0", "0.1.0"]), stderr: "" } });
  assert.deepEqual(publishedVersions(EXTENSION_ID, repeated.vsce), ["0.1.0"]);
  const unknown = fakeVsce({ show: { status: 0, stdout: "undefined\n", stderr: "" } });
  assert.deepEqual(publishedVersions(EXTENSION_ID, unknown.vsce), []);
  const missing = fakeVsce({ show: { status: 1, stdout: "", stderr: "ERROR Extension 'purestate.ragents-vscode' not found.\n" } });
  assert.deepEqual(publishedVersions(EXTENSION_ID, missing.vsce), []);
  const broken = fakeVsce({ show: { status: 1, stdout: "", stderr: "ERROR getaddrinfo ENOTFOUND marketplace\n" } });
  assert.throws(() => publishedVersions(EXTENSION_ID, broken.vsce), /ENOTFOUND/);
});

test("the plan rejects what must not be published", () => {
  assert.deepEqual(publishPlan(manifest(), ["0.0.9"], "0.1.0"), { extensionId: EXTENSION_ID, version: "0.1.0" });
  assert.deepEqual(publishPlan(manifest(), [], "0.1.0"), { extensionId: EXTENSION_ID, version: "0.1.0" });
  assert.throws(() => publishPlan(manifest(), ["0.0.9", "0.1.0"], "0.1.0"), /is already in the Marketplace \(there: 0\.0\.9, 0\.1\.0\).*raise version/s);
  assert.throws(() => publishPlan(manifest({ name: "ragents" }), [], "0.1.0"), /is named ragents, but ragents-vscode is published/);
  assert.throws(() => publishPlan(manifest({ publisher: "someone" }), [], "0.1.0"), /publisher is "someone"/);
  assert.throws(() => publishPlan(manifest({ private: true }), [], "0.1.0"), /is private/);
  assert.throws(() => publishPlan(manifest(), [], "new"), /is not a version/);
  assert.throws(() => publishPlan(manifest({ icon: undefined }), [], "0.1.0"), /lacks fields for the Marketplace: icon/);
  assert.throws(() => publishPlan(manifest({ repository: {} }), [], "0.1.0"), /lacks fields for the Marketplace: repository/);
  assert.throws(() => publishPlan(manifest({ engines: {} }), [], "0.1.0"), /lacks fields for the Marketplace: engines\.vscode/);
  assert.throws(() => publishPlan(manifest({ keywords: [] }), [], "0.1.0"), /lacks fields for the Marketplace: keywords/);
  assert.throws(() => publishPlan(manifest({ license: "", categories: [] }), [], "0.1.0"), /lacks fields for the Marketplace: license, categories/);
});

test("extension and host package name the same version", () => {
  assertHostPackageVersion({ ragents: { packageVersion: "1.2.3" } }, "1.2.3");
  assert.throws(() => assertHostPackageVersion({}, "1.2.3"), /names undefined under ragents\.packageVersion.*set the field to 1\.2\.3/s);
  assert.throws(() => assertHostPackageVersion({ ragents: { packageVersion: "1.2.2" } }, "1.2.3"), /is at 1\.2\.3/);
  assertHostPackageVersion({ ragents: { packageVersion: readPackageVersion() } }, expectedHostPackageVersion(fakeNpmVersions([])),
    "this checkout is consistent with itself");
  assert.equal(expectedHostPackageVersion(fakeNpmVersions(["0.0.1"])), readPackageVersion(), "the root is above an older published version");
  assert.equal(expectedHostPackageVersion(fakeNpmVersions(["99.0.0", "0.0.1"])), "99.0.0", "a newer one on npm wins");
});

test("the next version comes from the Marketplace versions, a higher one in package.json wins", () => {
  const listed = fakeVsce({ show: { status: 0, stdout: `${gallery(["0.1.0", "0.1.1"])}\n`, stderr: "" } });
  const published = publishedVersions(EXTENSION_ID, listed.vsce);
  assert.deepEqual(nextVersion("0.1.1", published), { version: "0.1.2", latest: "0.1.1" });
  assert.deepEqual(nextVersion("0.2.0", published), { version: "0.2.0", latest: "0.1.1" });
  const unknown = fakeVsce({ show: { status: 1, stdout: "", stderr: "ERROR Extension 'purestate.ragents-vscode' not found.\n" } });
  assert.deepEqual(nextVersion("0.1.0", publishedVersions(EXTENSION_ID, unknown.vsce)), { version: "0.1.0" });
  assert.equal(versionLine({ version: "0.1.2", latest: "0.1.1" }), "== Version 0.1.2, last published 0.1.1");
  assert.equal(versionLine({ version: "0.1.0" }), "== Version 0.1.0, nothing published yet");
});

test("only the line with version is written, the dry run only computes", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "publish-extension-")), "package.json");
  const original = `{\n  "name": "ragents-vscode",\n  "version": "0.1.0",\n  "engines": { "version": "whatever" },\n\t"publisher": "purestate"\n}\n`;
  writeFileSync(file, original);
  assert.equal(readVersion(file), "0.1.0");
  const { vsce } = fakeVsce({ show: { status: 0, stdout: gallery(["0.1.0"]), stderr: "" } });
  const next = nextVersion(readVersion(file), publishedVersions(EXTENSION_ID, vsce));
  assert.equal(next.version, "0.1.1");
  assert.equal(readFileSync(file, "utf8"), original);
  writeVersion(file, next.version);
  assert.equal(readFileSync(file, "utf8"), original.replace(`"version": "0.1.0"`, `"version": "0.1.1"`));
});

test("the token goes into the environment as VSCE_PAT and never into any output", () => {
  const environment = publishEnvironment("pat_secret", { PATH: "/usr/bin" });
  assert.deepEqual(environment, { PATH: "/usr/bin", VSCE_PAT: "pat_secret" });
  assert.equal(redacting("pat_secret")("ERROR with pat_secret in the text"), "ERROR with <AZURE_DEVOPS_VSCE_RAGENTS_PAT> in the text");
  assert.equal(redacting("")("without token"), "without token");
});

test("verify-pat runs before anything else and does not reveal the token even on failure", () => {
  const good = fakeVsce({ "verify-pat": { status: 0, stdout: "The Personal Access Token verification succeeded\n", stderr: "" } });
  verifyToken(PUBLISHER, "pat_secret", good.vsce);
  assert.deepEqual(good.calls[0]!.args, ["verify-pat", PUBLISHER]);
  assert.equal(good.calls[0]!.token, "pat_secret");
  const bad = fakeVsce({ "verify-pat": { status: 1, stdout: "", stderr: "ERROR 401 pat_secret has expired\n" } });
  assert.throws(() => verifyToken(PUBLISHER, "pat_secret", bad.vsce),
    (error: Error) => error.message === "vsce verify-pat purestate ended with code 1: ERROR 401 <AZURE_DEVOPS_VSCE_RAGENTS_PAT> has expired."
      && !error.message.includes("\n"));
});

test("a publisher that does not exist yet gets its hint", () => {
  assert.match(publisherAdvice(PUBLISHER, "ERROR Access Denied: needs the following permission(s) on the resource /purestate"),
    /the publisher purestate does not exist in the Marketplace yet.*marketplace\.visualstudio\.com\/manage/s);
  assert.equal(publisherAdvice(PUBLISHER, "ERROR 401 Unauthorized"), "");
  const denied = fakeVsce({ "verify-pat": { status: 1, stdout: "", stderr: "ERROR Access Denied: no permissions on /purestate\n" } });
  assert.throws(() => verifyToken(PUBLISHER, "pat_secret", denied.vsce),
    (error: Error) => error.message.includes("Access Denied") && error.message.includes("does not exist") && !error.message.includes("\n"));
});

test("the publish reports the published version and a failure", () => {
  const { vsce, calls } = fakeVsce({ publish: { status: 0, stdout: " DONE  Published purestate.ragents-vscode v0.1.0\n", stderr: "" } });
  const lines: string[] = [];
  publishVsix({ vsix: ["/dist/ragents-vscode-0.1.0.vsix", "/dist/ragents-vscode-win32-x64-0.1.0.vsix"], version: "0.1.0", token: "pat_secret", vsce, log: (line) => lines.push(line) });
  assert.deepEqual(calls.map((call) => call.args), [["publish", "--packagePath", "/dist/ragents-vscode-0.1.0.vsix", "/dist/ragents-vscode-win32-x64-0.1.0.vsix"]]);
  assert.equal(calls[0]!.token, "pat_secret");
  assert.deepEqual(lines, [" DONE  Published purestate.ragents-vscode v0.1.0", `== Published: ${EXTENSION_ID}@0.1.0`]);
  const failing = fakeVsce({ publish: { status: 1, stdout: "", stderr: "ERROR 403 Forbidden with pat_secret\n" } });
  const shown: string[] = [];
  assert.throws(() => publishVsix({ vsix: ["/dist/ragents-vscode-0.1.0.vsix"], version: "0.1.0", token: "pat_secret", vsce: failing.vsce, log: (line) => shown.push(line) }),
    (error: Error) => error.message === "vsce publish ended with code 1." && !error.message.includes("\n"));
  assert.deepEqual(shown, ["ERROR 403 Forbidden with <AZURE_DEVOPS_VSCE_RAGENTS_PAT>"]);
});

test("every error message is one line", () => {
  assert.equal(oneLine("ERROR code 401\n\n  ERROR not authorized\n"), "ERROR code 401; ERROR not authorized");
  const brokenShow = fakeVsce({ show: { status: 1, stdout: "", stderr: "ERROR network\nERROR ECONNREFUSED\n" } });
  assert.throws(() => publishedVersions(EXTENSION_ID, brokenShow.vsce), /code 1: ERROR network; ERROR ECONNREFUSED$/);
});

test("the extension is packaged universally without Bash and rg, per platform with its rg and on Windows with its Bash", () => {
  const base = readFileSync(path.join(import.meta.dirname, "../../apps/vscode/.vscodeignore"), "utf8");
  assert.deepEqual(VSIX_TARGETS, ["universal", "win32-x64", "win32-arm64", "darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"]);
  assert.equal(ignoreRules(base, "universal"), base);
  assert.deepEqual(bundledFolders("universal"), []);
  assert.doesNotMatch(base, /dist\/bash|dist\/rg/, "the universal allowlist includes neither Bash nor rg");
  const x64 = ignoreRules(base, "win32-x64");
  assert.ok(x64.startsWith(base.trimEnd()));
  assert.match(x64, /\n!dist\/bash\/win32-x64\/\*\*\n!dist\/rg\/win32-x64\/\*\*\n$/);
  assert.doesNotMatch(x64, /win32-arm64/);
  for (const target of ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const) {
    assert.deepEqual(bundledFolders(target), [`dist/rg/${target}`]);
    const rules = ignoreRules(base, target);
    assert.equal(rules, `${base.trimEnd()}\n!dist/rg/${target}/**\n`);
    assert.doesNotMatch(rules, /dist\/bash/, `${target} carries no Bash`);
    for (const other of VSIX_TARGETS.filter((candidate) => candidate !== target && candidate !== "universal")) {
      assert.ok(!rules.includes(other), `${target} carries nothing of ${other}`);
    }
  }
  assert.equal(vsixName("0.1.4", "darwin-arm64"), "ragents-vscode-darwin-arm64-0.1.4.vsix");
  assert.equal(vsixName("0.1.4", "universal"), "ragents-vscode-0.1.4.vsix");
  assert.equal(vsixName("0.1.4", "win32-arm64"), "ragents-vscode-win32-arm64-0.1.4.vsix");
  assert.deepEqual(packageArguments("/out/a.vsix", "universal", "/tmp/u.ignore"), ["package", "--no-dependencies", "--ignoreFile", "/tmp/u.ignore", "--out", "/out/a.vsix"]);
  assert.deepEqual(packageArguments("/out/b.vsix", "win32-x64", "/tmp/x.ignore"),
    ["package", "--no-dependencies", "--ignoreFile", "/tmp/x.ignore", "--out", "/out/b.vsix", "--target", "win32-x64"]);
});
