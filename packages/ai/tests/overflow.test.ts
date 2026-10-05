import assert from "node:assert/strict";
import test from "node:test";
import { fauxAssistantMessage } from "../src/providers/faux.ts";
import { isContextOverflow } from "../src/utils/overflow.ts";

test("a length stop with a few output tokens near the context limit is overflow", () => {
  for (const output of [0, 1, 8]) {
    const message = fauxAssistantMessage("x", { stopReason: "length" });
    message.usage = { ...message.usage, input: 158_420, cacheRead: 100_000, output, totalTokens: 258_420 + output };
    assert.equal(isContextOverflow(message, 262_144), true);
  }
});

test("an ordinary output limit and a length stop away from the context limit are not overflow", () => {
  const message = fauxAssistantMessage("Answer", { stopReason: "length" });
  message.usage = { ...message.usage, input: 98_000, output: 9, totalTokens: 98_009 };
  assert.equal(isContextOverflow(message, 100_000), false);
  message.usage = { ...message.usage, input: 97_999, output: 1, totalTokens: 98_000 };
  assert.equal(isContextOverflow(message, 100_000), false);
  assert.equal(isContextOverflow(message), false);
});
