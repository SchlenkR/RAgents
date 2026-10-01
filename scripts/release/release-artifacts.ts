import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { oneLine, publishedVersions as npmVersions, redacting, runNpm, type NpmRunner } from "../package/publish-package.ts";
import { compareVersions } from "../publish-version.ts";
import { EXTENSION_ID, PUBLISHER, publishedVersions, publishVsix, runVsce, verifyToken } from "../vscode/publish-extension.ts";
import { assembleManifest, manifestName, validateManifest, verifyArtifacts } from "./release-manifest.mjs";
import { releasePattern, run } from "./publish-release.ts";

interface NpmArtifact {
  readonly name: string;
  readonly version: string;
  readonly filename: string;
  readonly integrity: string;
}

interface ReleaseManifest {
  readonly version: string;
  readonly source: string;
  readonly npm: readonly NpmArtifact[];
  readonly vsix: readonly string[];
  readonly files: Readonly<Record<string, string>>;
}

interface Release {
  readonly isDraft: boolean;
  readonly targetCommitish: string;
  readonly assets: readonly { name: string }[];
}

export const publishedIntegrity = (artifact: NpmArtifact, npm: NpmRunner = runNpm): string | undefined => {
  const result = npm(["view", `${artifact.name}@${artifact.version}`, "dist.integrity", "--json"], { cwd: process.cwd() });
  if (result.status !== 0) {
    if (/E404|404 Not Found/.test(`${result.stdout}\n${result.stderr}`)) return undefined;
    throw new Error(`Cannot inspect ${artifact.name}: ${oneLine(result.stderr)}`);
  }
  const integrity: unknown = JSON.parse(result.stdout.trim() || "null");
  if (typeof integrity !== "string" || !integrity) throw new Error(`npm returned no integrity for ${artifact.name}@${artifact.version}`);
  return integrity;
};

export const needsNpmPublish = (artifact: NpmArtifact, npm: NpmRunner = runNpm): boolean => {
  const integrity = publishedIntegrity(artifact, npm);
  if (integrity === undefined) return true;
  if (integrity !== artifact.integrity) throw new Error(`${artifact.name}@${artifact.version} already contains different bytes. Refusing to overwrite or skip it.`);
  return false;
};

