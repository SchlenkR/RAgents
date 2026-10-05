import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { coreContracts, type HostBootstrap, type HostPackageDownload } from "../../apps/server/src/api/contracts.ts";
import { readPackageVersion } from "../../apps/server/src/host-version.ts";
import { ServerClient } from "../../apps/web/src/server-client.ts";
import { hostPackageFolder } from "../package/host-package.ts";
import { selectWorkspaceHost } from "./run-workspace-client.ts";

const temporary = (t: TestContext): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "ragents-cli-host-selection-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};

const host = (directory: string, version: string): string => {
  const root = path.join(directory, "launching-host");
  mkdirSync(root);
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@schlenkr/ragents", version }));
  return root;
};

const archive = Buffer.from("the exact host package archive");
const archiveIntegrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
const download = { path: "/api/host-package", integrity: archiveIntegrity };

const server = (
  t: TestContext, version: string, hostPackage: HostPackageDownload | null = null,
  response: () => Response = () => { throw new Error("the server archive must not be requested"); },
): { transport: ServerClient; requests: string[] } => {
  const requests: string[] = [];
  const bootstrap: HostBootstrap = { version, hostPackage, product: { id: "test", title: "Test" }, plugins: [], startEntries: [] };
  const transport = new ServerClient("https://example.invalid", "workstation-session", async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const route = new URL(url).pathname;
    requests.push(route);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer workstation-session");
    if (route === "/rpc") {
      const request = JSON.parse(String(init?.body)) as { id: string; method: string };
      assert.equal(request.method, coreContracts.plugins.bootstrap.id);
      return Response.json({ jsonrpc: "2.0", id: request.id, result: bootstrap });
    }
    assert.equal(route, "/api/host-package");
    assert.equal(init?.redirect, "error");
    return response();
  });
  t.after(() => transport.rpc.close());
  return { transport, requests };
};

const installer = `
const { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");
appendFileSync(process.env.RAGENTS_FAKE_NPM_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");
const prefix = process.argv[process.argv.indexOf("--prefix") + 1];
const specifier = process.argv.at(-1);
if (process.env.RAGENTS_FAKE_UNPUBLISHED === "1" && specifier.startsWith("@schlenkr/ragents@")) {
  writeFileSync(path.join(prefix, "partial-install"), "incomplete");
  console.error("npm ERR! E404 unpublished host version");
  process.exit(1);
}
if (!specifier.startsWith("@schlenkr/ragents@")) {
  if (existsSync(path.join(prefix, "partial-install"))) throw new Error("the partial npm installation was retained");
  const integrity = "sha512-" + createHash("sha512").update(readFileSync(specifier)).digest("base64");
  if (integrity !== process.env.RAGENTS_FAKE_ARCHIVE_INTEGRITY) throw new Error("npm received different archive bytes");
}
const root = path.join(prefix, "node_modules", "@schlenkr", "ragents");
mkdirSync(path.join(root, "apps", "server", "src"), { recursive: true });
writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@schlenkr/ragents", version: path.basename(prefix) }));
writeFileSync(path.join(root, "apps", "server", "src", "main.ts"), "");
`;

const fakeNpm = (directory: string, unpublished = false): { environment: NodeJS.ProcessEnv; calls: () => string[][] } => {
  const bin = path.join(directory, "bin");
  const calls = path.join(directory, "npm-calls.jsonl");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "npm"), `#!${process.execPath}\n${installer}`, { mode: 0o755 });
  if (process.platform === "win32") {
    const cli = path.join(bin, "node_modules", "npm", "bin", "npm-cli.js");
    mkdirSync(path.dirname(cli), { recursive: true });
    writeFileSync(cli, installer);
    writeFileSync(path.join(bin, "npm.cmd"), "");
  }
  return {
    environment: { PATH: process.platform === "win32" ? `${bin}${path.delimiter}${path.dirname(process.execPath)}` : bin, RAGENTS_FAKE_NPM_CALLS: calls, RAGENTS_FAKE_UNPUBLISHED: unpublished ? "1" : "0", RAGENTS_FAKE_ARCHIVE_INTEGRITY: archiveIntegrity },
    calls: () => existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]) : [],
  };
};

test("a CLI workstation reuses its launching host when the server version matches", async (t) => {
  const directory = temporary(t);
  const root = host(directory, "0.1.40-local.abcdef");
  const { transport, requests } = server(t, "0.1.40-local.abcdef", download);
  const storage = path.join(directory, "cache");
  assert.equal(await selectWorkspaceHost(transport, root, { PATH: "" }, () => undefined, storage), root);
  assert.deepEqual(requests, ["/rpc"]);
  assert.equal(existsSync(storage), false);
});

test("a CLI workstation requires a server version before selecting a host", async (t) => {
  const directory = temporary(t);
  const root = host(directory, "0.1.40");
  const { transport } = server(t, "");
  await assert.rejects(selectWorkspaceHost(transport, root, { PATH: "" }, () => undefined, path.join(directory, "cache")),
    /The server reports no RAgents version/);
});

