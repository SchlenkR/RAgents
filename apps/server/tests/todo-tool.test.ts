import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import type { ToolScope } from "@ragents/engine";

import { todoStateOf } from "../../../plugins/ragents.todo/contract.ts";
import { createTodoTool } from "../../../plugins/ragents.todo/server/todo-tool.ts";

const stateAfterReplace = (input: unknown): unknown => {
  let stored: unknown;
  const scope = {
    runtime: { replacePluginState: (_context: unknown, _runId: string, request: { state: unknown }) => { stored = request.state; } },
    caller: { runId: "run-1", actorId: "actor-1", turnId: null },
    context: () => ({}),
    eventsFor: () => [],
  } as unknown as ToolScope;

  createTodoTool().run(scope, "call-1", input as never);

  return stored;
};

test("todo_replace exposes one canonical typed status contract", () => {
  const schema = createTodoTool().schema;

  assert.equal(Value.Check(schema, {
    todos: [
      { id: "done", text: "Done", status: "completed" },
      { id: "active", text: "Running", status: "active" },
      { id: "open", text: "Open", status: "open" },
    ],
  }), true);
  assert.equal(Value.Check(schema, {
    todos: [{ id: "legacy", text: "Old", status: "erledigt" }],
  }), false);
});

test("todo_replace accepts the trained status idioms", () => {
  const schema = createTodoTool().schema;

  assert.equal(Value.Check(schema, {
    todos: [
      { id: "done", text: "Done", status: "done" },
      { id: "active", text: "Running", status: "in_progress" },
      { id: "open", text: "Open", status: "pending" },
    ],
  }), true);
});

test("the trained status idioms are stored as the canonical values", () => {
  assert.deepEqual(stateAfterReplace({
    todos: [
      { id: "done", text: "Done", status: "done" },
      { id: "active", text: "Running", status: "in_progress" },
      { id: "open", text: "Open", status: "pending" },
    ],
  }), {
    todos: [
      { id: "done", text: "Done", status: "completed" },
      { id: "active", text: "Running", status: "active" },
      { id: "open", text: "Open", status: "open" },
    ],
  });
});

test("historical to-do states are normalized when read", () => {
  assert.deepEqual(todoStateOf({
    todos: [
      { id: "done", text: "Done", status: "erledigt" },
      { id: "active", text: "Running", status: "in Arbeit" },
      { id: "open", text: "Open", status: "offen" },
    ],
  }), {
    todos: [
      { id: "done", text: "Done", status: "completed" },
      { id: "active", text: "Running", status: "active" },
      { id: "open", text: "Open", status: "open" },
    ],
  });
});
