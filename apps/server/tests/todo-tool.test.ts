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
      { id: "done", text: "Fertig", status: "completed" },
      { id: "active", text: "Läuft", status: "active" },
      { id: "open", text: "Offen", status: "open" },
    ],
  }), true);
  assert.equal(Value.Check(schema, {
    todos: [{ id: "legacy", text: "Alt", status: "erledigt" }],
  }), false);
});

test("todo_replace accepts the trained status idioms", () => {
  const schema = createTodoTool().schema;

  assert.equal(Value.Check(schema, {
    todos: [
      { id: "done", text: "Fertig", status: "done" },
      { id: "active", text: "Läuft", status: "in_progress" },
      { id: "open", text: "Offen", status: "pending" },
    ],
  }), true);
});

test("the trained status idioms are stored as the canonical values", () => {
  assert.deepEqual(stateAfterReplace({
    todos: [
      { id: "done", text: "Fertig", status: "done" },
      { id: "active", text: "Läuft", status: "in_progress" },
      { id: "open", text: "Offen", status: "pending" },
    ],
  }), {
    todos: [
      { id: "done", text: "Fertig", status: "completed" },
      { id: "active", text: "Läuft", status: "active" },
      { id: "open", text: "Offen", status: "open" },
    ],
  });
});

test("historical to-do states are normalized when read", () => {
  assert.deepEqual(todoStateOf({
    todos: [
      { id: "done", text: "Fertig", status: "erledigt" },
      { id: "active", text: "Läuft", status: "in Arbeit" },
      { id: "open", text: "Offen", status: "offen" },
    ],
  }), {
    todos: [
      { id: "done", text: "Fertig", status: "completed" },
      { id: "active", text: "Läuft", status: "active" },
      { id: "open", text: "Offen", status: "open" },
    ],
  });
});
