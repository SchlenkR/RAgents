import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { create as createTar } from "tar";
import { profileArchivePath, type ClientProfileDescription } from "../../plugins/ragents.profile-distribution/contract.ts";
import { HOST_API_VERSION } from "../../apps/server/src/host-api.ts";
import { HOST_API_RECORD_FILE } from "../../apps/server/src/host-version.ts";
import { readBody } from "../../apps/server/src/plugin-support/http.ts";
import { writeBundle } from "../../apps/server/tests/bundle-fixture.ts";

process.env.DATA_DIR ??= await mkdtemp(path.join(tmpdir(), "ragents-connect-data-"));
process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { inspectClientProfile, packClientProfile } = await import("../../plugins/ragents.profile-distribution/server/archive.ts");
const { parseArguments, prepareProfile, remoteLayout, serverFolderName } = await import("./connect.ts");

const hostVersion = "0123456789abcdef0123456789abcdef01234567";
const testToken = "fixture";

/** An archive the distributor never packs: with a link in the bundle that points to a foreign file. */
const packWithSymlink = async (folder: string): Promise<{ archive: Buffer; version: string }> => {
  await symlink("/etc/hosts", path.join(folder, "plugins", "workshop.demo", "web-link"));
  const chunks: Buffer[] = [];
  for await (const chunk of createTar({ gzip: true, cwd: folder, portable: true, noMtime: true }, ["ragents.config.workshop-client.ts", "plugins"])) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const archive = Buffer.concat(chunks);
  return { archive, version: createHash("sha256").update(archive).digest("hex") };
};

const fakeServer = async (t: TestContext, options: { bundleRevision?: string; symlink?: boolean } = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), "ragents-connect-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const serverBundles = path.join(root, "server-host", "bundles");
  writeBundle(path.join(serverBundles, "ragents.orchestration"));
  writeBundle(path.join(root, "server", "plugins", "workshop.demo"), options.bundleRevision === undefined ? {} : { manifest: { revision: options.bundleRevision } });
  const profileFile = path.join(root, "server", "ragents.config.workshop-client.ts");
  await writeFile(profileFile, `export const config = { host: { PRODUCT_PROFILE: "workshop-client", PLUGINS: ["ragents.orchestration", "./plugins/workshop.demo"] } };\n`);
  const packed = options.symlink ? await packWithSymlink(path.join(root, "server")) : await packClientProfile(await inspectClientProfile(profileFile, serverBundles));
  const description: ClientProfileDescription = {
    profile: "workshop-client", version: packed.version, hostApi: HOST_API_VERSION, hostVersion, packageVersion: "0.2.0", file: "ragents.config.workshop-client.ts",
    size: packed.archive.byteLength, archivePath: profileArchivePath(packed.version),
    plugins: [{ id: "ragents.orchestration", source: "host" }, { id: "workshop.demo", source: "archive" }],
  };
  const tokens: string[] = [];
  let archiveRequests = 0;
  const server = createServer(async (request, response) => {
    tokens.push(request.headers.authorization ?? "");
    if (request.headers.authorization !== `Bearer ${testToken}`) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Please sign in.", code: "login-required" }));
      return;
    }
    if (request.method === "POST" && request.url === "/rpc") {
      const message = JSON.parse(await readBody(request)) as { id: unknown; method: string };
      assert.equal(message.method, "ragents.profile.describe");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: description }));
      return;
    }
    if (request.method === "GET" && request.url === description.archivePath) {
      archiveRequests += 1;
      response.writeHead(200, { "Content-Type": "application/gzip" });
      response.end(packed.archive);
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return { root, url: `http://127.0.0.1:${address.port}`, description, tokens, archiveRequests: () => archiveRequests };
};

test("arguments, server folder and storage follow fixed rules", () => {
  assert.deepEqual(parseArguments(["https://workshop.example.com", "--clean", "--port", "0", "--no-start"]), { serverUrl: "https://workshop.example.com", port: 0, clean: true, start: false });
  assert.throws(() => parseArguments([]), /server address is missing/);
  assert.throws(() => parseArguments(["http://a", "http://b"]), /Unknown argument/);
  assert.throws(() => parseArguments(["http://a", "--port", "x"]), /--port/);
  assert.equal(serverFolderName("https://workshop.example.com/"), "workshop.example.com");
  assert.equal(serverFolderName("http://localhost:4710"), "localhost-4710");
  assert.throws(() => serverFolderName("ftp://x"), /http or https/);
  const layout = remoteLayout("/data", "https://workshop.example.com", "workshop-client");
  assert.equal(layout.profiles, path.join("/data", "remote", "workshop.example.com", "workshop-client", "profiles"));
  assert.equal(layout.data, path.join("/data", "remote", "workshop.example.com", "workshop-client", "data"));
});

