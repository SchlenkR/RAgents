import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { list as listTar } from "tar";
import { readZipEntries } from "../../apps/server/src/plugin-support/zip.ts";
import { cachedArchive, megabytes } from "./bundle-bash.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionRoot = path.join(repositoryRoot, "apps", "vscode");

/** Die feste ripgrep-Fassung; eine neue Fassung heißt neue Hashes. */
export const RIPGREP_VERSION = "15.2.0";
const RELEASE_URL = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}`;

export type RipgrepTarget = "win32-x64" | "win32-arm64" | "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64";

interface TargetSource {
  /** Das Ziel im Namen des Release-Archivs; unter Linux die statisch gelinkte musl-Fassung, die ohne glibc läuft. */
  readonly triple: string;
  readonly sha256: string;
}

export const RIPGREP_TARGETS: Readonly<Record<RipgrepTarget, TargetSource>> = {
  "win32-x64": { triple: "x86_64-pc-windows-msvc", sha256: "71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5" },
  "win32-arm64": { triple: "aarch64-pc-windows-msvc", sha256: "e4abca10c3a64ebea742667dd7009449d49403db5460dd6873e389fa2945360f" },
  "darwin-arm64": { triple: "aarch64-apple-darwin", sha256: "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4" },
  "darwin-x64": { triple: "x86_64-apple-darwin", sha256: "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1" },
  "linux-x64": { triple: "x86_64-unknown-linux-musl", sha256: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c" },
  "linux-arm64": { triple: "aarch64-unknown-linux-musl", sha256: "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915" },
};

const onWindows = (target: RipgrepTarget): boolean => target.startsWith("win32-");

/** Das Release-Archiv einer Plattform: für Windows ZIP, sonst tar.gz. */
export const ripgrepAsset = (target: RipgrepTarget): string =>
  `ripgrep-${RIPGREP_VERSION}-${RIPGREP_TARGETS[target].triple}.${onWindows(target) ? "zip" : "tar.gz"}`;

export const ripgrepExecutable = (target: RipgrepTarget): string => onWindows(target) ? "rg.exe" : "rg";

/** ripgrep steht wahlweise unter MIT oder Unlicense; COPYING nennt die Wahl. */
export const RIPGREP_LICENSE_FILES = ["COPYING", "LICENSE-MIT", "UNLICENSE"] as const;

/** Der Ordner, in dem die Erweiterung rg für eine Plattform erwartet; die Bash des Werkzeugs hat ihn vorn im PATH. */
export const ripgrepBundleFolder = (target: RipgrepTarget, root: string = extensionRoot): string => path.join(root, "dist", "rg", target);

const notice = (target: RipgrepTarget): string => `RAgents bundled ripgrep (${target})
${"=".repeat(`RAgents bundled ripgrep (${target})`.length)}

${ripgrepExecutable(target)} is ripgrep ${RIPGREP_VERSION}, copied unchanged from the release archive:
  ${RELEASE_URL}/${ripgrepAsset(target)}
  SHA-256 ${RIPGREP_TARGETS[target].sha256}

ripgrep is dual-licensed under the MIT license or the Unlicense, at your choice; the texts are in
licenses/. Source code: https://github.com/BurntSushi/ripgrep/tree/${RIPGREP_VERSION}
`;

/** Die Dateien eines tar.gz-Archivs, die `keep` nennt, mit ihrem Inhalt. */
const tarEntries = (archive: string, keep: (name: string) => boolean): ReadonlyMap<string, Buffer> => {
  const found = new Map<string, Buffer>();
  listTar({
    file: archive,
    sync: true,
    strict: true,
    onReadEntry: (entry) => {
      if (!keep(entry.path)) return;
      const chunks: Buffer[] = [];
      entry.on("data", (chunk: Buffer) => chunks.push(chunk));
      entry.on("end", () => found.set(entry.path, Buffer.concat(chunks)));
    },
  });
  return found;
};

const archiveEntries = (archive: string, target: RipgrepTarget, keep: (name: string) => boolean): ReadonlyMap<string, Buffer> =>
  onWindows(target)
    ? new Map(readZipEntries(readFileSync(archive), keep).map((entry) => [entry.name, entry.content] as const))
    : tarEntries(archive, keep);

export interface RipgrepBundle {
  readonly target: RipgrepTarget;
  readonly directory: string;
  readonly executable: string;
  readonly bytes: number;
  /** Die Größe nach Deflate, wie sie ungefähr in der .vsix landet. */
  readonly deflatedBytes: number;
}

export interface RipgrepBundleOptions {
  readonly output?: string;
  readonly cache?: string;
  readonly log?: (line: string) => void;
}

/** Legt rg einer Plattform samt Lizenztexten aus dem festen Release-Archiv ab. */
export const bundleRipgrep = async (target: RipgrepTarget, options: RipgrepBundleOptions = {}): Promise<RipgrepBundle> => {
  const log = options.log ?? (() => undefined);
  const cache = options.cache ?? path.join(tmpdir(), "ragents-rg-cache");
  const archive = await cachedArchive(`${RELEASE_URL}/${ripgrepAsset(target)}`, RIPGREP_TARGETS[target].sha256, cache, log);
  const prefix = `ripgrep-${RIPGREP_VERSION}-${RIPGREP_TARGETS[target].triple}/`;
  const executable = ripgrepExecutable(target);
  const wanted = [executable, ...RIPGREP_LICENSE_FILES];
  const entries = archiveEntries(archive, target, (name) => wanted.some((file) => name === `${prefix}${file}`));
  const missing = wanted.filter((file) => !entries.has(`${prefix}${file}`));
  if (missing.length > 0) throw new Error(`${ripgrepAsset(target)} enthält unter ${prefix} nicht: ${missing.join(", ")}`);
  const contentOf = (file: string): Buffer => entries.get(`${prefix}${file}`)!;

  const output = options.output ?? ripgrepBundleFolder(target);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(path.join(output, "licenses"), { recursive: true });
  const binary = path.join(output, executable);
  writeFileSync(binary, contentOf(executable));
  if (!onWindows(target)) chmodSync(binary, 0o755);
  for (const file of RIPGREP_LICENSE_FILES) writeFileSync(path.join(output, "licenses", file), contentOf(file));
  writeFileSync(path.join(output, "NOTICE.txt"), notice(target));

  const bundle: RipgrepBundle = {
    target,
    directory: output,
    executable: binary,
    bytes: contentOf(executable).length,
    deflatedBytes: deflateRawSync(contentOf(executable), { level: 9 }).length,
  };
  log(`== ${target}: ${executable} ${megabytes(bundle.bytes)} ausgepackt, ${megabytes(bundle.deflatedBytes)} gepackt, nach ${path.relative(repositoryRoot, output)}`);
  return bundle;
};

const usage = `Verwendung: pnpm bundle:rg [${Object.keys(RIPGREP_TARGETS).join("] [")}]
Legt ripgrep ${RIPGREP_VERSION}, das die plattformgebundenen Fassungen der VS-Code-Erweiterung mitbringen,
aus den festen Release-Archiven nach apps/vscode/dist/rg/<plattform>. Ohne Angabe alle Plattformen;
die Archive bleiben im Temp-Ordner liegen.`;

const main = async (): Promise<void> => {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((argument) => !(argument in RIPGREP_TARGETS));
  if (unknown.length > 0) throw new Error(`Unbekannte Plattform: ${unknown.join(" ")}\n${usage}`);
  const targets = (requested.length > 0 ? requested : Object.keys(RIPGREP_TARGETS)) as RipgrepTarget[];
  for (const target of targets) await bundleRipgrep(target, { log: (line) => console.log(line) });
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
