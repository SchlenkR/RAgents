import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { nextVersion, readVersion, versionLine, writeHostPackageVersion, writeVersion } from "../publish-version.ts";
import { PACKAGE_NAME } from "./build-package.ts";
import { latestPublishedVersion, oneLine, publishDirectory, publishedVersions, publishEnvironment, publishPlan, redacting, type NpmResult, type NpmRunner } from "./publish-package.ts";

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
    if (!answer) throw new Error(`Der Fake kennt npm ${args.join(" ")} nicht`);
    return answer;
  };
  return { npm, calls };
};

test("die Fassungen auf npm: Liste, einzelne Fassung, unbekanntes Paket, kaputter Aufruf", () => {
  const listed = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `["0.1.0","0.2.0"]\n`, stderr: "" } });
  assert.deepEqual(publishedVersions(PACKAGE_NAME, listed.npm), ["0.1.0", "0.2.0"]);
  assert.deepEqual(listed.calls[0]!.args, ["view", PACKAGE_NAME, "versions", "--json"]);
  assert.equal(listed.calls[0]!.token, undefined, "Lesen braucht den Token nicht");
  const single = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `"0.1.0"\n`, stderr: "" } });
  assert.deepEqual(publishedVersions(PACKAGE_NAME, single.npm), ["0.1.0"]);
  const unknown = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: `npm error code E404\nnpm error 404 Not found` } });
  assert.deepEqual(publishedVersions(PACKAGE_NAME, unknown.npm), []);
  const broken = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: "npm error network ECONNREFUSED" } });
  assert.throws(() => publishedVersions(PACKAGE_NAME, broken.npm), /ECONNREFUSED/);
});

test("die höchste veröffentlichte Fassung ist die, die ein Benutzer bekommt", () => {
  const listed = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `["0.1.0","0.2.0","0.1.9"]\n`, stderr: "" } });
  assert.equal(latestPublishedVersion(listed.npm), "0.2.0");
  const unknown = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: "npm error code E404" } });
  assert.equal(latestPublishedVersion(unknown.npm), undefined);
});

test("die Fassung des Pakets wandert auch in die Erweiterung, damit sie ohne Checkout die passende holt", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "publish-package-")), "package.json");
  const original = `{\n  "name": "ragents-vscode",\n  "version": "0.1.0",\n  "ragents": {\n    "packageVersion": "0.1.1"\n  }\n}\n`;
  writeFileSync(file, original);
  writeHostPackageVersion(file, "0.1.2");
  assert.equal(readFileSync(file, "utf8"), original.replace(`"packageVersion": "0.1.1"`, `"packageVersion": "0.1.2"`));
  assert.equal(readVersion(file), "0.1.0", "die Fassung der Erweiterung bleibt ihre eigene");
  writeFileSync(file, `{\n  "name": "ragents-vscode"\n}\n`);
  assert.throws(() => writeHostPackageVersion(file, "0.1.2"), /ragents\.packageVersion nicht zu finden/);
});

test("der Plan lehnt ab, was nicht veröffentlicht werden darf", () => {
  assert.deepEqual(publishPlan(manifest(), ["0.0.9"], "0.1.0"), { name: PACKAGE_NAME, version: "0.1.0", hostVersion: "a".repeat(40) });
  assert.deepEqual(publishPlan(manifest(), [], "0.1.0"), { name: PACKAGE_NAME, version: "0.1.0", hostVersion: "a".repeat(40) });
  assert.throws(() => publishPlan(manifest(), ["0.0.9", "0.1.0"], "0.1.0"), /liegt schon auf npm \(dort: 0\.0\.9, 0\.1\.0\).*erhöhe version/s);
  assert.throws(() => publishPlan(manifest({ name: "ragents" }), [], "0.1.0"), /heißt ragents, veröffentlicht wird @schlenkr\/ragents/);
  assert.throws(() => publishPlan(manifest({ publishConfig: undefined }), [], "0.1.0"), /publishConfig\.access/);
  assert.throws(() => publishPlan(manifest(), [], "neu"), /keine Fassung/);
  assert.throws(() => publishPlan(manifest({ ragents: {} }), [], "0.1.0"), /ragents\.hostVersion/);
});

test("die nächste Fassung kommt aus der veröffentlichten Liste, eine höhere in der package.json gewinnt", () => {
  const listed = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `["0.1.0","0.1.1"]\n`, stderr: "" } });
  const published = publishedVersions(PACKAGE_NAME, listed.npm);
  assert.deepEqual(nextVersion("0.1.1", published), { version: "0.1.2", latest: "0.1.1" });
  assert.deepEqual(nextVersion("0.2.0", published), { version: "0.2.0", latest: "0.1.1" });
  const unknown = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: "npm error code E404" } });
  assert.deepEqual(nextVersion("0.1.0", publishedVersions(PACKAGE_NAME, unknown.npm)), { version: "0.1.0" });
  assert.equal(versionLine({ version: "0.1.2", latest: "0.1.1" }), "== Fassung 0.1.2, zuletzt veröffentlicht 0.1.1");
  assert.equal(versionLine({ version: "0.1.0" }), "== Fassung 0.1.0, noch nichts veröffentlicht");
});