/** A client host at any location: its host API, its built-in bundles and, as a package, its package.json. */
const clientHost = async (root: string, name: string, options: { api?: number; builtIns?: readonly string[]; packageVersion?: string } = {}): Promise<string> => {
  const folder = path.join(root, name);
  await mkdir(path.join(folder, path.dirname(HOST_API_RECORD_FILE)), { recursive: true });
  await writeFile(path.join(folder, HOST_API_RECORD_FILE), JSON.stringify({ version: options.api ?? HOST_API_VERSION, server: {}, web: {} }));
  for (const id of options.builtIns ?? ["ragents.orchestration"]) writeBundle(path.join(folder, "bundles", id));
  if (options.packageVersion) {
    await writeFile(path.join(folder, "package.json"), JSON.stringify({ name: "@schlenkr/ragents", version: options.packageVersion, ragents: { hostVersion: "f".repeat(40) } }));
  }
  return folder;
};

test("connect fetches profile file and bundles once, checks the version and removes old versions on request; the web app comes from the host", async (t) => {
  const { root, url, description, tokens, archiveRequests } = await fakeServer(t);
  const dataRoot = path.join(root, "data-root");
  const hostPath = await clientHost(root, "checkout");
  const first = await prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath });
  assert.equal(first.downloaded, true);
  assert.equal(first.profileFile, path.join(dataRoot, "remote", `127.0.0.1-${new URL(url).port}`, "workshop-client", "profiles", description.version, "ragents.config.workshop-client.ts"));
  assert.match(await readFile(first.profileFile, "utf8"), /PRODUCT_PROFILE: "workshop-client"/);
  assert.equal(existsSync(path.join(first.cacheDirectory, "plugins", "workshop.demo", "ragents-bundle.json")), true, "the bundle is ready in the cache");
  assert.equal(existsSync(path.join(first.cacheDirectory, "web")), false, "the version brings no web app");
  assert.equal(existsSync(first.dataDirectory), true);
  const current = JSON.parse(await readFile(path.join(path.dirname(path.dirname(first.cacheDirectory)), "current.json"), "utf8")) as Record<string, string>;
  assert.deepEqual(current, { serverUrl: url, profile: "workshop-client", version: description.version, profileFile: first.profileFile, dataDirectory: first.dataDirectory });
  assert.ok(tokens.every((token) => token === `Bearer ${testToken}`));
  const stale = path.join(path.dirname(first.cacheDirectory), "0".repeat(64));
  await mkdir(stale, { recursive: true });
  const second = await prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath, clean: true });
  assert.equal(second.downloaded, false);
  assert.equal(archiveRequests(), 1);
  assert.equal(existsSync(stale), false);
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: "wrong", dataRoot, hostPath }), /provides no client profile/);
});

test("a bundle in the archive whose files do not match its revision is not taken into the cache", async (t) => {
  const { root, url } = await fakeServer(t, { bundleRevision: "f".repeat(64) });
  const dataRoot = path.join(root, "data-root");
  const hostPath = await clientHost(root, "checkout");
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath }),
    /The bundle workshop\.demo in the server's archive does not have the files it was built with \(revision in plugins\/workshop\.demo\/ragents-bundle\.json\); rebuild it on the server/);
  assert.equal(existsSync(path.join(dataRoot, "remote", `127.0.0.1-${new URL(url).port}`, "workshop-client", "current.json")), false);
});

test("a link in the archive is not created, connect aborts with the cause", async (t) => {
  const { root, url } = await fakeServer(t, { symlink: true });
  const hostPath = await clientHost(root, "checkout");
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot: path.join(root, "data-root"), hostPath }),
    /The archive contains entries that are neither file nor folder: plugins\/workshop\.demo\/web-link \(SymbolicLink\)/);
});

test("connect accepts only version, profile and file that stay in the cache", async (t) => {
  const { root, url, description } = await fakeServer(t);
  const dataRoot = path.join(root, "data-root");
  const hostPath = await clientHost(root, "checkout");
  const original = { ...description };
  for (const [field, value] of [
    ["version", `../../${"a".repeat(58)}`],
    ["profile", "../workshop"],
    ["file", "../ragents.config.workshop-client.ts"],
    ["file", "plugins/foreign.ts"],
  ] as const) {
    Object.assign(description, original, { [field]: value });
    await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath }),
      new RegExp(`invalid client profile: ${field} `));
  }
  assert.equal(existsSync(path.join(dataRoot, "remote")), false, "an invalid profile creates nothing");
});

test("connect requires the same host API and the profile's built-in bundles and names the way to the server's version", async (t) => {
  const { root, url } = await fakeServer(t);
  const dataRoot = path.join(root, "data-root");
  const older = await clientHost(root, "old-checkout", { api: HOST_API_VERSION - 1 });
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath: older }),
    new RegExp(`for host API ${HOST_API_VERSION}, the host .* offers host API ${HOST_API_VERSION - 1}\\.\\nSwitch to the server's commit: git -C .* checkout 0123456789abcdef`, "s"));
  const packaged = await clientHost(root, "package", { api: HOST_API_VERSION + 1, packageVersion: "0.1.0" });
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath: packaged }),
    /offers host API \d+\.\nGet the server's version: npm install -g @schlenkr\/ragents@0\.2\.0 \(installed is 0\.1\.0\)/);
  const unbuilt = await clientHost(root, "unbuilt", { builtIns: [] });
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath: unbuilt }),
    /has no bundle: ragents\.orchestration\.\nIn the checkout, run pnpm build:plugins first/);
  assert.equal(existsSync(path.join(dataRoot, "remote")), false, "without a fitting host nothing is fetched");
});
