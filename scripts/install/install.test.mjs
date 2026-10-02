import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = dirname(fileURLToPath(import.meta.url));
const shellInstaller = join(source, "install.sh");
const powershellInstaller = join(source, "install.ps1");
const powershellAvailable = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;
const rerun = "curl -fsSL https://github.com/SchlenkR/RAgents/releases/latest/download/install.sh | sh -s --";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ragents-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  mkdirSync(home);
  const prefix = join(root, "install with spaces and 'quote'");
  const mock = join(root, "mock");
  mkdirSync(mock);
  writeFileSync(join(mock, "uname"), '#!/bin/sh\ncase "$1" in -s) echo "$TEST_OS";; -m) echo "$TEST_ARCH";; esac\n', { mode: 0o755 });
  writeFileSync(join(mock, "sudo"), '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$TEST_SUDO_LOG"\nexit 1\n', { mode: 0o755 });
  writeFileSync(join(mock, "curl"), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const url = args.find(arg => arg.startsWith('https://'));
fs.appendFileSync(process.env.TEST_DOWNLOAD_LOG, url + '\\n');
if (url.endsWith('/latest')) {
  process.stdout.write('https://github.com/SchlenkR/RAgents/releases/tag/v' + process.env.TEST_LATEST);
} else {
  const match = url.match(/\\/download\\/v([^/]+)\\/(.+)$/);
  fs.copyFileSync(path.join(process.env.TEST_RELEASES, match[1], match[2]), args[args.indexOf('-o') + 1]);
}
`, { mode: 0o755 });
  const env = {
    ...process.env,
    HOME: home,
    PATH: `${mock}:/usr/bin:/bin`,
    SHELL: "/bin/zsh",
    TEST_OS: "Linux",
    TEST_ARCH: "x86_64",
    TEST_LATEST: "1.0.0",
    TEST_DOWNLOAD_LOG: join(root, "downloads"),
    TEST_SUDO_LOG: join(root, "sudo"),
    TEST_RELEASES: join(root, "releases"),
  };
  function release(version, { platform = "linux", arch = "x64", broken = false, corrupt = false, unprepared = false } = {}) {
    const directory = `ragents-${version}-${platform}-${arch}`;
    const staging = join(root, `build-${version}-${platform}-${arch}`);
    const bundle = join(staging, directory);
    mkdirSync(join(bundle, "bin"), { recursive: true });
    writeFileSync(join(bundle, "bin/ragents"), `#!/bin/sh\n${broken ? "exit 9" : `printf '%s\\n' '${version}' "$@"`}\n`, { mode: 0o755 });
    mkdirSync(join(bundle, "runtime/bin"), { recursive: true });
    writeFileSync(join(bundle, "runtime/bin/node"), `#!/bin/sh\nexec '${process.execPath}' "$@"\n`, { mode: 0o755 });
    mkdirSync(join(bundle, "app/scripts/package"), { recursive: true });
    writeFileSync(join(bundle, "app/scripts/package/host-links.mjs"), unprepared
      ? 'export const ensureHostLinks = () => { throw new Error("links failed"); };\n'
      : 'import { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nexport const ensureHostLinks = (root) => writeFileSync(join(root, "linked"), root);\n');
    const releaseFolder = join(env.TEST_RELEASES, version);
    mkdirSync(releaseFolder, { recursive: true });
    const asset = `${directory}.tar.gz`;
    const archive = join(releaseFolder, asset);
    const packed = spawnSync("tar", ["-czf", archive, "-C", staging, directory], { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
    assert.equal(packed.status, 0, packed.stderr);
    const hash = corrupt ? "0".repeat(64) : createHash("sha256").update(readFileSync(archive)).digest("hex");
    appendFileSync(join(releaseFolder, "SHA256SUMS"), `${hash}  ${asset}\n`);
    return join(prefix, "lib/ragents", directory);
  }
  function installer(args = [], overrides = {}) {
    return spawnSync("sh", [shellInstaller, ...args], { env: { ...env, ...overrides }, encoding: "utf8" });
  }
  function install(args = [], overrides = {}) {
    return installer(["--prefix", prefix, ...args], overrides);
  }
  function run(...args) {
    return spawnSync(join(prefix, "bin/ragents"), args, { env, encoding: "utf8" });
  }
  const downloads = () => existsSync(env.TEST_DOWNLOAD_LOG) ? readFileSync(env.TEST_DOWNLOAD_LOG, "utf8") : "";
  const sudoCalls = () => existsSync(env.TEST_SUDO_LOG) ? readFileSync(env.TEST_SUDO_LOG, "utf8") : "";
  return { root, home, prefix, env, release, installer, install, run, downloads, sudoCalls };
}

test("Unix installer installs latest once, prepares the final folder, forwards arguments, updates and reuses a pinned version", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  const first = f.release("1.0.0");
  const installed = f.install();
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Installed RAgents 1\.0\.0 for the current user in /);
  assert.ok(installed.stdout.includes(`${f.prefix}/bin is not on your PATH. Add this line to ~/.zshrc, then open a new terminal:\n  export PATH="${f.prefix}/bin:$PATH"\n`), installed.stdout);
  assert.equal(f.run("one two", "--help").stdout, "1.0.0\none two\n--help\n");
  assert.equal(readFileSync(join(first, "app/linked"), "utf8"), join(first, "app"));
  assert.equal(f.downloads().split("/latest").length - 1, 1);
  f.release("1.1.0");
  const updated = f.install(["--version", "v1.1.0"]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(f.run().stdout, "1.1.0\n");
  assert.ok(existsSync(first));
  const before = f.downloads();
  assert.equal(f.install(["--version", "1.1.0"]).status, 0);
  assert.equal(f.downloads(), before);
  assert.ok(!existsSync(join(f.prefix, "lib/ragents/.install-lock")));
  assert.equal(f.sudoCalls(), "");
});

