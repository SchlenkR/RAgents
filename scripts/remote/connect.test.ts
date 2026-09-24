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

/** Ein Archiv, wie es der Verteiler nie packt: mit einer Verknüpfung im Bundle, die auf eine fremde Datei zeigt. */
const packWithSymlink = async (folder: string): Promise<{ archive: Buffer; version: string }> => {
  await symlink("/etc/hosts", path.join(folder, "plugins", "werkstatt.demo", "web-link"));
  const chunks: Buffer[] = [];
  for await (const chunk of createTar({ gzip: true, cwd: folder, portable: true, noMtime: true }, ["ragents.config.werkstatt-client.ts", "plugins"])) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const archive = Buffer.concat(chunks);
  return { archive, version: createHash("sha256").update(archive).digest("hex") };
};

const fakeServer = async (t: TestContext, options: { bundleStand?: string; symlink?: boolean } = {}) => {
  const root = await mkdtemp(path.join(tmpdir(), "ragents-connect-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const serverBundles = path.join(root, "server-host", "bundles");
  writeBundle(path.join(serverBundles, "ragents.orchestration"));
  writeBundle(path.join(root, "server", "plugins", "werkstatt.demo"), options.bundleStand === undefined ? {} : { manifest: { stand: options.bundleStand } });
  const profileFile = path.join(root, "server", "ragents.config.werkstatt-client.ts");
  await writeFile(profileFile, `export const config = { host: { PRODUCT_PROFILE: "werkstatt-client", PLUGINS: ["ragents.orchestration", "./plugins/werkstatt.demo"] } };\n`);
  const packed = options.symlink ? await packWithSymlink(path.join(root, "server")) : await packClientProfile(await inspectClientProfile(profileFile, serverBundles));
  const description: ClientProfileDescription = {
    profile: "werkstatt-client", version: packed.version, hostApi: HOST_API_VERSION, hostVersion, packageVersion: "0.2.0", file: "ragents.config.werkstatt-client.ts",
    size: packed.archive.byteLength, archivePath: profileArchivePath(packed.version),
    plugins: [{ id: "ragents.orchestration", source: "host" }, { id: "werkstatt.demo", source: "archive" }],
  };
  const tokens: string[] = [];
  let archiveRequests = 0;
  const server = createServer(async (request, response) => {
    tokens.push(request.headers.authorization ?? "");
    if (request.headers.authorization !== `Bearer ${testToken}`) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Bitte melde dich an.", code: "login-required" }));
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
  if (!address || typeof address === "string") throw new Error("Kein Port");
  return { root, url: `http://127.0.0.1:${address.port}`, description, tokens, archiveRequests: () => archiveRequests };
};

test("Argumente, Serverordner und Ablage folgen festen Regeln", () => {
  assert.deepEqual(parseArguments(["https://werkstatt.example.com", "--clean", "--port", "0", "--no-start"]), { serverUrl: "https://werkstatt.example.com", port: 0, clean: true, start: false });
  assert.throws(() => parseArguments([]), /Serveradresse fehlt/);
  assert.throws(() => parseArguments(["http://a", "http://b"]), /Unbekanntes Argument/);
  assert.throws(() => parseArguments(["http://a", "--port", "x"]), /--port/);
  assert.equal(serverFolderName("https://werkstatt.example.com/"), "werkstatt.example.com");
  assert.equal(serverFolderName("http://localhost:4710"), "localhost-4710");
  assert.throws(() => serverFolderName("ftp://x"), /http oder https/);
  const layout = remoteLayout("/data", "https://werkstatt.example.com", "werkstatt-client");
  assert.equal(layout.profiles, path.join("/data", "remote", "werkstatt.example.com", "werkstatt-client", "profiles"));
  assert.equal(layout.data, path.join("/data", "remote", "werkstatt.example.com", "werkstatt-client", "data"));
});

/** Ein Host des Clients an beliebiger Stelle: seine Host-API, seine eingebauten Bundles und, als Paket, seine package.json. */
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

test("connect holt Profildatei und Bundles einmal, prüft den Stand und räumt alte Stände auf Wunsch weg; das Web kommt vom Host", async (t) => {
  const { root, url, description, tokens, archiveRequests } = await fakeServer(t);
  const dataRoot = path.join(root, "data-root");
  const hostPath = await clientHost(root, "checkout");
  const first = await prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath });
  assert.equal(first.downloaded, true);
  assert.equal(first.profileFile, path.join(dataRoot, "remote", `127.0.0.1-${new URL(url).port}`, "werkstatt-client", "profiles", description.version, "ragents.config.werkstatt-client.ts"));
  assert.match(await readFile(first.profileFile, "utf8"), /PRODUCT_PROFILE: "werkstatt-client"/);
  assert.equal(existsSync(path.join(first.cacheDirectory, "plugins", "werkstatt.demo", "ragents-bundle.json")), true, "das Bundle liegt fertig im Cache");
  assert.equal(existsSync(path.join(first.cacheDirectory, "web")), false, "der Stand bringt kein Web mit");
  assert.equal(existsSync(first.dataDirectory), true);
  const current = JSON.parse(await readFile(path.join(path.dirname(path.dirname(first.cacheDirectory)), "current.json"), "utf8")) as Record<string, string>;
  assert.deepEqual(current, { serverUrl: url, profile: "werkstatt-client", version: description.version, profileFile: first.profileFile, dataDirectory: first.dataDirectory });
  assert.ok(tokens.every((token) => token === `Bearer ${testToken}`));
  const stale = path.join(path.dirname(first.cacheDirectory), "0".repeat(64));
  await mkdir(stale, { recursive: true });
  const second = await prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath, clean: true });
  assert.equal(second.downloaded, false);
  assert.equal(archiveRequests(), 1);
  assert.equal(existsSync(stale), false);
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: "wrong", dataRoot, hostPath }), /liefert kein Client-Profil/);
});

