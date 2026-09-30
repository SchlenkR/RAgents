import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { nextVersion, readVersion, releaseVersion, versionLine, writeHostPackageVersion, writeVersion } from "../publish-version.ts";
import { PACKAGE_NAME } from "./build-package.ts";
import { latestPublishedVersion, oneLine, publishDirectory, publishedVersions, publishEnvironment, publishPlan, publishToolsPackages, redacting, type NpmResult, type NpmRunner } from "./publish-package.ts";

const manifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: PACKAGE_NAME,
  version: "0.1.0",
  publishConfig: { access: "public" },
  ragents: { hostVersion: "a".repeat(40) },
  ...over,
});

const fakeNpm = (answers: Record<string, NpmResult>) => {
  const calls: { args: readonly string[]; cwd: string; token: string | undefined }[] = [];
  const npm: NpmRunner = (args, options) => {
    calls.push({ args, cwd: options.cwd, token: options.token });
    const answer = answers[args.slice(0, 2).join(" ")];
    if (!answer) throw new Error(`The fake does not know npm ${args.join(" ")}`);
    return answer;
  };
  return { npm, calls };
};

test("the versions on npm: list, single version, unknown package, broken call", () => {
  const listed = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `["0.1.0","0.2.0"]\n`, stderr: "" } });
  assert.deepEqual(publishedVersions(PACKAGE_NAME, listed.npm), ["0.1.0", "0.2.0"]);
  assert.deepEqual(listed.calls[0]!.args, ["view", PACKAGE_NAME, "versions", "--json"]);
  assert.equal(listed.calls[0]!.token, undefined, "reading does not need the token");
  const single = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `"0.1.0"\n`, stderr: "" } });
  assert.deepEqual(publishedVersions(PACKAGE_NAME, single.npm), ["0.1.0"]);
  const unknown = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: `npm error code E404\nnpm error 404 Not found` } });
  assert.deepEqual(publishedVersions(PACKAGE_NAME, unknown.npm), []);
  const broken = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: "npm error network ECONNREFUSED" } });
  assert.throws(() => publishedVersions(PACKAGE_NAME, broken.npm), /ECONNREFUSED/);
});

test("the highest published version is the one a user gets", () => {
  const listed = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `["0.1.0","0.2.0","0.1.9"]\n`, stderr: "" } });
  assert.equal(latestPublishedVersion(listed.npm), "0.2.0");
  const unknown = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: "npm error code E404" } });
  assert.equal(latestPublishedVersion(unknown.npm), undefined);
});

test("the package version also goes into the extension so that it fetches the matching one without a checkout", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "publish-package-")), "package.json");
  const original = `{\n  "name": "ragents-vscode",\n  "version": "0.1.0",\n  "ragents": {\n    "packageVersion": "0.1.1"\n  }\n}\n`;
  writeFileSync(file, original);
  writeHostPackageVersion(file, "0.1.2");
  assert.equal(readFileSync(file, "utf8"), original.replace(`"packageVersion": "0.1.1"`, `"packageVersion": "0.1.2"`));
  assert.equal(readVersion(file), "0.1.0", "the extension's version stays its own");
  writeFileSync(file, `{\n  "name": "ragents-vscode"\n}\n`);
  assert.throws(() => writeHostPackageVersion(file, "0.1.2"), /ragents\.packageVersion cannot be found/);
});

test("the plan rejects what must not be published", () => {
  assert.deepEqual(publishPlan(manifest(), ["0.0.9"], "0.1.0"), { name: PACKAGE_NAME, version: "0.1.0", hostVersion: "a".repeat(40) });
  assert.deepEqual(publishPlan(manifest(), [], "0.1.0"), { name: PACKAGE_NAME, version: "0.1.0", hostVersion: "a".repeat(40) });
  assert.throws(() => publishPlan(manifest(), ["0.0.9", "0.1.0"], "0.1.0"), /is already on npm \(there: 0\.0\.9, 0\.1\.0\).*raise version/s);
  assert.throws(() => publishPlan(manifest({ name: "ragents" }), [], "0.1.0"), /is named ragents, but @schlenkr\/ragents is published/);
  assert.throws(() => publishPlan(manifest({ publishConfig: undefined }), [], "0.1.0"), /publishConfig\.access/);
  assert.throws(() => publishPlan(manifest(), [], "new"), /is not a version/);
  assert.throws(() => publishPlan(manifest(), [], "0.1.1"), /does not match the release/);
  assert.throws(() => publishPlan(manifest({ ragents: {} }), [], "0.1.0"), /ragents\.hostVersion/);
});

