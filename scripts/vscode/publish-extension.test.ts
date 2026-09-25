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
  description: "Werkstatt für KI-Agenten in VS Code.",
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
    if (!answer) throw new Error(`Der Fake kennt vsce ${args.join(" ")} nicht`);
    return answer;
  };
  return { vsce, calls };
};

/** Ein npm, das nur die Fassungen des Host-Pakets kennt. */
const fakeNpmVersions = (versions: readonly string[]): NpmRunner => () => ({ status: 0, stdout: JSON.stringify(versions), stderr: "" });

const gallery = (versions: readonly string[]): string => JSON.stringify({ versions: versions.map((version) => ({ version })) });

test("die Fassungen im Marketplace: Liste, mehrere Plattformen derselben Fassung, unbekannte Erweiterung, kaputter Aufruf", () => {
  const listed = fakeVsce({ show: { status: 0, stdout: `${gallery(["0.2.0", "0.1.0"])}\n`, stderr: "" } });
  assert.deepEqual(publishedVersions(EXTENSION_ID, listed.vsce), ["0.2.0", "0.1.0"]);
  assert.deepEqual(listed.calls[0]!.args, ["show", EXTENSION_ID, "--json"]);
  assert.equal(listed.calls[0]!.token, undefined, "Lesen braucht den Token nicht");
  const repeated = fakeVsce({ show: { status: 0, stdout: gallery(["0.1.0", "0.1.0"]), stderr: "" } });
  assert.deepEqual(publishedVersions(EXTENSION_ID, repeated.vsce), ["0.1.0"]);
  const unknown = fakeVsce({ show: { status: 0, stdout: "undefined\n", stderr: "" } });
  assert.deepEqual(publishedVersions(EXTENSION_ID, unknown.vsce), []);
  const missing = fakeVsce({ show: { status: 1, stdout: "", stderr: "ERROR Extension 'purestate.ragents-vscode' not found.\n" } });
  assert.deepEqual(publishedVersions(EXTENSION_ID, missing.vsce), []);
  const broken = fakeVsce({ show: { status: 1, stdout: "", stderr: "ERROR getaddrinfo ENOTFOUND marketplace\n" } });
  assert.throws(() => publishedVersions(EXTENSION_ID, broken.vsce), /ENOTFOUND/);
});

test("der Plan lehnt ab, was nicht veröffentlicht werden darf", () => {
  assert.deepEqual(publishPlan(manifest(), ["0.0.9"], "0.1.0"), { extensionId: EXTENSION_ID, version: "0.1.0" });
  assert.deepEqual(publishPlan(manifest(), [], "0.1.0"), { extensionId: EXTENSION_ID, version: "0.1.0" });
  assert.throws(() => publishPlan(manifest(), ["0.0.9", "0.1.0"], "0.1.0"), /liegt schon im Marketplace \(dort: 0\.0\.9, 0\.1\.0\).*erhöhe version/s);
  assert.throws(() => publishPlan(manifest({ name: "ragents" }), [], "0.1.0"), /heißt ragents, veröffentlicht wird ragents-vscode/);
  assert.throws(() => publishPlan(manifest({ publisher: "jemand" }), [], "0.1.0"), /Herausgeber ist "jemand"/);
  assert.throws(() => publishPlan(manifest({ private: true }), [], "0.1.0"), /ist private/);
  assert.throws(() => publishPlan(manifest(), [], "neu"), /keine Fassung/);
  assert.throws(() => publishPlan(manifest({ icon: undefined }), [], "0.1.0"), /fehlen Felder für den Marketplace: icon/);
  assert.throws(() => publishPlan(manifest({ repository: {} }), [], "0.1.0"), /fehlen Felder für den Marketplace: repository/);
  assert.throws(() => publishPlan(manifest({ engines: {} }), [], "0.1.0"), /fehlen Felder für den Marketplace: engines\.vscode/);
  assert.throws(() => publishPlan(manifest({ keywords: [] }), [], "0.1.0"), /fehlen Felder für den Marketplace: keywords/);
  assert.throws(() => publishPlan(manifest({ license: "", categories: [] }), [], "0.1.0"), /fehlen Felder für den Marketplace: license, categories/);
});

