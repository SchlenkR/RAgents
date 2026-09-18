import assert from "node:assert/strict";
import test from "node:test";
import { shellPlatformPrompt, shellPlatformText } from "../src/plugin-support/shell-platform.ts";

test("the shell platform text is derived from the platform and names the exit code contract", () => {
  assert.match(shellPlatformText("darwin"), /macOS.*BSD.*`grep` has no `-P`.*sed -i ''/);
  assert.match(shellPlatformText("linux"), /Linux.*GNU.*`grep -P`/);
  for (const platform of ["darwin", "linux"] as const) assert.match(shellPlatformText(platform), /nonzero exit code.*not as a tool error/);
  assert.throws(() => shellPlatformText("win32"), /keine Shell-Beschreibung/);
});

test("the shell platform prompt is bound to bash and delivered with the initial prompt", async () => {
  const prompt = shellPlatformPrompt("ragents.workspace.shell.prompt", 102);
  assert.deepEqual(prompt.requiresTools, ["bash"]);
  assert.equal(prompt.delivery, "initial");
  assert.equal(await prompt.render({}), `## Shell platform\n\n${shellPlatformText()}`);
});
