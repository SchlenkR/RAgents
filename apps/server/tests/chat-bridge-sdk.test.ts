import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import { frameHtml } from "../../../plugins/ragents.actor-programs/server/routes.ts";
import type { ChatAttachmentInput } from "../src/chat-events.ts";

for (const platformVersion of [2] as const) {
  test(`the v${platformVersion} frame applies the host theme without replacing app styles or state`, async () => {
    const dataset: Record<string, string> = {};
    const sent: Record<string, unknown>[] = [];
    const installedStyles: { textContent: string }[] = [];
    const ownStyles = ":root { color-scheme: light; background: #f5f9fc; }";
    const port = {
      onmessage: undefined as undefined | ((event: { data: Record<string, unknown> }) => void),
      start() {},
      postMessage(message: Record<string, unknown>) { sent.push(message); },
    };
    const scope = vm.createContext({
      URLSearchParams, structuredClone, atob, crypto: { randomUUID },
      window: { addEventListener() {} },
      location: { hash: `#ragentsBridge=${"b".repeat(32)}` },
      document: {
        documentElement: { dataset },
        createElement: () => ({ setAttribute() {}, textContent: "" }),
        head: { prepend(style: { textContent: string }) { installedStyles.push(style); } },
      },
      MessageChannel: class { port1 = port; port2 = {}; },
      parent: { postMessage() {} },
    });
    const html = frameHtml({
      html: "<html><head></head><body></body></html>", styles: ownStyles, clientJavaScript: "", platformVersion,
    }, "nonce");
    const script = html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script);
    vm.runInContext(script, scope);
    assert.equal(dataset.uiSurface, "mini-app");
    assert.equal(dataset.miniAppFrame, "true");
    const receive = (data: Record<string, unknown>) => port.onmessage!({ data: { version: 1, ...data } });
    assert.throws(() => vm.runInContext("globalThis.__ragentsAppContext.actor", scope), /noch nicht bereit/);
    const initial = { type: "ragents.app.ready", theme: "dark", app: { actorId: "owner-id", actorHandle: "editor", actions: [] }, state: { values: { text: "Entwurf" } } };
    assert.throws(() => receive({ ...initial, theme: "system" }), /light oder dark/);
    assert.equal(dataset.theme, undefined);
    assert.equal(sent.length, 0);
    receive(initial);
    await vm.runInContext("globalThis.__ragentsAppContext.ready", scope);
    assert.equal(JSON.stringify(vm.runInContext("globalThis.__ragentsAppContext.actor", scope)), JSON.stringify({ id: "owner-id", handle: "editor" }));
    assert.equal(vm.runInContext("Object.isFrozen(globalThis.__ragentsAppContext.actor)", scope), true);
    assert.equal(dataset.theme, "dark");
    assert.equal(sent.filter(message => message.type === "ragents.app.connected").length, 1);
    const readState = () => JSON.stringify(vm.runInContext("globalThis.__ragentsAppContext.state.read()", scope));
    const state = readState();
    assert.equal(vm.runInContext("globalThis.__ragentsAppContext.state.read() === globalThis.__ragentsAppContext.state.read()", scope), true);
    assert.equal(vm.runInContext("Object.isFrozen(globalThis.__ragentsAppContext.state.read())", scope), true);
    let updates = 0;
    const stateView = vm.runInContext("globalThis.__ragentsAppContext.state", scope) as {
      read(): Readonly<{ text?: string }>;
      subscribe(listener: () => void): () => void;
    };
    const unsubscribe = stateView.subscribe(() => { updates++; });
    const first = stateView.read();
    receive({ type: "ragents.app.state", state: { values: { text: "Gespeichert" } } });
    assert.notEqual(stateView.read(), first);
    assert.equal(stateView.read().text, "Gespeichert");
    assert.equal(updates, 1);
    unsubscribe();
    receive({ type: "ragents.app.state", state: { values: { text: "Entwurf" } } });
    assert.equal(updates, 1);
    const css = installedStyles.map(style => style.textContent);
    if (platformVersion === 2) {
      assert.equal(css.length, 1);
      assert.ok(css[0].includes(".hljs-keyword"));
      assert.ok(css[0].endsWith(ownStyles));
    }
    receive({ type: "ragents.app.theme", theme: "light" });
    assert.equal(dataset.theme, "light");
    receive({ type: "ragents.app.theme", theme: "dark" });
    assert.equal(dataset.theme, "dark");
    for (const theme of [undefined, null, "system", "sepia", {}, 1]) {
      assert.throws(() => receive({ type: "ragents.app.theme", theme }), /light oder dark/);
      assert.equal(dataset.theme, "dark");
    }
    receive({ type: "ragents.app.theme", theme: "light", version: 2 });
    assert.equal(dataset.theme, "dark");
    assert.equal(readState(), state);
    assert.deepEqual(installedStyles.map(style => style.textContent), css);
    assert.equal(sent.filter(message => message.type === "ragents.app.connected").length, 1);
  });
}

