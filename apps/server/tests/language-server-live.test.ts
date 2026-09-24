import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  LanguageServerHost,
  fsharpAdapter,
  roslynAdapter,
  runManagedProcess,
  typescriptAdapter,
  workspaceProcessContext,
  type WorkspaceProcessContext,
} from "@ragents/workspace-executor";
import { hostRoot } from "../src/host-version.ts";

const enabled = process.env.RAGENTS_LSP_TESTS === "1";
const skip = enabled ? false : "RAGENTS_LSP_TESTS=1 setzen (die Sprachserver holt pnpm provision --workspace)";
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "lsp");
const RUN = "run-lsp";

interface Workspace {
  root: string;
  contextFor: () => Promise<WorkspaceProcessContext>;
  context: WorkspaceProcessContext;
  dispose: () => Promise<void>;
}

const workspace = async (fixture: string): Promise<Workspace> => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-lsp-")));
  const root = path.join(directory, "workspace");
  const home = path.join(directory, "home");
  await cp(path.join(fixtures, fixture), root, { recursive: true });
  await mkdir(home, { recursive: true });
  const context = workspaceProcessContext({
    runId: RUN,
    cwd: root,
    root,
    home: { home, nugetPackages: path.join(os.homedir(), ".nuget", "packages") },
    logDirectory: home,
    hostRoot: hostRoot(),
  });
  return {
    root,
    context,
    contextFor: () => Promise.resolve(context),
    dispose: () => rm(directory, { recursive: true, force: true }),
  };
};

const restore = async (context: WorkspaceProcessContext, solution: string): Promise<void> => {
  let output = "";
  const result = await runManagedProcess({
    command: "dotnet",
    args: ["restore", solution, "--source", "https://api.nuget.org/v3/index.json"],
    cwd: context.root,
    env: context.env,
    label: "dotnet restore",
    timeoutMs: 180_000,
    onStdout: (chunk) => { output += chunk.toString(); },
    onStderr: (chunk) => { output += chunk.toString(); },
  });
  assert.equal(result.code, 0, output);
};

test("Roslyn reports C# errors of an edited file without a build", { skip, timeout: 600_000 }, async () => {
  const ws = await workspace("dotnet");
  const host = new LanguageServerHost(roslynAdapter, ws.contextFor);
  try {
    await restore(ws.context, "Sample.sln");
    const summary = await host.open(RUN, "Sample.sln");
    assert.match(summary, /Sample\.sln geladen/);
    assert.match(await host.open(RUN, "Sample.sln"), /bereits geöffnet/);

    const greeter = path.join(ws.root, "CSharpLib", "Greeter.cs");
    const original = await readFile(greeter, "utf8");
    assert.equal(await host.diagnostics(RUN, ["CSharpLib/Greeter.cs"], false), "Diagnostik (Roslyn) CSharpLib/Greeter.cs: keine Fehler");

    await writeFile(greeter, "namespace CSharpLib;\n\npublic static class Greeter\n{\n    public static int Value = \"text\";\n}\n");
    const annotation = await host.annotate(RUN, greeter);
    assert.match(annotation ?? "", /^Diagnostik \(Roslyn\) CSharpLib\/Greeter\.cs: 1 Fehler/m);
    assert.match(annotation ?? "", /CSharpLib\/Greeter\.cs:5:31 error CS0029/);

    await writeFile(greeter, original);
    assert.equal(await host.diagnostics(RUN, ["CSharpLib/Greeter.cs"], false), "Diagnostik (Roslyn) CSharpLib/Greeter.cs: keine Fehler");

    const created = path.join(ws.root, "CSharpLib", "Broken.cs");
    await writeFile(created, "namespace CSharpLib;\n\npublic static class Broken\n{\n    public static int Value = \"text\";\n}\n");
    assert.match(await host.annotate(RUN, created) ?? "", /CSharpLib\/Broken\.cs:5:31 error CS0029/);

    assert.equal(await host.annotate(RUN, path.join(ws.root, "README.md")), undefined);
  } finally {
    await host.shutdown();
    await ws.dispose();
  }
});

