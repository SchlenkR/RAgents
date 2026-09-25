import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { peImports, type PeImports } from "./pe-imports.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionRoot = path.join(repositoryRoot, "apps", "vscode");

/** Die feste Git-for-Windows-Fassung, aus der die Bash stammt; eine neue Fassung heißt neue Hashes. */
export const PORTABLE_GIT_TAG = "v2.55.0.windows.5";
const RELEASE_URL = `https://github.com/git-for-windows/git/releases/download/${PORTABLE_GIT_TAG}`;

export type BashTarget = "win32-x64" | "win32-arm64";

interface TargetSource {
  readonly asset: string;
  readonly sha256: string;
  /** Der Ordner der nativen Windows-Programme im Archiv; aus ihm kommen nur Lizenztexte. */
  readonly nativePrefix: string;
}

export const BASH_TARGETS: Readonly<Record<BashTarget, TargetSource>> = {
  "win32-x64": {
    asset: "PortableGit-2.55.0.5-64-bit.7z.exe",
    sha256: "5aa8a20f6e9abb2c755f0e73c91c687701a46b309ad84a0ca6509380fa4ae290",
    nativePrefix: "mingw64",
  },
  "win32-arm64": {
    asset: "PortableGit-2.55.0.5-arm64.7z.exe",
    sha256: "49d1dd3158017fa9805d07268433dbab7021b2ec1c1cc3fbabaf8b8255764dd0",
    nativePrefix: "clangarm64",
  },
};

const COREUTILS = [
  "[", "arch", "b2sum", "base32", "base64", "basename", "basenc", "cat", "chgrp", "chmod", "chown", "cksum", "comm", "cp",
  "csplit", "cut", "date", "dd", "df", "dir", "dircolors", "dirname", "du", "echo", "env", "expand", "expr", "factor",
  "false", "fmt", "fold", "groups", "head", "id", "install", "join", "link", "ln", "logname", "ls", "md5sum", "mkdir",
  "mkfifo", "mknod", "mktemp", "mv", "nice", "nl", "nohup", "nproc", "numfmt", "od", "paste", "pathchk", "pr", "printenv",
  "printf", "ptx", "pwd", "readlink", "realpath", "rm", "rmdir", "seq", "sha1sum", "sha224sum", "sha256sum", "sha384sum",
  "sha512sum", "shred", "shuf", "sleep", "sort", "split", "stat", "stty", "sum", "sync", "tac", "tail", "tee", "test",
  "timeout", "touch", "tr", "true", "truncate", "tsort", "tty", "uname", "unexpand", "uniq", "unlink", "vdir", "wc",
  "whoami", "yes",
].map((name) => `${name}.exe`);

/** Was aus usr/bin mitkommt, je Paket der Quelle; Skripte ohne .exe sind sh-Skripte über den Programmen daneben. */
export const BASH_PACKAGES: Readonly<Record<string, readonly string[]>> = {
  "bash": ["bash.exe", "sh.exe"],
  "coreutils": COREUTILS,
  "grep": ["grep.exe", "egrep", "fgrep"],
  "sed": ["sed.exe"],
  "gawk": ["gawk.exe", "awk.exe"],
  "findutils": ["find.exe", "xargs.exe"],
  "diffutils": ["diff.exe", "cmp.exe", "diff3.exe", "sdiff.exe"],
  "patch": ["patch.exe"],
  "tar": ["tar.exe"],
  "gzip": ["gzip.exe", "gunzip", "zcat"],
  "bzip2": ["bzip2.exe", "bunzip2.exe", "bzcat.exe"],
  "unzip": ["unzip.exe", "zipinfo.exe", "funzip.exe"],
  "less": ["less.exe"],
  "file": ["file.exe"],
  "which": ["which.exe"],
  "dos2unix": ["dos2unix.exe", "unix2dos.exe", "d2u.exe", "u2d.exe", "mac2unix.exe", "unix2mac.exe"],
  "iconv": ["iconv.exe"],
  "msys2-runtime": ["cygpath.exe", "ps.exe", "kill.exe"],
  "util-linux": ["column.exe", "getopt.exe"],
};

/** Daten, ohne die ein mitgebrachtes Programm nicht arbeitet: die Magic-Datenbank von file. */
const DATA_FILES = ["usr/share/misc/magic.mgc"];

/** Was nie in die Bash gehört: Git kommt vom Benutzer, und Perl, Editoren, Krypto-Werkzeuge und Terminals braucht sie nicht. */
const FORBIDDEN = /^(git|perl|vim?|view|gpg|ssh|scp|sftp|openssl|mintty|winpty|tig|r?nano)([-.0-9_].*)?$|^msys-perl/i;

