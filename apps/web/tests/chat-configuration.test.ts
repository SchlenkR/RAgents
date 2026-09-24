import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages } from "../src/chat/ChatMessages.tsx";
import type { Message } from "../src/chat/types.ts";

const messages: Message[] = [
  { key: "question", role: "user", text: "Meine Frage", sender: "owner", at: "2026-09-22T14:05:00Z" },
  { key: "answer", role: "assistant", text: "Meine Antwort", sender: "helper", at: "2026-09-22T14:06:00Z", closed: true },
];

const render = (options: Partial<ComponentProps<typeof ChatMessages>> = {}) =>
  renderToStaticMarkup(createElement(ChatMessages, { messages, ...options }));
const timestamps = (html: string) => [...html.matchAll(/<time\b[^>]*>(.*?)<\/time>/g)].map((match) => match[1]);
const buttons = (html: string, label: string) => [...html.matchAll(/<button\b[^>]*>/g)].filter((match) => match[0].includes(`aria-label="${label}"`));

test("default chat appearance keeps timestamps hidden and copying limited to user messages", () => {
  const html = render();
  assert.deepEqual(timestamps(html), []);
  assert.equal(buttons(html, "Nachricht kopieren").length, 1);
  assert.doesNotMatch(html, /data-chat="day-separator"|data-chat="sender"/);
  assert.match(html, /data-message="user"/);
  assert.match(html, /data-message="answer"/);
});

test("timestamp formatting respects the requested locale and time zone", () => {
  const options = { showTimestamps: true, timestampOptions: { locale: "de-DE", timeZone: "UTC" } };
  assert.deepEqual(timestamps(render(options)), ["14:05", "14:06"]);
  assert.deepEqual(timestamps(render({ ...options, timestampOptions: { ...options.timestampOptions, timeZone: "Europe/Berlin" } })), ["16:05", "16:06"]);
  const dates = timestamps(render({ ...options, timestampOptions: { ...options.timestampOptions, format: "date-time" } }));
  assert.match(dates[0], /22\.09\.2026.*14:05/);
  assert.match(dates[1], /22\.09\.2026.*14:06/);
});

test("relative timestamps use the configured language", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-22T14:10:00Z") });
  const html = render({ showTimestamps: true, timestampOptions: { format: "relative", locale: "de-DE", timeZone: "UTC" } });
  assert.deepEqual(timestamps(html), ["vor 5 Minuten", "vor 4 Minuten"]);
});

test("missing and invalid timestamps do not render invalid dates or create day separators", () => {
  const html = render({
    messages: [
      { key: "missing", role: "user", text: "Ohne Zeit" },
      { key: "invalid", role: "assistant", text: "Ungültige Zeit", at: "not-a-date", closed: true },
    ],
    showTimestamps: true,
    timestampOptions: { format: "date-time", locale: "de-DE", timeZone: "UTC", showDaySeparators: true },
  });
  assert.ok(timestamps(html).every((value) => value === ""));
  assert.doesNotMatch(html, /Invalid Date|NaN|not-a-date|data-chat="day-separator"/);
  assert.match(html, /Ohne Zeit/);
  assert.match(html, /Ungültige Zeit/);
});

test("day separators follow calendar days in the configured time zone", () => {
  const datedMessages: Message[] = [
    { key: "first", role: "user", text: "Erster Tag", at: "2026-09-22T21:50:00Z" },
    { key: "second", role: "assistant", text: "Zweiter Tag", at: "2026-09-22T22:10:00Z", closed: true },
    { key: "third", role: "assistant", text: "Noch derselbe Tag", at: "2026-09-22T22:20:00Z", closed: true },
  ];
  const renderDays = (timeZone: string) => render({ messages: datedMessages, timestampOptions: { locale: "de-DE", timeZone, showDaySeparators: true } });
  assert.equal((renderDays("UTC").match(/data-chat="day-separator"/g) ?? []).length, 1);
  assert.equal((renderDays("Europe/Berlin").match(/data-chat="day-separator"/g) ?? []).length, 2);
  assert.deepEqual(timestamps(renderDays("Europe/Berlin")), []);
});

