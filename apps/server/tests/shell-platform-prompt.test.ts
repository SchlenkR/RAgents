import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { MethodConnection } from "@ragents/engine";
import { WORKSPACE_EXECUTOR_VERSION, shellPlatformText } from "@ragents/workspace-executor";
import { shellPlatformChapter, shellPlatformPrompt } from "../../../plugins/ragents.workspace/server/shell-platform.ts";
import { executorShellChapter } from "../../../plugins/ragents.workspace/server/binding.ts";
import { WorkspaceClientRegistry } from "../../../plugins/ragents.workspace/server/clients.ts";

const CLIENT = "client-00000001";

const connection = (): MethodConnection => ({
  id: randomUUID(),
  userId: "alice",
  streamless: false,
  call: () => Promise.reject(new Error("Dieser Arbeitsplatz antwortet nicht")),
  onClose: () => () => undefined,
});

const registryWith = async (platform: string, ripgrep: boolean) => {
  const registry = new WorkspaceClientRegistry([]);
  await registry.register(
    CLIENT,
    { label: "Laptop", hostname: "laptop", platform, folders: ["C:\\projekte\\werkstatt"], runsDirectory: "C:\\ragents\\runs", ripgrep },
    WORKSPACE_EXECUTOR_VERSION,
    [],
    connection(),
  );
  return registry;
};

const onServer = { ripgrep: true } as const;

test("the shell platform text is derived from the platform and names the exit code contract", () => {
  assert.match(shellPlatformText("darwin", onServer), /macOS.*BSD.*`grep` has no `-P`.*sed -i ''/);
  assert.match(shellPlatformText("linux", onServer), /Linux.*GNU.*`grep -P`/);
  assert.match(shellPlatformText("win32", onServer), /Windows with the bash RAgents brings along/);
  for (const platform of ["darwin", "linux", "win32"] as const) assert.match(shellPlatformText(platform, onServer), /nonzero exit code.*not as a tool error/);
  assert.throws(() => shellPlatformText("freebsd", onServer), /keine Shell-Beschreibung/);
});

test("the shell platform prompt is bound to bash and delivered with the initial prompt", async () => {
  const prompt = shellPlatformPrompt("ragents.workspace.shell.prompt", 102, onServer);
  assert.deepEqual(prompt.requiresTools, ["bash"]);
  assert.equal(prompt.delivery, "initial");
  assert.equal(await prompt.render({}), shellPlatformChapter(process.platform, onServer));
  assert.equal(prompt.renderForRun, undefined);
  assert.match(await prompt.render({}), /Search code with `rg`/);
  assert.match(await shellPlatformPrompt("ragents.workspace.shell.prompt", 102, { ripgrep: false }).render({}), /`rg` \(ripgrep\) is not available here/);
});

test("the prompt names the platform and search tool of the executor that runs the run", async () => {
  const registry = await registryWith("win32", false);
  const prompt = shellPlatformPrompt("ragents.workspace.shell.prompt", 102, onServer, (runId) =>
    executorShellChapter(registry, "alice", runId === "auf-windows"
      ? { machine: { client: CLIENT, label: "Laptop" }, folder: { path: "C:\\projekte\\werkstatt" } }
      : { machine: "server", folder: { path: "/projekte/werkstatt" } }, onServer));
  assert.equal(prompt.renderForRun?.("auf-windows"), shellPlatformChapter("win32", { ripgrep: false }));
  assert.match(prompt.renderForRun?.("auf-windows") ?? "", /not available here.*--exclude-dir=node_modules/s);
  assert.equal(prompt.renderForRun?.("auf-dem-server"), shellPlatformChapter(process.platform, onServer));
  assert.equal(await prompt.render({}), shellPlatformChapter(process.platform, onServer));
});

test("a workstation that reports rg gets the rg search, whatever the server has", async () => {
  const registry = await registryWith("win32", true);
  const binding = { machine: { client: CLIENT, label: "Laptop" }, folder: { path: "C:\\projekte\\werkstatt" } } as const;
  const chapter = executorShellChapter(registry, "alice", binding, { ripgrep: false });
  assert.equal(chapter, shellPlatformChapter("win32", { ripgrep: true }));
  assert.match(chapter, /Search code with `rg` \(ripgrep\)/);
});

test("the platform comes only from a workstation of the run owner, never from another user with the same id", async () => {
  const registry = await registryWith("win32", true);
  const binding = { machine: { client: CLIENT, label: "Laptop" }, folder: { path: "C:\\ragents\\runs\\run-1", fresh: true } } as const;
  assert.equal(executorShellChapter(registry, "alice", binding, onServer), shellPlatformChapter("win32", { ripgrep: true }));
  assert.match(executorShellChapter(registry, "bob", binding, onServer), /Laptop.*not registered right now/s);
  assert.match(executorShellChapter(registry, null, binding, onServer), /Laptop.*not registered right now/s);
});

test("an unregistered workstation is named instead of guessing a platform", () => {
  const chapter = executorShellChapter(new WorkspaceClientRegistry([]), "alice", {
    machine: { client: CLIENT, label: "Laptop" },
    folder: { path: "C:\\projekte\\werkstatt" },
  }, onServer);
  assert.match(chapter, /Laptop.*not registered right now/s);
});
