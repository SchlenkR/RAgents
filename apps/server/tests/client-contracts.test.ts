import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { clientUiContractPaths, readClientUiComponentContracts, readClientUiComponentNames, readClientUiContractFiles } from "../src/plugin-support/actor-programs/client-contracts.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

for (const [platform, paths, directory] of [
  ["POSIX", path.posix, "/opt/node_modules/@example/host/"],
  ["Windows", path.win32, "c:\\tools\\node_modules\\@example\\host\\"],
] as const) {
  test(`${platform} UI paths map normalized compiler names and preserve source boundaries`, () => {
    const mapping = clientUiContractPaths(directory, paths);
    const physicalRoot = paths.resolve(directory).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
    const file = `${mapping.root}/apps/web/src/ui/index.ts`;
    const native = paths.join(physicalRoot, "apps/web/src/ui/index.ts");
    assert.equal(mapping.physical(file), native);
    assert.equal(mapping.physical(paths.normalize(file)), native);
    assert.equal(mapping.virtual(native), file);
    assert.equal(mapping.virtual(native.replaceAll(paths.sep, "/")), file);
    assert.equal(mapping.physical(`${mapping.root}/apps/../apps/web/src/ui/index.ts`), native);
    assert.equal(mapping.virtual(physicalRoot), mapping.root);
    assert.equal(mapping.physical(mapping.root), physicalRoot);
    assert.equal(mapping.isVirtual(file), true);
    assert.equal(mapping.isVirtual(`${mapping.root}-other/index.ts`), false);
    assert.equal(mapping.isVirtual(`${mapping.root}/../outside.ts`), false);
    const sibling = paths.normalize(`${physicalRoot}-other/index.ts`);
    assert.equal(mapping.virtual(sibling), sibling.replaceAll(paths.sep, "/"));
    assert.equal(mapping.physical(sibling), sibling);
    if (platform === "Windows") {
      assert.equal(mapping.physical(file.replace(/^C:/, "c:")), native);
      assert.equal(mapping.virtual(native.replace(/^C:/, "c:")), file);
      assert.equal(mapping.isVirtual(file.replace(/^C:/, "c:")), true);
      assert.equal(mapping.isVirtual(file.replace(/^C:/, "D:")), false);
      assert.equal(mapping.physical("d:/outside.ts"), "D:\\outside.ts");
    }
  });
}

for (const layout of ["hoisted", "nested", "linked"]) {
  test(`an installed host with ${layout} dependencies exposes the same UI components and declarations as the checkout`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ragents-installed-ui-"));
    const installed = path.join(directory, "node_modules/@example/host");
    const sources = layout === "linked" ? path.join(directory, "node_modules/.pnpm/host/node_modules/@example/host") : installed;
    try {
      for (const folder of ["apps/web/src", "apps/web/package.json", "apps/server/src/plugin-support/actor-programs/workflow"]) {
        await cp(path.join(root, folder), path.join(sources, folder), { recursive: true });
      }
      if (layout === "linked") {
        await mkdir(path.dirname(installed), { recursive: true });
        await symlink(sources, installed, "junction");
      }
      for (const folder of ["node_modules", "apps/web/node_modules"]) {
        const source = path.join(root, folder);
        const names = (await Promise.all((await readdir(source)).filter((name) => !name.startsWith(".")).map(async (name) =>
          name.startsWith("@") ? (await readdir(path.join(source, name))).map((entry) => `${name}/${entry}`) : [name]))).flat();
        for (const name of names) {
          const target = path.join(layout === "hoisted" ? directory : sources, "node_modules", name);
          await mkdir(path.dirname(target), { recursive: true });
          await symlink(path.join(source, name), target, "junction").catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
          });
        }
      }
      const names = readClientUiComponentNames();
      const files = readClientUiContractFiles();
      assert.ok(names.includes("Button"));
      assert.ok(files["apps/web/src/ui/index.d.ts"]);
      assert.deepEqual(readClientUiComponentNames(installed), names);
      assert.deepEqual(readClientUiContractFiles(installed), files);
      assert.deepEqual(readClientUiComponentContracts("Button", installed), readClientUiComponentContracts("Button"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

for (const dependency of ["../outside.d.ts", "node_modules/dependency/index.d.ts"]) {
  test(`UI type references cannot leave public sources through ${dependency}`, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ragents-ui-boundary-"));
    const installed = path.join(directory, "node_modules/@example/host");
    const entry = path.join(installed, "apps/web/src/actor-programs/client-ui/contracts.d.ts");
    const target = path.resolve(installed, dependency);
    try {
      await mkdir(path.dirname(entry), { recursive: true });
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "export interface Props { label: string }");
      const reference = path.relative(path.dirname(entry), target).replaceAll(path.sep, "/");
      await writeFile(entry, `import type { Props } from "${reference}"; export declare function Widget(props: Props): string;`);
      assert.throws(() => readClientUiContractFiles(installed), /A local UI type reference leaves the public repository sources/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
