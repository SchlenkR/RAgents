import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { RequestError, type AgentSideConnection } from "@agentclientprotocol/sdk";
import type { RpcClient } from "../../web/src/rpc/client.ts";
import { acpArguments } from "../../../scripts/acp/acp-cli.ts";
import { ChatStream } from "../../../scripts/acp/chat-stream.ts";
import { boundedText, DISPLAY_TEXT_LIMIT, promptMessage, sessionMcpServers } from "../../../scripts/acp/content.ts";
import { chatUpdates, toolKind } from "../../../scripts/acp/updates.ts";
import { localHostAddress } from "../../../scripts/acp/workspaces.ts";

const cwd = path.resolve("/home/user/project");
const textEvent = { kind: "text" as const, delta: "Hello", cursor: { conversationId: "chat", sequence: 1, offset: 5 } };

test("ACP maps primary text, thought, user replay, and failed results without protocol bookkeeping", () => {
  assert.deepEqual(chatUpdates(textEvent, cwd), [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello" } }]);
  assert.deepEqual(chatUpdates({ kind: "thinking", delta: "Considering" }, cwd), [{ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Considering" } }]);
  assert.deepEqual(chatUpdates({ kind: "user", text: "Task" }, cwd), []);
  assert.deepEqual(chatUpdates({ kind: "system", text: "Workspace: project" }, cwd), [{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Workspace: project\n\n" } }]);
  assert.deepEqual(chatUpdates({ kind: "user", text: "Task" }, cwd, true), [{ sessionUpdate: "user_message_chunk", content: { type: "text", text: "Task" } }]);
  const result = chatUpdates({ kind: "tool-result", id: "call", result: "x".repeat(DISPLAY_TEXT_LIMIT + 1), isError: true }, cwd)[0];
  assert.ok(result?.sessionUpdate === "tool_call_update");
  assert.equal(result.status, "failed");
  assert.equal(result.rawOutput, undefined);
  assert.equal(result.content?.[0]?.type, "content");
  assert.match(JSON.stringify(result.content), /truncated/);
  assert.equal(boundedText("x".repeat(DISPLAY_TEXT_LIMIT + 1)).length, DISPLAY_TEXT_LIMIT);
});

test("ACP tool updates carry native file locations, status transitions, and bounded input diffs", () => {
  const file = path.join(cwd, "src/file.ts");
  assert.deepEqual(chatUpdates({ kind: "tool", id: "edit-call", name: "edit", arguments: JSON.stringify({ file_path: "src/file.ts", old_string: "before", new_string: "after" }) }, cwd), [
    { sessionUpdate: "tool_call", toolCallId: "edit-call", title: "edit", name: "edit", kind: "edit", status: "pending", locations: [{ path: file }] },
    { sessionUpdate: "tool_call_update", toolCallId: "edit-call", status: "in_progress", content: [{ type: "diff", path: file, oldText: "before", newText: "after" }] },
  ]);
  const large = chatUpdates({ kind: "tool", id: "write-call", name: "write", arguments: JSON.stringify({ file_path: "file.ts", content: "x".repeat(DISPLAY_TEXT_LIMIT + 1) }) }, cwd);
  assert.ok(large[1]?.sessionUpdate === "tool_call_update");
  assert.deepEqual(large[1].content, []);
  assert.deepEqual(chatUpdates({ kind: "tool", id: "hidden", name: "read", arguments: "" }, cwd)[0]?.sessionUpdate, "tool_call");
  const alias = chatUpdates({ kind: "tool", id: "alias", name: "read", arguments: '{"file_path":"@actors/helper/file.ts"}' }, cwd)[0];
  assert.ok(alias?.sessionUpdate === "tool_call");
  assert.deepEqual(alias.locations, []);
  assert.equal(toolKind("bash"), "execute");
  assert.equal(toolKind("file_search"), "search");
  assert.equal(toolKind("mcp__fixture__echo"), "other");
});

test("ACP maps the real to-do event envelope and questions with options", () => {
  assert.deepEqual(chatUpdates({ kind: "plugin", pluginId: "ragents.todo", type: "state-replaced", payload: {
    scope: { actorId: "primary" }, state: { todos: [{ content: "Implement", status: "in_progress", activeForm: "Implementing" }] },
  } }, cwd), [{ sessionUpdate: "plan", entries: [{ content: "Implement", status: "in_progress", priority: "medium" }] }]);
  const question = chatUpdates({ kind: "action", actionId: "question", owner: "ragents.ask", text: "Choose", payload: {
    questions: [{ question: "Choose a color", header: "Color", multiSelect: false, options: [{ label: "Red", description: "Warm" }, { label: "Blue", description: "Cool" }] }],
  } }, cwd);
  assert.match(JSON.stringify(question), /Color: Choose a color.*Red: Warm.*Blue: Cool/);
});

test("ACP prompts preserve links, fence bounded resources, validate images, and reject unsupported content", () => {
  const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=";
  const message = promptMessage([{ type: "text", text: "Review" }, { type: "resource_link", name: "Guide", uri: "https://example.com/guide" },
    { type: "resource", resource: { uri: "file:///home/user/project/file.ts", text: "```\nconst x = 1;" } }, { type: "image", data: image, mimeType: "image/png" }]);
  assert.match(message.text, /Guide: https:\/\/example.com\/guide/);
  assert.match(message.text, /Resource "file:\/\/\/home\/user\/project\/file.ts":\n````/);
  assert.deepEqual(message.attachments, [{ name: "image-4", mediaType: "image/png", data: image }]);
  assert.match(promptMessage([{ type: "resource", resource: { uri: "demo://large", text: "x".repeat(20_000) } }]).text, /truncated/);
  assert.throws(() => promptMessage([{ type: "text", text: "x".repeat(65_537) }]), /exceeds/);
  assert.throws(() => promptMessage([{ type: "audio", data: "", mimeType: "audio/wav" }]), /Unsupported/);
  assert.throws(() => promptMessage([]), RequestError);
});

test("ACP normalizes server names deterministically and refuses duplicates and draft transports", () => {
  const servers = sessionMcpServers([{ name: "server.with spaces", command: "node", args: [], env: [{ name: "EXAMPLE_TOKEN", value: "fixture-private" }] },
    { name: "http", type: "http", url: "https://mcp.example.com/mcp", headers: [] }, { name: "old", type: "sse", url: "https://mcp.example.com/sse", headers: [] }]);
  assert.match(Object.keys(servers)[0]!, /^server_with_spaces_[0-9a-f]{12}$/);
  assert.deepEqual(sessionMcpServers([{ name: "server.with spaces", command: "node", args: [], env: [{ name: "EXAMPLE_TOKEN", value: "fixture-private" }] }])[Object.keys(servers)[0]!], servers[Object.keys(servers)[0]!]);
  assert.throws(() => sessionMcpServers([{ name: "duplicate", command: "node", args: [], env: [] }, { name: "duplicate", command: "node", args: [], env: [] }]), /unique/);
  assert.throws(() => sessionMcpServers([{ type: "acp", name: "draft", acpId: "draft" }]), /Unsupported MCP transport/);
});

test("ACP CLI options and local addresses are resolved without changing the parent process", async () => {
  assert.equal(acpArguments(["--profile", "core"]).profile, "core");
  assert.equal(acpArguments(["--data-dir", "/tmp/acp-data"]).dataDirectory, path.resolve("/tmp/acp-data"));
  assert.throws(() => acpArguments(["--profile"]), /needs a value/);
  assert.throws(() => acpArguments(["--unknown"]), /Unknown argument/);
  assert.equal(await localHostAddress("http://127.0.0.1:4710"), true);
  assert.equal(await localHostAddress("http://[::1]:4710"), true);
});

test("ACP cancellation before sending releases a stalled history replay", { timeout: 1000 }, async () => {
  const controller = new AbortController();
  const rpc = { subscribe: () => () => undefined, onStatus: () => () => undefined } as unknown as RpcClient;
  const stream = new ChatStream({ rpc, connection: {} as AgentSideConnection, runId: "pending", cwd, replay: false,
    elicit: false, signal: controller.signal, attachment: async () => undefined });
  try {
    controller.abort();
    await stream.ready();
    assert.equal(await stream.done(), "cancelled");
  } finally { stream.close(); }
});
