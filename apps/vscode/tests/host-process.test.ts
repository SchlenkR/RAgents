import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readPackageVersion } from "../../server/src/host-version";
import { missingEnvironmentNotice, missingEnvironmentOf } from "../../server/src/missing-environment";
import { ensureHostPackage, findExecutable, HOST_PACKAGE_NAME, hostPackageFolder, hostPackageSpecifier, installHostPackage, packagedHostVersion, startHost } from "../src/host-process";

const fakeHost = (body: string): { file: string; args: string[]; cwd: string } => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-fake-host-"));
  const script = path.join(directory, "host.mjs");
  writeFileSync(script, body);
  return { file: process.execPath, args: [script], cwd: directory };
};

const announcing = `
process.stderr.write("Konfiguration geladen\\n");
console.log("Profil " + process.env.PRODUCT_PROFILE + " aus " + process.env.PRODUCT_PROFILE_FILE + " mit Daten " + process.env.DATA_DIR);
console.log(JSON.stringify({ ragents: { url: "http://127.0.0.1:43210", token: "t0ken", pid: process.pid } }));
process.on("SIGTERM", () => { console.log("beendet"); process.exit(0); });
setInterval(() => {}, 1000);
`;

test("der Host wird mit Profil und Datenordner gestartet, die Ansage gelesen und der Prozess beim Trennen beendet", async () => {
  const lines: string[] = [];
  const host = await startHost({
    profile: "test", profileFile: "/x/ragents.config.test.ts", dataDirectory: "/tmp/data", environment: { ...process.env },
    log: (line) => lines.push(line), command: fakeHost(announcing),
  });
  assert.equal(host.url, "http://127.0.0.1:43210");
  assert.equal(host.token, "t0ken");
  assert.ok(lines.includes("Konfiguration geladen"));
  assert.ok(lines.includes("Profil test aus /x/ragents.config.test.ts mit Daten /tmp/data"));
  await host.stop();
  assert.equal(await host.exited, 0);
  await host.stop();
});

const announcingParent = `
console.log("Elternprozess " + process.env.RAGENTS_PARENT_PID);
console.log(JSON.stringify({ ragents: { url: "http://127.0.0.1:43211", token: null, pid: process.pid } }));
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`;

test("der Host kennt die Prozesskennung der Erweiterung und überlebt sie damit nicht", async () => {
  const lines: string[] = [];
  const host = await startHost({
    profile: "test", profileFile: "/x/ragents.config.test.ts", dataDirectory: "/tmp/data", environment: { ...process.env },
    log: (line) => lines.push(line), command: fakeHost(announcingParent),
  });
  assert.ok(lines.includes(`Elternprozess ${process.pid}`), lines.join("\n"));
  await host.stop();
  assert.equal(await host.exited, 0);
});

test("ein Host, der vor der Ansage endet oder schweigt, ist ein benannter Fehler mit seinen letzten Zeilen", async () => {
  await assert.rejects(startHost({
    profile: "test", profileFile: "/x", dataDirectory: "/tmp", environment: { ...process.env }, log: () => undefined,
    command: fakeHost(`console.error("RAgents startet nicht: Port belegt"); process.exit(1);`),
  }), /endete vor seiner Ansage mit Code 1[\s\S]*Port belegt/);
  await assert.rejects(startHost({
    profile: "test", profileFile: "/x", dataDirectory: "/tmp", environment: { ...process.env }, log: () => undefined,
    command: fakeHost(`setInterval(() => {}, 1000);`), startTimeoutMs: 300,
  }), /nicht gemeldet/);
  await assert.rejects(startHost({
    profile: "test", profileFile: "/x", dataDirectory: "/tmp", environment: { ...process.env }, log: () => undefined,
    command: { file: "/nirgendwo/node", args: [], cwd: tmpdir() },
  }), /konnte nicht gestartet werden/);
});

test("scheitert der Host an einer Umgebungsvariablen, trägt sein Fehler deren Namen, nicht nur den deutschen Satz", async () => {
  const lines: string[] = [];
  const missing = { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" };
  const satz = `RAgents startet nicht: ragents.config.test.ts: ${missing.section}.${missing.key} verweist mit env("${missing.variable}") auf eine nicht gesetzte Umgebungsvariable.`;
  const command = fakeHost(`
console.error(${JSON.stringify(satz)});
console.error(${JSON.stringify(missingEnvironmentNotice(missing))});
process.exit(1);
`);
  const cause = await startHost({
    profile: "test", profileFile: "/x", dataDirectory: "/tmp", environment: { ...process.env }, log: (line) => lines.push(line), command,
  }).then(() => undefined, (error: unknown) => error);
  assert.deepEqual(missingEnvironmentOf(cause), missing, `kein benannter Fehler: ${String(cause)}`);
  assert.match((cause as Error).message, /endete vor seiner Ansage mit Code 1[\s\S]*SERVICE_TOKEN/);
  assert.ok(!lines.some((line) => line.startsWith("ragents:missing-environment")), "die Protokollzeile steht nicht im Ausgabekanal");
});

test("findExecutable sucht im PATH", () => {
  assert.equal(findExecutable("node", { PATH: path.dirname(process.execPath) }), process.execPath);
  assert.equal(findExecutable("gibt-es-nicht", { PATH: path.dirname(process.execPath) }), undefined);
});

/** Ein npm, das die Aufrufe mitschreibt und den Host so hinterlässt, wie eine echte Installation es täte. */
const fakeNpm = (body: string): { directory: string; environment: NodeJS.ProcessEnv; calls: () => string[] } => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-fake-npm-"));
  const calls = path.join(directory, "calls.txt");
  writeFileSync(path.join(directory, "npm"), `#!${process.execPath}\n${body}`, { mode: 0o755 });
  return {
    directory,
    environment: { PATH: directory, RAGENTS_FAKE_NPM_CALLS: calls },
    calls: () => existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean) : [],
  };
};

