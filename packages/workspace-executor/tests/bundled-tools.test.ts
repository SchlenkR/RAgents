import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveBundledTools, WORKSPACE_TOOL_TARGETS, workspaceToolsPackageName } from "../src/bundled-tools.ts";

for (const target of WORKSPACE_TOOL_TARGETS) {
  const [platform, arch] = target.split("-") as [NodeJS.Platform, string];
  for (const distribution of ["extension", "package"] as const) {
    test(`${distribution} resolves the same bundled tools on ${target}`, () => {
      const paths = platform === "win32" ? path.win32 : path.posix;
      const root = platform === "win32" ? "C:\\tools" : "/tools";
      const found = resolveBundledTools({
        root, platform, arch, distribution, paths, exists: () => true,
        resolvePackage: (specifier) => {
          assert.equal(specifier, `${workspaceToolsPackageName(target)}/package.json`);
          return paths.join(root, "package.json");
        },
      });
      assert.equal(found.rg, paths.join(root, "dist", "rg", target, platform === "win32" ? "rg.exe" : "rg"));
      assert.equal(found.bash, platform === "win32" ? paths.join(root, "dist", "bash", target, "usr", "bin", "bash.exe") : undefined);
    });
  }
}

test("missing optional packages, binaries, and unsupported npm targets fail explicitly", () => {
  const options = { root: "/tools", platform: "linux" as const, arch: "x64", distribution: "package" as const };
  assert.throws(() => resolveBundledTools({ ...options, resolvePackage: () => { throw new Error("MODULE_NOT_FOUND"); } }), /optional dependencies enabled/);
  assert.throws(() => resolveBundledTools({ ...options, resolvePackage: () => "/tools/package.json", exists: () => false }), /tool is missing/);
  assert.throws(() => resolveBundledTools({ ...options, arch: "riscv64" }), /Unsupported workstation platform/);
});

test("the universal extension keeps its existing system-tool behavior", () => {
  assert.deepEqual(resolveBundledTools({ root: "/extension", distribution: "extension", platform: "darwin", arch: "arm64", exists: () => false }), { bash: undefined, rg: undefined });
});