test("Erweiterung und Host-Paket nennen dieselbe Fassung", () => {
  assertHostPackageVersion({ ragents: { packageVersion: "1.2.3" } }, "1.2.3");
  assert.throws(() => assertHostPackageVersion({}, "1.2.3"), /nennt unter ragents\.packageVersion undefined.*setze das Feld auf 1\.2\.3/s);
  assert.throws(() => assertHostPackageVersion({ ragents: { packageVersion: "1.2.2" } }, "1.2.3"), /steht auf 1\.2\.3/);
  assertHostPackageVersion({ ragents: { packageVersion: readPackageVersion() } }, expectedHostPackageVersion(fakeNpmVersions([])),
    "dieser Checkout ist mit sich im Reinen");
  assert.equal(expectedHostPackageVersion(fakeNpmVersions(["0.0.1"])), readPackageVersion(), "die Wurzel steht über einer älteren veröffentlichten Fassung");
  assert.equal(expectedHostPackageVersion(fakeNpmVersions(["99.0.0", "0.0.1"])), "99.0.0", "eine neuere auf npm gewinnt");
});

test("die nächste Fassung kommt aus den Fassungen des Marketplace, eine höhere in der package.json gewinnt", () => {
  const listed = fakeVsce({ show: { status: 0, stdout: `${gallery(["0.1.0", "0.1.1"])}\n`, stderr: "" } });
  const published = publishedVersions(EXTENSION_ID, listed.vsce);
  assert.deepEqual(nextVersion("0.1.1", published), { version: "0.1.2", latest: "0.1.1" });
  assert.deepEqual(nextVersion("0.2.0", published), { version: "0.2.0", latest: "0.1.1" });
  const unknown = fakeVsce({ show: { status: 1, stdout: "", stderr: "ERROR Extension 'purestate.ragents-vscode' not found.\n" } });
  assert.deepEqual(nextVersion("0.1.0", publishedVersions(EXTENSION_ID, unknown.vsce)), { version: "0.1.0" });
  assert.equal(versionLine({ version: "0.1.2", latest: "0.1.1" }), "== Fassung 0.1.2, zuletzt veröffentlicht 0.1.1");
  assert.equal(versionLine({ version: "0.1.0" }), "== Fassung 0.1.0, noch nichts veröffentlicht");
});

test("geschrieben wird nur die Zeile mit version, der Probelauf rechnet nur", () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "publish-extension-")), "package.json");
  const original = `{\n  "name": "ragents-vscode",\n  "version": "0.1.0",\n  "engines": { "version": "egal" },\n\t"publisher": "purestate"\n}\n`;
  writeFileSync(file, original);
  assert.equal(readVersion(file), "0.1.0");
  const { vsce } = fakeVsce({ show: { status: 0, stdout: gallery(["0.1.0"]), stderr: "" } });
  const next = nextVersion(readVersion(file), publishedVersions(EXTENSION_ID, vsce));
  assert.equal(next.version, "0.1.1");
  assert.equal(readFileSync(file, "utf8"), original);
  writeVersion(file, next.version);
  assert.equal(readFileSync(file, "utf8"), original.replace(`"version": "0.1.0"`, `"version": "0.1.1"`));
});

test("der Token geht als VSCE_PAT in die Umgebung und nie in eine Ausgabe", () => {
  const environment = publishEnvironment("pat_geheim", { PATH: "/usr/bin" });
  assert.deepEqual(environment, { PATH: "/usr/bin", VSCE_PAT: "pat_geheim" });
  assert.equal(redacting("pat_geheim")("ERROR mit pat_geheim im Text"), "ERROR mit <AZURE_DEVOPS_VSCE_RAGENTS_PAT> im Text");
  assert.equal(redacting("")("ohne Token"), "ohne Token");
});

test("verify-pat läuft vor allem anderen und verrät den Token auch im Fehlschlag nicht", () => {
  const good = fakeVsce({ "verify-pat": { status: 0, stdout: "The Personal Access Token verification succeeded\n", stderr: "" } });
  verifyToken(PUBLISHER, "pat_geheim", good.vsce);
  assert.deepEqual(good.calls[0]!.args, ["verify-pat", PUBLISHER]);
  assert.equal(good.calls[0]!.token, "pat_geheim");
  const bad = fakeVsce({ "verify-pat": { status: 1, stdout: "", stderr: "ERROR 401 pat_geheim ist abgelaufen\n" } });
  assert.throws(() => verifyToken(PUBLISHER, "pat_geheim", bad.vsce),
    (error: Error) => error.message === "vsce verify-pat purestate endete mit Code 1: ERROR 401 <AZURE_DEVOPS_VSCE_RAGENTS_PAT> ist abgelaufen."
      && !error.message.includes("\n"));
});

