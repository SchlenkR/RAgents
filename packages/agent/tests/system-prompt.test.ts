import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

test("a custom system prompt stays as the caller wrote it, without a working-directory line", () => {
  assert.equal(buildSystemPrompt({ customPrompt: "Eigener Prompt.", cwd: "/home/user/project" }), "Eigener Prompt.");
});