/** Windows-Systembibliotheken, die nie in usr/bin liegen; eine andere fehlende DLL bricht den Bau ab. */
const WINDOWS_SYSTEM_DLLS: ReadonlySet<string> = new Set([
  "advapi32.dll", "bcrypt.dll", "comctl32.dll", "comdlg32.dll", "crypt32.dll", "dbghelp.dll", "dnsapi.dll", "gdi32.dll",
  "imm32.dll", "iphlpapi.dll", "kernel32.dll", "mpr.dll", "msvcrt.dll", "ncrypt.dll", "netapi32.dll", "ntdll.dll",
  "ole32.dll", "oleaut32.dll", "powrprof.dll", "psapi.dll", "rpcrt4.dll", "secur32.dll", "setupapi.dll", "shell32.dll",
  "shlwapi.dll", "sspicli.dll", "ucrtbase.dll", "user32.dll", "userenv.dll", "version.dll", "winmm.dll", "ws2_32.dll",
  "wtsapi32.dll",
]);

export const isWindowsSystemDll = (name: string): boolean =>
  /^(api|ext)-ms-win-/i.test(name) || WINDOWS_SYSTEM_DLLS.has(name.toLowerCase());

/** Alle DLLs, die die Programme laden, transitiv; `available` bildet kleingeschriebene Namen auf die Dateien in usr/bin ab. */
export const dllClosure = (
  programs: readonly string[],
  importsOf: (file: string) => PeImports,
  available: ReadonlyMap<string, string>,
): readonly string[] => {
  const found = new Map<string, string>();
  const pending = [...programs];
  while (pending.length > 0) {
    const file = pending.pop()!;
    const { imports, delayImports } = importsOf(file);
    for (const dll of [...imports, ...delayImports]) {
      const bundled = available.get(dll.toLowerCase());
      if (bundled === undefined) {
        if (isWindowsSystemDll(dll)) continue;
        throw new Error(`${file} braucht ${dll}; die DLL liegt nicht in usr/bin und ist keine bekannte Windows-Systembibliothek`);
      }
      if (found.has(bundled.toLowerCase())) continue;
      found.set(bundled.toLowerCase(), bundled);
      pending.push(bundled);
    }
  }
  return [...found.values()].sort();
};

/** Wählt HOME aus der Umgebung und sonst das Windows-Profil; die übrigen Zeilen wie in Git for Windows. */
const NSSWITCH = `# Written by RAgents for its bundled bash: HOME comes from the environment, otherwise from Windows.
passwd: files db
group: files # db
db_enum: cache builtin
db_home: env windows
db_shell: env windows
db_gecos: env
`;

/** Die Lizenztexte der Bash: Name in licenses/ und Pfad im Archiv; <native> ist der Ordner der nativen Programme. */
const LICENSE_FILES: readonly (readonly [string, string])[] = [
  ["GPL-2.0.txt", "LICENSE.txt"],
  ["GPL-3.0.txt", "usr/share/licenses/mintty/LICENSE.GPL"],
  ["LGPL-3.0.txt", "<native>/share/licenses/libunistring/LICENSE.LIB"],
  ["LGPL-2.1.txt", "<native>/share/licenses/libiconv/COPYING.LIB"],
  ["GCC-RUNTIME-LIBRARY-EXCEPTION.txt", "usr/share/licenses/gcc-libs/RUNTIME.LIBRARY.EXCEPTION"],
  ["bzip2/LICENSE", "<native>/share/licenses/bzip2/LICENSE"],
  ["dos2unix/LICENSE", "usr/share/licenses/dos2unix/LICENSE"],
  ["file/COPYING", "usr/share/licenses/file/COPYING"],
  ["ncurses/LICENSE", "usr/share/licenses/ncurses/LICENSE"],
  ["pcre2/LICENCE.md", "<native>/share/licenses/pcre2/LICENCE.md"],
  ["unzip/LICENSE", "usr/share/licenses/unzip/LICENSE"],
  ["xz/COPYING", "<native>/share/licenses/xz/COPYING"],
  ["xz/COPYING.0BSD", "<native>/share/licenses/xz/COPYING.0BSD"],
  ["zlib/LICENSE", "usr/share/licenses/zlib/LICENSE"],
  ["zstd/LICENSE", "<native>/share/licenses/zstd/LICENSE"],
];

