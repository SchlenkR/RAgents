import assert from "node:assert/strict";
import test from "node:test";

import { TODO_STATUSES, todoStateOf } from "../../../plugins/ragents.todo/contract.ts";

const stateWith = (status: unknown) => todoStateOf({ todos: [{ id: "1", text: "Task", status }] });

test("the status values of the contract are open, active and completed", () => {
  assert.deepEqual([...TODO_STATUSES], ["open", "active", "completed"]);
});

test("synonyms and spellings map to the three status values", () => {
  const expected: Readonly<Record<string, string>> = {
    open: "open",
    pending: "open",
    " PENDING ": "open",
    active: "active",
    doing: "active",
    in_progress: "active",
    running: "active",
    completed: "completed",
    done: "completed",
    finished: "completed",
    "Done ": "completed",
  };

  for (const [input, status] of Object.entries(expected)) {
    assert.deepEqual(stateWith(input), { todos: [{ id: "1", text: "Task", status }] }, input);
  }
});

test("an unknown status discards the whole state", () => {
  assert.equal(stateWith("waiting"), undefined);
  assert.equal(stateWith(""), undefined);
  assert.equal(stateWith(3), undefined);
  assert.equal(stateWith(undefined), undefined);
});

test("a single faulty entry discards the whole state", () => {
  const state = todoStateOf({
    todos: [
      { id: "1", text: "good", status: "open" },
      { id: 2, text: "ID is not a string", status: "open" },
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
  const state = todoStateOf({ todos: [{ id: "1", text: "Task", status: "done", extra: "gone" }] });

  assert.deepEqual(state, { todos: [{ id: "1", text: "Task", status: "completed" }] });
});
