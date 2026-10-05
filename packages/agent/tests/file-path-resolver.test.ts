import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createEditToolDefinition, createReadToolDefinition, createWriteToolDefinition, resolveReadPathAsync, resolveToCwd } from "../src/index.ts";

test("a supplied file resolver selects the exact path without another normalization", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-file-resolver-"));
  try {
    const exact = path.join(directory, "exact\u00A0name.txt");
    const normalized = path.join(directory, "exact name.txt");
    await writeFile(exact, "Original file");
    await writeFile(normalized, "Other file");
    const resolved: string[] = [];
    const resolvePath = async (file: string, cwd: string) => {
      assert.equal(cwd, directory);
      resolved.push(file);
      return exact;
    };
    const read = createReadToolDefinition(directory, { resolvePath });
    assert.equal((await read.execute("read", { file_path: "selected" })).content[0]?.text, "1\tOriginal file");
    await createEditToolDefinition(directory, { resolvePath }).execute("edit", {
      file_path: "selected", old_string: "Original", new_string: "Edited",
    });
    assert.equal(await readFile(exact, "utf8"), "Edited file");
    await createWriteToolDefinition(directory, { resolvePath }).execute("write", { file_path: "selected", content: "Written file" });
    assert.equal(await readFile(exact, "utf8"), "Written file");
    assert.equal(await readFile(normalized, "utf8"), "Other file");
    assert.deepEqual(resolved, ["selected", "selected", "selected"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the shared resolvers preserve URI, tilde, at-prefix, Unicode spaces and read variants", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-shared-path-"));
  try {
    const file = path.join(directory, "spaced name.txt");
    await writeFile(file, "Fixture");
    const requests = [
      pathToFileURL(file).href,
      `~/${path.relative(homedir(), file).split(path.sep).join("/")}`,
      `@${file}`,
      path.join(directory, "spaced\u00A0name.txt"),
    ];
    for (const requested of requests) {
      assert.equal(resolveToCwd(requested, directory), file);
      assert.equal(await resolveReadPathAsync(requested, directory), file);
    }
    const screenshot = path.join(directory, "Screenshot 10\u202FAM.txt");
    await writeFile(screenshot, "Screenshot fixture");
    assert.equal(await resolveReadPathAsync("Screenshot 10 AM.txt", directory), screenshot);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
