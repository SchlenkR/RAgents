import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
  safeProcessEnvironment,
  sandboxEnvironment,
  sandboxToolsModule,
  shellPlatformText,
  workspaceProcessContext,
} from "../src/index.ts";
import { dotnetCommand } from "../src/language-server/roots.ts";
import { processExists } from "../src/managed-process.ts";

const textOf = (result: unknown): string =>
  ((result as { content?: Array<{ type: string; text?: string }> }).content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");

test("die Shell-Beschreibung kennt win32 und nennt die mitgebrachte Bash, GNU-Werkzeuge, Windows-Programme, Windows-Pfade und CRLF", () => {
  const text = shellPlatformText("win32");
  assert.match(text, /bash RAgents brings along/);
  assert.doesNotMatch(text, /Git Bash/);
  assert.match(text, /MSYS userland with the GNU tools/);
  assert.match(text, /`git`, `dotnet` and `node` are the Windows programs of this machine/);
  assert.match(text, /C:\/project/);
  assert.match(text, /CRLF/);
  for (const platform of ["darwin", "linux", "win32"] as const) {
    assert.match(shellPlatformText(platform), /nonzero exit code.*not as a tool error/);
  }
  assert.throws(() => shellPlatformText("freebsd"), /keine Shell-Beschreibung/);
});

test("unter Windows startet bash nur die mitgebrachte Bash, mit ihrem usr/bin vorn im PATH und ohne MSYSTEM", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-bundled-bash-")));
  const bash = path.join(directory, "usr", "bin", "bash.exe");
  try {
    assert.throws(() => bashLaunch(undefined, "ls", { Path: "C:\\Windows\\system32" }, "win32"), /nur mit der Bash, die RAgents mitbringt[\s\S]*RAGENTS_BASH/);
    assert.throws(() => bashLaunch(bash, "ls", {}, "win32"), new RegExp(`Die Bash dieses Executors fehlt: ${bash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    await mkdir(path.dirname(bash), { recursive: true });
    await writeFile(bash, "");
    const launch = bashLaunch(bash, "find . -name '*.ts'", {
      Path: "C:\\Windows\\system32;C:\\Program Files\\Git\\cmd",
      MSYSTEM: "MINGW64",
      HOME: "C:\\Users\\alice",
    }, "win32");
    assert.equal(launch.command, bash);
    assert.deepEqual(launch.args, ["--noprofile", "--norc", "-c", "find . -name '*.ts'"]);
    assert.equal(launch.env.PATH, `${path.dirname(bash)};C:\\Windows\\system32;C:\\Program Files\\Git\\cmd`);
    assert.equal(Object.keys(launch.env).filter((name) => name.toUpperCase() === "PATH").length, 1, "genau eine PATH-Variable");
    assert.equal(launch.env.MSYSTEM, undefined);
    assert.equal(launch.env.HOME, "C:\\Users\\alice");
    assert.equal(bashLaunch(bash, "ls", {}, "win32").env.PATH, path.dirname(bash));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("außerhalb von Windows startet bash die Bash des Systems und lässt PATH unverändert", () => {
  const launch = bashLaunch(undefined, "ls", { PATH: "/usr/bin", MSYSTEM: "MINGW64" }, "linux");
  assert.match(launch.command, /bash$/);
  assert.deepEqual(launch.args, ["--noprofile", "--norc", "-c", "ls"]);
  assert.deepEqual(launch.env, { PATH: "/usr/bin", MSYSTEM: "MINGW64" });
});

test("die Bash des Executors läuft über die aufgelöste Shell, nicht über einen festen Pfad", async () => {
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
    assert.ok(used.includes(getShellConfig().shell), `${used} nennt nicht ${getShellConfig().shell}`);
  } finally {
    await executor.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("der Datenordner liegt unter Windows in %LOCALAPPDATA%, sonst unter ~/.local/share", () => {
  const local = "C:\\Users\\dev\\AppData\\Local";
  assert.equal(ragentsDataRoot("C:\\Users\\dev", "win32", { LOCALAPPDATA: local }), path.join(local, "ragents"));
  assert.throws(() => ragentsDataRoot("C:\\Users\\dev", "win32", {}), /LOCALAPPDATA ist nicht gesetzt/);
  assert.equal(ragentsDataRoot("/home/dev", "linux", {}), "/home/dev/.local/share/ragents");
});

test("der Arbeitsplatz erbt die ganze Umgebung außer Editor-Variablen und Bash-Startdateien, der Server nur die sichere Auswahl", () => {
  const source = {
    PATH: "/usr/bin",
    GH_TOKEN: "vom-benutzer",
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
    PATH: "/usr/bin", GH_TOKEN: "vom-benutzer", DOTNET_ROOT: "/opt/dotnet", HOME: "/home/user", GIT_CONFIG_COUNT: "9",
  });
  const additions = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null", RAGENTS_RUN_ID: "run-1" };
  const workstation = sandboxEnvironment(source, { base: "inherited", home: { home: "/daten/home" }, additions });
  assert.equal(workstation.GH_TOKEN, "vom-benutzer");
  assert.equal(workstation.VSCODE_PID, undefined);
  assert.equal(workstation.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(workstation.BASH_ENV, undefined);
  assert.equal(workstation.ENV, undefined);
  assert.equal(workstation.HOME, "/daten/home", "HOME des Runs gilt vor dem geerbten");
  assert.equal(workstation.USERPROFILE, "/daten/home");
  assert.equal(workstation.GIT_CONFIG_COUNT, "1", "die Git-Regeln des Runs gelten vor den geerbten");
  assert.equal(workstation.RAGENTS_RUN_ID, "run-1");
  for (const server of [
    sandboxEnvironment(source, { home: { home: "/daten/home" }, additions }),
    sandboxEnvironment(source, { base: "safe", home: { home: "/daten/home" }, additions }),
  ]) {
    assert.equal(server.GH_TOKEN, undefined);
    assert.equal(server.VSCODE_PID, undefined);
    assert.equal(server.BASH_ENV, undefined);
    assert.equal(server.DOTNET_ROOT, "/opt/dotnet");
    assert.equal(server.PATH, "/usr/bin");
    assert.equal(server.GIT_CONFIG_COUNT, "1");
  }
  const inherited = workspaceProcessContext({
    runId: "run-1", cwd: "/w", root: "/w", home: { home: "/daten/home" }, logDirectory: "/tmp", hostRoot: undefined,
    source, baseEnvironment: "inherited", bash: "C:/tools/bash.exe",
  });
  assert.equal(inherited.env.GH_TOKEN, "vom-benutzer");
  assert.equal(inherited.bash, "C:/tools/bash.exe");
  const safe = workspaceProcessContext({ runId: "run-1", cwd: "/w", root: "/w", home: { home: "/daten/home" }, logDirectory: "/tmp", hostRoot: undefined, source });
  assert.equal(safe.env.GH_TOKEN, undefined);
  assert.equal("bash" in safe, false);
});

test("die HOME-Umleitung der Sandbox setzt auch USERPROFILE", () => {
  const environment = sandboxEnvironment({ PATH: "/usr/bin" }, { home: { home: "/daten/home" } });
  assert.equal(environment.HOME, "/daten/home");
  assert.equal(environment.USERPROFILE, "/daten/home");
});

test("ohne Konto behält die Sandbox den Benutzernamen der Maschine, mit Konto nimmt sie dessen Namen", () => {
  const machine = sandboxEnvironment({ PATH: "/usr/bin", USER: "dev", LOGNAME: "dev" }, { home: { home: "/daten/home" } });
  assert.equal(machine.USER, "dev");
  assert.equal(machine.LOGNAME, "dev");
  const unnamed = sandboxEnvironment({ PATH: "/usr/bin", USERNAME: "dev" }, { home: { home: "/daten/home" } });
  assert.equal("USER" in unnamed, false);
  assert.equal("LOGNAME" in unnamed, false);
  assert.equal(unnamed.USERNAME, "dev");
  const account = sandboxEnvironment({ PATH: "/usr/bin", USER: "dev", LOGNAME: "dev" }, { home: { home: "/daten/home" }, ident: { name: "sandbox-1" } });
  assert.equal(account.USER, "sandbox-1");
  assert.equal(account.LOGNAME, "sandbox-1");
});

test("die sichere Umgebung reicht die Windows-Grundvariablen durch", () => {
  const source = {
    PATH: "C:\\Windows\\system32",
    SystemRoot: "C:\\Windows",
    ComSpec: "C:\\Windows\\system32\\cmd.exe",
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
    APPDATA: "C:\\Users\\dev\\AppData\\Roaming",
    GEHEIM: "nicht durchreichen",
  };
  const environment = safeProcessEnvironment(source);
  assert.equal(environment.SystemRoot, "C:\\Windows");
  assert.equal(environment.ComSpec, "C:\\Windows\\system32\\cmd.exe");
  assert.equal(environment.PATHEXT, ".COM;.EXE;.BAT;.CMD");
  assert.equal(environment.LOCALAPPDATA, "C:\\Users\\dev\\AppData\\Local");
  assert.equal(environment.APPDATA, "C:\\Users\\dev\\AppData\\Roaming");
  assert.equal(environment.GEHEIM, undefined);
});

test("die Sprachserver starten mit Windows-Pfaden: dotnet für .dll, die Binary direkt", () => {
  assert.deepEqual(
    dotnetCommand("C:\\Users\\dev\\AppData\\Local\\ragents\\workspace\\tools\\roslyn\\Microsoft.CodeAnalysis.LanguageServer.dll", ["--stdio"]),
    { command: "dotnet", args: ["C:\\Users\\dev\\AppData\\Local\\ragents\\workspace\\tools\\roslyn\\Microsoft.CodeAnalysis.LanguageServer.dll", "--stdio"] },
  );
  assert.deepEqual(
    dotnetCommand("C:\\tools\\fsautocomplete\\fsautocomplete.exe", ["--state-directory", "C:\\temp\\fsac"]),
    { command: "C:\\tools\\fsautocomplete\\fsautocomplete.exe", args: ["--state-directory", "C:\\temp\\fsac"] },
  );
});

test("der Prozessbaum wird nur für einen noch vorhandenen Prozess beendet", () => {
  assert.equal(processExists(process.pid), true);
  assert.equal(processExists(999_999), false);
});

test("unter Windows gibt es keine Prozesstabelle, die Prozessüberwachung nennt die Ursache", () => {
  assert.equal(hasProcessTable("win32"), false);
  assert.equal(hasProcessTable("darwin"), true);
  assert.equal(hasProcessTable("linux"), true);
  assert.throws(() => processTableForPlatform("win32"), /Unter Windows gibt es keine Prozesstabelle/);
  assert.throws(() => processTableForPlatform("freebsd"), /kennt die Plattform freebsd nicht/);
});
