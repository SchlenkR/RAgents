import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BYTE_OPERATIONS,
  FILE_BYTES_LIMIT,
  FILE_COUNT_LIMIT,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  sandboxToolsModule,
  workspaceProcessContext,
  type FileBytes,
} from "../src/index.ts";

const coded = (code: string, pattern?: RegExp) => (error: unknown): boolean =>
  error instanceof WorkspaceOperationError && error.code === code && (pattern === undefined || pattern.test(error.message));

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

const fixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-bytes-")));
  const project = path.join(directory, "project");
  const documents = path.join(directory, "documents");
  const skills = path.join(directory, "skills", "notes");
  const outside = path.join(directory, "outside");
  await Promise.all([project, documents, skills, outside].map((folder) => mkdir(folder, { recursive: true })));
  await mkdir(path.join(project, "shots", "empty"), { recursive: true });
  await writeFile(path.join(project, "shots", "home.png"), png);
  await writeFile(path.join(project, "shots", "notes.md"), "# Notes\n");
  await writeFile(path.join(skills, "SKILL.md"), "Skill\n");
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => workspaceProcessContext({
      runId, cwd: project, root: project, home: { home: directory }, logDirectory: directory, hostRoot: undefined,
      additionalRoots: [{ directory: documents, alias: "@documents" }],
      readOnlyRoots: [{ directory: skills, alias: "@skills/notes" }],
    }),
    modules: [sandboxToolsModule],
  });
  const read = (requested: string, recursive = false) =>
    executor.execute("run-1", BYTE_OPERATIONS.read, { path: requested, ...(recursive ? { recursive } : {}) }) as Promise<FileBytes>;
  const write = (requested: string, content: FileBytes) => executor.execute("run-1", BYTE_OPERATIONS.write, { path: requested, content });
  return {
    directory, project, documents, outside, executor, read, write,
    close: async () => {
      await executor.shutdown();
      await rm(directory, { recursive: true, force: true });
    },
  };
};

test("bytes.read and bytes.write carry a binary file between the roots, routed by the alias of their path", async () => {
  const f = await fixture();
  try {
    const shot = await f.read("shots/home.png");
    assert.deepEqual(shot, { kind: "file", content: png.toString("base64") });
    assert.deepEqual(await f.read(path.join(f.project, "shots", "home.png")), shot);
    await f.write("@documents/report/home.png", shot);
    assert.deepEqual(await readFile(path.join(f.documents, "report", "home.png")), png);
    assert.deepEqual(await f.read("@documents/report/home.png"), shot);
    assert.equal(Buffer.from((await f.read("@skills/notes/SKILL.md") as { content: string }).content, "base64").toString(), "Skill\n");
    assert.deepEqual(f.executor.footprintOf(BYTE_OPERATIONS.read, { path: "@documents/report/home.png" }), { roots: { aliases: ["@documents"], runRoot: false } });
    assert.deepEqual(f.executor.footprintOf(BYTE_OPERATIONS.write, { path: "shots/copy.png" }), { roots: { aliases: [], runRoot: true } });
  } finally { await f.close(); }
});

test("a folder is read only on request and written with everything in it, existing files are overwritten", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.read("shots"), coded("workspace-path-invalid", /shots is a folder, not a file/));
    const folder = await f.read("shots", true);
    assert.deepEqual(folder, {
      kind: "directory",
      directories: ["empty"],
      files: [{ path: "home.png", content: png.toString("base64") }, { path: "notes.md", content: Buffer.from("# Notes\n").toString("base64") }],
    });
    await mkdir(path.join(f.documents, "evidence"));
    await writeFile(path.join(f.documents, "evidence", "notes.md"), "old\n");
    await f.write("@documents/evidence", folder);
    assert.equal(await readFile(path.join(f.documents, "evidence", "notes.md"), "utf8"), "# Notes\n");
    assert.deepEqual(await readFile(path.join(f.documents, "evidence", "home.png")), png);
    assert.deepEqual(await f.read("@documents/evidence", true), folder);
    await assert.rejects(f.write("@documents/evidence", { kind: "file", content: "" }), coded("workspace-path-invalid", /evidence is a folder; name the file to create/));
    await assert.rejects(f.write("shots/notes.md", folder), coded("workspace-path-invalid", /notes\.md is a file; name the folder to create/));
  } finally { await f.close(); }
});

test("byte paths stay in the roots: no read-only destination, no link out, no path out of a folder", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.write("@skills/notes/new.md", { kind: "file", content: "" }), coded("workspace-path-invalid", /outside the working directory: @skills\/notes\/new\.md/));
    await assert.rejects(f.read(path.join(f.outside, "secret.md")), coded("workspace-path-invalid", /outside the working directory/));
    await assert.rejects(f.read("missing.png"), coded("workspace-path-not-found", /Not found: missing\.png/));
    await assert.rejects(f.read("@apps/list.ts"), coded("workspace-alias-unknown"));
    await symlink(f.outside, path.join(f.project, "shots", "escape"));
    await assert.rejects(f.read("shots", true), coded("workspace-path-invalid", /shots\/escape is a symbolic link/));
    await symlink(f.outside, path.join(f.documents, "linked"));
    await assert.rejects(f.write("@documents", { kind: "directory", directories: [], files: [{ path: "linked/file.md", content: "" }] }),
      coded("workspace-path-invalid", /outside the working directory: @documents\/linked\/file\.md/));
    await assert.rejects(f.write("@documents/x", { kind: "directory", directories: [], files: [{ path: "../escape.md", content: "" }] }),
      coded("workspace-path-invalid", /Invalid path/));
  } finally { await f.close(); }
});

test("one call carries at most 16 MiB and 1000 files, and the error names the limit", async () => {
  const f = await fixture();
  try {
    assert.equal(FILE_BYTES_LIMIT, 16 * 1024 * 1024);
    await writeFile(path.join(f.project, "large.bin"), "");
    await truncate(path.join(f.project, "large.bin"), FILE_BYTES_LIMIT + 1);
    await assert.rejects(f.read("large.bin"), coded("workspace-file-too-large", /large\.bin is larger than 16 MiB; one call carries at most 16 MiB and 1000 files/));
    await mkdir(path.join(f.project, "many"));
    await Promise.all(Array.from({ length: FILE_COUNT_LIMIT + 1 }, (_, index) => writeFile(path.join(f.project, "many", `${index}.txt`), "")));
    await assert.rejects(f.read("many", true), coded("workspace-file-too-large", /The folder many is too large for one call; one call carries at most 16 MiB and 1000 files/));
    const oversized = Buffer.alloc(FILE_BYTES_LIMIT + 1).toString("base64");
    await assert.rejects(f.write("@documents/large.bin", { kind: "file", content: oversized }), coded("workspace-file-too-large", /16 MiB/));
  } finally { await f.close(); }
});

test("writing bytes waits for a running bash of the run like write does", async () => {
  const f = await fixture();
  try {
    const bash = f.executor.execute("run-1", "bash", { command: "sleep 0.3; printf bash > order.txt", timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await f.write("order.txt", { kind: "file", content: Buffer.from("bytes").toString("base64") });
    await bash;
    assert.equal(await readFile(path.join(f.project, "order.txt"), "utf8"), "bytes");
  } finally { await f.close(); }
});