const installing = `
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
appendFileSync(process.env.RAGENTS_FAKE_NPM_CALLS, process.argv.slice(2).join(" ") + "\\n");
const prefix = process.argv[process.argv.indexOf("--prefix") + 1];
const root = path.join(prefix, "node_modules", "@schlenkr", "ragents");
mkdirSync(path.join(root, "apps", "server", "src"), { recursive: true });
writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@schlenkr/ragents", version: "0.1.0" }));
writeFileSync(path.join(root, "apps", "server", "src", "main.ts"), "");
console.log("added 1 package");
`;

test("den Host holt die Erweiterung als npm-Paket je Fassung genau einmal in ihren Speicher", async () => {
  const npm = fakeNpm(installing);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  const lines: string[] = [];
  const root = await ensureHostPackage(storage, "0.1.0", npm.environment, (line) => lines.push(line));
  assert.equal(root, path.join(hostPackageFolder(storage, "0.1.0"), "node_modules", "@schlenkr", "ragents"));
  assert.deepEqual(npm.calls(), [`install --prefix ${hostPackageFolder(storage, "0.1.0")} ${HOST_PACKAGE_NAME}@0.1.0`]);
  assert.ok(lines.some((line) => line.includes(`${HOST_PACKAGE_NAME}@0.1.0`)));
  assert.ok(lines.includes("added 1 package"), "die Ausgabe von npm steht im Kanal");
  assert.equal(await ensureHostPackage(storage, "0.1.0", npm.environment, () => undefined), root);
  assert.equal(npm.calls().length, 1, "eine geholte Fassung bleibt liegen");
  await ensureHostPackage(storage, "0.2.0", npm.environment, () => undefined);
  assert.equal(npm.calls().length, 2, "jede Fassung bekommt ihren eigenen Ordner");
});

test("ein lokales Profil holt die Fassung, die in der package.json der Erweiterung steht", () => {
  assert.equal(packagedHostVersion(path.resolve(import.meta.dirname, "..")), readPackageVersion(path.resolve(import.meta.dirname, "../../..")),
    "Erweiterung und Host-Paket gehören zusammen");
  const empty = mkdtempSync(path.join(tmpdir(), "ragents-manifest-"));
  writeFileSync(path.join(empty, "package.json"), JSON.stringify({ name: "ragents-vscode" }));
  assert.throws(() => packagedHostVersion(empty), /ragents\.packageVersion nennt die Fassung von @schlenkr\/ragents/);
});

test("für einen Test steht eine lokale .tgz an der Stelle des veröffentlichten Pakets", async () => {
  assert.equal(hostPackageSpecifier("0.1.2", {}), `${HOST_PACKAGE_NAME}@0.1.2`);
  assert.equal(hostPackageSpecifier("0.1.2", { RAGENTS_HOST_PACKAGE_SPEC: "  /tmp/ragents.tgz  " }), "/tmp/ragents.tgz");
  const npm = fakeNpm(installing);
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  const lines: string[] = [];
  await ensureHostPackage(storage, "0.1.2", { ...npm.environment, RAGENTS_HOST_PACKAGE_SPEC: "/tmp/ragents.tgz" }, (line) => lines.push(line));
  assert.deepEqual(npm.calls(), [`install --prefix ${hostPackageFolder(storage, "0.1.2")} /tmp/ragents.tgz`]);
  assert.ok(lines.some((line) => line.includes("/tmp/ragents.tgz")));
});

test("ohne npm und ohne Host im Ergebnis ist das Holen ein benannter Fehler", async () => {
  const storage = mkdtempSync(path.join(tmpdir(), "ragents-storage-"));
  await assert.rejects(() => ensureHostPackage(storage, "0.1.0", { PATH: "" }, () => undefined), /npm wurde im PATH nicht gefunden.*ragents\.hostPath/s);
  const empty = fakeNpm(`
require("node:fs").appendFileSync(process.env.RAGENTS_FAKE_NPM_CALLS, "leer\\n");
`);
  await assert.rejects(() => installHostPackage(path.join(storage, "leer"), "irgendwas.tgz", empty.environment, () => undefined), /irgendwas\.tgz hat keinen RAgents-Host/);
});