/** Die Quellen stehen bei Git for Windows und MSYS2; der Hinweis nennt sie samt Fassungen der mitgebrachten Pakete. */
const notice = (target: BashTarget, source: TargetSource, versions: readonly string[], dlls: readonly string[]): string => `RAgents bundled bash (${target})
================================

This folder is a subset of Git for Windows PortableGit ${PORTABLE_GIT_TAG}:
  ${RELEASE_URL}/${source.asset}
  SHA-256 ${source.sha256}

The files are copied unchanged, except etc/nsswitch.conf, which RAgents writes itself.
Git, Perl, editors, GnuPG, OpenSSH, OpenSSL and terminal programs are not included.

Packages (name and version as in the release's etc/package-versions.txt):
${versions.map((line) => `  ${line}`).join("\n")}

Libraries loaded by these programs:
${dlls.map((dll) => `  usr/bin/${dll}`).join("\n")}

Most programs are licensed under the GNU General Public License version 3 or later, the MSYS2
runtime (msys-2.0.dll) and several libraries under the GNU Lesser General Public License; the
license texts are in licenses/. The complete corresponding source code is published by the
Git for Windows and MSYS2 projects:
  https://github.com/git-for-windows/git/releases/tag/${PORTABLE_GIT_TAG}
  https://github.com/git-for-windows/MSYS2-packages
  https://github.com/git-for-windows/msys2-runtime
  https://github.com/msys2/MSYS2-packages
`;

const sha256Of = (buffer: Buffer): string => createHash("sha256").update(buffer).digest("hex");

/** Lädt das Archiv einmal in den Cache und prüft es bei jedem Gebrauch gegen den festen Hash. */
const cachedArchive = async (source: TargetSource, cache: string, log: (line: string) => void): Promise<string> => {
  const file = path.join(cache, source.asset);
  if (!existsSync(file)) {
    log(`== ${source.asset} laden`);
    const response = await fetch(`${RELEASE_URL}/${source.asset}`);
    if (!response.ok) throw new Error(`${RELEASE_URL}/${source.asset} antwortete mit ${response.status}`);
    const downloaded = Buffer.from(await response.arrayBuffer());
    const hash = sha256Of(downloaded);
    if (hash !== source.sha256) throw new Error(`${source.asset} hat den SHA-256 ${hash}, erwartet ist ${source.sha256}`);
    mkdirSync(cache, { recursive: true });
    writeFileSync(`${file}.part`, downloaded);
    renameSync(`${file}.part`, file);
    return file;
  }
  const hash = sha256Of(readFileSync(file));
  if (hash !== source.sha256) throw new Error(`${file} hat den SHA-256 ${hash}, erwartet ist ${source.sha256}; die Datei löschen und neu laden lassen`);
  return file;
};

/** 7-Zip heißt je nach Paket 7zz oder 7z; ohne eines von beiden lässt sich das Archiv nicht öffnen. */
const sevenZip = (): string => {
  const usable = ["7zz", "7z"].find((name) => !spawnSync(name, ["i"], { stdio: "ignore" }).error);
  if (!usable) {
    throw new Error("7-Zip fehlt: weder 7zz noch 7z ist im PATH. macOS: brew install sevenzip, Debian/Ubuntu: apt install 7zip, Windows: winget install 7zip.7zip");
  }
  return usable;
};

/** Packt nur die Teile aus, aus denen die Bash entsteht; ein vollständiger Stand trägt eine Marke. */
const extracted = (archive: string, source: TargetSource, cache: string, log: (line: string) => void): string => {
  const directory = path.join(cache, `${source.asset}.files`);
  const marker = path.join(directory, ".complete");
  if (existsSync(marker)) return directory;
  rmSync(directory, { recursive: true, force: true });
  log(`== ${source.asset} auspacken`);
  const patterns = ["usr/bin/*", "usr/share/misc/*", "usr/share/licenses/*", "etc/fstab", "etc/package-versions.txt", "LICENSE.txt", `${source.nativePrefix}/share/licenses/*`];
  const result = spawnSync(sevenZip(), ["x", "-y", `-o${directory}`, archive, ...patterns], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`7-Zip konnte ${archive} nicht auspacken: ${result.stderr || result.stdout}`);
  writeFileSync(marker, "");
  return directory;
};

const copyInto = (from: string, to: string): void => {
  if (!existsSync(from)) throw new Error(`${from} fehlt im Archiv`);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(from, to);
};

const filesUnder = (directory: string): readonly string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? filesUnder(full) : [full];
});

const megabytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export interface BashBundle {
  readonly target: BashTarget;
  readonly directory: string;
  readonly dlls: readonly string[];
  readonly files: number;
  readonly bytes: number;
  /** Die Größe nach Deflate, wie sie ungefähr in der .vsix landet. */
  readonly deflatedBytes: number;
}

export interface BundleOptions {
  readonly output?: string;
  readonly cache?: string;
  readonly log?: (line: string) => void;
}

