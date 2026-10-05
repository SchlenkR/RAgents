import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createSandboxTools, workspaceProcessContext, type SeenFile } from "../src/index.ts";

type Result = { content: Array<{ text?: string }>; details?: { seen?: SeenFile; contentHash?: string } };

const textOf = (result: Result): string => result.content.map((part) => part.text ?? "").join("\n");
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");

const fixture = async (annotate?: (file: string) => Promise<string | undefined>) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-file-boundary-")));
  const root = path.join(directory, "workspace");
  const outside = path.join(directory, "outside");
  const additional = path.join(directory, "additional");
  const readOnly = path.join(directory, "read-only");
  await Promise.all([root, outside, additional, readOnly].map((folder) => mkdir(folder)));
  const sandbox = await createSandboxTools("test", async () => workspaceProcessContext({
    runId: "test", cwd: root, root, home: { home: root }, logDirectory: root, hostRoot: undefined,
    additionalRoots: [{ directory: additional, alias: "@extra", environmentVariable: "RAGENTS_EXTRA_DIR" }],
    readOnlyRoots: [{ directory: readOnly, alias: "@reference" }],
  }), annotate);
  const call = (name: "read" | "write" | "edit", input: Record<string, unknown>): Promise<Result> =>
    sandbox.tools.get(name)!(input, { toolCallId: name }) as Promise<Result>;
  return {
    directory, root, outside, additional, readOnly, call,
    close: async () => { await sandbox.shutdown(); await rm(directory, { recursive: true, force: true }); },
  };
};

test("file tools reject outside paths after URI, tilde, variable and Unicode normalization", async () => {
  const f = await fixture();
  try {
    const foreign = path.join(f.outside, "private.txt");
    await writeFile(foreign, "Original fixture");
    const tilde = `~/${path.relative(homedir(), foreign).split(path.sep).join("/")}`;
    const requests = [
      foreign,
      pathToFileURL(foreign).href,
      tilde,
      "../outside/private.txt",
      "$RAGENTS_EXTRA_DIR/../outside/private.txt",
      "${RAGENTS_EXTRA_DIR}/../outside/private.txt",
      "@extra/../outside/private.txt",
      `@${foreign}`,
    ];
    for (const file_path of requests) {
      await assert.rejects(f.call("read", { file_path, seen: null }), /outside|alias/);
      await assert.rejects(f.call("write", { file_path, content: "Changed", seen: null }), /outside|alias/);
      await assert.rejects(f.call("edit", { file_path, old_string: "Original", new_string: "Changed", seen: null }), /outside|alias/);
      assert.equal(await readFile(foreign, "utf8"), "Original fixture");
    }
    await writeFile(path.join(f.outside, "spaced name.txt"), "Space fixture");
    for (const name of ["read", "write", "edit"] as const) {
      await assert.rejects(f.call(name, {
        file_path: "../outside/spaced\u00A0name.txt", content: "Changed", old_string: "Space", new_string: "Changed",
      }), /outside/);
    }
    assert.equal(await readFile(path.join(f.outside, "spaced name.txt"), "utf8"), "Space fixture");
  } finally { await f.close(); }
});

