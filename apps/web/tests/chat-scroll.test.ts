import assert from "node:assert/strict";
import test from "node:test";
import { createChatScroll } from "../src/chat/chat-scroll.ts";

test("content and composer growth keep following the actual scroll boundary", () => {
  const changes: boolean[] = [];
  const scroll = createChatScroll((value) => changes.push(value));
  const viewport = { scrollTop: 0, scrollHeight: 1200, clientHeight: 400 };
  scroll.layout(viewport);
  assert.equal(viewport.scrollTop, 800);
  viewport.scrollHeight += 250;
  scroll.scroll(viewport);
  scroll.layout(viewport);
  assert.equal(viewport.scrollTop, 1050);
  viewport.scrollHeight += 160;
  viewport.clientHeight = 300;
  scroll.layout(viewport);
  assert.equal(viewport.scrollTop, 1310);
  assert.deepEqual(changes, []);
});

test("scrolling up pauses; manually reaching the bottom resumes for successive stream updates", () => {
  const changes: boolean[] = [];
  const scroll = createChatScroll((value) => changes.push(value));
  const viewport = { scrollTop: 0, scrollHeight: 1200, clientHeight: 400 };
  scroll.layout(viewport);
  scroll.pause(viewport);
  viewport.scrollTop = 300;
  scroll.scroll(viewport);
  viewport.scrollHeight += 200;
  scroll.layout(viewport);
  assert.equal(viewport.scrollTop, 300);
  viewport.scrollTop = 750;
  scroll.scroll(viewport);
  scroll.layout(viewport);
  assert.equal(viewport.scrollTop, 750);
  viewport.scrollTop = 1000;
  scroll.scroll(viewport);
  for (let i = 0; i < 5; i++) {
    viewport.scrollHeight += 100;
    scroll.layout(viewport);
    scroll.scroll(viewport);
    assert.equal(viewport.scrollTop, viewport.scrollHeight - viewport.clientHeight);
  }
  assert.deepEqual(changes, [false, true]);
});

test("jump resumes immediately and includes all bottom padding", () => {
  const changes: boolean[] = [];
  const scroll = createChatScroll((value) => changes.push(value));
  const viewport = { scrollTop: 0, scrollHeight: 1800, clientHeight: 400 };
  scroll.layout(viewport);
  scroll.pause(viewport);
  viewport.scrollTop = 100;
  scroll.scroll(viewport);
  scroll.jump(viewport);
  assert.equal(viewport.scrollTop, 1400);
  viewport.scrollHeight = 2100;
  scroll.layout(viewport);
  assert.equal(viewport.scrollTop, 1700);
  assert.deepEqual(changes, [false, true]);
});

test("a user scroll before its queued event is preserved during a concurrent message render", () => {
  const changes: boolean[] = [];
  const scroll = createChatScroll((value) => changes.push(value));
  const viewport = { scrollTop: 0, scrollHeight: 1200, clientHeight: 400 };
  scroll.layout(viewport);
  scroll.pause(viewport);
  viewport.scrollTop = 300;
  viewport.scrollHeight += 150;
  scroll.layout(viewport);
  scroll.scroll(viewport);
  assert.equal(viewport.scrollTop, 300);
  assert.deepEqual(changes, [false]);
});

test("a resized viewport that fits the history resumes following", () => {
  const changes: boolean[] = [];
  const scroll = createChatScroll((value) => changes.push(value));
  const viewport = { scrollTop: 0, scrollHeight: 1200, clientHeight: 400 };
  scroll.layout(viewport);
  scroll.pause(viewport);
  viewport.scrollTop = 0;
  scroll.scroll(viewport);
  viewport.clientHeight = 1300;
  scroll.layout(viewport);
  viewport.scrollHeight = 1600;
  scroll.layout(viewport);
  assert.equal(viewport.scrollTop, 300);
  assert.deepEqual(changes, [false, true]);
});


test("browser clamping and anchoring never imply an upward user gesture", () => {
  const changes: boolean[] = [];
  const scroll = createChatScroll((value) => changes.push(value));
  const viewport = {scrollTop:0,scrollHeight:5000,clientHeight:500};
  scroll.layout(viewport);
  viewport.scrollTop = 2800;
  viewport.scrollHeight = 5100;
  scroll.scroll(viewport);
  scroll.layout(viewport);
  assert.equal(viewport.scrollTop,4600);
  assert.deepEqual(changes,[]);
});


test("an invisible tab preserves paused follow state until the user returns to the end", () => {
  const changes: boolean[] = [];
  const scroll = createChatScroll((value) => changes.push(value));
  const viewport = {scrollTop:0,scrollHeight:5000,clientHeight:500};
  scroll.layout(viewport);scroll.pause(viewport);viewport.scrollTop=1000;scroll.scroll(viewport);
  viewport.scrollHeight=0;viewport.clientHeight=0;viewport.scrollTop=0;
  scroll.layout(viewport);scroll.scroll(viewport);
  viewport.scrollHeight=5500;viewport.clientHeight=500;viewport.scrollTop=1000;
  scroll.layout(viewport);
  assert.equal(viewport.scrollTop,1000);
  assert.deepEqual(changes,[false]);
});