test("geschrieben wird nur die Zeile mit version, der Probelauf rechnet nur", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "publish-package-")), "package.json");
  const original = `{\n  "name": "ragents",\n  "version": "0.1.1",\n  "engines": { "version": "egal" },\n\t"license": "PolyForm-Shield-1.0.0"\n}\n`;
  writeFileSync(file, original);
  assert.equal(readVersion(file), "0.1.1");
  const { npm } = fakeNpm({ "view @schlenkr/ragents": { status: 0, stdout: `["0.1.1"]\n`, stderr: "" } });
  const next = nextVersion(readVersion(file), publishedVersions(PACKAGE_NAME, npm));
  assert.equal(next.version, "0.1.2");
  assert.equal(readFileSync(file, "utf8"), original);
  writeVersion(file, next.version);
  assert.equal(readFileSync(file, "utf8"), original.replace(`"version": "0.1.1"`, `"version": "0.1.2"`));
});

test("der Token geht als Registrierungsschlüssel in die Umgebung und nie in eine Ausgabe", () => {
  const environment = publishEnvironment("npm_geheim", { PATH: "/usr/bin" });
  assert.deepEqual(environment, { PATH: "/usr/bin", "npm_config_//registry.npmjs.org/:_authToken": "npm_geheim" });
  assert.equal(redacting("npm_geheim")("npm error mit npm_geheim im Text"), "npm error mit <npm_key> im Text");
});

test("der Probelauf reicht --dry-run durch und veröffentlicht nichts", () => {
  const { npm, calls } = fakeNpm({ "publish --access": { status: 0, stdout: "", stderr: "npm notice filename: schlenkr-ragents-0.1.0.tgz\n" } });
  const lines: string[] = [];
  publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_geheim", dryRun: true, npm, log: (line) => lines.push(line) });
  assert.deepEqual(calls.map((call) => call.args), [["publish", "--access", "public", "--dry-run"]]);
  assert.equal(calls[0]!.cwd, "/dist/ragents");
  assert.equal(calls[0]!.token, "npm_geheim");
  assert.deepEqual(lines, ["npm notice filename: schlenkr-ragents-0.1.0.tgz", "== Probelauf: nichts veröffentlicht"]);
});

test("der echte Publish meldet die veröffentlichte Fassung und einen Fehlschlag", () => {
  const { npm, calls } = fakeNpm({
    "publish --access": { status: 0, stdout: "+ @schlenkr/ragents@0.1.0\n", stderr: "npm notice total files: 900\n" },
  });
  const lines: string[] = [];
  publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_geheim", dryRun: false, npm, log: (line) => lines.push(line) });
  assert.deepEqual(calls.map((call) => call.args[0]), ["publish"]);
  assert.ok(!calls[0]!.args.includes("--dry-run"));
  assert.equal(lines.at(-1), `== Veröffentlicht: ${PACKAGE_NAME}@0.1.0`);
  const failing = fakeNpm({ "publish --access": { status: 1, stdout: "", stderr: "npm error 403 Forbidden mit npm_geheim\n" } });
  const shown: string[] = [];
  assert.throws(() => publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_geheim", dryRun: false, npm: failing.npm, log: (line) => shown.push(line) }), /npm publish endete mit Code 1\./);
  assert.deepEqual(shown, ["npm error 403 Forbidden mit <npm_key>"]);
});

test("jede Fehlermeldung ist eine Zeile, und ein fehlender Scope bekommt seinen Hinweis", () => {
  assert.equal(oneLine("npm error code E404\n\n  npm error 404 Scope not found\n"), "npm error code E404; npm error 404 Scope not found");
  const missingScope = fakeNpm({
    "publish --access": { status: 1, stdout: "", stderr: "npm error code E404\nnpm error 404 Scope not found\nnpm error 404 @schlenkr/ragents\n" },
  });
  const advised = "npm publish endete mit Code 1. Die Organisation @schlenkr existiert auf npm nicht oder der Token darf sie nicht: "
    + "auf npmjs.com anlegen bzw. den Token für den Scope freigeben.";
  assert.throws(() => publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_geheim", dryRun: false, npm: missingScope.npm, log: () => undefined }),
    (error: Error) => error.message === advised && !error.message.includes("\n"));
  const forbidden = fakeNpm({ "publish --access": { status: 1, stdout: "", stderr: "npm error 403 Forbidden\n" } });
  assert.throws(() => publishDirectory({ directory: "/dist/ragents", version: "0.1.0", token: "npm_geheim", dryRun: false, npm: forbidden.npm, log: () => undefined }),
    (error: Error) => error.message === "npm publish endete mit Code 1.");
  const brokenView = fakeNpm({ "view @schlenkr/ragents": { status: 1, stdout: "", stderr: "npm error network\nnpm error ECONNREFUSED\n" } });
  assert.throws(() => publishedVersions(PACKAGE_NAME, brokenView.npm), /Code 1: npm error network; npm error ECONNREFUSED$/);
});