const optionalGh = <T>(args: readonly string[]): T | undefined => {
  const result = spawnSync("gh", [...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout) as T;
  if (/HTTP 404|release not found/i.test(result.stderr)) return undefined;
  throw new Error(`gh ${args[0]} failed: ${result.stderr.trim()}`);
};

export const localPublishCredentials = (environment: NodeJS.ProcessEnv = process.env): { token: string; vsceToken: string } => {
  const token = environment.npm_key;
  const vsceToken = environment.AZURE_DEVOPS_VSCE_RAGENTS_PAT;
  if (!token || !vsceToken) throw new Error("Publishing requires the local npm_key and AZURE_DEVOPS_VSCE_RAGENTS_PAT environment variables");
  return { token, vsceToken };
};

export const verifyPublishAccess = (): void => {
  const { token, vsceToken } = localPublishCredentials();
  const identity = runNpm(["whoami"], { cwd: process.cwd(), token });
  if (identity.status !== 0) throw new Error(`npm authentication failed: ${redacting(token)(oneLine(identity.stderr))}`);
  verifyToken(PUBLISHER, vsceToken, runVsce);
  run("gh", ["auth", "status"]);
};

export const preparedReleaseSource = (version: string): string | undefined => {
  const release = optionalGh<Release>(["release", "view", `v${version}`, "--json", "isDraft,targetCommitish,assets"]);
  if (!release?.assets.some((asset) => asset.name === manifestName)) return undefined;
  const manifest = JSON.parse(run("gh", ["release", "download", `v${version}`, "--pattern", manifestName, "--output", "-"])) as ReleaseManifest;
  validateManifest(manifest, version, manifest.source);
  return manifest.source;
};

export const publishArtifacts = (directory: string | undefined, version: string, source: string): void => {
  if (process.env.GITHUB_ACTIONS === "true") throw new Error("Publishing runs locally. GitHub Actions only builds release artifacts.");
  verifyPublishAccess();
  const { token, vsceToken } = localPublishCredentials();
  const tag = `v${version}`;
  const tagged = optionalGh<{ sha: string }>(["api", `repos/{owner}/{repo}/commits/${tag}`]);
  if (tagged && tagged.sha !== source) throw new Error(`${tag} points to another source commit`);
  const release = optionalGh<Release>(["release", "view", tag, "--json", "isDraft,targetCommitish,assets"]);
  if (release && !tagged && release.targetCommitish !== source) throw new Error(`${tag} is reserved for another source commit`);
  const previous = release?.assets.some((asset) => asset.name === manifestName);
  if (release && !release.isDraft && !previous) throw new Error(`${tag} is already public without a unified release manifest. Choose a new version.`);
  if (!previous && !directory) throw new Error(`Release ${version} has no saved artifacts. Build it first with pnpm release --version ${version}.`);
  const saved = previous ? mkdtempSync(path.join(tmpdir(), "ragents-release-resume-")) : directory!;
  try {
    if (previous) run("gh", ["release", "download", tag, "--dir", saved]);
    const manifest = JSON.parse(readFileSync(path.join(saved, manifestName), "utf8")) as ReleaseManifest;
    verifyArtifacts(saved, manifest, version, source);
    if (release && !release.isDraft) {
      console.log(`== All channels already released: ${version}`);
      return;
    }
    const marketplace = publishedVersions(EXTENSION_ID, runVsce);
    const later = [...marketplace, ...manifest.npm.flatMap((artifact) => npmVersions(artifact.name, runNpm))]
      .find((published) => compareVersions(published, version) > 0);
    if (later) throw new Error(`Version ${later} is already published. Refusing to move latest back to ${version}.`);
    const pending = manifest.npm.filter((artifact) => needsNpmPublish(artifact));
    if (!previous) {
      if (pending.length !== manifest.npm.length || marketplace.includes(version)) {
        throw new Error(`Version ${version} already exists outside this release. Choose a new version.`);
      }
      if (!release) run("gh", ["release", "create", tag, "--draft", "--target", source, "--title", `RAgents ${tag}`, "--generate-notes"]);
      run("gh", ["release", "upload", tag, ...Object.keys(manifest.files).map((file) => path.join(saved, file)), "--clobber"]);
      run("gh", ["release", "upload", tag, path.join(saved, manifestName)]);
    }
    for (const artifact of pending) {
      const result = runNpm(["publish", path.join(saved, artifact.filename), "--access", "public"], { cwd: saved, token });
      console.log(redacting(token)(`${result.stdout}${result.stderr}`));
      if (result.status !== 0) throw new Error(`npm publish failed for ${artifact.name}. Rerun this release to resume version ${version}.`);
    }
    publishVsix({ version, vsix: manifest.vsix.map((file) => path.join(saved, file)), token: vsceToken, vsce: runVsce, log: console.log, skipDuplicate: true });
    run("gh", ["release", "edit", tag, "--draft=false", "--latest"]);
    console.log(`== All channels released: ${version}`);
  } finally {
    if (previous) rmSync(saved, { recursive: true, force: true });
  }
};

const main = (): void => {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("Use pnpm release; release-artifacts.ts only assembles artifacts in GitHub Actions");
  const version = process.env.RELEASE_VERSION ?? "";
  const source = process.env.RELEASE_SOURCE ?? "";
  if (!releasePattern.test(version) || !/^[0-9a-f]{40}$/.test(source)) throw new Error("Missing release version or source commit");
  const directory = fileURLToPath(new URL("../../dist/releases", import.meta.url));
  if (process.argv[2] === "assemble") assembleManifest(directory, version, source);
  else throw new Error("Expected assemble; publishing runs locally through pnpm release");
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