test("iframe Escape reaches the host unless the app handles it first", async () => {
  const sent: Record<string, unknown>[] = [];
  let keydown: (event: { key: string; defaultPrevented: boolean }) => void = () => {};
  const scope = vm.createContext({
    URLSearchParams, queueMicrotask, structuredClone, atob, crypto: { randomUUID },
    location: { hash: "#ragentsBridge=frame-token" },
    document: { documentElement: { dataset: {} }, createElement: () => ({ setAttribute() {}, textContent: "" }), head: { prepend() {} } },
    MessageChannel: class { port1 = { start() {} }; port2 = {}; },
    parent: { postMessage(message: Record<string, unknown>) { sent.push(message); } },
    window: { addEventListener(_type: string, handler: typeof keydown) { keydown = handler; } },
  });
  const html = frameHtml({ html: "<html><head></head><body></body></html>", styles: "", clientJavaScript: "", platformVersion: 2 }, "nonce");
  const script = html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  vm.runInContext(script, scope);
  sent.length = 0;
  keydown({ key: "Enter", defaultPrevented: false });
  keydown({ key: "Escape", defaultPrevented: true });
  const handledLater = { key: "Escape", defaultPrevented: false };
  keydown(handledLater);
  handledLater.defaultPrevented = true;
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(sent.length, 0);
  keydown({ key: "Escape", defaultPrevented: false });
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(sent.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), { type: "ragents.app.escape", version: 1, token: "frame-token" });
});

test("the delivered chat SDK shares subscriptions, retains stable snapshots and settles sends", async () => {
  const sent: Record<string, unknown>[] = [];
  const port = {
    onmessage: undefined as undefined | ((event: { data: Record<string, unknown> }) => void),
    start() {},
    postMessage(message: Record<string, unknown>) { sent.push(message); },
  };
  const scope = vm.createContext({
    URLSearchParams, structuredClone, atob, crypto: { randomUUID },
    window: { addEventListener() {} },
    location: { hash: `#ragentsBridge=${"a".repeat(32)}` },
    document: { documentElement: { dataset: {} }, createElement: () => ({ setAttribute() {}, textContent: "" }), head: { prepend() {} } },
    MessageChannel: class { port1 = port; port2 = {}; },
    parent: { postMessage() {} },
  });
  const html = frameHtml({
    html: "<html><head></head><body></body></html>", styles: "", clientJavaScript: "", platformVersion: 2,
  }, "nonce");
  const script = html.match(/<script nonce="nonce">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  vm.runInContext(script, scope);
  const chat = vm.runInContext("globalThis.__ragentsAppContext.chat", scope) as {
    read(actor: string): { messages: { text: string }[]; running: boolean } | undefined;
    subscribe(actor: string, listener: () => void): () => void;
    send(actor: string, text: string, attachments?: ChatAttachmentInput[]): Promise<void>;
  };
  const receive = (data: Record<string, unknown>) => port.onmessage!({ data: { version: 1, ...data } });
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  let updates = 0;
  const unsubscribeFirst = chat.subscribe("primary", () => { updates++; });
  const unsubscribeSecond = chat.subscribe("primary", () => { updates++; });
  assert.equal(chat.read("primary"), undefined);
  assert.equal(sent.length, 0);
  receive({ type: "ragents.app.ready", theme: "light", app: { actorId: "owner-id", actorHandle: "editor", actions: [] }, state: {} });
  await tick();
  const watches = sent.filter((message) => message.type === "ragents.app.chat-watch");
  assert.equal(watches.length, 1);
  assert.equal(sent.some((message) => message.type === "ragents.app.chat-send"), false);
  receive({
    type: "ragents.app.chat-state", actor: "primary", requestId: watches[0].requestId,
    snapshot: { messages: [{ text: "Hallo" }], running: true },
  });
  const snapshot = chat.read("primary")!;
  assert.equal(updates, 2);
  assert.equal(chat.read("primary"), snapshot);
  assert.equal(Object.isFrozen(snapshot.messages[0]), true);
  assert.equal(Object.isFrozen(snapshot.messages), true);
  assert.equal(Object.isFrozen(snapshot), true);
  const success = chat.send("primary", "Weiter");
  await tick();
  const send = sent.at(-1)!;
  assert.equal(send.type, "ragents.app.chat-send");
  assert.equal(send.text, "Weiter");
  receive({ type: "ragents.app.chat-ack", requestId: send.requestId });
  await success;
  const attachments = [{ name: "photo.png", mediaType: "image/png", data: "aGk=" }];
  const media = chat.send("@reviewer", "", attachments);
  await tick();
  assert.equal(sent.at(-1)!.actor, "@reviewer");
  assert.equal(sent.at(-1)!.text, "");
  assert.deepEqual(sent.at(-1)!.attachments, attachments);
  receive({ type: "ragents.app.chat-ack", requestId: sent.at(-1)!.requestId });
  await media;
  const failure = chat.send("primary", "Noch einmal");
  const rejected = assert.rejects(failure, /Verbindung unterbrochen/);
  await tick();
  receive({ type: "ragents.app.error", requestId: sent.at(-1)!.requestId, message: "Verbindung unterbrochen" });
  await rejected;
  unsubscribeFirst();
  assert.equal(sent.some((message) => message.type === "ragents.app.chat-unwatch"), false);
  unsubscribeSecond();
  assert.equal(sent.at(-1)!.type, "ragents.app.chat-unwatch");
  assert.equal(chat.read("primary"), undefined);
  const cancel = chat.subscribe("@reviewer", () => { throw new Error("Already removed"); });
  cancel();
  await tick();
  assert.equal(sent.some((message) => message.actor === "@reviewer" && message.type === "ragents.app.chat-watch"), false);
});
