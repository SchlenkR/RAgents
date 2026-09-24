import assert from "node:assert/strict";
import test from "node:test";
import { chatUserLocation, runUserLocation } from "../src/chat/user-location.ts";
import { sendChatMessage } from "../src/chat/requests.ts";
import { RpcClient } from "../src/rpc/client.ts";
import type { ChatAttachmentInput } from "../../server/src/chat-events.ts";

const tabs = [{ id: "orchestration", label: "Actors" }, { id: "files", label: "Dateien" }];
const selected = { type: "actor", id: "actor-a" };

test("run location uses the current tab label and only the surface entity reference", () => {
  const source = { ...selected, content: "Unrelated panel payload", prompt: "Private form draft" };
  const location = runUserLocation("run-a", "orchestration", tabs, true, source);
  assert.deepEqual(location, { runId: "run-a", tab: "Actors", selection: selected });
  assert.notEqual(location.selection, source);
  assert.equal(runUserLocation("run-a", "files", tabs, true, undefined).tab, "Dateien");
  assert.deepEqual(runUserLocation("run-a", "removed-tab", tabs, true, undefined), { runId: "run-a", tab: null, selection: null });
});

test("collapsing the workspace removes the tab while preserving visible surface selection", () => {
  assert.deepEqual(runUserLocation("run-a", "orchestration", tabs, false, selected), { runId: "run-a", tab: null, selection: selected });
  assert.deepEqual(runUserLocation("run-a", "orchestration", tabs, true, undefined), { runId: "run-a", tab: "Actors", selection: null });
});

test("changing or deselecting the active run immediately removes stale details", () => {
  const previous = runUserLocation("run-a", "orchestration", tabs, true, selected);
  assert.deepEqual(chatUserLocation("run-a", false, previous), { page: "run", runId: "run-a", tab: "Actors", selection: selected });
  assert.deepEqual(chatUserLocation("run-b", false, previous), { page: "run", runId: "run-b", tab: null, selection: null });
  assert.deepEqual(chatUserLocation(undefined, false, previous), { page: "home", runId: null, tab: null, selection: null });
  assert.deepEqual(chatUserLocation("run-b", false, undefined), { page: "run", runId: "run-b", tab: null, selection: null });
  const next = runUserLocation("run-b", "files", tabs, true, { type: "artifact", id: "artifact-b" });
  assert.deepEqual(chatUserLocation("run-b", false, next), { page: "run", runId: "run-b", tab: "Dateien", selection: { type: "artifact", id: "artifact-b" } });
});

test("overview snapshots identify the page without leaking the covered tab or selection", () => {
  const run = runUserLocation("run-a", "orchestration", tabs, true, selected);
  assert.deepEqual(chatUserLocation("run-a", true, run), { page: "overview", runId: "run-a", tab: null, selection: null });
  assert.deepEqual(chatUserLocation(undefined, true, run), { page: "overview", runId: null, tab: null, selection: null });
});

interface SendCall { id: number; method: string; params: Record<string, unknown> }

const sendCalls = (calls: SendCall[]): typeof fetch => async (_url, init) => {
  const call = JSON.parse(String(init?.body)) as SendCall;
  calls.push(call);
  return Response.json({ jsonrpc: "2.0", id: call.id, result: null });
};

test("each send serializes its current location separately while normal chat and attachments remain unchanged", async () => {
  const calls: SendCall[] = [];
  const client = new RpcClient({ fetch: sendCalls(calls) });
  const attachment: ChatAttachmentInput = { name: "note.txt", mediaType: "text/plain", data: "SGFsbG8=" };
  const run = runUserLocation("run-a", "orchestration", tabs, true, selected);
  await sendChatMessage("global", "Was sehe ich?", [attachment], chatUserLocation("run-a", false, run), client);
  await sendChatMessage("global", "Und jetzt?", undefined, chatUserLocation("run-b", false, run), client);
  await sendChatMessage("global", "Startseite?", undefined, chatUserLocation(undefined, false, run), client);
  await sendChatMessage("normal", "Normaler Auftrag", [attachment], undefined, client);
  assert.deepEqual(calls.map((call) => call.method), Array(4).fill("ragents.chat.send"));
  assert.deepEqual(calls[0]!.params, { runId: "global", text: "Was sehe ich?", attachments: [attachment], userLocation: { page: "run", runId: "run-a", tab: "Actors", selection: selected } });
  assert.deepEqual(calls[1]!.params, { runId: "global", text: "Und jetzt?", userLocation: { page: "run", runId: "run-b", tab: null, selection: null } });
  assert.deepEqual(calls[2]!.params, { runId: "global", text: "Startseite?", userLocation: { page: "home", runId: null, tab: null, selection: null } });
  assert.deepEqual(calls[3]!.params, { runId: "normal", text: "Normaler Auftrag", attachments: [attachment] });
});

test("location-aware sending continues to expose server rejection messages", async () => {
  const client = new RpcClient({ fetch: async (_url, init) => {
    const call = JSON.parse(String(init?.body)) as SendCall;
    return Response.json({ jsonrpc: "2.0", id: call.id, error: { code: -32000, message: "Kein Zugriff auf diesen Run" } });
  } });
  await assert.rejects(sendChatMessage("global", "Hallo", undefined, chatUserLocation(undefined, false, undefined), client), /Kein Zugriff auf diesen Run/);
});
