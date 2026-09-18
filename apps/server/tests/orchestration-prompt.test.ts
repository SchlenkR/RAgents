import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { handlebarsPrompt } from "../src/plugin-support/prompt.ts";

const promptFile = fileURLToPath(
  new URL("../../../plugins/ragents.orchestration/orchestration.hbs", import.meta.url));

const orchestrationPrompt = () => handlebarsPrompt("test.orchestration", 0, promptFile).render({});

test("the orchestration prompt waits through subscriptions without polling", async () => {
  const prompt = await orchestrationPrompt();
  assert.match(prompt, /end the turn\. Do not poll `event_query`, run\s+sleep loops/);
  assert.match(prompt, /A new matching input\s+starts the next turn/);
  assert.match(prompt, /Use `event_query` for intentional history inspection or recovery/);
  assert.match(prompt, /do not add a filler waiting message/);
});

test("the orchestration prompt avoids duplicate completion inputs", async () => {
  const prompt = await orchestrationPrompt();
  assert.match(prompt, /delivers each as a later ActorInput to its subscriber/);
  assert.match(prompt, /`model\.output\.completed` for answer text, or `turn\.finished`/);
  assert.match(prompt, /Combining answer and finish events routinely produces two\s+inputs/);
  assert.match(prompt, /correlate by turn and act only once/);
});

test("the orchestration prompt reuses existing participants before creating new roles", async () => {
  const prompt = await orchestrationPrompt();
  assert.match(prompt, /Use `actor_list` before creating participants/);
  assert.match(prompt, /A prepared run or another actor may already\s+have created the required roles/);
  assert.match(prompt, /Reuse suitable active actors/);
  assert.match(prompt, /Reusing a name in `agent_spawn` creates another actor with a suffix/);
  assert.match(prompt, /Before retrying,\s+inspect the existing actors, programs and subscriptions/);
});

test("free outcome requests leave technical implementation to the model", async () => {
  const prompt = await orchestrationPrompt();
  assert.match(prompt, /The user describes\s+an outcome; discover the available functions and choose the implementation yourself/);
  assert.match(prompt, /It needs no actor package, persistent setup actor or invented tests/);
  assert.match(prompt, /Snippets and actor programs use the same registered functions and contracts/);
  assert.doesNotMatch(prompt, /must perform the calls that assemble|setup handler must|Run-Builder cannot directly/);
  for (const name of ["20-circle-of-four", "250-balcony-wizard"]) {
    const source = await readFile(new URL(`../../../plugins/ragents.reference/skills/${name}/SKILL.md`, import.meta.url), "utf8");
    const request = source.replace(/^---\n[\s\S]*?\n---\n/, "");
    assert.doesNotMatch(request, /typescript_eval|typescript_api|actor_program_|actor_input|event_subscribe|onInput|context\.functions|Setup-Actor/);
  }
});