/** Der Ordner, in dem die Erweiterung ihre Bash für eine Plattform erwartet. */
export const bashBundleFolder = (target: BashTarget, root: string = extensionRoot): string => path.join(root, "dist", "bash", target);

/** Baut die Bash einer Windows-Plattform aus dem festen PortableGit-Archiv. */
export const bundleBash = async (target: BashTarget, options: BundleOptions = {}): Promise<BashBundle> => {
  const log = options.log ?? (() => undefined);
  const source = BASH_TARGETS[target];
  const cache = options.cache ?? path.join(tmpdir(), "ragents-bash-cache");
  const archive = await cachedArchive(source, cache, log);
  const files = extracted(archive, source, cache, log);
  const bin = path.join(files, "usr", "bin");
  const available = new Map(readdirSync(bin).map((name) => [name.toLowerCase(), name] as const));
  const programs = Object.values(BASH_PACKAGES).flat();
  const missing = programs.filter((program) => !available.has(program.toLowerCase()));
  if (missing.length > 0) throw new Error(`${source.asset} enthält in usr/bin nicht: ${missing.join(", ")}`);
  const executables = programs.filter((program) => program.toLowerCase().endsWith(".exe"));
  const dlls = dllClosure(executables, (file) => peImports(readFileSync(path.join(bin, file)), file), available);
  const shipped = [...programs, ...dlls];
  const forbidden = shipped.filter((file) => FORBIDDEN.test(file));
  if (forbidden.length > 0) throw new Error(`Die Bash würde enthalten, was nie hineingehört: ${forbidden.join(", ")}`);

  const output = options.output ?? bashBundleFolder(target);
  rmSync(output, { recursive: true, force: true });
  for (const file of shipped) copyInto(path.join(bin, file), path.join(output, "usr", "bin", file));
  for (const file of DATA_FILES) copyInto(path.join(files, file), path.join(output, file));
  copyInto(path.join(files, "etc", "fstab"), path.join(output, "etc", "fstab"));
  writeFileSync(path.join(output, "etc", "nsswitch.conf"), NSSWITCH);
  for (const [name, from] of LICENSE_FILES) copyInto(path.join(files, from.replace("<native>", source.nativePrefix)), path.join(output, "licenses", name));
  const packageVersions = readFileSync(path.join(files, "etc", "package-versions.txt"), "utf8").split("\n").map((line) => line.trim());
  const versions = Object.keys(BASH_PACKAGES).map((name) => {
    const line = packageVersions.find((entry) => entry.startsWith(`${name} `));
    if (!line) throw new Error(`etc/package-versions.txt nennt das Paket ${name} nicht`);
    return line;
  });
  writeFileSync(path.join(output, "NOTICE.txt"), notice(target, source, versions, dlls));

  const written = filesUnder(output);
  const contents = written.map((file) => readFileSync(file));
  const bundle: BashBundle = {
    target,
    directory: output,
    dlls,
    files: written.length,
    bytes: written.reduce((sum, file) => sum + statSync(file).size, 0),
    deflatedBytes: contents.reduce((sum, content) => sum + deflateRawSync(content, { level: 9 }).length, 0),
  };
  log(`== ${target}: ${bundle.files} Dateien, ${megabytes(bundle.bytes)} ausgepackt, ${megabytes(bundle.deflatedBytes)} gepackt, nach ${path.relative(repositoryRoot, output)}`);
  return bundle;
};

const usage = `Verwendung: pnpm bundle:bash [win32-x64] [win32-arm64]
Baut die Bash, die die Windows-Fassungen der VS-Code-Erweiterung mitbringen, aus dem festen
Git-for-Windows-Archiv ${PORTABLE_GIT_TAG} nach apps/vscode/dist/bash/<plattform>. Ohne Angabe
beide Plattformen. Braucht 7-Zip (7zz oder 7z) im PATH; das Archiv bleibt im Temp-Ordner liegen.`;

const main = async (): Promise<void> => {
  const requested = process.argv.slice(2);
  const unknown = requested.filter((argument) => !(argument in BASH_TARGETS));
  if (unknown.length > 0) throw new Error(`Unbekannte Plattform: ${unknown.join(" ")}\n${usage}`);
  const targets = (requested.length > 0 ? requested : Object.keys(BASH_TARGETS)) as BashTarget[];
  for (const target of targets) {
    const bundle = await bundleBash(target, { log: (line) => console.log(line) });
    console.log(`== ${target}: DLLs ${bundle.dlls.join(", ")}`);
  }
};

const moduleUrl: string | undefined = import.meta.url;
if (moduleUrl && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
