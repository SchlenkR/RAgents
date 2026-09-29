import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getShellConfig } from "@ragents/agent";
import {
  WorkspaceOperationExecutor,
  bashLaunch,
  hasProcessTable,
  inheritedProcessEnvironment,
  processTableForPlatform,
  ragentsDataRoot,
  ripgrepAvailable,
  safeProcessEnvironment,
  sandboxEnvironment,
  sandboxToolsModule,
  shellPlatformText,
  workspaceProcessContext,
} from "../src/index.ts";
import { processExists } from "../src/managed-process.ts";

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

test("the shell description knows win32 and names the bundled bash, GNU tools, Windows programs, Windows paths and CRLF", () => {
  const text = shellPlatformText("win32", { ripgrep: true });
  assert.match(text, /bash RAgents brings along/);
  assert.doesNotMatch(text, /Git Bash/);
  assert.match(text, /MSYS userland with the GNU tools/);
  assert.match(text, /`git`, `dotnet` and `node` are the Windows programs of this machine/);
  assert.match(text, /C:\/project/);
  assert.match(text, /CRLF/);
  for (const platform of ["darwin", "linux", "win32"] as const) {
    for (const ripgrep of [true, false]) assert.match(shellPlatformText(platform, { ripgrep }), /nonzero exit code.*not as a tool error/);
  }
  assert.throws(() => shellPlatformText("freebsd", { ripgrep: true }), /no shell description/);
});