test("a CLI workstation prefers npm and caches each server version independently", async (t) => {
  const directory = temporary(t);
  const root = host(directory, "0.1.39");
  const storage = path.join(directory, "cache");
  const npm = fakeNpm(directory);
  const first = server(t, "0.1.40", download);
  const second = server(t, "0.1.41", download);
  const firstRoot = await selectWorkspaceHost(first.transport, root, npm.environment, () => undefined, storage);
  const secondRoot = await selectWorkspaceHost(second.transport, root, npm.environment, () => undefined, storage);
  assert.equal(readPackageVersion(firstRoot), "0.1.40");
  assert.equal(readPackageVersion(secondRoot), "0.1.41");
  assert.notEqual(firstRoot, secondRoot);
  assert.deepEqual(npm.calls(), [
    ["install", "--prefix", hostPackageFolder(storage, "0.1.40"), "@schlenkr/ragents@0.1.40"],
    ["install", "--prefix", hostPackageFolder(storage, "0.1.41"), "@schlenkr/ragents@0.1.41"],
  ]);
  assert.equal(await selectWorkspaceHost(first.transport, root, { PATH: "" }, () => undefined, storage), firstRoot);
  assert.equal(npm.calls().length, 2);
  assert.deepEqual(first.requests, ["/rpc", "/rpc"]);
  assert.deepEqual(second.requests, ["/rpc"]);
});

test("a CLI workstation installs an unpublished server host from its authenticated verified archive", async (t) => {
  const directory = temporary(t);
  const root = host(directory, "0.1.39");
  const storage = path.join(directory, "cache");
  const npm = fakeNpm(directory, true);
  const version = "0.1.40-local.abcdef";
  const { transport, requests } = server(t, version, download, () => new Response(archive));
  const selected = await selectWorkspaceHost(transport, root, npm.environment, () => undefined, storage);
  const folder = hostPackageFolder(storage, version);
  assert.equal(readPackageVersion(selected), version);
  assert.deepEqual(requests, ["/rpc", "/api/host-package"]);
  assert.deepEqual(npm.calls(), [
    ["install", "--prefix", folder, `@schlenkr/ragents@${version}`],
    ["install", "--prefix", folder, path.join(folder, "host.tgz")],
  ]);
  assert.equal(existsSync(path.join(folder, "host.tgz")), false);
  assert.equal(existsSync(path.join(folder, "partial-install")), false);
  assert.equal(await selectWorkspaceHost(transport, root, { PATH: "" }, () => undefined, storage), selected);
  assert.deepEqual(requests, ["/rpc", "/api/host-package", "/rpc"]);
});

test("a CLI workstation refuses an archive with different integrity before installing it", async (t) => {
  const directory = temporary(t);
  const root = host(directory, "0.1.39");
  const storage = path.join(directory, "cache");
  const npm = fakeNpm(directory, true);
  const version = "0.1.40-local.abcdef";
  const { transport } = server(t, version, download, () => new Response("a modified archive"));
  await assert.rejects(selectWorkspaceHost(transport, root, npm.environment, () => undefined, storage),
    /npm failed:.*E404 unpublished host version.*Server download failed:.*integrity does not match/s);
  assert.equal(npm.calls().length, 1);
  assert.equal(existsSync(hostPackageFolder(storage, version)), false);
});

test("a CLI workstation reports npm failure and an unavailable server download together", async (t) => {
  const directory = temporary(t);
  const root = host(directory, "0.1.39");
  const storage = path.join(directory, "cache");
  const npm = fakeNpm(directory, true);
  const version = "0.1.40-local.abcdef";
  const { transport, requests } = server(t, version);
  await assert.rejects(selectWorkspaceHost(transport, root, npm.environment, () => undefined, storage),
    /Host 0\.1\.40-local\.abcdef is unavailable: npm failed:.*E404 unpublished host version.*The server offers no host package download/s);
  assert.deepEqual(requests, ["/rpc"]);
  assert.equal(npm.calls().length, 1);
  assert.equal(existsSync(hostPackageFolder(storage, version)), false);
});

test("a CLI workstation reports denied archive access and removes the failed cache", async (t) => {
  const directory = temporary(t);
  const root = host(directory, "0.1.39");
  const storage = path.join(directory, "cache");
  const npm = fakeNpm(directory, true);
  const version = "0.1.40-local.abcdef";
  const { transport } = server(t, version, download, () => new Response("workstation registration denied", { status: 403 }));
  await assert.rejects(selectWorkspaceHost(transport, root, npm.environment, () => undefined, storage),
    /npm failed:.*E404 unpublished host version.*Server download failed:.*HTTP 403 workstation registration denied/s);
  assert.equal(npm.calls().length, 1);
  assert.equal(existsSync(hostPackageFolder(storage, version)), false);
});
