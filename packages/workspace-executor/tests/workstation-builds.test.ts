import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LanguageServerHost,
  createSandboxTools,
  createUnrestrictedNetworkSandbox,
  executorMachine,
  hostDataDirectory,
  isolatedWorkstationEnvironment,
  pluginToolsDirectory,
  prepareWorkstationFolders,
  workstationAccessRule,
  workstationCacheEnvironment,
  workspaceProcessContext,
  type WorkspaceExecutorContribution,
} from "../src/index.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const fixtures = path.join(repository, "apps", "server", "tests", "fixtures", "lsp");
const supported = process.platform === "darwin" || process.platform === "linux";
const available = (command: string): boolean => spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0;
const output = (result: unknown): string => ((result as { content?: { text?: string }[] }).content ?? []).map((entry) => entry.text ?? "").join("\n");

const fixture = async (t: TestContext, name: string) => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ragents-workstation-build-")));
  const root = path.join(directory, "project");
  const storage = path.join(directory, "data", "run-storage", "build-run");
  await cp(path.join(fixtures, name), root, { recursive: true });
  const folders = await prepareWorkstationFolders(storage);
  const source = isolatedWorkstationEnvironment(process.env);
  const rule = await workstationAccessRule({ root, offered: [root], storage, data: [path.join(directory, "data")], grants: [], environment: source,
    readable: [repository, path.join(hostDataDirectory(), "tools")] });
  const sandbox = createUnrestrictedNetworkSandbox({ rule, temporary: folders.temporary, environment: source });
  const context = workspaceProcessContext({
    runId: "build-run", root, cwd: root, home: { home: folders.home }, logDirectory: folders.temporary, hostRoot: repository,
    source, baseEnvironment: "inherited", accessRule: rule, sandbox,
    additions: workstationCacheEnvironment(folders.home, folders.temporary, source),
  });
  const tools = await createSandboxTools(context.runId, async () => context);
  t.after(async () => { await tools.shutdown(); await rm(directory, { recursive: true, force: true }); });
  const run = async (command: string): Promise<string> => {
    const result = await tools.tools.get("bash")!({ command: `${command} && printf '\\nWORKSTATION_CHECK_OK\\n'`, timeout: 180_000 }, { toolCallId: "build-check" });
    const text = output(result);
    assert.match(text, /^WORKSTATION_CHECK_OK$/m, text);
    return text;
  };
  return { root, folders, context, run };
};

test("isolated workstation restores, builds and tests a .NET solution", { skip: !supported ? "OS sandbox requires macOS or Linux" : !available("dotnet") ? ".NET SDK is not installed" : false, timeout: 300_000 }, async (t) => {
  const f = await fixture(t, "dotnet");
  const tests = path.join(f.root, "Tests");
  await mkdir(tests);
  await writeFile(path.join(tests, "Tests.csproj"), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net10.0</TargetFramework><IsTestProject>true</IsTestProject></PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../CSharpLib/CSharpLib.csproj" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.6.0" />
    <PackageReference Include="NUnit" Version="3.13.3" />
    <PackageReference Include="NUnit3TestAdapter" Version="4.4.2" />
  </ItemGroup>
</Project>\n`);
  await writeFile(path.join(tests, "GreetingTests.cs"), "using NUnit.Framework;\npublic class GreetingTests { [Test] public void Greets() { Assert.That(CSharpLib.Greeter.Greet(\"world\"), Is.EqualTo(\"Hello world\")); } }\n");
  await f.run("dotnet restore Sample.sln && dotnet build Sample.sln --no-restore && dotnet test Tests/Tests.csproj --logger 'console;verbosity=normal'");
});

for (const manager of ["npm", "pnpm"]) {
  test(`isolated workstation restores, builds and tests a ${manager} project`, { skip: !supported ? "OS sandbox requires macOS or Linux" : !available(manager) ? `${manager} is not installed` : false, timeout: 300_000 }, async (t) => {
    const f = await fixture(t, "typescript");
    await writeFile(path.join(f.root, "package.json"), JSON.stringify({ name: "sandbox-build-fixture", private: true, type: "module",
      scripts: { build: "tsc --noEmit", test: "node --test test.mjs" }, devDependencies: { typescript: "5.9.3" },
      ...manager === "pnpm" ? { packageManager: "pnpm@11.22.0" } : {} }));
    await writeFile(path.join(f.root, "test.mjs"), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\ntest('fixture is present', () => assert.match(fs.readFileSync('src/index.ts', 'utf8'), /Hello/));\n");
    await f.run(`${manager} install --ignore-scripts && ${manager} run build && ${manager} test`);
  });
}

for (const [id, file, project] of [["roslyn", "roslyn/Microsoft.CodeAnalysis.LanguageServer.dll", "Sample.sln"], ["fsharp", "fsautocomplete/fsautocomplete.dll", "Sample.sln"], ["typescript", "", "."]] as const) {
  const tools = pluginToolsDirectory(hostDataDirectory(), `ragents.lsp-${id}`);
  const configured = process.env[id === "roslyn" ? "ROSLYN_LANGUAGE_SERVER" : "FSHARP_LANGUAGE_SERVER"];
  const present = id === "typescript" || available("dotnet") && existsSync(configured ?? path.join(tools, file));
  test(`isolated workstation loads ${id} language server`, { skip: !supported ? "OS sandbox requires macOS or Linux" : !present ? `Language server is not installed; run pnpm provision --workspace` : false, timeout: 300_000 }, async (t) => {
    const f = await fixture(t, id === "typescript" ? "typescript" : "dotnet");
    if (id !== "typescript") await f.run("dotnet restore Sample.sln");
    const loaded = await import(path.join(repository, "plugins", `ragents.lsp-${id}`, "executor.ts")) as { executor: WorkspaceExecutorContribution };
    const adapter = loaded.executor(executorMachine(tools)).languageServers![0]!;
    const host = new LanguageServerHost(adapter, async () => f.context);
    t.after(() => host.shutdown());
    const summary = await host.open(f.context.runId, project);
    assert.ok(summary.length > 0);
    if (id === "roslyn") assert.match(summary, /Loaded Sample\.sln/);
  });
}
