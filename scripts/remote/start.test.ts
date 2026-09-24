import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

process.env.PRODUCT_PROFILE = "core";
process.env.PRODUCT_ID = "ragents";
process.env.PRODUCT_TITLE = "RAgents";
const { cachedProfiles, parseArguments, selectCachedProfile } = await import("./start.ts");
const { noteHost } = await import("./connect.ts");
const { localProfile } = await import("../../apps/server/src/profile-target.ts");
const { readHostRecord } = await import("../../apps/server/src/host-record.ts");
const { PACKAGED_PROFILES } = await import("../package/build-package.ts");

const temporary = async (t: TestContext): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-start-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

test("start nimmt einen Profilnamen oder einen Pfad und dazu einen Port", () => {
  assert.deepEqual(parseArguments(["developer"]), { selection: "developer", port: undefined });
  assert.deepEqual(parseArguments(["./ragents.config.workshop.ts", "--port", "4733"]), { selection: "./ragents.config.workshop.ts", port: 4733 });
  assert.throws(() => parseArguments([]), /Der Profilname fehlt/);
  assert.throws(() => parseArguments(["a", "b"]), /Unbekanntes Argument: b/);
  assert.throws(() => parseArguments(["a", "--port", "nein"]), /braucht eine ganze Zahl/);
});

test("ein Name findet das Profil neben dem Host, ein Pfad das eigene Profil irgendwo auf der Platte", async (t) => {
  const root = await temporary(t);
  for (const profile of PACKAGED_PROFILES) await writeFile(path.join(root, `ragents.config.${profile}.ts`), "export const config = {};\n");
  assert.deepEqual(localProfile("developer", root), { profile: "developer", profileFile: path.join(root, "ragents.config.developer.ts") });
  assert.equal(localProfile("werkstatt-client", root), undefined, "ein unbekannter Name kommt aus dem Cache, nicht vom Host");

  const eigen = path.join(root, "workshop", "ragents.config.workshop.ts");
  await mkdir(path.dirname(eigen), { recursive: true });
  await writeFile(eigen, "export const config = {};\n");
  assert.deepEqual(localProfile(eigen, root), { profile: "workshop", profileFile: eigen });
  assert.deepEqual(localProfile("./workshop/ragents.config.workshop.ts", root, root), { profile: "workshop", profileFile: eigen });
});

test("eine Profildatei, die es nicht gibt oder die anders heißt, sagt das beim Start", async (t) => {
  const root = await temporary(t);
  assert.throws(() => localProfile("./beliebig.ts", root, root), /heißt ragents\.config\.<profil>\.ts, nicht beliebig\.ts/);
  assert.throws(() => localProfile("./ragents.config.gibtesnicht.ts", root, root), /Die Profildatei fehlt/);
});

test("die geholten Stände kommen aus dem Datenordner und werden über ihren Profilnamen gewählt", async (t) => {
  const dataRoot = await temporary(t);
  assert.deepEqual(await cachedProfiles(dataRoot), []);
  const folder = path.join(dataRoot, "remote", "ragents.example.com", "werkstatt-client");
  await mkdir(folder, { recursive: true });
  const cached = {
    serverUrl: "https://ragents.example.com",
    profile: "werkstatt-client",
    version: "abc",
    profileFile: path.join(folder, "profiles/abc/ragents.config.werkstatt-client.ts"),
    dataDirectory: path.join(folder, "data"),
  };
  await writeFile(path.join(folder, "current.json"), `${JSON.stringify(cached, null, 2)}\n`);
  assert.deepEqual(await cachedProfiles(dataRoot), [cached]);
  assert.deepEqual(selectCachedProfile([cached], "werkstatt-client"), cached);
  assert.throws(() => selectCachedProfile([cached], "core"), /liegt nicht im Cache.*werkstatt-client/s);
  assert.throws(() => selectCachedProfile([], "core"), /noch kein Profil geholt/);
});

test("start merkt den Host im Datenordner des Profils; ein Port 0 lässt sich nicht merken", async (t) => {
  const directory = await temporary(t);
  assert.equal(noteHost("workshop", directory, 0), undefined);
  noteHost("workshop", directory, 4711)!(4242);
  const noted = readHostRecord(directory)!;
  assert.equal(noted.profile, "workshop");
  assert.equal(noted.url, "http://localhost:4711");
  assert.equal(noted.pid, 4242);
  assert.equal(noted.log, path.join(directory, "logs", "server.log"));
});