test("platform packages use the release version, skip already published versions, and keep dry runs unpublished", () => {
  const first = "@schlenkr/ragents-tools-darwin-arm64";
  const second = "@schlenkr/ragents-tools-win32-x64";
  const packages = [
    { name: first, version: "0.1.1", directory: "/dist/tools/darwin-arm64" },
    { name: second, version: "0.1.1", directory: "/dist/tools/win32-x64" },
  ];
  for (const dryRun of [true, false]) {
    const { npm, calls } = fakeNpm({
      [`view ${first}`]: { status: 0, stdout: '["0.1.1"]', stderr: "" },
      [`view ${second}`]: { status: 1, stdout: "", stderr: "npm error code E404" },
      "publish --access": { status: 0, stdout: "", stderr: "" },
    });
    const lines: string[] = [];
    publishToolsPackages(packages, { version: "0.1.1", token: "npm_secret", dryRun, npm, log: (line) => lines.push(line) });
    assert.deepEqual(calls.map((call) => call.args[0]), ["view", "view", "publish"]);
    assert.equal(calls[2]!.cwd, packages[1]!.directory);
    assert.equal(calls[2]!.args.includes("--dry-run"), dryRun);
    assert.equal(lines[0], `== Already published: ${first}@0.1.1`);
    assert.equal(lines[1], dryRun ? "== Dry run: nothing published" : `== Published: ${second}@0.1.1`);
  }
});

test("a tools publication error aborts the remaining release packages", () => {
  const first = "@schlenkr/ragents-tools-linux-x64";
  const { npm, calls } = fakeNpm({
    [`view ${first}`]: { status: 0, stdout: "[]", stderr: "" },
    "publish --access": { status: 1, stdout: "", stderr: "npm error 403 Forbidden" },
  });
  const options = { version: "0.1.1", token: "npm_secret", dryRun: false, npm, log: () => undefined };
  assert.throws(() => publishToolsPackages([
    { name: first, version: "0.1.1", directory: "/dist/tools/linux-x64" },
    { name: "@schlenkr/ragents-tools-linux-arm64", version: "0.1.1", directory: "/dist/tools/linux-arm64" },
  ], options), /npm publish ended with code 1/);
  assert.deepEqual(calls.map((call) => call.args[0]), ["view", "publish"]);
  assert.throws(() => publishToolsPackages([{ name: first, version: "0.1.0", directory: "/dist/tools/linux-x64" }], options), /does not match the release/);
});

test("the next version comes from the published list, a higher one in package.json wins", () => {
  const listed = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `["0.1.0","0.1.1"]\n`, stderr: "" } });
  const published = publishedVersions(PACKAGE_NAME, listed.npm);
  assert.deepEqual(nextVersion("0.1.1", published), { version: "0.1.2", latest: "0.1.1" });
  assert.deepEqual(nextVersion("0.2.0", published), { version: "0.2.0", latest: "0.1.1" });
  const unknown = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: "npm error code E404" } });
  assert.deepEqual(nextVersion("0.1.0", publishedVersions(PACKAGE_NAME, unknown.npm)), { version: "0.1.0" });
  assert.equal(versionLine({ version: "0.1.2", latest: "0.1.1" }), "== Version 0.1.2, last published 0.1.1");
  assert.equal(versionLine({ version: "0.1.0" }), "== Version 0.1.0, nothing published yet");
});

test("npm package and VS Code extension get one version above both local versions and the published ones", () => {
  assert.deepEqual(releaseVersion(["0.1.7", "0.1.6"], ["0.1.6", "0.1.7"]), { version: "0.1.8", latest: "0.1.7" });
  assert.deepEqual(releaseVersion(["0.1.7", "0.1.9"], ["0.1.7"]), { version: "0.1.9", latest: "0.1.7" });
});