test("ein Herausgeber, den es noch nicht gibt, bekommt seinen Hinweis", () => {
  assert.match(publisherAdvice(PUBLISHER, "ERROR Access Denied: needs the following permission(s) on the resource /purestate"),
    /gibt es den Herausgeber purestate im Marketplace noch nicht.*marketplace\.visualstudio\.com\/manage/s);
  assert.equal(publisherAdvice(PUBLISHER, "ERROR 401 Unauthorized"), "");
  const denied = fakeVsce({ "verify-pat": { status: 1, stdout: "", stderr: "ERROR Access Denied: keine Rechte auf /purestate\n" } });
  assert.throws(() => verifyToken(PUBLISHER, "pat_geheim", denied.vsce),
    (error: Error) => error.message.includes("Access Denied") && error.message.includes("noch nicht") && !error.message.includes("\n"));
});

test("der Publish meldet die veröffentlichte Fassung und einen Fehlschlag", () => {
  const { vsce, calls } = fakeVsce({ publish: { status: 0, stdout: " DONE  Published purestate.ragents-vscode v0.1.0\n", stderr: "" } });
  const lines: string[] = [];
  publishVsix({ vsix: ["/dist/ragents-vscode-0.1.0.vsix", "/dist/ragents-vscode-win32-x64-0.1.0.vsix"], version: "0.1.0", token: "pat_geheim", vsce, log: (line) => lines.push(line) });
  assert.deepEqual(calls.map((call) => call.args), [["publish", "--packagePath", "/dist/ragents-vscode-0.1.0.vsix", "/dist/ragents-vscode-win32-x64-0.1.0.vsix"]]);
  assert.equal(calls[0]!.token, "pat_geheim");
  assert.deepEqual(lines, [" DONE  Published purestate.ragents-vscode v0.1.0", `== Veröffentlicht: ${EXTENSION_ID}@0.1.0`]);
  const failing = fakeVsce({ publish: { status: 1, stdout: "", stderr: "ERROR 403 Forbidden mit pat_geheim\n" } });
  const shown: string[] = [];
  assert.throws(() => publishVsix({ vsix: ["/dist/ragents-vscode-0.1.0.vsix"], version: "0.1.0", token: "pat_geheim", vsce: failing.vsce, log: (line) => shown.push(line) }),
    (error: Error) => error.message === "vsce publish endete mit Code 1." && !error.message.includes("\n"));
  assert.deepEqual(shown, ["ERROR 403 Forbidden mit <AZURE_DEVOPS_VSCE_RAGENTS_PAT>"]);
});

test("jede Fehlermeldung ist eine Zeile", () => {
  assert.equal(oneLine("ERROR code 401\n\n  ERROR not authorized\n"), "ERROR code 401; ERROR not authorized");
  const brokenShow = fakeVsce({ show: { status: 1, stdout: "", stderr: "ERROR network\nERROR ECONNREFUSED\n" } });
  assert.throws(() => publishedVersions(EXTENSION_ID, brokenShow.vsce), /Code 1: ERROR network; ERROR ECONNREFUSED$/);
});

test("die Erweiterung wird universell ohne Bash und je Windows-Plattform mit ihrer Bash gepackt", () => {
  const base = readFileSync(path.join(import.meta.dirname, "../../apps/vscode/.vscodeignore"), "utf8");
  assert.deepEqual(VSIX_TARGETS, ["universal", "win32-x64", "win32-arm64"]);
  assert.equal(ignoreRules(base, "universal"), base);
  assert.doesNotMatch(base, /dist\/bash/, "die universelle Positivliste nimmt keine Bash auf");
  const x64 = ignoreRules(base, "win32-x64");
  assert.ok(x64.startsWith(base.trimEnd()));
  assert.match(x64, /\n!dist\/bash\/win32-x64\/\*\*\n$/);
  assert.doesNotMatch(x64, /win32-arm64/);
  assert.equal(vsixName("0.1.4", "universal"), "ragents-vscode-0.1.4.vsix");
  assert.equal(vsixName("0.1.4", "win32-arm64"), "ragents-vscode-win32-arm64-0.1.4.vsix");
  assert.deepEqual(packageArguments("/out/a.vsix", "universal", "/tmp/u.ignore"), ["package", "--no-dependencies", "--ignoreFile", "/tmp/u.ignore", "--out", "/out/a.vsix"]);
  assert.deepEqual(packageArguments("/out/b.vsix", "win32-x64", "/tmp/x.ignore"),
    ["package", "--no-dependencies", "--ignoreFile", "/tmp/x.ignore", "--out", "/out/b.vsix", "--target", "win32-x64"]);
});
