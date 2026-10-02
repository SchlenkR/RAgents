import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import type { ToolScope } from "@ragents/engine";

import { createTodoTool, todoToolMetadata } from "../../../plugins/ragents.todo/server/todo-tool.ts";

const stateAfterWrite = (input: unknown): unknown => {
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

test("todo_write takes the TodoWrite schema of the leading harness and is a native tool", () => {
  const tool = createTodoTool();

  assert.equal(todoToolMetadata.name, "todo_write");
  assert.notEqual(tool.nativeTool, false);
  assert.equal(Value.Check(tool.schema, {
    todos: [
      { content: "Run tests", status: "completed", activeForm: "Running tests" },
      { content: "Fix the build", status: "in_progress", activeForm: "Fixing the build" },
      { content: "Write the summary", status: "pending", activeForm: "Writing the summary" },
    ],
  }), true);
  assert.equal(Value.Check(tool.schema, { todos: [] }), true);
});

test("todo_write rejects the former contract and invented statuses", () => {
  const schema = createTodoTool().schema;

  assert.equal(Value.Check(schema, { todos: [{ id: "1", text: "Old", status: "open" }] }), false);
  assert.equal(Value.Check(schema, { todos: [{ content: "Run tests", status: "active", activeForm: "Running tests" }] }), false);
  assert.equal(Value.Check(schema, { todos: [{ content: "Run tests", status: "done", activeForm: "Running tests" }] }), false);
  assert.equal(Value.Check(schema, { todos: [{ content: "Run tests", status: "pending" }] }), false);
  assert.equal(Value.Check(schema, { todos: [{ content: "", status: "pending", activeForm: "Running tests" }] }), false);
  assert.equal(Value.Check(schema, { todos: [{ id: "1", content: "Run tests", status: "pending", activeForm: "Running tests" }] }), false);
});

test("todo_write stores the complete list in order with trimmed texts and confirms with null", () => {
  assert.deepEqual(stateAfterWrite({
    todos: [
      { content: " Run tests ", status: "in_progress", activeForm: "Running tests\n" },
      { content: "Fix the build", status: "pending", activeForm: "Fixing the build" },
    ],
  }), {
    todos: [
      { content: "Run tests", status: "in_progress", activeForm: "Running tests" },
      { content: "Fix the build", status: "pending", activeForm: "Fixing the build" },
    ],
  });
  assert.throws(() => stateAfterWrite({ todos: [{ content: "   ", status: "pending", activeForm: "Waiting" }] }), /todos\[0\]\.content is empty/);
});
