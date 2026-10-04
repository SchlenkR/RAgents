import assert from "node:assert/strict";
import test from "node:test";
import type { DriverEvent, DriverToolEvent, LiveEvent, TurnRequest } from "@ragents/engine";
import { AcpUpdates } from "../../../plugins/ragents.acp/server/updates.ts";

const fixture = () => {
  const tools: DriverToolEvent[] = [];
  const live: LiveEvent[] = [];
  const output: DriverEvent[] = [];
  const abort = new AbortController();
  const request = {
    emit: (event: DriverEvent) => output.push(event),
    recordTool: (event: DriverToolEvent) => tools.push(event),
    publish: (event: LiveEvent) => {
      if (event.kind === "tool") {
        const start = tools.at(-1);
        assert.ok(start?.kind === "started", "the journal start precedes live publication");
        assert.equal(event.arguments, JSON.stringify(start.input));
        assert.equal(event.id, start.id);
        assert.equal(event.name, start.name);
      }
      live.push(event);
    },
  } as TurnRequest<"external">;
  return { updates: new AcpUpdates(request, abort.signal), tools, live, output, abort };
};

test("pending tool refinements survive text, plans and omitted fields until execution starts", () => {
  const { updates, tools, live } = fixture();
  updates.accept({ sessionUpdate: "tool_call", toolCallId: "call", name: "Bash", title: "Terminal", kind: "execute", status: "pending", rawInput: {} });
  updates.accept({ sessionUpdate: "tool_call_update", toolCallId: "call", title: "Print readiness", rawInput: { command: "printf ready" } });
  updates.accept({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Preparing." } });
  updates.accept({ sessionUpdate: "plan", entries: [] });
  updates.accept({ sessionUpdate: "tool_call_update", toolCallId: "call", title: null, rawInput: undefined, content: undefined });
  assert.deepEqual(tools, []);
  assert.equal(live.some((event) => event.kind === "tool"), false);
  updates.accept({ sessionUpdate: "tool_call_update", toolCallId: "call", status: "in_progress" });
  assert.deepEqual(tools, [{ kind: "started", id: "external_1", name: "Bash", input: { title: "Print readiness", arguments: { command: "printf ready" } } }]);
  updates.accept({ sessionUpdate: "tool_call_update", toolCallId: "call", status: "completed", rawOutput: "ready" });
  updates.accept({ sessionUpdate: "tool_call_update", toolCallId: "call", status: "completed" });
  updates.finish(false);
  assert.deepEqual(tools.map((event) => event.kind), ["started", "completed"]);
  assert.deepEqual(live.filter((event) => event.kind === "tool" || event.kind === "tool-result").map((event) => event.kind), ["tool", "tool-result"]);
});

for (const status of ["completed", "failed"] as const) {
  test(`a pending tool may become ${status} without an in-progress update`, () => {
    const { updates, tools } = fixture();
    updates.accept({ sessionUpdate: "tool_call", toolCallId: "call", title: "Read file", kind: "read", status: "pending" });
    updates.accept({ sessionUpdate: "tool_call_update", toolCallId: "call", title: "Read notes", rawInput: { path: "notes.md" }, status, rawOutput: "Result" });
    updates.finish(false);
    assert.deepEqual(tools.map((event) => event.kind), ["started", status]);
    const start = tools[0]!;
    assert.ok(start.kind === "started");
    assert.deepEqual(start.input, { title: "Read notes", arguments: { path: "notes.md" } });
    assert.equal(start.name, "acp_read");
  });
}

test("permission starts the matching call with refined input and preserves its tool name", () => {
  const { updates, tools } = fixture();
  updates.accept({ sessionUpdate: "tool_call", toolCallId: "call", name: "Bash", title: "Terminal", status: "pending" });
  updates.permission({ toolCallId: "call", title: "Run check", rawInput: { command: "pnpm check" } });
  updates.accept({ sessionUpdate: "tool_call_update", toolCallId: "call", status: "in_progress" });
  updates.accept({ sessionUpdate: "tool_call_update", toolCallId: "call", status: "failed", rawOutput: "Permission denied." });
  updates.finish(false);
  assert.deepEqual(tools, [
    { kind: "started", id: "external_1", name: "Bash", input: { title: "Run check", arguments: { command: "pnpm check" } } },
    { kind: "failed", id: "external_1", name: "Bash", error: "Permission denied." },
  ]);
});

test("turn completion closes pending and running tools while interruption leaves closure to the turn projection", () => {
  const { updates, tools } = fixture();
  updates.accept({ sessionUpdate: "tool_call", toolCallId: "pending", title: "Pending call", status: "pending" });
  updates.accept({ sessionUpdate: "tool_call", toolCallId: "running", title: "Running call", status: "in_progress" });
  updates.finish(false);
  updates.finish(false);
  assert.equal(tools.filter((event) => event.kind === "started").length, 2);
  assert.deepEqual(tools.filter((event) => event.kind === "failed").map((event) => event.error), [
    "External agent ended the turn before starting this tool call.",
    "External agent ended the turn before completing this tool call.",
  ]);
  const interrupted = fixture();
  interrupted.updates.accept({ sessionUpdate: "tool_call", toolCallId: "call", title: "Interrupted call", status: "pending" });
  interrupted.abort.abort();
  interrupted.updates.finish(true);
  assert.deepEqual(interrupted.tools.map((event) => event.kind), ["started"]);
});