test("Unix installer preserves the active version on checksum, startup and preparation failures", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  f.release("1.0.0");
  assert.equal(f.install().status, 0);
  const corrupt = f.release("1.1.0", { corrupt: true });
  const badChecksum = f.install(["--version", "1.1.0"]);
  assert.notEqual(badChecksum.status, 0);
  assert.match(badChecksum.stderr, /Checksum mismatch/);
  assert.ok(!existsSync(corrupt));
  const broken = f.release("1.2.0", { broken: true });
  const badStartup = f.install(["--version", "1.2.0"]);
  assert.notEqual(badStartup.status, 0);
  assert.match(badStartup.stderr, /could not start/);
  assert.ok(!existsSync(broken));
  const unprepared = f.release("1.3.0", { unprepared: true });
  const badLinks = f.install(["--version", "1.3.0"]);
  assert.notEqual(badLinks.status, 0);
  assert.match(badLinks.stderr, /could not be prepared/);
  assert.ok(!existsSync(unprepared));
  assert.equal(f.run().stdout, "1.0.0\n");
  assert.deepEqual(readdirSync(join(f.prefix, "lib/ragents")), ["ragents-1.0.0-linux-x64"]);
});

test("Windows installer installs, updates and preserves a working installation on failures", { skip: process.platform !== "win32" || !powershellAvailable }, () => {
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", join(source, "install.windows.test.ps1")], { encoding: "utf8", env: { ...process.env, TEST_NODE: process.execPath } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("Unix installer selects macOS arm64 and rejects unsupported input before downloading", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  f.release("1.0.0", { platform: "darwin", arch: "arm64" });
  const installed = f.install([], { TEST_OS: "Darwin", TEST_ARCH: "arm64", SHELL: "/bin/bash" });
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Add this line to ~\/\.bash_profile, then open a new terminal/);
  const before = f.downloads();
  for (const args of [["--version", "../bad"], ["--version", "1.0.0\n../bad"], ["--version", ""], ["--prefix", "relative"], ["--unknown"], ["--version"], ["--local", "--global"], ["--uninstall", "--version", "1.0.0"]]) {
    const result = f.install(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
  }
  assert.match(f.install(["--global", "--local"]).stderr, /Choose either --local or --global/);
  assert.notEqual(f.install([], { TEST_ARCH: "riscv64" }).status, 0);
  assert.equal(f.downloads(), before);
});

