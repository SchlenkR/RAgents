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

test("start takes a profile name or a path plus a port", () => {
  assert.deepEqual(parseArguments(["developer"]), { selection: "developer", port: undefined });
  assert.deepEqual(parseArguments(["./ragents.config.workshop.ts", "--port", "4733"]), { selection: "./ragents.config.workshop.ts", port: 4733 });
  assert.throws(() => parseArguments([]), /The profile name is missing/);
  assert.throws(() => parseArguments(["a", "b"]), /Unknown argument: b/);
  assert.throws(() => parseArguments(["a", "--port", "no"]), /needs an integer/);
});

test("a name finds the profile next to the host, a path finds your own profile anywhere on disk", async (t) => {
  const root = await temporary(t);
  for (const profile of PACKAGED_PROFILES) await writeFile(path.join(root, `ragents.config.${profile}.ts`), "export const config = {};\n");
  assert.deepEqual(localProfile("developer", root), { profile: "developer", profileFile: path.join(root, "ragents.config.developer.ts") });
  assert.equal(localProfile("workshop-client", root), undefined, "an unknown name comes from the cache, not from the host");

  const own = path.join(root, "workshop", "ragents.config.workshop.ts");
  await mkdir(path.dirname(own), { recursive: true });
  await writeFile(own, "export const config = {};\n");
  assert.deepEqual(localProfile(own, root), { profile: "workshop", profileFile: own });
  assert.deepEqual(localProfile("./workshop/ragents.config.workshop.ts", root, root), { profile: "workshop", profileFile: own });
});

test("a profile file that does not exist or is named differently says so at start", async (t) => {
  const root = await temporary(t);
  assert.throws(() => localProfile("./arbitrary.ts", root, root), /is named ragents\.config\.<profile>\.ts, not arbitrary\.ts/);
  assert.throws(() => localProfile("./ragents.config.doesnotexist.ts", root, root), /The profile file is missing/);
});

test("the fetched versions come from the data folder and are selected by their profile name", async (t) => {
  const dataRoot = await temporary(t);
  assert.deepEqual(await cachedProfiles(dataRoot), []);
  const folder = path.join(dataRoot, "remote", "ragents.example.com", "workshop-client");
  await mkdir(folder, { recursive: true });
  const cached = {
    serverUrl: "https://ragents.example.com",
    profile: "workshop-client",
    version: "abc",
    profileFile: path.join(folder, "profiles/abc/ragents.config.workshop-client.ts"),
    dataDirectory: path.join(folder, "data"),
  };
  await writeFile(path.join(folder, "current.json"), `${JSON.stringify(cached, null, 2)}\n`);
  assert.deepEqual(await cachedProfiles(dataRoot), [cached]);
  assert.deepEqual(selectCachedProfile([cached], "workshop-client"), cached);
  assert.throws(() => selectCachedProfile([cached], "core"), /is not in the cache.*workshop-client/s);
  assert.throws(() => selectCachedProfile([], "core"), /No profile has been fetched yet/);
});

test("start records the host in the profile's data folder; a port 0 cannot be recorded", async (t) => {
  const directory = await temporary(t);
  assert.equal(noteHost("workshop", directory, 0), undefined);
  noteHost("workshop", directory, 4711)!(4242);
  const noted = readHostRecord(directory)!;
  assert.equal(noted.profile, "workshop");
  assert.equal(noted.url, "http://localhost:4711");
  assert.equal(noted.pid, 4242);
  assert.equal(noted.log, path.join(directory, "logs", "server.log"));
});
