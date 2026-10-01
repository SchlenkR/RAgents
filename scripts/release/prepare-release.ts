import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPackage } from "../package/build-package.ts";
import { buildToolsPackages } from "../package/tools-package.ts";
import { packageManagerInvocation } from "./package-manager.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

const npm = (args: string[], cwd: string): string => {
  const invocation = packageManagerInvocation("npm", args);
  const result = spawnSync(invocation.command, [...invocation.args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args[0]} failed with exit code ${result.status}`);
  return result.stdout;
};

const main = async (): Promise<void> => {
  if (process.argv.length > 3) throw new Error("Usage: prepare-release.ts [output-directory]");
  const output = path.resolve(process.argv[2] ?? path.join(root, "dist/release-input"));
  const publishOutput = path.join(root, "dist/release-publish");
  const temporary = await mkdtemp(path.join(tmpdir(), "ragents-release-tools-"));
  try {
    await mkdir(output, { recursive: true });
    await rm(publishOutput, { recursive: true, force: true });
    await mkdir(publishOutput, { recursive: true });
    const built = await buildPackage(path.join(output, "app"));
    const packages: { name: string; version: string; filename: string; integrity: string }[] = [];
    const packedHost = JSON.parse(npm(["pack", "--json", "--pack-destination", publishOutput], built.directory)) as typeof packages;
    const toolsDirectory = path.join(output, "tools");
    await mkdir(toolsDirectory, { recursive: true });
    const tools = await buildToolsPackages(built.manifest.version as string, temporary, undefined, console.log);
    const optionalDependencies: Record<string, string> = {};
    for (const tool of tools) {
      const packed = JSON.parse(npm(["pack", "--json", "--pack-destination", toolsDirectory], tool.directory)) as typeof packages;
      await copyFile(path.join(toolsDirectory, packed[0]!.filename), path.join(publishOutput, packed[0]!.filename));
      packages.push(packed[0]!);
      const file = `${path.basename(tool.directory)}.tgz`;
      await rename(path.join(toolsDirectory, packed[0]!.filename), path.join(toolsDirectory, file));
      optionalDependencies[tool.name] = `file:../tools/${file}`;
    }
    packages.push(packedHost[0]!);
    await writeFile(path.join(publishOutput, "npm-packages.json"), `${JSON.stringify(packages.map(({ name, version, filename, integrity }) => ({ name, version, filename, integrity })), null, 2)}\n`);
    await writeFile(path.join(built.directory, "package.json"), `${JSON.stringify({ ...built.manifest, optionalDependencies }, null, 2)}\n`);
    npm(["install", "--package-lock-only", "--ignore-scripts", "--include=optional", "--no-audit", "--no-fund"], built.directory);
    console.log(`Release input for ${built.manifest.version} ready in ${output}`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
