import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { assertDataDirectoryIsolated, defaultDataDirectory } from "../src/data-directory.ts";

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(path.join(process.platform === "darwin" ? "/private/tmp" : tmpdir(), "ragents-data-directory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
};

test("the default isolates profiles below the user data directory", () => {
  assert.equal(defaultDataDirectory("team"), path.join(homedir(), ".local/share/ragents/team"));
  assert.equal(defaultDataDirectory("core", "/test/user"), "/test/user/.local/share/ragents/core");
  for (const profile of ["", ".", "..", "../team", "core/other", "/team", "core\\other"]) {
    assert.throws(() => defaultDataDirectory(profile, "/test/user"), undefined, profile);
  }
});

test("an isolated directory and its nonexistent descendants are accepted without creating them", async (t) => {
  const directory = await fixture(t);
  await assertDataDirectoryIsolated(directory);
  const missing = path.join(directory, "profile", "sessions", "run");
  await assertDataDirectoryIsolated(missing);
  await assert.rejects(realpath(missing), { code: "ENOENT" });
});

test("project markers reject the data directory itself and nested nonexistent paths", async (t) => {
  for (const marker of [".git", "pnpm-workspace.yaml", "package.json"]) {
    const directory = await fixture(t);
    await writeFile(path.join(directory, marker), marker === ".git" ? "gitdir: /unused" : "{}");
    for (const target of [directory, path.join(directory, "uncreated", "runtime")]) {
      await assert.rejects(assertDataDirectoryIsolated(target), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(marker), error.message);
        return true;
      });
    }
  }
});

test("a Git directory also prevents project nesting", async (t) => {
  const directory = await fixture(t);
  await mkdir(path.join(directory, ".git"));
  await assert.rejects(assertDataDirectoryIsolated(path.join(directory, "runtime")), /\.git/);
});

test("an innocent-looking symlink into a project cannot bypass physical ancestor checks", async (t) => {
  const directory = await fixture(t);
  const project = path.join(directory, "project");
  await mkdir(path.join(project, "storage"), { recursive: true });
  await writeFile(path.join(project, "pnpm-workspace.yaml"), "packages: []\n");
  const alias = path.join(directory, "outside");
  await symlink(path.join(project, "storage"), alias);
  await assert.rejects(assertDataDirectoryIsolated(alias), /pnpm-workspace\.yaml/);
  await assert.rejects(assertDataDirectoryIsolated(path.join(alias, "missing", "profile")), /pnpm-workspace\.yaml/);
});

test("a project elsewhere in the same temporary parent does not reject isolated sibling data", async (t) => {
  const directory = await fixture(t);
  const project = path.join(directory, "project");
  await mkdir(project);
  await writeFile(path.join(project, "package.json"), "{}");
  await assertDataDirectoryIsolated(path.join(directory, "runtime", "team"));
});

test("filesystem failures and non-directory path segments are not mistaken for missing directories", async (t) => {
  const directory = await fixture(t);
  const file = path.join(directory, "file");
  await writeFile(file, "not a directory");
  await assert.rejects(assertDataDirectoryIsolated(file));
  await assert.rejects(assertDataDirectoryIsolated(path.join(file, "runtime")));
  const loop = path.join(directory, "loop");
  await symlink(loop, loop);
  await assert.rejects(assertDataDirectoryIsolated(path.join(loop, "runtime")));
});