test("only the line with version is written, the dry run only computes", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "publish-package-")), "package.json");
  const original = `{\n  "name": "ragents",\n  "version": "0.1.1",\n  "engines": { "version": "whatever" },\n\t"license": "PolyForm-Shield-1.0.0"\n}\n`;
  writeFileSync(file, original);
  assert.equal(readVersion(file), "0.1.1");
  const { npm } = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `["0.1.1"]\n`, stderr: "" } });
  const next = nextVersion(readVersion(file), publishedVersions(PACKAGE_NAME, npm));
  assert.equal(next.version, "0.1.2");
  assert.equal(readFileSync(file, "utf8"), original);
  writeVersion(file, next.version);
  assert.equal(readFileSync(file, "utf8"), original.replace(`"version": "0.1.1"`, `"version": "0.1.2"`));
});

test("the token goes into the environment as a registry key and never into any output", () => {
  const environment = publishEnvironment("npm_secret", { PATH: "/usr/bin" });
  assert.deepEqual(environment, { PATH: "/usr/bin", "npm_config_//registry.npmjs.org/:_authToken": "npm_secret" });
  assert.equal(redacting("npm_secret")("npm error with npm_secret in the text"), "npm error with <npm_key> in the text");
});

test("the dry run passes --dry-run through and publishes nothing", () => {
  const { npm, calls } = fakeNpm({ "publish --access": { status: 0, stdout: "", stderr: "npm notice filename: schlenkr-ragents-0.1.0.tgz\n" } });
  const lines: string[] = [];
  publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_secret", dryRun: true, npm, log: (line) => lines.push(line) });
  assert.deepEqual(calls.map((call) => call.args), [["publish", "--access", "public", "--dry-run"]]);
  assert.equal(calls[0]!.cwd, "/dist/ragents");
  assert.equal(calls[0]!.token, "npm_secret");
  assert.deepEqual(lines, ["npm notice filename: schlenkr-ragents-0.1.0.tgz", "== Dry run: nothing published"]);
});

test("the real publish reports the published version and a failure", () => {
  const { npm, calls } = fakeNpm({
    "publish --access": { status: 0, stdout: "+ @schlenkr/ragents@0.1.0\n", stderr: "npm notice total files: 900\n" },
  });
  const lines: string[] = [];
  publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_secret", dryRun: false, npm, log: (line) => lines.push(line) });
  assert.deepEqual(calls.map((call) => call.args[0]), ["publish"]);
  assert.ok(!calls[0]!.args.includes("--dry-run"));
  assert.equal(lines.at(-1), `== Published: ${PACKAGE_NAME}@0.1.0`);
  const failing = fakeNpm({ "publish --access": { status: 1, stdout: "", stderr: "npm error 403 Forbidden with npm_secret\n" } });
  const shown: string[] = [];
  assert.throws(() => publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_secret", dryRun: false, npm: failing.npm, log: (line) => shown.push(line) }), /npm publish ended with code 1\./);
  assert.deepEqual(shown, ["npm error 403 Forbidden with <npm_key>"]);
});

test("every error message is one line, and a missing scope gets its hint", () => {
  assert.equal(oneLine("npm error code E404\n\n  npm error 404 Scope not found\n"), "npm error code E404; npm error 404 Scope not found");
  const missingScope = fakeNpm({
    "publish --access": { status: 1, stdout: "", stderr: "npm error code E404\nnpm error 404 Scope not found\nnpm error 404 @schlenkr/ragents\n" },
  });
  const advised = "npm publish ended with code 1. The organization @schlenkr does not exist on npm or the token may not use it: "
    + "create it on npmjs.com or grant the token access to the scope.";
  assert.throws(() => publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_secret", dryRun: false, npm: missingScope.npm, log: () => undefined }),
    (error: Error) => error.message === advised && !error.message.includes("\n"));
  const forbidden = fakeNpm({ "publish --access": { status: 1, stdout: "", stderr: "npm error 403 Forbidden\n" } });
  assert.throws(() => publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_secret", dryRun: false, npm: forbidden.npm, log: () => undefined }),
    (error: Error) => error.message === "npm publish ended with code 1.");
  const brokenView = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: "npm error network\nnpm error ECONNREFUSED\n" } });
  assert.throws(() => publishedVersions(PACKAGE_NAME, brokenView.npm), /code 1: npm error network; npm error ECONNREFUSED$/);
});
