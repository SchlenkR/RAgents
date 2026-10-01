import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { localPublishCredentials, needsNpmPublish } from "./release-artifacts.ts";
import { chooseVersion, completeRelease, main, parseArguments } from "./publish-release.ts";

test("one release version is above every published channel, while retries keep their explicit version", () => {
  assert.equal(chooseVersion(["0.1.20", "0.1.20"], ["0.1.21", "0.1.24", "0.1.22"]), "0.1.25");
  assert.equal(chooseVersion(["0.2.0", "0.1.20"], ["0.1.24"]), "0.2.0");
  assert.equal(chooseVersion(["0.1.20"], ["0.1.25"], "0.1.25"), "0.1.25");
  assert.throws(() => chooseVersion(["1.0.0-beta"], []), /stable X.Y.Z/);
});

test("release options reject partial channels, malformed versions, and duplicate arguments", () => {
  assert.deepEqual(parseArguments([]), { dryRun: false });
  assert.deepEqual(parseArguments(["--dry-run", "--version", "1.2.3"]), { dryRun: true, version: "1.2.3" });
  for (const args of [["--npm-only"], ["--version"], ["--version", "01.2.3"], ["--version", "1.2.3-beta"], ["--version", "1.2.3", "--version", "1.2.4"], ["--dry-run", "--dry-run"]]) {
    assert.throws(() => parseArguments(args));
  }
});

test("a dry run with an explicit version leaves both manifests unchanged and never dispatches a workflow", async () => {
  const files = [new URL("../../package.json", import.meta.url), new URL("../../apps/vscode/package.json", import.meta.url)];
  const before = files.map((file) => readFileSync(file, "utf8"));
  await main(["--dry-run", "--version", "9.9.9"]);
  assert.deepEqual(files.map((file) => readFileSync(file, "utf8")), before);
});

test("npm retries skip only exactly matching bytes, publish missing packages, and reject registry failures", () => {
  const artifact = { name: "@schlenkr/ragents", version: "1.2.3", filename: "package.tgz", integrity: "sha512-YWJj" };
  assert.equal(needsNpmPublish(artifact, () => ({ status: 0, stdout: '"sha512-YWJj"', stderr: "" })), false);
  assert.equal(needsNpmPublish(artifact, () => ({ status: 1, stdout: "", stderr: "npm error E404" })), true);
  assert.throws(() => needsNpmPublish(artifact, () => ({ status: 0, stdout: '"sha512-other"', stderr: "" })), /different bytes/);
  assert.throws(() => needsNpmPublish(artifact, () => ({ status: 1, stdout: "", stderr: "ECONNRESET" })), /ECONNRESET/);
  assert.throws(() => needsNpmPublish(artifact, () => ({ status: 0, stdout: "", stderr: "" })), /no integrity/);
});

test("publishing keeps the existing local credentials and does not require a GH_TOKEN variable", () => {
  assert.deepEqual(localPublishCredentials({ npm_key: "npm_test", AZURE_DEVOPS_VSCE_RAGENTS_PAT: "vsce_test" }), { token: "npm_test", vsceToken: "vsce_test" });
  assert.throws(() => localPublishCredentials({ NPM_TOKEN: "npm_test", VSCE_PAT: "vsce_test" }), /local npm_key/);
});

test("a fresh release verifies access, waits for its build, then publishes locally and removes temporary files", async () => {
  const calls: string[] = [];
  const outputs: string[] = [];
  await completeRelease("1.2.3", "a".repeat(40), false, {
    preparedSource: () => undefined,
    verifyAccess: () => { calls.push("verify"); },
    build: async (version, source, directory) => {
      assert.equal(version, "1.2.3");
      assert.equal(source, "a".repeat(40));
      assert.equal(existsSync(directory), true);
      outputs.push(directory);
      calls.push("build");
    },
    publish: (directory, version, source) => {
      assert.equal(directory, outputs[0]);
      assert.equal(version, "1.2.3");
      assert.equal(source, "a".repeat(40));
      calls.push("publish");
    },
  });
  assert.deepEqual(calls, ["verify", "build", "publish"]);
  assert.equal(existsSync(outputs[0]!), false);
});

test("a build failure stops every publish, while a saved draft resumes without rebuilding or requiring a clean checkout", async () => {
  await assert.rejects(completeRelease("1.2.3", "a".repeat(40), false, {
    preparedSource: () => undefined,
    verifyAccess: () => undefined,
    build: async () => { throw new Error("native build failed"); },
    publish: () => assert.fail("A failed build must not publish"),
  }), /native build failed/);
  const calls: string[] = [];
  await completeRelease("1.2.3", "b".repeat(40), true, {
    preparedSource: () => "a".repeat(40),
    verifyAccess: () => assert.fail("The publisher verifies access when resuming"),
    build: async () => assert.fail("A saved draft must not dispatch a workflow"),
    publish: (directory, version, source) => {
      assert.equal(directory, undefined);
      assert.equal(version, "1.2.3");
      assert.equal(source, "a".repeat(40));
      calls.push("publish");
    },
  });
  assert.deepEqual(calls, ["publish"]);
});