test("equivalent allowed paths share the canonical seen state, hashes and annotations", async () => {
  const annotations: string[] = [];
  const f = await fixture(async (file) => { annotations.push(file); return "Saved fixture"; });
  try {
    const file = path.join(f.additional, "spaced name.txt");
    await writeFile(file, "Initial content");
    const initial = await f.call("read", { file_path: "@extra/spaced\u00A0name.txt", seen: null });
    assert.deepEqual(initial.details?.seen, { file, hash: hash("Initial content"), read: {} });
    const repeated = await f.call("read", { file_path: pathToFileURL(file).href, seen: initial.details?.seen });
    assert.match(textOf(repeated), /^File unchanged/);
    const edited = await f.call("edit", {
      file_path: "$RAGENTS_EXTRA_DIR/spaced name.txt", old_string: "Initial", new_string: "Edited", seen: initial.details?.seen,
    });
    assert.equal(await readFile(file, "utf8"), "Edited content");
    assert.deepEqual(edited.details?.seen, { file, hash: hash("Edited content") });
    const written = await f.call("write", {
      file_path: pathToFileURL(file).href, content: "Written content", seen: edited.details?.seen,
    });
    assert.equal(await readFile(file, "utf8"), "Written content");
    assert.deepEqual(written.details?.seen, { file, hash: hash("Written content") });
    assert.deepEqual(annotations, [file, file]);
    assert.match(textOf(written), new RegExp(pathToFileURL(file).href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally { await f.close(); }
});

test("read filename variants are checked and recorded as the file actually read", async () => {
  const f = await fixture();
  try {
    const names = [
      { requested: "Screenshot 10 AM.txt", actual: "Screenshot 10\u202FAM.txt" },
      { requested: "Capture d'écran.txt", actual: "Capture d\u2019écran.txt" },
      { requested: "résumé.txt", actual: "résumé.txt".normalize("NFD") },
    ];
    for (const { requested, actual } of names) {
      const file = path.join(f.root, actual);
      await writeFile(file, "Variant content");
      const result = await f.call("read", { file_path: requested, seen: null });
      assert.match(textOf(result), /Variant content/);
      assert.deepEqual(result.details?.seen, { file: await realpath(file), hash: hash("Variant content"), read: {} });
      assert.match(textOf(await f.call("read", { file_path: requested, seen: result.details?.seen })), /^File unchanged/);
    }
    const target = path.join(f.outside, "External d\u2019écran.txt");
    await writeFile(target, "Outside variant");
    await symlink(target, path.join(f.root, "External d\u2019écran.txt"));
    await assert.rejects(f.call("read", { file_path: "External d'écran.txt", seen: null }), /outside/);
  } finally { await f.close(); }
});

test("symlinks preserve the exact checked path and cannot bypass writable or read-only roots", async () => {
  const annotations: string[] = [];
  const f = await fixture(async (file) => { annotations.push(file); return undefined; });
  try {
    const exact = path.join(f.additional, "exact\u00A0name.txt");
    const other = path.join(f.additional, "exact name.txt");
    await writeFile(exact, "Exact file");
    await writeFile(other, "Other file");
    await symlink(exact, path.join(f.root, "alias.txt"));
    const seen = (await f.call("read", { file_path: "alias.txt", seen: null })).details?.seen;
    assert.deepEqual(seen, { file: await realpath(exact), hash: hash("Exact file"), read: {} });
    const edit = await f.call("edit", { file_path: "alias.txt", old_string: "Exact", new_string: "Edited", seen });
    await f.call("write", { file_path: "alias.txt", content: "Written exact file", seen: edit.details?.seen });
    assert.equal(await readFile(exact, "utf8"), "Written exact file");
    assert.equal(await readFile(other, "utf8"), "Other file");
    assert.deepEqual(annotations, [await realpath(exact), await realpath(exact)]);

    const foreign = path.join(f.outside, "target.txt");
    const reference = path.join(f.readOnly, "reference.txt");
    await writeFile(foreign, "Foreign fixture");
    await writeFile(reference, "Reference fixture");
    await symlink(foreign, path.join(f.root, "escape.txt"));
    await symlink(path.join(f.outside, "missing"), path.join(f.root, "dangling"));
    await symlink(reference, path.join(f.root, "reference-link.txt"));
    const referenceSeen = (await f.call("read", { file_path: "reference-link.txt", seen: null })).details?.seen;
    assert.equal(referenceSeen?.file, reference);
    for (const file_path of ["escape.txt", "dangling/new.txt", "reference-link.txt", "@reference/reference.txt"]) {
      await assert.rejects(f.call("write", { file_path, content: "Changed" }), /outside/);
      await assert.rejects(f.call("edit", { file_path, old_string: "fixture", new_string: "Changed" }), /outside/);
    }
    await assert.rejects(f.call("read", { file_path: "escape.txt" }), /outside/);
    assert.equal(await readFile(foreign, "utf8"), "Foreign fixture");
    assert.equal(await readFile(reference, "utf8"), "Reference fixture");
  } finally { await f.close(); }
});
