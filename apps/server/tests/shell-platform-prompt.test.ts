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

const registryWith = async (platform: string) => {
  const registry = new WorkspaceClientRegistry();
  await registry.register(
    CLIENT,
    { label: "Laptop", hostname: "laptop", platform, folders: ["C:\\projekte\\werkstatt"], runsDirectory: "C:\\ragents\\runs" },
    WORKSPACE_EXECUTOR_VERSION,
    connection(),
  );
  return registry;
};

test("the shell platform text is derived from the platform and names the exit code contract", () => {
  assert.match(shellPlatformText("darwin"), /macOS.*BSD.*`grep` has no `-P`.*sed -i ''/);
  assert.match(shellPlatformText("linux"), /Linux.*GNU.*`grep -P`/);
  assert.match(shellPlatformText("win32"), /Windows with the bash RAgents brings along/);
  for (const platform of ["darwin", "linux", "win32"] as const) assert.match(shellPlatformText(platform), /nonzero exit code.*not as a tool error/);
  assert.throws(() => shellPlatformText("freebsd"), /keine Shell-Beschreibung/);
});

test("the shell platform prompt is bound to bash and delivered with the initial prompt", async () => {
  const prompt = shellPlatformPrompt("ragents.workspace.shell.prompt", 102);
  assert.deepEqual(prompt.requiresTools, ["bash"]);
  assert.equal(prompt.delivery, "initial");
  assert.equal(await prompt.render({}), shellPlatformChapter(process.platform));
  assert.equal(prompt.renderForRun, undefined);
});

test("the prompt names the platform of the executor that runs the run", async () => {
  const registry = await registryWith("win32");
  const prompt = shellPlatformPrompt("ragents.workspace.shell.prompt", 102, (runId) =>
    executorShellChapter(registry, "alice", runId === "auf-windows"
      ? { machine: { client: CLIENT, label: "Laptop" }, folder: { path: "C:\\projekte\\werkstatt" } }
      : { machine: "server", folder: { path: "/projekte/werkstatt" } }));
  assert.equal(prompt.renderForRun?.("auf-windows"), shellPlatformChapter("win32"));
  assert.equal(prompt.renderForRun?.("auf-dem-server"), shellPlatformChapter(process.platform));
  assert.equal(await prompt.render({}), shellPlatformChapter(process.platform));
});

test("the platform comes only from a workstation of the run owner, never from another user with the same id", async () => {
  const registry = await registryWith("win32");
  const binding = { machine: { client: CLIENT, label: "Laptop" }, folder: { path: "C:\\ragents\\runs\\run-1", fresh: true } } as const;
  assert.equal(executorShellChapter(registry, "alice", binding), shellPlatformChapter("win32"));
  assert.match(executorShellChapter(registry, "bob", binding), /Laptop.*not registered right now/s);
  assert.match(executorShellChapter(registry, null, binding), /Laptop.*not registered right now/s);
});

test("an unregistered workstation is named instead of guessing a platform", () => {
  const chapter = executorShellChapter(new WorkspaceClientRegistry(), "alice", {
    machine: { client: CLIENT, label: "Laptop" },
    folder: { path: "C:\\projekte\\werkstatt" },
  });
  assert.match(chapter, /Laptop.*not registered right now/s);
});
