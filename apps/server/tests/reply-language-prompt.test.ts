import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { handlebarsPrompt } from "../src/plugin-support/prompt.ts";
import { coordinatorPrompt, preparationPrompt } from "../../../plugins/ragents.overseer/server/coordinator-prompt.ts";

const preamble = () => handlebarsPrompt("test.preamble", 0, fileURLToPath(new URL("../../../plugins/ragents.product/preamble.hbs", import.meta.url))).render({});

test("the coordinator prompts let the user's own words decide the reply language", async () => {
  for (const [label, prompt] of [["global coordinator", coordinatorPrompt], ["preparation", preparationPrompt], ["run coordinator", await preamble()]] as const) {
    assert.match(prompt, /in the language of the user's own words, never in that of [^.]*tool results[^.]*these instructions, which are English/, label);
    assert.match(prompt, /a message too short to tell, such as "go"\s+or "2", keeps the language of the conversation so far/, label);
  }
  assert.match(coordinatorPrompt, /never in that of the interface context/);
});