test("grouped steps split at calendar boundaries when day separators are enabled", () => {
  const html = render({
    messages: [
      { key: "first-step", role: "thinking", text: "Erster Gedanke", at: "2026-09-22T23:59:00Z", closed: true },
      { key: "second-step", role: "thinking", text: "Zweiter Gedanke", at: "2026-09-23T00:01:00Z", closed: true },
    ],
    detailMode: "grouped",
    timestampOptions: { timeZone: "UTC", showDaySeparators: true },
  });
  assert.equal((html.match(/data-chat="day-separator"/g) ?? []).length, 2);
  assert.equal((html.match(/data-step="group"/g) ?? []).length, 2);
});

test("message copy controls can be disabled, enabled for all text, or selected per message", () => {
  assert.equal(buttons(render({ messageActions: { copy: false } }), "Nachricht kopieren").length, 0);
  assert.equal(buttons(render({ messageActions: { copy: true } }), "Nachricht kopieren").length, 2);
  assert.equal(buttons(render({ messageActions: { copy: (message) => message.role === "assistant" } }), "Nachricht kopieren").length, 1);
});

test("edit and retry actions only appear when supplied by the host", () => {
  assert.equal(buttons(render(), "Nachricht bearbeiten").length, 0);
  assert.equal(buttons(render(), "Antwort erneut anfordern").length, 0);
  const html = render({ messageActions: { edit: () => {}, retry: () => {} } });
  assert.equal(buttons(html, "Nachricht bearbeiten").length, 1);
  assert.equal(buttons(html, "Antwort erneut anfordern").length, 1);
});

test("custom actions preserve host labels and disabled state", () => {
  const html = render({ messageActions: { custom: (message) => message.role === "assistant" ? [
    { id: "save", label: "Antwort ablegen", disabled: true, onClick: () => {} },
  ] : [] } });
  const customButtons = buttons(html, "Antwort ablegen");
  assert.equal(customButtons.length, 1);
  assert.match(customButtons[0][0], /disabled=""/);
});

test("plain appearance suppresses explicit bubbles while preserving message content", () => {
  const html = render({
    messages: messages.map((message) => ({ ...message, bubble: { color: "#123456", side: "end", label: "Expliziter Name" } })),
    bubbleOptions: { variant: "plain" },
  });
  assert.doesNotMatch(html, /data-message="bubble"|data-message="user"|background:#123456/);
  assert.match(html, /Meine Frage/);
  assert.match(html, /Meine Antwort/);
});

test("bubble options expose alignment, width and resolved sender labels", () => {
  const html = render({ bubbleOptions: {
    variant: "bubbles", maxWidth: "72%", userSide: "start", assistantSide: "end", showSender: true,
    senderLabel: (message) => message.sender === "owner" ? "Alice" : "Helfer",
  } });
  assert.match(html, /data-side="start"/);
  assert.match(html, /data-side="end"/);
  assert.match(html, /72%/);
  assert.equal((html.match(/data-chat="sender"/g) ?? []).length, 2);
  assert.match(html, /Alice/);
  assert.match(html, /Helfer/);
});

test("chat typography keeps numeric line height unitless and numeric gaps in pixels", () => {
  const html = render({ appearance: { fontSize: 18, lineHeight: 1.8, messageGap: 24, denseMessageGap: "0.75rem" } });
  assert.match(html, /--chat-font-size:18px/);
  assert.match(html, /--chat-line-height:1.8(?:;|")/);
  assert.match(html, /--chat-message-gap:24px/);
  assert.match(html, /--chat-dense-message-gap:0.75rem/);
});

test("code block settings leave inline code alone and offer optional block copying", () => {
  const codeMessages: Message[] = [{ key: "code", role: "assistant", text: "Inline `value`\n\n```ts\nconst value = 42;\n```", closed: true }];
  const plain = render({ messages: codeMessages });
  assert.equal(buttons(plain, "Code kopieren").length, 0);
  const html = render({ messages: codeMessages, codeBlockOptions: { wrap: true, maxHeight: 120, showCopyButton: true } });
  assert.equal(buttons(html, "Code kopieren").length, 1);
  assert.equal((html.match(/data-chat="code-block"/g) ?? []).length, 1);
  assert.match(html, /max-height:120px/);
  assert.match(html, /white-space:pre-wrap|whitespace-pre-wrap/);
  assert.match(html, /<code[^>]*>value<\/code>/);
});
