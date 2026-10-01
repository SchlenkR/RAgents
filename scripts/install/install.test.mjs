import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = dirname(fileURLToPath(import.meta.url));
const shellInstaller = join(source, "install.sh");
const powershellInstaller = join(source, "install.ps1");
const powershellAvailable = spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"]).status === 0;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "ragents-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const prefix = join(root, "install with spaces and 'quote'");
  const mock = join(root, "mock");
  mkdirSync(mock);
  writeFileSync(join(mock, "uname"), '#!/bin/sh\ncase "$1" in -s) echo "$TEST_OS";; -m) echo "$TEST_ARCH";; esac\n', { mode: 0o755 });
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
    HOME: join(root, "home"),
    PATH: `${mock}:${process.env.PATH}`,
    TEST_OS: "Linux",
    TEST_ARCH: "x86_64",
    TEST_LATEST: "1.0.0",
    TEST_DOWNLOAD_LOG: join(root, "downloads"),
    TEST_RELEASES: join(root, "releases"),
  };
  function release(version, { platform = "linux", arch = "x64", broken = false, corrupt = false } = {}) {
    const directory = `ragents-${version}-${platform}-${arch}`;
    const staging = join(root, `build-${version}-${platform}-${arch}`);
    const bin = join(staging, directory, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "ragents"), `#!/bin/sh\n${broken ? "exit 9" : `printf '%s\\n' '${version}' "$@"`}\n`, { mode: 0o755 });
    const releaseFolder = join(env.TEST_RELEASES, version);
    mkdirSync(releaseFolder, { recursive: true });
    const asset = `${directory}.tar.gz`;
    const archive = join(releaseFolder, asset);
    const packed = spawnSync("tar", ["-czf", archive, "-C", staging, directory], { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    const hash = corrupt ? "0".repeat(64) : createHash("sha256").update(readFileSync(archive)).digest("hex");
    writeFileSync(join(releaseFolder, "SHA256SUMS"), `${hash}  ${asset}\n`);
    return join(prefix, "lib/ragents", directory);
  }
  function install(args = [], overrides = {}) {
    return spawnSync("sh", [shellInstaller, "--prefix", prefix, ...args], { env: { ...env, ...overrides }, encoding: "utf8" });
  }
  function run(...args) {
    return spawnSync(join(prefix, "bin/ragents"), args, { env, encoding: "utf8" });
  }
  return { root, prefix, env, release, install, run };
}

test("Unix installer installs latest once, forwards arguments, updates and reuses a pinned version", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  const first = f.release("1.0.0");
  const installed = f.install();
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, /Add this directory to your PATH/);
  assert.equal(f.run("one two", "--help").stdout, "1.0.0\none two\n--help\n");
  assert.equal(readFileSync(f.env.TEST_DOWNLOAD_LOG, "utf8").split("/latest").length - 1, 1);
  assert.ok(existsSync(first));
  f.release("1.1.0");
  const updated = f.install(["--version", "v1.1.0"]);
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(f.run().stdout, "1.1.0\n");
  assert.ok(existsSync(first));
  const before = readFileSync(f.env.TEST_DOWNLOAD_LOG, "utf8");
  assert.equal(f.install(["--version", "1.1.0"]).status, 0);
  assert.equal(readFileSync(f.env.TEST_DOWNLOAD_LOG, "utf8"), before);
  assert.ok(!existsSync(join(f.prefix, "lib/ragents/.install-lock")));
});

test("Unix installer preserves the active version on checksum and startup failures", { skip: process.platform === "win32" }, t => {
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
  assert.equal(f.run().stdout, "1.0.0\n");
  assert.deepEqual(readdirSync(join(f.prefix, "lib/ragents")), ["ragents-1.0.0-linux-x64"]);
});

test("Windows installer installs, updates and preserves a working installation on failures", { skip: process.platform !== "win32" || !powershellAvailable }, () => {
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", join(source, "install.windows.test.ps1")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("Unix installer selects macOS arm64 and rejects unsupported input before downloading", { skip: process.platform === "win32" }, t => {
  const f = fixture(t);
  f.release("1.0.0", { platform: "darwin", arch: "arm64" });
  const installed = f.install([], { TEST_OS: "Darwin", TEST_ARCH: "arm64" });
  assert.equal(installed.status, 0, installed.stderr);
  const before = readFileSync(f.env.TEST_DOWNLOAD_LOG, "utf8");
  for (const args of [["--version", "../bad"], ["--version", "1.0.0\n../bad"], ["--version", ""], ["--prefix", "relative"], ["--unknown"], ["--version"]]) {
    const result = f.install(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
  }
  assert.notEqual(f.install([], { TEST_ARCH: "riscv64" }).status, 0);
  assert.equal(readFileSync(f.env.TEST_DOWNLOAD_LOG, "utf8"), before);
});

test("PowerShell installer parses and rejects invalid versions and architectures without downloads", { skip: !powershellAvailable }, t => {
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
try { & $env:TEST_INSTALLER -Version '../invalid' -Prefix $env:TEST_PREFIX; throw 'Accepted invalid version' }
catch { if ($_ -notmatch 'Invalid version') { throw } }
$env:PROCESSOR_ARCHITECTURE = 'IA64'
try { & $env:TEST_INSTALLER -Version '1.0.0' -Prefix $env:TEST_PREFIX; throw 'Accepted unsupported architecture' }
catch { if ($_ -notmatch 'Supported architectures') { throw } }
`);
  const result = spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", harness], {
    env: { ...process.env, TEST_INSTALLER: powershellInstaller, TEST_PREFIX: root },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(root), ["check.ps1"]);
});
