import assert from "node:assert/strict";
import test from "node:test";

import { TODO_STATUSES, todoStateOf } from "../../../plugins/ragents.todo/contract.ts";

const stateWith = (status: unknown) => todoStateOf({ todos: [{ id: "1", text: "Aufgabe", status }] });

test("die Statuswerte des Vertrags sind offen, aktiv und erledigt", () => {
  assert.deepEqual([...TODO_STATUSES], ["open", "active", "completed"]);
});

test("Synonyme und Schreibweisen werden auf die drei Statuswerte abgebildet", () => {
  const expected: Readonly<Record<string, string>> = {
    open: "open",
    offen: "open",
    pending: "open",
    " OFFEN ": "open",
    active: "active",
    doing: "active",
    in_progress: "active",
    "in arbeit": "active",
    "In Arbeit": "active",
    running: "active",
    completed: "completed",
    done: "completed",
    erledigt: "completed",
    finished: "completed",
    "Erledigt ": "completed",
  };

  for (const [input, status] of Object.entries(expected)) {
    assert.deepEqual(stateWith(input), { todos: [{ id: "1", text: "Aufgabe", status }] }, input);
  }
});

test("ein unbekannter Status verwirft den gesamten Zustand", () => {
  assert.equal(stateWith("wartet"), undefined);
  assert.equal(stateWith(""), undefined);
  assert.equal(stateWith(3), undefined);
  assert.equal(stateWith(undefined), undefined);
});

test("ein einziger fehlerhafter Eintrag verwirft den gesamten Zustand", () => {
  const state = todoStateOf({
    todos: [
      { id: "1", text: "gut", status: "open" },
      { id: 2, text: "Kennung ist keine Zeichenkette", status: "open" },
    ],
  });

  assert.equal(state, undefined);
});

test("kein Zustand ohne Todo-Liste", () => {
  assert.equal(todoStateOf(undefined), undefined);
  assert.equal(todoStateOf(null), undefined);
  assert.equal(todoStateOf({}), undefined);
  assert.equal(todoStateOf({ todos: "keine Liste" }), undefined);
  assert.deepEqual(todoStateOf({ todos: [] }), { todos: [] });
});

test("nur die Vertragsfelder überleben die Prüfung", () => {
  const state = todoStateOf({ todos: [{ id: "1", text: "Aufgabe", status: "done", extra: "weg" }] });

  assert.deepEqual(state, { todos: [{ id: "1", text: "Aufgabe", status: "completed" }] });
});