test("Unix installer defaults to ~/.local and names the PATH line for the user's shell", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  f.release("1.0.0");
  const installed = f.installer();
  assert.equal(installed.status, 0, installed.stderr);
  assert.ok(installed.stdout.includes(`Installed RAgents 1.0.0 for the current user in ${f.home}/.local.\n`), installed.stdout);
  assert.ok(installed.stdout.includes('Add this line to ~/.zshrc, then open a new terminal:\n  export PATH="$HOME/.local/bin:$PATH"\n'), installed.stdout);
  assert.equal(spawnSync(join(f.home, ".local/bin/ragents"), [], { encoding: "utf8" }).stdout, "1.0.0\n");
  assert.match(f.installer([], { SHELL: "/usr/bin/bash" }).stdout, /Add this line to ~\/\.bashrc, then open a new terminal/);
  assert.ok(f.installer([], { SHELL: "/usr/local/bin/fish" }).stdout.includes(`For fish, run this once:\n  fish_add_path '${f.home}/.local/bin'\n`));
  assert.match(f.installer([], { SHELL: "/bin/sh" }).stdout, /Add this line to your shell startup file, for example ~\/\.profile/);
  const onPath = f.installer([], { PATH: `${f.home}/.local/bin:${f.env.PATH}` });
  assert.equal(onPath.status, 0, onPath.stderr);
  assert.match(onPath.stdout, /Run: ragents --help\n/);
  assert.doesNotMatch(onPath.stdout, /not on your PATH|Warning/);
});

test("Unix installer refuses to replace a ragents command it did not create", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  f.release("1.0.0");
  mkdirSync(join(f.prefix, "bin"), { recursive: true });
  const foreign = join(f.prefix, "bin/ragents");
  writeFileSync(foreign, "#!/bin/sh\necho npm\n", { mode: 0o755 });
  const refused = f.install();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /bin\/ragents was not created by this installer/);
  rmSync(foreign);
  symlinkSync("../lib/node_modules/@schlenkr/ragents/scripts/package/ragents.mjs", foreign);
  assert.match(f.install().stderr, /was not created by this installer/);
  assert.equal(f.downloads(), "");
  assert.ok(!existsSync(join(f.prefix, "lib/ragents")));
});

test("Unix installer warns about a shadowing command and names the other scope's installation", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  f.release("1.0.0");
  assert.equal(f.installer().status, 0);
  const other = join(f.root, "other tools");
  mkdirSync(other);
  writeFileSync(join(other, "ragents"), "#!/bin/sh\necho other\n", { mode: 0o755 });
  const shadowed = f.installer([], { PATH: `${other}:${f.home}/.local/bin:${f.env.PATH}` });
  assert.equal(shadowed.status, 0, shadowed.stderr);
  assert.ok(shadowed.stdout.includes(`Warning: the ragents command on your PATH is ${other}/ragents, not this installation.\nRemove that copy, or put ${f.home}/.local/bin before it on your PATH.\n`), shadowed.stdout);
  const global = f.install(["--global"]);
  assert.equal(global.status, 0, global.stderr);
  assert.ok(global.stdout.includes(`Installed RAgents 1.0.0 for all users in ${f.prefix}.\n`), global.stdout);
  assert.ok(global.stdout.includes(`Another RAgents installation remains in ${f.home}/.local. Remove it with:\n  ${rerun} --uninstall\n`), global.stdout);
  assert.equal(f.sudoCalls(), "", "a writable folder needs no sudo");
});

