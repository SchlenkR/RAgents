import assert from "node:assert/strict";
import test from "node:test";

import { TODO_STATUSES, todoStateOf } from "../../../plugins/ragents.todo/contract.ts";

const stateWith = (status: unknown) => todoStateOf({ todos: [{ content: "Run tests", status, activeForm: "Running tests" }] });

test("the status values of the contract are pending, in_progress and completed", () => {
  assert.deepEqual([...TODO_STATUSES], ["pending", "in_progress", "completed"]);
});

test("exactly the three status values are a to-do item", () => {
  for (const status of TODO_STATUSES)
    assert.deepEqual(stateWith(status), { todos: [{ content: "Run tests", status, activeForm: "Running tests" }] }, status);

  for (const status of ["open", "active", "done", "PENDING", "waiting", "", 3, undefined])
    assert.equal(stateWith(status), undefined, String(status));
});

test("a state of the former contract is no to-do list", () => {
  assert.equal(todoStateOf({ todos: [{ id: "1", text: "Task", status: "open" }] }), undefined);
});

test("a single faulty entry discards the whole state", () => {
  const state = todoStateOf({
    todos: [
      { content: "good", status: "pending", activeForm: "Doing good" },
      { content: "no present continuous", status: "pending" },
    ],
  });

  assert.equal(state, undefined);
});

test("no state without a todo list", () => {
  assert.equal(todoStateOf(undefined), undefined);
  assert.equal(todoStateOf(null), undefined);
  assert.equal(todoStateOf({}), undefined);
  assert.equal(todoStateOf({ todos: "no list" }), undefined);
  assert.deepEqual(todoStateOf({ todos: [] }), { todos: [] });
});

test("only the contract fields survive the check", () => {
  const state = todoStateOf({ todos: [{ content: "Run tests", status: "completed", activeForm: "Running tests", extra: "gone" }] });

  assert.deepEqual(state, { todos: [{ content: "Run tests", status: "completed", activeForm: "Running tests" }] });
});
