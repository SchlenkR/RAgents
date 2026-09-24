import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getShellConfig } from "@ragents/agent";
import {
  WorkspaceOperationExecutor,
  hasProcessTable,
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

test("die Shell-Beschreibung kennt win32 und nennt Git Bash, GNU-Werkzeuge, Windows-Pfade und CRLF", () => {
  const text = shellPlatformText("win32");
  assert.match(text, /Git Bash/);
  assert.match(text, /MSYS userland with the GNU tools/);
  assert.match(text, /C:\/project/);
  assert.match(text, /CRLF/);
  for (const platform of ["darwin", "linux", "win32"] as const) {
    assert.match(shellPlatformText(platform), /nonzero exit code.*not as a tool error/);
  }
  assert.throws(() => shellPlatformText("freebsd"), /keine Shell-Beschreibung/);
});

test("die Shell-Auflösung nimmt unter Windows Git Bash statt eines festen /bin/bash", () => {
  assert.throws(() => getShellConfig(undefined, "win32"), /Install Git for Windows/);
  const resolved = getShellConfig(undefined, process.platform);
  assert.match(resolved.shell, /bash$|sh$/);
  assert.deepEqual(resolved.args, ["-c"]);
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
