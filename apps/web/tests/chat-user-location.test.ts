import assert from "node:assert/strict";
import test from "node:test";
import { chatUserLocation, runUserLocation } from "../src/chat/user-location.ts";
import { sendChatMessage } from "../src/chat/requests.ts";
import type { ChatAttachmentInput } from "../../server/src/chat-events.ts";

const tabs = [{ id: "orchestration", label: "Actors" }, { id: "files", label: "Dateien" }];
const selected = { type: "actor", id: "actor-a" };

test("run location uses the current tab label and only the canvas entity reference", () => {
  const source = { ...selected, content: "Unrelated panel payload", prompt: "Private form draft" };
  const location = runUserLocation("run-a", "orchestration", tabs, true, source);
  assert.deepEqual(location, { runId: "run-a", tab: "Actors", selection: selected });
  assert.notEqual(location.selection, source);
  assert.equal(runUserLocation("run-a", "files", tabs, true, undefined).tab, "Dateien");
  assert.deepEqual(runUserLocation("run-a", "removed-tab", tabs, true, undefined), { runId: "run-a", tab: null, selection: null });
});

test("collapsing the workspace removes the tab while preserving visible canvas selection", () => {
  assert.deepEqual(runUserLocation("run-a", "orchestration", tabs, false, selected), { runId: "run-a", tab: null, selection: selected });
  assert.deepEqual(runUserLocation("run-a", "orchestration", tabs, true, undefined), { runId: "run-a", tab: "Actors", selection: null });
});

test("changing or deselecting the active run immediately removes stale details", () => {
  const previous = runUserLocation("run-a", "orchestration", tabs, true, selected);
  assert.deepEqual(chatUserLocation("run-a", false, previous), { surface: "run", runId: "run-a", tab: "Actors", selection: selected });
  assert.deepEqual(chatUserLocation("run-b", false, previous), { surface: "run", runId: "run-b", tab: null, selection: null });
  assert.deepEqual(chatUserLocation(undefined, false, previous), { surface: "home", runId: null, tab: null, selection: null });
  assert.deepEqual(chatUserLocation("run-b", false, undefined), { surface: "run", runId: "run-b", tab: null, selection: null });
  const next = runUserLocation("run-b", "files", tabs, true, { type: "artifact", id: "artifact-b" });
  assert.deepEqual(chatUserLocation("run-b", false, next), { surface: "run", runId: "run-b", tab: "Dateien", selection: { type: "artifact", id: "artifact-b" } });
});

test("overview snapshots identify the surface without leaking the covered tab or selection", () => {
  const run = runUserLocation("run-a", "orchestration", tabs, true, selected);
  assert.deepEqual(chatUserLocation("run-a", true, run), { surface: "overview", runId: "run-a", tab: null, selection: null });
  assert.deepEqual(chatUserLocation(undefined, true, run), { surface: "overview", runId: null, tab: null, selection: null });
});

test("each send serializes its current location separately while normal chat and attachments remain unchanged", async () => {
  const requests: { url: string; init: RequestInit }[] = [];
  const request: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init: init! });
    return new Response(null, { status: 204 });
  };
  const attachment: ChatAttachmentInput = { name: "note.txt", mediaType: "text/plain", data: "SGFsbG8=" };
  const run = runUserLocation("run-a", "orchestration", tabs, true, selected);
  await sendChatMessage("/chat/global", "Was sehe ich?", [attachment], chatUserLocation("run-a", false, run), { "X-Test": "yes" }, request);
  await sendChatMessage("/chat/global", "Und jetzt?", undefined, chatUserLocation("run-b", false, run), {}, request);
  await sendChatMessage("/chat/global", "Startseite?", undefined, chatUserLocation(undefined, false, run), {}, request);
  await sendChatMessage("/chat/normal", "Normaler Auftrag", [attachment], undefined, {}, request);
  const bodies = requests.map((entry) => JSON.parse(String(entry.init.body)));
  assert.deepEqual(bodies[0], { text: "Was sehe ich?", attachments: [attachment], userLocation: { surface: "run", runId: "run-a", tab: "Actors", selection: selected } });
  assert.deepEqual(bodies[1], { text: "Und jetzt?", userLocation: { surface: "run", runId: "run-b", tab: null, selection: null } });
  assert.deepEqual(bodies[2], { text: "Startseite?", userLocation: { surface: "home", runId: null, tab: null, selection: null } });
  assert.deepEqual(bodies[3], { text: "Normaler Auftrag", attachments: [attachment] });
  assert.equal(requests[0]!.url, "/chat/global/send");
  assert.equal(requests[3]!.url, "/chat/normal/send");
  assert.equal(requests[0]!.init.method, "POST");
  assert.deepEqual(requests[0]!.init.headers, { "Content-Type": "application/json", "X-Test": "yes" });
});

test("location-aware sending continues to expose server rejection messages", async () => {
  await assert.rejects(sendChatMessage("/chat/global", "Hallo", undefined, chatUserLocation(undefined, false, undefined), {}, async () =>
    Response.json({ error: "Kein Zugriff auf diesen Run" }, { status: 403 })), /Kein Zugriff auf diesen Run/);
});
