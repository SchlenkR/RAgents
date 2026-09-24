import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

test("a custom system prompt stays as the caller wrote it, without a working-directory line", () => {
  assert.equal(buildSystemPrompt({ customPrompt: "Eigener Prompt.", cwd: "/home/user/project" }), "Eigener Prompt.");
});

test("the skill catalog names the location the tools reach and resolves relative paths against its folder", () => {
  const prompt = buildSystemPrompt({
    customPrompt: "Eigener Prompt.",
    cwd: "/home/user/project",
    skills: [{
      name: "review",
      description: "Prüft Änderungen.",
      filePath: "/srv/host/skills/review/SKILL.md",
      baseDir: "/srv/host/skills/review",
      location: "@skills/review/SKILL.md",
      disableModelInvocation: false,
    }],
  });
  assert.match(prompt, /<location>@skills\/review\/SKILL\.md<\/location>/);
  assert.match(prompt, /resolve it against the skill's folder \(its location without SKILL\.md\)/);
  assert.doesNotMatch(prompt, /\/srv\/host/);
});