test("Unix installer uninstalls the command and every version but keeps foreign commands and data", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  f.release("1.0.0");
  assert.equal(f.installer().status, 0);
  const data = join(f.home, ".local/share/ragents/core");
  mkdirSync(data, { recursive: true });
  const removed = f.installer(["--uninstall"]);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /^Removed RAgents from .*\/home\/\.local\. Settings and runs stay in ~\/\.local\/share\/ragents of each user\.\n$/);
  assert.ok(!existsSync(join(f.home, ".local/bin/ragents")));
  assert.ok(!existsSync(join(f.home, ".local/lib/ragents")));
  assert.ok(existsSync(join(f.home, ".local/bin")));
  assert.ok(existsSync(data));
  assert.equal(f.installer(["--uninstall"]).stdout, `No RAgents installation in ${f.home}/.local.\n`);
  assert.equal(f.install(["--uninstall", "--global"]).stdout, `No RAgents installation in ${f.prefix}.\n`);
  assert.equal(f.install().status, 0);
  writeFileSync(join(f.prefix, "bin/ragents"), "#!/bin/sh\necho npm\n");
  const kept = f.install(["--uninstall"]);
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.stdout, /^Kept .*\/bin\/ragents: this installer did not create it\.\n/);
  assert.ok(existsSync(join(f.prefix, "bin/ragents")));
  assert.ok(!existsSync(join(f.prefix, "lib/ragents")));
  assert.equal(f.sudoCalls(), "");
});

test("Unix installer needs a writable folder for --local and asks sudo only for --global", { skip: process.platform === "win32" || process.getuid?.() === 0 }, t => {
  const f = fixture(t);
  f.release("1.0.0");
  const locked = join(f.root, "locked");
  mkdirSync(locked);
  chmodSync(locked, 0o555);
  const local = f.installer(["--prefix", locked]);
  assert.notEqual(local.status, 0);
  assert.match(local.stderr, /is not writable for this user\. Use --global/);
  assert.equal(f.sudoCalls(), "");
  const global = f.installer(["--global", "--prefix", locked]);
  assert.notEqual(global.status, 0);
  assert.match(global.stdout, /needs administrator access; sudo may ask for your password/);
  assert.match(global.stderr, /Administrator access was not granted/);
  assert.equal(f.sudoCalls(), "-v\n");
  assert.equal(f.downloads(), "");
  assert.deepEqual(readdirSync(locked), []);
});

test("PowerShell installer parses and rejects invalid input and architectures without downloads", { skip: !powershellAvailable }, t => {
  const root = mkdtempSync(join(tmpdir(), "ragents-install-ps-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const harness = join(root, "check.ps1");
  writeFileSync(harness, `
$ErrorActionPreference = 'Stop'
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile($env:TEST_INSTALLER, [ref]$null, [ref]$errors) | Out-Null
if ($errors) { throw ($errors | Out-String) }
function Invoke-WebRequest { throw 'Unexpected download' }
$env:OS = 'Windows_NT'
$env:PROCESSOR_ARCHITEW6432 = ''
$env:PROCESSOR_ARCHITECTURE = 'AMD64'
function Assert-Rejected([scriptblock] $Call, [string] $Expected) {
  $accepted = $true
  try { & $Call | Out-Null } catch { $accepted = $false; if ($_ -notmatch $Expected) { throw } }
  if ($accepted) { throw "The installer accepted input that must fail with: $Expected" }
}
Assert-Rejected { & $env:TEST_INSTALLER -Version '../invalid' -Prefix $env:TEST_PREFIX } 'Invalid version'
Assert-Rejected { & $env:TEST_INSTALLER -Local -Global -Prefix $env:TEST_PREFIX } 'Choose either -Local or -Global'
Assert-Rejected { & $env:TEST_INSTALLER -Uninstall -Version '1.0.0' -Prefix $env:TEST_PREFIX } 'takes no -Version'
Assert-Rejected { & $env:TEST_INSTALLER -Prefix 'relative' } 'absolute path'
$nothing = & $env:TEST_INSTALLER -Uninstall -Prefix (Join-Path $env:TEST_PREFIX 'empty')
if ($nothing -notcontains "No RAgents installation in $(Join-Path $env:TEST_PREFIX 'empty').") { throw "Unexpected uninstall output: $nothing" }
$env:PROCESSOR_ARCHITECTURE = 'IA64'
Assert-Rejected { & $env:TEST_INSTALLER -Version '1.0.0' -Prefix $env:TEST_PREFIX } 'Supported architectures'
`);
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", harness], {
    env: { ...process.env, TEST_INSTALLER: powershellInstaller, TEST_PREFIX: root },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(readdirSync(root), ["check.ps1"]);
});