test("with rg the shell description steers the search to rg, without rg to grep with excluded folders", () => {
  for (const platform of ["darwin", "linux", "win32"] as const) {
    const withRipgrep = shellPlatformText(platform, { ripgrep: true });
    assert.match(withRipgrep, /Search code with `rg` \(ripgrep\) and list files with `rg --files`/);
    assert.match(withRipgrep, /`\.gitignore` excludes, such as `node_modules`, `bin` and `obj`, and is far faster than `grep -r`/);
    assert.match(withRipgrep, /Use `grep` only on single files or in pipes/);
    assert.doesNotMatch(withRipgrep, /not available/);
    const withoutRipgrep = shellPlatformText(platform, { ripgrep: false });
    assert.match(withoutRipgrep, /`rg` \(ripgrep\) is not available here/);
    assert.match(withoutRipgrep, /--exclude-dir=node_modules/);
    assert.doesNotMatch(withoutRipgrep, /rg --files/);
  }
  assert.doesNotMatch(shellPlatformText("darwin", { ripgrep: false }), /grep -E` or `rg`/, "macOS no longer names rg without a check");
});

test("on Windows bash only starts the bundled bash, with its usr/bin at the front of PATH and without MSYSTEM", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-bundled-bash-")));
  const bash = path.join(directory, "usr", "bin", "bash.exe");
  try {
    assert.throws(() => bashLaunch({ bash: undefined, rg: undefined }, "ls", { Path: "C:\\Windows\\system32" }, "win32"), /only works with the bash that RAgents bundles[\s\S]*RAGENTS_BASH/);
    assert.throws(() => bashLaunch({ bash, rg: undefined }, "ls", {}, "win32"), new RegExp(`The bash of this executor is missing: ${bash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await mkdir(path.dirname(bash), { recursive: true });
    await writeFile(bash, "");
    const launch = bashLaunch({ bash, rg: undefined }, "find . -name '*.ts'", {
      Path: "C:\\Windows\\system32;C:\\Program Files\\Git\\cmd",
      MSYSTEM: "MINGW64",
      HOME: "C:\\Users\\alice",
    }, "win32");
    assert.equal(launch.command, bash);
    assert.deepEqual(launch.args, ["--noprofile", "--norc", "-c", "find . -name '*.ts'"]);
    assert.equal(launch.env.PATH, `${path.dirname(bash)};C:\\Windows\\system32;C:\\Program Files\\Git\\cmd`);
    assert.equal(Object.keys(launch.env).filter((name) => name.toUpperCase() === "PATH").length, 1, "exactly one PATH variable");
    assert.equal(launch.env.MSYSTEM, undefined);
    assert.equal(launch.env.HOME, "C:\\Users\\alice");
    assert.equal(bashLaunch({ bash, rg: undefined }, "ls", {}, "win32").env.PATH, path.dirname(bash));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("outside Windows bash without rg starts the system's bash and leaves PATH unchanged", () => {
  const launch = bashLaunch({ bash: undefined, rg: undefined }, "ls", { PATH: "/usr/bin", MSYSTEM: "MINGW64" }, "linux");
  assert.match(launch.command, /bash$/);
  assert.deepEqual(launch.args, ["--noprofile", "--norc", "-c", "ls"]);
  assert.deepEqual(launch.env, { PATH: "/usr/bin", MSYSTEM: "MINGW64" });
});

test("the bundled rg is at the front of PATH on every platform, on Windows before the usr/bin of the bash; if it is missing, bash fails", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-bundled-rg-")));
  const bash = path.join(directory, "bash", "usr", "bin", "bash.exe");
  const rg = path.join(directory, "rg", "linux-x64", "rg");
  const rgExe = path.join(directory, "rg", "win32-x64", "rg.exe");
  try {
    assert.throws(() => bashLaunch({ bash: undefined, rg }, "rg foo", { PATH: "/usr/bin" }, "linux"),
      new RegExp(`The rg of this executor is missing: ${rg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*RAGENTS_RG`));
    for (const file of [bash, rg, rgExe]) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "");
    }
    for (const platform of ["linux", "darwin"] as const) {
      const launch = bashLaunch({ bash: undefined, rg }, "rg foo", { PATH: "/usr/bin:/bin", HOME: "/home/alice" }, platform);
      assert.deepEqual(launch.env, { PATH: `${path.dirname(rg)}:/usr/bin:/bin`, HOME: "/home/alice" });
    }
    assert.equal(bashLaunch({ bash: undefined, rg }, "rg foo", {}, "linux").env.PATH, path.dirname(rg));
    const windows = bashLaunch({ bash, rg: rgExe }, "rg foo", { Path: "C:\\Windows\\system32", MSYSTEM: "MINGW64" }, "win32");
    assert.equal(windows.env.PATH, `${path.dirname(rgExe)};${path.dirname(bash)};C:\\Windows\\system32`);
    assert.equal(windows.env.Path, undefined);
    assert.equal(windows.env.MSYSTEM, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("whether the bash finds rg: the named one, otherwise one in PATH; a named one that is missing is an error", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-rg-lookup-")));
  try {
    const bin = path.join(directory, "bin");
    const windowsBin = path.join(directory, "windows");
    await mkdir(bin, { recursive: true });
    await mkdir(windowsBin, { recursive: true });
    assert.equal(ripgrepAvailable(undefined, { PATH: bin }, "linux"), false);
    await writeFile(path.join(bin, "rg"), "");
    assert.equal(ripgrepAvailable(undefined, { PATH: bin }, "linux"), false, "a non-executable rg does not count");
    await chmod(path.join(bin, "rg"), 0o755);
    assert.equal(ripgrepAvailable(undefined, { PATH: `/nowhere:${bin}` }, "linux"), true);
    assert.equal(ripgrepAvailable(undefined, {}, "linux"), false);
    await writeFile(path.join(windowsBin, "rg.exe"), "");
    assert.equal(ripgrepAvailable(undefined, { Path: `C:\\Windows;${windowsBin}` }, "win32"), true, "on Windows every spelling of PATH counts");
    assert.equal(ripgrepAvailable(undefined, { Path: bin }, "win32"), false, "on Windows it is called rg.exe");
    assert.equal(ripgrepAvailable(path.join(bin, "rg"), {}, "linux"), true);
    assert.throws(() => ripgrepAvailable(path.join(directory, "missing", "rg"), { PATH: bin }, "linux"), /The rg of this executor is missing:.*missing/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the bash of the executor runs through the resolved shell, not through a fixed path", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-windows-")));
  const workspace = path.join(directory, "workspace");
  await mkdir(workspace, { recursive: true });
  const executor = new WorkspaceOperationExecutor({
    modules: [sandboxToolsModule],
    contextFor: (runId) => Promise.resolve(workspaceProcessContext({
      runId,
      cwd: workspace,
      root: workspace,
      home: { home: directory },
      logDirectory: directory,
      hostRoot: undefined,
    })),
  });
  try {
    const used = textOf(await executor.execute("run-1", "bash", { command: 'printf %s "$BASH"' }));
    assert.ok(used.includes(getShellConfig().shell), `${used} does not name ${getShellConfig().shell}`);
  } finally {
    await executor.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the data folder is in %LOCALAPPDATA% on Windows, otherwise under ~/.local/share", () => {
  const local = "C:\\Users\\dev\\AppData\\Local";
  assert.equal(ragentsDataRoot("C:\\Users\\dev", "win32", { LOCALAPPDATA: local }), path.join(local, "ragents"));
  assert.throws(() => ragentsDataRoot("C:\\Users\\dev", "win32", {}), /LOCALAPPDATA is not set/);
  assert.equal(ragentsDataRoot("/home/dev", "linux", {}), "/home/dev/.local/share/ragents");
});

test("the workspace inherits the whole environment except editor variables and bash startup files, the server only the safe selection", () => {
  const source = {
    PATH: "/usr/bin",
    GH_TOKEN: "from-the-user",
    DOTNET_ROOT: "/opt/dotnet",
    VSCODE_PID: "7",
    VSCODE_IPC_HOOK: "/tmp/ipc",
    ELECTRON_RUN_AS_NODE: "1",
    BASH_ENV: "/home/user/.bashrc",
    ENV: "/home/user/.shrc",
    HOME: "/home/user",
    GIT_CONFIG_COUNT: "9",
  };
  assert.deepEqual(inheritedProcessEnvironment(source), {
    PATH: "/usr/bin", GH_TOKEN: "from-the-user", DOTNET_ROOT: "/opt/dotnet", HOME: "/home/user", GIT_CONFIG_COUNT: "9",
  });
  const additions = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null", RAGENTS_RUN_ID: "run-1" };
  const workstation = sandboxEnvironment(source, { base: "inherited", home: { home: "/data/home" }, additions });
  assert.equal(workstation.GH_TOKEN, "from-the-user");
  assert.equal(workstation.VSCODE_PID, undefined);
  assert.equal(workstation.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(workstation.BASH_ENV, undefined);
  assert.equal(workstation.ENV, undefined);
  assert.equal(workstation.HOME, "/data/home", "HOME of the run applies over the inherited one");
  assert.equal(workstation.USERPROFILE, "/data/home");
  assert.equal(workstation.GIT_CONFIG_COUNT, "1", "the Git rules of the run apply over the inherited ones");
  assert.equal(workstation.RAGENTS_RUN_ID, "run-1");
  for (const server of [
    sandboxEnvironment(source, { home: { home: "/data/home" }, additions }),
    sandboxEnvironment(source, { base: "safe", home: { home: "/data/home" }, additions }),
  ]) {
    assert.equal(server.GH_TOKEN, undefined);
    assert.equal(server.VSCODE_PID, undefined);
    assert.equal(server.BASH_ENV, undefined);
    assert.equal(server.DOTNET_ROOT, "/opt/dotnet");
    assert.equal(server.PATH, "/usr/bin");
    assert.equal(server.GIT_CONFIG_COUNT, "1");
  }
  const inherited = workspaceProcessContext({
    runId: "run-1", cwd: "/w", root: "/w", home: { home: "/data/home" }, logDirectory: "/tmp", hostRoot: undefined,
    source, baseEnvironment: "inherited", bash: "C:/tools/bash.exe", rg: "C:/tools/rg/rg.exe",
  });
  assert.equal(inherited.env.GH_TOKEN, "from-the-user");
  assert.equal(inherited.bash, "C:/tools/bash.exe");
  assert.equal(inherited.rg, "C:/tools/rg/rg.exe");
  const safe = workspaceProcessContext({ runId: "run-1", cwd: "/w", root: "/w", home: { home: "/data/home" }, logDirectory: "/tmp", hostRoot: undefined, source });
  assert.equal(safe.env.GH_TOKEN, undefined);
  assert.equal("bash" in safe, false);
  assert.equal("rg" in safe, false);
});

test("the HOME redirection of the sandbox also sets USERPROFILE", () => {
  const environment = sandboxEnvironment({ PATH: "/usr/bin" }, { home: { home: "/data/home" } });
  assert.equal(environment.HOME, "/data/home");
  assert.equal(environment.USERPROFILE, "/data/home");
});

test("without an account the sandbox keeps the user name of the machine, with an account it takes the account's name", () => {
  const machine = sandboxEnvironment({ PATH: "/usr/bin", USER: "dev", LOGNAME: "dev" }, { home: { home: "/data/home" } });
  assert.equal(machine.USER, "dev");
  assert.equal(machine.LOGNAME, "dev");
  const unnamed = sandboxEnvironment({ PATH: "/usr/bin", USERNAME: "dev" }, { home: { home: "/data/home" } });
  assert.equal("USER" in unnamed, false);
  assert.equal("LOGNAME" in unnamed, false);
  assert.equal(unnamed.USERNAME, "dev");
  const account = sandboxEnvironment({ PATH: "/usr/bin", USER: "dev", LOGNAME: "dev" }, { home: { home: "/data/home" }, ident: { name: "sandbox-1" } });
  assert.equal(account.USER, "sandbox-1");
  assert.equal(account.LOGNAME, "sandbox-1");
});

test("the safe environment passes the basic Windows variables through", () => {
  const source = {
    PATH: "C:\\Windows\\system32",
    SystemRoot: "C:\\Windows",
    ComSpec: "C:\\Windows\\system32\\cmd.exe",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
    APPDATA: "C:\\Users\\dev\\AppData\\Roaming",
    SECRET: "do not pass through",
  };
  const environment = safeProcessEnvironment(source);
  assert.equal(environment.SystemRoot, "C:\\Windows");
  assert.equal(environment.ComSpec, "C:\\Windows\\system32\\cmd.exe");
  assert.equal(environment.PATHEXT, ".COM;.EXE;.BAT;.CMD");
  assert.equal(environment.LOCALAPPDATA, "C:\\Users\\dev\\AppData\\Local");
  assert.equal(environment.APPDATA, "C:\\Users\\dev\\AppData\\Roaming");
  assert.equal(environment.SECRET, undefined);
});

test("the process tree is only ended for a process that still exists", () => {
  assert.equal(processExists(process.pid), true);
  assert.equal(processExists(999_999), false);
});

test("on Windows there is no process table, the process monitor names the cause", () => {
  assert.equal(hasProcessTable("win32"), false);
  assert.equal(hasProcessTable("darwin"), true);
  assert.equal(hasProcessTable("linux"), true);
  assert.throws(() => processTableForPlatform("win32"), /There is no process table on Windows/);
  assert.throws(() => processTableForPlatform("freebsd"), /does not know the platform freebsd/);
});
