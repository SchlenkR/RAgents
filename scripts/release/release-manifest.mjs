import { createHash } from "node:crypto";
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { archiveName, nodeRuntime } from "./build-standalone.mjs";

export const manifestName = "release-manifest.json";
export const targets = Object.keys(nodeRuntime.sha256).sort();
const hash = (directory, file, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(readFileSync(path.join(directory, file))).digest(encoding);

export const validateManifest = (manifest, version, source) => {
  if (manifest.version !== version || manifest.source !== source) throw new Error(`Release ${version} is already reserved for another source commit or version`);
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{40}$/.test(source)) throw new Error("Invalid release identity");
  const expectedPackages = ["@schlenkr/ragents", ...targets.map((target) => `@schlenkr/ragents-tools-${target}`)].sort();
  if (JSON.stringify(manifest.npm?.map((entry) => entry.name).sort()) !== JSON.stringify(expectedPackages)) throw new Error("Release needs the host and all six npm tools packages");
  for (const entry of manifest.npm) {
    if (entry.version !== version || !/^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity)) throw new Error(`Invalid npm artifact: ${entry.name}`);
    if (!entry.filename.endsWith(".tgz")) throw new Error(`Invalid npm filename: ${entry.filename}`);
  }
  const expectedVsix = ["universal", ...targets].map((target) => `ragents-vscode${target === "universal" ? "" : `-${target}`}-${version}.vsix`).sort();
  if (JSON.stringify(manifest.vsix?.slice().sort()) !== JSON.stringify(expectedVsix)) throw new Error("Release needs all seven VSIX targets");
  const required = [...targets.map((target) => archiveName(version, target)), ...expectedVsix, ...manifest.npm.map((entry) => entry.filename), "install.sh", "install.ps1", "npm-packages.json", "SHA256SUMS"];
  if (Object.keys(manifest.files).length !== required.length || required.some((file) => !manifest.files[file])) throw new Error("Incomplete release assets");
  for (const [file, digest] of Object.entries(manifest.files)) {
    if (!/^[a-zA-Z0-9._-]+$/.test(file) || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid release file: ${file}`);
  }
};

export const verifyArtifacts = (directory, manifest, version, source) => {
  validateManifest(manifest, version, source);
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (hash(directory, file) !== expected) throw new Error(`Release checksum mismatch: ${file}`);
  }
  for (const entry of manifest.npm) {
    if (`sha512-${hash(directory, entry.filename, "sha512", "base64")}` !== entry.integrity) throw new Error(`npm integrity mismatch: ${entry.name}`);
  }
};

export const assembleManifest = (directory, version, source) => {
  for (const target of targets) {
    const file = archiveName(version, target);
    const sidecar = `${file}.sha256`;
    if (readFileSync(path.join(directory, sidecar), "utf8").trim() !== `${hash(directory, file)}  ${file}`) throw new Error(`Standalone checksum mismatch: ${file}`);
    rmSync(path.join(directory, sidecar));
  }
  const files = readdirSync(directory).filter((file) => file !== manifestName && file !== "SHA256SUMS").sort();
  writeFileSync(path.join(directory, "SHA256SUMS"), `${files.map((file) => `${hash(directory, file)}  ${file}`).join("\n")}\n`);
  const manifest = {
    version,
    source,
    npm: JSON.parse(readFileSync(path.join(directory, "npm-packages.json"), "utf8")),
    vsix: files.filter((file) => file.endsWith(".vsix")),
    files: Object.fromEntries([...files, "SHA256SUMS"].map((file) => [file, hash(directory, file)])),
  };
  verifyArtifacts(directory, manifest, version, source);
  writeFileSync(path.join(directory, manifestName), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};
