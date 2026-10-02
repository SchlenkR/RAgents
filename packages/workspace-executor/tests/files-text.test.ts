import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FILE_OPERATIONS,
  FILE_READ_LIMIT,
  WorkspaceOperationError,
  WorkspaceOperationExecutor,
  fileModule,
  workspaceProcessContext,
  type FileText,
} from "../src/index.ts";

const coded = (code: string, pattern?: RegExp) => (error: unknown): boolean =>
  error instanceof WorkspaceOperationError && error.code === code && (pattern === undefined || pattern.test(error.message));

const fixture = async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-files-text-")));
  const project = path.join(directory, "project");
  const actors = path.join(directory, "actors");
  const skills = path.join(directory, "skills", "notes");
  const outside = path.join(directory, "outside");
  await Promise.all([project, actors, skills, outside].map((folder) => mkdir(folder, { recursive: true })));
  await mkdir(path.join(project, "docs"));
  await writeFile(path.join(project, "docs", "guide.md"), "# Guide\n");
  await writeFile(path.join(actors, "notes.md"), "Actor notes\n");
  await writeFile(path.join(skills, "SKILL.md"), "Skill\n");
  await writeFile(path.join(outside, "secret.md"), "Secret\n");
  await writeFile(path.join(project, "large.txt"), "x".repeat(FILE_READ_LIMIT + 1));
  await writeFile(path.join(project, "binary.bin"), Buffer.from([1, 0, 2]));
  await symlink(path.join(outside, "secret.md"), path.join(project, "escape.md"));
  const executor = new WorkspaceOperationExecutor({
    contextFor: async (runId) => workspaceProcessContext({
      runId, cwd: project, root: project, home: { home: directory }, logDirectory: directory, hostRoot: undefined,
      additionalRoots: [{ directory: actors, alias: "@actors" }],
      readOnlyRoots: [{ directory: skills, alias: "@skills/notes" }],
    }),
    modules: [fileModule],
  });
  const text = (requested: string) => executor.execute("run-1", FILE_OPERATIONS.text, { path: requested }) as Promise<FileText>;
  return { directory, project, outside, executor, text };
};

test("files.text reads a whole file named like the file tools name it", async () => {
  const f = await fixture();
  try {
    for (const requested of ["docs/guide.md", "./docs/guide.md", path.join(f.project, "docs", "guide.md")]) {
      assert.deepEqual(await f.text(requested), { path: requested, size: 8, previewable: true, content: "# Guide\n" }, requested);
    }
    assert.equal((await f.text("@actors/notes.md") as { content: string }).content, "Actor notes\n");
    assert.equal((await f.text("@skills/notes/SKILL.md") as { content: string }).content, "Skill\n");
    assert.deepEqual(f.executor.footprintOf(FILE_OPERATIONS.text, { path: "@actors/notes.md" }), { roots: { aliases: ["@actors"], runRoot: false } });
    assert.deepEqual(f.executor.footprintOf(FILE_OPERATIONS.text, { path: "docs/guide.md" }), { roots: { aliases: [], runRoot: true } });
  } finally {
    await f.executor.shutdown();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("files.text keeps the roots of the run and names why a file is not shown", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.text(path.join(f.outside, "secret.md")), coded("workspace-path-invalid", /Path outside the working directory/));
    await assert.rejects(f.text("../outside/secret.md"), coded("workspace-path-invalid"));
    await assert.rejects(f.text("escape.md"), coded("workspace-path-invalid"));
    await assert.rejects(f.text("docs/missing.md"), coded("workspace-path-not-found", /docs\/missing\.md/));
    await assert.rejects(f.text("docs"), coded("workspace-path-invalid", /Not a file/));
    await assert.rejects(f.text("@unknown/file.md"), coded("workspace-alias-unknown"));
    await assert.rejects(f.text(""), coded("workspace-path-invalid"));
    assert.deepEqual(await f.text("large.txt"), { path: "large.txt", size: FILE_READ_LIMIT + 1, previewable: false, reason: `The file is larger than ${FILE_READ_LIMIT / 1024} KB and is not read` });
    assert.deepEqual(await f.text("binary.bin"), { path: "binary.bin", size: 3, previewable: false, reason: "The file is binary" });
  } finally {
    await f.executor.shutdown();
    await rm(f.directory, { recursive: true, force: true });
  }
});