test("ein Bundle im Archiv, dessen Dateien nicht zu seinem stand passen, wird nicht in den Cache übernommen", async (t) => {
  const { root, url } = await fakeServer(t, { bundleStand: "f".repeat(64) });
  const dataRoot = path.join(root, "data-root");
  const hostPath = await clientHost(root, "checkout");
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath }),
    /Das Bundle werkstatt\.demo im Archiv des Servers hat nicht die Dateien, mit denen es gebaut wurde \(stand in plugins\/werkstatt\.demo\/ragents-bundle\.json\); auf dem Server neu bauen/);
  assert.equal(existsSync(path.join(dataRoot, "remote", `127.0.0.1-${new URL(url).port}`, "werkstatt-client", "current.json")), false);
});

test("eine Verknüpfung im Archiv wird nicht angelegt, connect bricht mit Ursache ab", async (t) => {
  const { root, url } = await fakeServer(t, { symlink: true });
  const hostPath = await clientHost(root, "checkout");
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot: path.join(root, "data-root"), hostPath }),
    /Das Archiv enthält Einträge, die weder Datei noch Ordner sind: plugins\/werkstatt\.demo\/web-link \(SymbolicLink\)/);
});

test("connect nimmt nur Stand, Profil und Datei an, die im Cache bleiben", async (t) => {
  const { root, url, description } = await fakeServer(t);
  const dataRoot = path.join(root, "data-root");
  const hostPath = await clientHost(root, "checkout");
  const original = { ...description };
  for (const [field, value] of [
    ["version", `../../${"a".repeat(58)}`],
    ["profile", "../werkstatt"],
    ["file", "../ragents.config.werkstatt-client.ts"],
    ["file", "plugins/fremd.ts"],
  ] as const) {
    Object.assign(description, original, { [field]: value });
    await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath }),
      new RegExp(`ungültiges Client-Profil: ${field} `));
  }
  assert.equal(existsSync(path.join(dataRoot, "remote")), false, "ein ungültiges Profil legt nichts an");
});

test("connect verlangt dieselbe Host-API und die eingebauten Bundles des Profils und nennt den Weg zum Stand des Servers", async (t) => {
  const { root, url } = await fakeServer(t);
  const dataRoot = path.join(root, "data-root");
  const older = await clientHost(root, "alter-checkout", { api: HOST_API_VERSION - 1 });
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath: older }),
    new RegExp(`für Host-API ${HOST_API_VERSION}, der Host .* bietet Host-API ${HOST_API_VERSION - 1}\\.\\nWechsle auf den Commit des Servers: git -C .* checkout 0123456789abcdef`, "s"));
  const packaged = await clientHost(root, "paket", { api: HOST_API_VERSION + 1, packageVersion: "0.1.0" });
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath: packaged }),
    /bietet Host-API \d+\.\nHol die Fassung des Servers: npm install -g @schlenkr\/ragents@0\.2\.0 \(installiert ist 0\.1\.0\)/);
  const unbuilt = await clientHost(root, "ungebaut", { builtIns: [] });
  await assert.rejects(() => prepareProfile({ serverUrl: url, token: testToken, dataRoot, hostPath: unbuilt }),
    /kein Bundle hat: ragents\.orchestration\.\nIm Checkout zuerst pnpm build:plugins/);
  assert.equal(existsSync(path.join(dataRoot, "remote")), false, "ohne passenden Host wird nichts geholt");
});
