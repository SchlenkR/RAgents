import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { request } from "node:http";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { c } from "tar";
import { createAccessContext, PluginHost } from "@ragents/engine";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { hostPackageRoute, loadServedHostPackage } from "../src/host-package.ts";
import { coreSources, startRpcServer } from "./rpc-fixture.ts";

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-host-tarball-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "package");
  await mkdir(root);
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "@schlenkr/ragents", version: "0.1.40-local.abc", ragents: { hostVersion: "a".repeat(40) },
  }));
  await writeFile(path.join(root, "host.ts"), 'export const host = "demo";\n');
  const tarball = path.join(directory, "host.tgz");
  await c({ cwd: directory, gzip: true, file: tarball }, ["package/package.json", "package/host.ts"]);
  return { directory, root, tarball };
};

const access = (rights: readonly string[] | null) => createAccessContext({ enabled: true,
  user: rights === null ? null : { id: "alice", label: "Alice", rights },
});

test("a configured archive matches the installed content and keeps its bytes and SHA-512 integrity", async (t) => {
  const { root, tarball } = await fixture(t);
  await mkdir(path.join(root, "node_modules", "dependency"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "dependency", "index.js"), "installed dependency");
  const served = await loadServedHostPackage(tarball, root);
  const bytes = await readFile(tarball);
  assert.deepEqual(served?.content, bytes);
  assert.deepEqual(served?.download, { path: "/api/host-package", integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` });
  await writeFile(tarball, "changed after startup");
  assert.deepEqual(served?.content, bytes);
});

test("an absent configuration offers none, while a missing configured archive is a hard error", async (t) => {
  const { root, directory } = await fixture(t);
  assert.equal(await loadServedHostPackage(undefined, root), undefined);
  await assert.rejects(loadServedHostPackage(path.join(directory, "missing.tgz"), root), /RAGENTS_HOST_TARBALL.*ENOENT/);
});

test("a mismatching package version, commit or file and an incomplete archive fail before startup", async (t) => {
  const { directory, root, tarball } = await fixture(t);
  const manifest = await readFile(path.join(root, "package.json"), "utf8");
  for (const changed of [manifest.replace("0.1.40-local.abc", "0.1.41"), manifest.replace("a".repeat(40), "b".repeat(40))]) {
    await writeFile(path.join(root, "package.json"), changed);
    await assert.rejects(loadServedHostPackage(tarball, root), /does not match.*package.json/);
  }
  await writeFile(path.join(root, "package.json"), manifest);
  await writeFile(path.join(root, "host.ts"), "different code");
  await assert.rejects(loadServedHostPackage(tarball, root), /does not match.*host.ts/);
  await c({ cwd: directory, gzip: true, file: tarball }, ["package/package.json"]);
  await assert.rejects(loadServedHostPackage(tarball, root), /file set does not match/);
});

test("archives with data outside package content, duplicates or installed dependencies are rejected", async (t) => {
  const { directory, root, tarball } = await fixture(t);
  await writeFile(path.join(directory, "secret.txt"), "not package content");
  await c({ cwd: directory, gzip: true, file: tarball }, ["package/package.json", "secret.txt"]);
  await assert.rejects(loadServedHostPackage(tarball, root), /non-package entry: secret.txt/);
  await c({ cwd: directory, gzip: true, file: tarball }, ["package/package.json", "package/package.json"]);
  await assert.rejects(loadServedHostPackage(tarball, root), /repeats package.json/);
  await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "node_modules", "secret.txt"), "not published");
  await c({ cwd: directory, gzip: true, file: tarball }, ["package/package.json", "package/node_modules/secret.txt"]);
  await assert.rejects(loadServedHostPackage(tarball, root), /non-package entry.*node_modules/);
  await writeFile(tarball, "not a tar archive");
  await assert.rejects(loadServedHostPackage(tarball, root), /RAGENTS_HOST_TARBALL/);
});

test("host download requires workstation registration access and returns exact bytes, integrity and HEAD metadata", async (t) => {
  const { root, tarball } = await fixture(t);
  const served = await loadServedHostPackage(tarball, root);
  const route = hostPackageRoute(served);
  assert.deepEqual(route.requiredRights, ["runs.write"]);
  const server = await startRpcServer(t, { routes: [route], accessFor: (request) => access(
    request.headers.authorization === "Bearer writer" ? ["runs.write"] : request.headers.authorization ? ["runs.read"] : null),
  });
  for (const headers of [{}, { authorization: "Bearer reader" }]) {
    const response = await fetch(`${server.url}/api/host-package`, { headers });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /workstation registration access/);
  }
  const response = await fetch(`${server.url}/api/host-package`, { headers: { authorization: "Bearer writer" } });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), served!.content);
  assert.equal(response.headers.get("x-ragents-integrity"), served!.download.integrity);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const head = await fetch(`${server.url}/api/host-package`, { method: "HEAD", headers: { authorization: "Bearer writer" } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(served!.content.length));
  assert.equal(await head.text(), "");
});

test("an unconfigured server's download is a named 404", async (t) => {
  const server = await startRpcServer(t, { routes: [hostPackageRoute(undefined)] });
  const response = await fetch(`${server.url}/api/host-package`);
  assert.equal(response.status, 404);
  assert.equal((await response.json() as { code: string }).code, "host-package-unavailable");
});

test("a token-only remote client cannot download or discover a package when it cannot register", async (t) => {
  const { root, tarball, directory } = await fixture(t);
  const served = await loadServedHostPackage(tarball, root);
  const anonymous = createAccessContext({ enabled: false, user: null });
  const plugins = new PluginHost({ product: { id: "demo", title: "Demo" }, dataDirectory: path.join(directory, "data") });
  const server = await startRpcServer(t, { routes: [hostPackageRoute(served)],
    methods: coreMethods(coreSources({}, { plugins, hostPackage: served!.download })), accessFor: () => anonymous, local: false,
  });
  const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const outgoing = request(`${server.url}/api/host-package`, { headers: { host: "ragents.example.com" } }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.once("end", () => resolve({ status: incoming.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      incoming.once("error", reject);
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
  assert.equal(response.status, 403);
  assert.equal((JSON.parse(response.body) as { code: string }).code, "workspace-client-login-required");
  const bootstrap = await server.call(coreContracts.plugins.bootstrap.id, {});
  assert.equal((bootstrap.result as { hostPackage: unknown }).hostPackage, null);
  const local = await fetch(`${server.url}/api/host-package`);
  assert.equal(local.status, 200, "loopback clients retain their registration access");
});

test("bootstrap announces only a configured download to workstation users", async (t) => {
  const { root, tarball, directory } = await fixture(t);
  const served = await loadServedHostPackage(tarball, root);
  const plugins = new PluginHost({ product: { id: "demo", title: "Demo" }, dataDirectory: path.join(directory, "data") });
  for (const hostPackage of [undefined, served!.download]) {
    const server = await startRpcServer(t, { methods: coreMethods(coreSources({}, { plugins, hostPackage })),
      accessFor: (request) => access(request.headers.authorization === "Bearer writer" ? ["runs.write"] : ["runs.read"]),
    });
    const writer = await server.call(coreContracts.plugins.bootstrap.id, {}, { authorization: "Bearer writer" });
    assert.deepEqual((writer.result as { hostPackage: unknown }).hostPackage, hostPackage ?? null);
    const reader = await server.call(coreContracts.plugins.bootstrap.id, {});
    assert.equal((reader.result as { hostPackage: unknown }).hostPackage, null);
  }
});
