import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WORKSPACE_TOOL_TARGETS, workspaceToolsPackageName } from "../../packages/workspace-executor/src/bundled-tools.ts";
import { buildToolsPackage } from "./tools-package.ts";

test("each tools package selects its own OS and CPU and reuses the extension builders and layout", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-tools-package-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const target of WORKSPACE_TOOL_TARGETS) {
    const calls: string[] = [];
    const output = path.join(directory, target);
    await mkdir(output);
    await writeFile(path.join(output, "stale"), "old build");
    const result = await buildToolsPackage(target, "1.2.3", output, () => undefined, {
      ripgrep: async (requested, options) => {
        assert.equal(requested, target);
        assert.equal(options.output, path.join(output, "dist", "rg", target));
        calls.push("rg");
      },
      bash: async (requested, options) => {
        assert.equal(requested, target);
        assert.equal(options.output, path.join(output, "dist", "bash", target));
        calls.push("bash");
      },
    });
    const [os, cpu] = target.split("-");
    const manifest = JSON.parse(await readFile(path.join(output, "package.json"), "utf8")) as Record<string, unknown>;
    assert.deepEqual(result, { directory: output, name: workspaceToolsPackageName(target), version: "1.2.3" });
    assert.equal(manifest.name, workspaceToolsPackageName(target));
    assert.equal(manifest.version, "1.2.3");
    assert.deepEqual(manifest.os, [os]);
    assert.deepEqual(manifest.cpu, [cpu]);
    assert.deepEqual(manifest.files, ["dist"]);
    assert.deepEqual(manifest.publishConfig, { access: "public" });
    assert.equal(manifest.dependencies, undefined);
    assert.deepEqual(calls, os === "win32" ? ["rg", "bash"] : ["rg"]);
    assert.match(await readFile(path.join(output, "LICENSE"), "utf8"), new RegExp(`dist/rg/${target}/licenses/`));
    await assert.rejects(readFile(path.join(output, "stale")), { code: "ENOENT" });
  }
});
