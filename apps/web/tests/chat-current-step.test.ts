import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages, applyEvent, type Message, DETAIL_MODES, detailModeLabel } from "quassel";
import { CHAT_DETAIL_MODES } from "../../server/src/plugin-support/chat-display-contract.ts";

const render = (messages: Message[], running = true) => renderToStaticMarkup(createElement(ChatMessages, { messages, running }));

function assertCurrentChip(html: string, label: string, expandable = true) {
  assert.match(html, /data-step="row"/);
  assert.deepEqual([...html.matchAll(/data-step="chip"[^>]*title="([^"]*)"/g)].map((match) => match[1]), [label]);
  assert.match(html, /animate-fade-pulse/);
  assert.doesNotMatch(html, /data-step="line"|data-step="detail"/);
  if (expandable) assert.match(html, /<button[^>]*aria-haspopup="dialog"[^>]*data-step="chip"/);
  else {
    assert.match(html, /<span[^>]*data-step="chip"/);
    assert.doesNotMatch(html, /<button|aria-haspopup|role="dialog"/);
  }
}

test("the current default switches between step chips and the answer without a step history", () => {
  const thinking = applyEvent(applyEvent([], { kind: "user", text: "My question" }), { kind: "thinking", delta: "Hidden thinking text" });
  const thoughtHtml = render(thinking);
  assertCurrentChip(thoughtHtml, "Thinking");
  assert.ok(!thoughtHtml.includes("Hidden thinking text"));
  assert.match(thoughtHtml, /data-chat="working"/);

  const tool = applyEvent(thinking, { kind: "tool", id: "first", name: "lookup", arguments: "{}" });
  const toolHtml = render(tool);
  assertCurrentChip(toolHtml, "lookup");
  assert.doesNotMatch(toolHtml, /Thinking|Hidden thinking text/);
  assert.match(toolHtml, /data-chat="working"/);

  const nextTool = applyEvent(tool, { kind: "tool", id: "second", name: "calculate", arguments: "{}" });
  assertCurrentChip(render(nextTool), "calculate");
  assert.ok(!render(nextTool).includes("lookup"));
  const completed = applyEvent(nextTool, { kind: "tool-result", id: "second", result: "42" });
  assert.ok(!render(completed).includes("calculate"));
  assert.ok(!render(completed).includes("lookup"));
  assert.doesNotMatch(render(completed), /data-step="chip"/);
  assert.match(render(completed), /data-chat="working"/);

  const answer = applyEvent(completed, { kind: "text", delta: "My answer", cursor: { conversationId: "chat", sequence: 5, offset: 12 } });
  const answerHtml = render(answer);
  assert.ok(answerHtml.includes("My question"));
  assert.ok(answerHtml.includes("My answer"));
  assert.ok(!answerHtml.includes("lookup"));
  assert.ok(!answerHtml.includes("calculate"));
  assert.ok(!answerHtml.includes("Hidden thinking text"));
  assert.doesNotMatch(answerHtml, /data-step="chip"/);
});

test("running and finished thoughts and waiting actions leave no current step", () => {
  const thinking = applyEvent([], { kind: "thinking", delta: "Private thought" });
  assert.doesNotMatch(render(thinking, false), /Thinking|data-step="chip"|data-chat="working"/);
  assert.doesNotMatch(render(applyEvent(thinking, { kind: "turn-done" })), /Thinking|data-step="chip"/);
  const tool = applyEvent(thinking, { kind: "tool", id: "ask", name: "ask_user", arguments: "{}" });
  assert.ok(!render(tool, false).includes("ask_user"));
  const question = applyEvent(tool, { kind: "action", actionId: "ask", owner: "ragents.ask", text: "Which color?", payload: { question: "Which color?", options: ["Red", "Blue"], multi: false } });
  assert.ok(render(question).includes("Which color?"));
  assert.ok(!render(question).includes("ask_user"));
  assert.doesNotMatch(render(question), /data-step="chip"/);
  const answer = applyEvent(tool, { kind: "text", delta: "I need your choice." });
  assert.match(render(answer), /I need your choice/);
  assert.doesNotMatch(render(answer), /ask_user|data-step="chip"/);
});

test("a follow-up input does not end the running step, any other message does", () => {
  const tool = applyEvent([], { kind: "tool", id: "call", name: "lookup", arguments: "{}" });
  const queued = applyEvent(tool, { kind: "user", text: "Please check the tests too" });
  const queuedHtml = render(queued);
  assertCurrentChip(queuedHtml, "lookup");
  assert.match(queuedHtml, /Please check the tests too/);
  assert.doesNotMatch(render(applyEvent(queued, { kind: "tool-result", id: "call", result: "42" })), /data-step="chip"/);
  const thinking = applyEvent(queued, { kind: "thinking", delta: "Continue" });
  assertCurrentChip(render(thinking), "Thinking");
  const twice = applyEvent(thinking, { kind: "user", text: "And one more thing" });
  assertCurrentChip(render(twice), "Thinking");
  assert.doesNotMatch(render(applyEvent(twice, { kind: "system", text: "Notice" })), /data-step="chip"/);
  assert.doesNotMatch(render(applyEvent(queued, { kind: "system", text: "Notice" })), /data-step="chip"/);
});

test("current belongs to the shared selectable detail levels", () => {
  assert.deepEqual(DETAIL_MODES, CHAT_DETAIL_MODES);
  assert.equal(detailModeLabel("current"), "current");
});

test("non-expandable current mode shows a generic step chip without technical content", () => {
  const show = (messages: Message[], running = true) => renderToStaticMarkup(createElement(ChatMessages, { messages, running, detailMode: "current", stepsExpandable: false }));
  const thinking = applyEvent([], { kind: "thinking", delta: "Hidden thought" });
  assertCurrentChip(show(thinking), "Thinking", false);
  assert.doesNotMatch(show(thinking), /Hidden thought|<button/);
  const tool = applyEvent(thinking, { kind: "tool", id: "browser", name: "browser_check", label: "Private source path", arguments: "Hidden arguments" });
  const html = show(tool);
  assertCurrentChip(html, "Tool running", false);
  assert.match(html, /title="Tool running"/);
  assert.match(html, /data-chat="working"/);
  assert.doesNotMatch(html, /browser_check|Private source path|Hidden arguments|Hidden thought|Thinking/);
  assert.doesNotMatch(show(tool, false), /Tool running|data-step="chip"|data-chat="working"/);
  const completed = applyEvent(tool, { kind: "tool-result", id: "browser", result: "Hidden screenshot" });
  assert.doesNotMatch(show(completed), /Tool running|Hidden screenshot/);
  const failed = applyEvent(tool, { kind: "tool-result", id: "browser", result: "Hidden error", isError: true });
  assert.doesNotMatch(show(failed), /Tool running|Hidden error/);
});

test("redacted empty phase markers stay visible and closed thoughts end", () => {
  const show = (messages: Message[]) => renderToStaticMarkup(createElement(ChatMessages, { messages, running: true, stepsExpandable: false }));
  const thinking = applyEvent([], { kind: "thinking", delta: "" });
  assertCurrentChip(show(thinking), "Thinking", false);
  assert.match(show(thinking), /data-chat="working"/);
  assert.doesNotMatch(show(applyEvent(thinking, { kind: "turn-done" })), /Thinking|data-step="chip"/);
  const tool = applyEvent(thinking, { kind: "tool", id: "redacted", name: "", arguments: "", label: "" });
  assertCurrentChip(show(tool), "Tool running", false);
  assert.match(show(tool), /data-chat="working"/);
  assert.doesNotMatch(show(applyEvent(tool, { kind: "tool-result", id: "redacted", result: "" })), /Tool running/);
});

test("current tool chips bypass custom tool renderers and closed arguments", () => {
  const messages = applyEvent([], { kind: "tool", id: "call", name: "private_tool", arguments: "private_source" });
  const html = renderToStaticMarkup(createElement(ChatMessages, {
    messages,
    running: true,
    stepsExpandable: false,
    renderTool: () => assert.fail("A generic status must not call a tool renderer"),
    toolArgumentsText: () => assert.fail("A generic status must not render arguments"),
  }));
  assertCurrentChip(html, "Tool running", false);
  assert.doesNotMatch(html, /private_tool|private_source/);
  const expanded = renderToStaticMarkup(createElement(ChatMessages, {
    messages,
    running: true,
    stepsExpandable: true,
    renderTool: () => assert.fail("The current step must appear as a chip"),
    toolArgumentsText: () => assert.fail("A closed chip must not render arguments"),
  }));
  assertCurrentChip(expanded, "private_tool");
  assert.doesNotMatch(expanded, /private_source|role="dialog"/);
});

test("current chips use the shared thinking and generic tool texts", () => {
  const show = (messages: Message[]) => renderToStaticMarkup(createElement(ChatMessages, {
    messages, running: true, stepsExpandable: false,
    texts: { thinkingChip: "Pondering", currentTool: "Action running" },
  }));
  assertCurrentChip(show(applyEvent([], { kind: "thinking", delta: "Private" })), "Pondering", false);
  assertCurrentChip(show(applyEvent([], { kind: "tool", id: "tool", name: "private_tool", arguments: "Private" })), "Action running", false);
});

test("the working indicator stays visible in every detail mode while the run is running", () => {
  const thinking = applyEvent([], { kind: "thinking", delta: "Thought" });
  const tool = applyEvent(thinking, { kind: "tool", id: "tool", name: "lookup", arguments: "{}" });
  const completed = applyEvent(tool, { kind: "tool-result", id: "tool", result: "Done" });
  const answer = applyEvent(completed, { kind: "text", delta: "Answer" });
  for (const detailMode of DETAIL_MODES) {
    for (const messages of [[], thinking, tool, completed, answer]) {
      const show = (running: boolean) => renderToStaticMarkup(createElement(ChatMessages, { messages, detailMode, running }));
      assert.match(show(true), /aria-label="Working \.\.\."[^>]*data-chat="working" role="status"/, detailMode);
      assert.doesNotMatch(show(false), /data-chat="working"/, detailMode);
    }
  }
});

test("a custom working indicator stays visible next to the current chip until the end of the turn", () => {
  const messages = applyEvent([], { kind: "tool", id: "tool", name: "lookup", arguments: "{}" });
  const show = (running: boolean) => renderToStaticMarkup(createElement(ChatMessages, {
    messages, running, working: createElement("span", { role: "status" }, "Custom working indicator"),
  }));
  const html = show(true);
  assertCurrentChip(html, "lookup");
  assert.match(html, /role="status">Custom working indicator/);
  assert.doesNotMatch(html, /data-chat="working"/);
  assert.doesNotMatch(show(false), /Custom working indicator|data-step="chip"/);
});