test("FSAC reports F# errors of an edited project file", { skip, timeout: 600_000 }, async () => {
  const ws = await workspace("dotnet");
  const host = new LanguageServerHost(fsharpAdapter, ws.contextFor);
  try {
    await restore(ws.context, "Sample.sln");
    assert.match(await host.open(RUN, "Sample.sln"), /1 F#-Projekt aus Sample\.sln geladen/);

    const library = path.join(ws.root, "FSharpLib", "Library.fs");
    const original = await readFile(library, "utf8");
    assert.equal(await host.diagnostics(RUN, ["FSharpLib/Library.fs"], false), "Diagnostik (FSAC) FSharpLib/Library.fs: keine Fehler");

    await writeFile(library, `${original}\nlet broken: int = "text"\n`);
    const annotation = await host.annotate(RUN, library);
    assert.match(annotation ?? "", /^Diagnostik \(FSAC\) FSharpLib\/Library\.fs: 1 Fehler/m);
    assert.match(annotation ?? "", /FSharpLib\/Library\.fs:5:19 error 1:/);

    await writeFile(library, original);
    assert.equal(await host.diagnostics(RUN, ["FSharpLib/Library.fs"], false), "Diagnostik (FSAC) FSharpLib/Library.fs: keine Fehler");
  } finally {
    await host.shutdown();
    await ws.dispose();
  }
});

test("TypeScript reports errors of an edited file and lists changed files via git", { skip, timeout: 300_000 }, async () => {
  const ws = await workspace("typescript");
  const host = new LanguageServerHost(typescriptAdapter, ws.contextFor);
  try {
    assert.match(await host.open(RUN, "."), /TypeScript-Server auf workspace bereit/);
    const clean = "Diagnostik (TypeScript) src/index.ts: keine Fehler";
    assert.equal(await host.diagnostics(RUN, ["src/index.ts"], false), clean);

    const startedAt = Date.now();
    assert.equal(await host.diagnostics(RUN, ["src/index.ts"], false), clean);
    const repeatMs = Date.now() - startedAt;
    assert.ok(repeatMs < 5_000, `die unveränderte Datei brauchte erneut ${repeatMs} ms`);

    const index = path.join(ws.root, "src", "index.ts");
    await writeFile(index, "export const count: number = 3;\nexport const label = \"drei\";\n");
    const cleanEditAt = Date.now();
    assert.equal(await host.annotate(RUN, index), clean);
    const cleanEditMs = Date.now() - cleanEditAt;
    assert.ok(cleanEditMs < 10_000, `die fehlerfreie Änderung brauchte ${cleanEditMs} ms`);

    await writeFile(index, "export const count: number = \"drei\";\n");
    const annotation = await host.annotate(RUN, index);
    assert.match(annotation ?? "", /^Diagnostik \(TypeScript\) src\/index\.ts: 1 Fehler/m);
    assert.match(annotation ?? "", /src\/index\.ts:1:14 error 2322/);
    assert.equal(await host.diagnostics(RUN, ["src/index.ts"], false), annotation);

    await assert.rejects(host.diagnostics(RUN, ["tsconfig.json"], false), /keine TypeScript-Endung/);
    await assert.rejects(host.diagnostics(RUN, undefined, false), /Git-Arbeitsverzeichnis/);

    for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"]]) {
      const result = await runManagedProcess({ command: "git", args, cwd: ws.root, env: ws.context.env, label: "git", timeoutMs: 30_000 });
      assert.equal(result.code, 0);
    }
    assert.equal(await host.diagnostics(RUN, undefined, false), "Keine geänderten TypeScript-Dateien in den geöffneten Wurzeln");
    await writeFile(path.join(ws.root, "src", "extra.ts"), "export const x: string = 1;\n");
    assert.match(await host.diagnostics(RUN, undefined, false), /src\/extra\.ts:1:14 error 2322/);
  } finally {
    await host.shutdown();
    await ws.dispose();
  }
});
