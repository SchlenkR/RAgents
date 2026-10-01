import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const nodeRuntime = JSON.parse(await readFile(new URL("node-runtime.json", import.meta.url), "utf8"));

export const archiveName = (version, target) => {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid release version: ${version}`);
  if (!Object.hasOwn(nodeRuntime.sha256, target)) throw new Error(`Unsupported platform: ${target}`);
  return `ragents-${version}-${target}.${target.startsWith("win32-") ? "zip" : "tar.gz"}`;
};

export const run = (file, args, options = {}) => {
  const result = spawnSync(file, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(file)} failed with exit code ${result.status}`);
};

export const launcher = (windows, target = `${process.platform}-${process.arch}`) => windows
  ? `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "PATH=%~dp0..\\runtime;%~dp0..\\app\\node_modules\\@schlenkr\\ragents-tools-${target}\\dist\\rg\\${target};%PATH%"\r\n"%~dp0..\\runtime\\node.exe" "%~dp0..\\app\\scripts\\package\\ragents.mjs" %*\r\nexit /b %errorlevel%\r\n`
  : `#!/bin/sh\nset -eu\nbundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexport PATH="$bundle_dir/runtime/bin:$bundle_dir/app/node_modules/@schlenkr/ragents-tools-${target}/dist/rg/${target}:$PATH"\nexec "$bundle_dir/runtime/bin/node" "$bundle_dir/app/scripts/package/ragents.mjs" "$@"\n`;

export const verifyHash = (bytes, expected, label) => {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${label}: expected ${expected}, got ${actual}`);
};

const downloadRuntime = async (target, directory) => {
  const windows = target.startsWith("win32-");
  const name = `node-v${nodeRuntime.version}-${target.replace("win32-", "win-")}`;
  const filename = `${name}.${windows ? "zip" : "tar.gz"}`;
  const cache = path.join(tmpdir(), "ragents-node-cache");
  await mkdir(cache, { recursive: true });
  const cached = path.join(cache, filename);
  const bytes = await readFile(cached).catch(async (error) => {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(`https://nodejs.org/dist/v${nodeRuntime.version}/${filename}`);
    if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
    const content = Buffer.from(await response.arrayBuffer());
    verifyHash(content, nodeRuntime.sha256[target], filename);
    await writeFile(cached, content);
    return content;
  });
  verifyHash(bytes, nodeRuntime.sha256[target], filename);
  run("tar", ["-xf", cached, "-C", directory]);
  await rename(path.join(directory, name), path.join(directory, "runtime"));
};

export const buildStandalone = async (input, output) => {
  const target = `${process.platform}-${process.arch}`;
  const manifest = JSON.parse(await readFile(path.join(input, "app/package.json"), "utf8"));
  const filename = archiveName(manifest.version, target);
  const temporary = await mkdtemp(path.join(tmpdir(), "ragents-standalone-"));
  const name = filename.replace(/\.(?:tar\.gz|zip)$/, "");
  const directory = path.join(temporary, name);
  const windows = process.platform === "win32";
  try {
    await mkdir(directory);
    await cp(path.join(input, "app"), path.join(directory, "app"), { recursive: true });
    await cp(path.join(input, "tools"), path.join(directory, "tools"), { recursive: true });
    await downloadRuntime(target, directory);
    const runtimeBin = path.join(directory, "runtime", ...(windows ? [] : ["bin"]));
    const node = path.join(runtimeBin, windows ? "node.exe" : "node");
    const npm = path.join(directory, "runtime", ...(windows ? [] : ["lib"]), "node_modules/npm/bin/npm-cli.js");
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["path", "node_path", "node_options"].includes(key.toLowerCase())));
    env.PATH = `${runtimeBin}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`;
    run(node, [npm, "ci", "--omit=dev", "--include=optional", "--no-audit", "--no-fund"], { cwd: path.join(directory, "app"), env });
    const optionalDependencies = Object.fromEntries(Object.keys(manifest.optionalDependencies).map((key) => [key, manifest.version]));
    await writeFile(path.join(directory, "app/package.json"), `${JSON.stringify({ ...manifest, optionalDependencies }, null, 2)}\n`);
    for (const file of ["tools", "app/package-lock.json", "app/node_modules/.package-lock.json"]) await rm(path.join(directory, file), { force: true, recursive: true });
    await mkdir(path.join(directory, "bin"));
    const command = path.join(directory, "bin", windows ? "ragents.cmd" : "ragents");
    await writeFile(command, launcher(windows));
    if (!windows) await chmod(command, 0o755);
    await cp(path.join(directory, "app/LICENSE"), path.join(directory, "LICENSE"));
    await writeFile(path.join(directory, "README.txt"), `RAgents ${manifest.version} (${target})\n\nRun bin/ragents${windows ? ".cmd" : ""} --help for commands.\nConfigure model access, then run bin/ragents${windows ? ".cmd" : ""} start core.\nNode.js ${nodeRuntime.version}, npm and platform tools are included.\nSettings and runs stay in the user's data directory.\nChromium, language servers and development SDKs are provisioned separately.\n\nGuide: https://schlenkr.github.io/RAgents/guide.html\nNode.js license: runtime/LICENSE\nDependency licenses: app/node_modules and runtime/\n`);
    await mkdir(output, { recursive: true });
    const archive = path.join(output, filename);
    if (windows) {
      run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:RAGENTS_ARCHIVE_SOURCE, $env:RAGENTS_ARCHIVE_FILE, [IO.Compression.CompressionLevel]::Optimal, $true)"], {
        env: { ...process.env, RAGENTS_ARCHIVE_SOURCE: directory, RAGENTS_ARCHIVE_FILE: path.join(temporary, filename) },
      });
    } else {
      run("tar", ["-czf", path.join(temporary, filename), "-C", temporary, name], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    }
    const extracted = path.join(temporary, "extracted bundle");
    await mkdir(extracted);
    run("tar", ["-xf", path.join(temporary, filename), "-C", extracted]);
    run(process.execPath, [path.join(root, "scripts/release/check-standalone.mjs"), path.join(extracted, name)]);
    await cp(path.join(temporary, filename), archive);
    const sha256 = createHash("sha256").update(await readFile(archive)).digest("hex");
    await writeFile(`${archive}.sha256`, `${sha256}  ${filename}\n`);
    console.log(`Built and checked ${archive}`);
    return archive;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 4) throw new Error("Usage: build-standalone.mjs [release-input] [output-directory]");
  buildStandalone(path.resolve(process.argv[2] ?? path.join(root, "dist/release-input")), path.resolve(process.argv[3] ?? path.join(root, "dist/releases"))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
