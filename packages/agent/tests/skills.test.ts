import assert from "node:assert/strict";
import test from "node:test";
import { formatSkillsForPrompt } from "../src/core/skills.ts";

test("the skill catalog names the location the tools reach and resolves relative paths against its folder", () => {
  const catalog = formatSkillsForPrompt([{
    name: "review",
    description: "Prüft Änderungen.",
    filePath: "/srv/host/skills/review/SKILL.md",
    baseDir: "/srv/host/skills/review",
    location: "@skills/review/SKILL.md",
    disableModelInvocation: false,
  }]);
  assert.match(catalog, /<location>@skills\/review\/SKILL\.md<\/location>/);
  assert.match(catalog, /resolve it against the skill's folder \(its location without SKILL\.md\)/);
  assert.doesNotMatch(catalog, /\/srv\/host/);
});

test("a skill the model may not invoke stays out of the catalog", () => {
  assert.equal(formatSkillsForPrompt([{
    name: "hidden", description: "Nur explizit.", filePath: "/x/SKILL.md", baseDir: "/x", location: "@skills/hidden/SKILL.md", disableModelInvocation: true,
  }]), "");
});
