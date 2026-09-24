import assert from "node:assert/strict";
import test from "node:test";
import { environmentStateWord, runStateWord, type EnvironmentStateName, type RunStateName } from "../src/ui/state-vocabulary";
import { longTime, shortTime } from "../src/ui/relative-time";
import { environmentState, routeLabel } from "../src/panel/target-state";
import type { TargetState, TargetView } from "../src/panel/contract";

const target = (state: TargetState, kind: TargetView["kind"] = "server"): TargetView => ({
  name: "workshop", kind, address: "http://localhost:4715", state, runs: [], entries: [], canCreate: true,
  route: kind === "profile" ? { kind: "profile", profile: "workshop" } : { kind: "server", host: "localhost:4715", localHost: false },
});

test("jeder Run-Zustand hat genau ein Wort, ein wartender nennt die Zahl offener Eingaben", () => {
  const words: Record<RunStateName, string> = {
    running: "läuft",
    waiting: "wartet auf Eingabe",
    idle: "ruht",
    ended: "beendet",
    failed: "fehlgeschlagen",
    cancelled: "abgebrochen",
  };
  for (const [state, word] of Object.entries(words)) assert.equal(runStateWord(state as RunStateName), word);
  assert.equal(runStateWord("waiting", 2), "wartet auf Eingabe (2)");
  assert.equal(runStateWord("waiting", 0), "wartet auf Eingabe");
  assert.equal(runStateWord("running", 3), "läuft", "die Zahl gehört nur zum Warten");
  for (const word of Object.values(words)) assert.doesNotMatch(word, /Rückfrage|Werkzeug|Tool/, "kein Werkzeugbegriff im Zustand");
});

test("jeder Umgebungszustand hat genau ein Wort", () => {
  const words: Record<EnvironmentStateName, string> = {
    connected: "verbunden",
    ready: "bereit",
    starting: "startet",
    "login-required": "Anmeldung nötig",
    unreachable: "nicht erreichbar",
    stopped: "gestoppt",
    failed: "gescheitert",
    forbidden: "kein Zugriff",
  };
  for (const [state, word] of Object.entries(words)) assert.equal(environmentStateWord(state as EnvironmentStateName), word);
});

test("ein verbundenes lokales Profil ist bereit, ein verbundener Server verbunden", () => {
  assert.equal(environmentState(target({ kind: "connected" })), "connected");
  assert.equal(environmentState(target({ kind: "connected" }, "profile")), "ready");
  assert.equal(environmentState(target({ kind: "starting" }, "profile")), "starting");
  assert.equal(environmentState(target({ kind: "connecting" })), "starting");
  assert.equal(environmentState(target({ kind: "login-required", mode: "password" })), "login-required");
  assert.equal(environmentState(target({ kind: "login-required", mode: "token" })), "login-required");
  assert.equal(environmentState(target({ kind: "unreachable", message: "fetch failed" })), "unreachable");
  assert.equal(environmentState(target({ kind: "forbidden", message: "kein Zugriff" })), "forbidden");
  assert.equal(environmentState(target({ kind: "failed", message: "kein Checkout" }, "profile")), "failed");
  assert.equal(environmentState(target({ kind: "stopped" })), "stopped");
});

test("die Zielzeile nennt lokal und Profil, den Host oder den Host mit lokal, wenn sein Profil hier läuft", () => {
  const workshop = target({ kind: "connected" });
  assert.equal(routeLabel(workshop), "localhost:4715");
  assert.equal(routeLabel({ ...workshop, route: { kind: "server", host: "workshop.example.com:8443", localHost: true } }), "workshop.example.com:8443 \u00b7 lokal");
  assert.equal(routeLabel(target({ kind: "connected" }, "profile")), "lokal \u00b7 workshop");
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("die Zeit ist kompakt, ohne vor und ohne Sonderfall für gestern", () => {
  const now = new Date(2026, 8, 22, 12, 0, 0).getTime();
  assert.equal(shortTime(now, now), "jetzt");
  assert.equal(shortTime(now - 59_000, now), "jetzt");
  assert.equal(shortTime(now - MINUTE, now), "1 min");
  assert.equal(shortTime(now - 5 * MINUTE, now), "5 min");
  assert.equal(shortTime(now - 59 * MINUTE, now), "59 min");
  assert.equal(shortTime(now - HOUR, now), "1 h");
  assert.equal(shortTime(now - 3 * HOUR, now), "3 h");
  assert.equal(shortTime(now - 23 * HOUR, now), "23 h");
  assert.equal(shortTime(now - DAY, now), "1 d", "gestern heißt 1 d");
  assert.equal(shortTime(now - 2 * DAY, now), "2 d");
  assert.equal(shortTime(now - 6 * DAY, now), "6 d");
  assert.equal(shortTime(now - 9 * DAY, now), "13.09.");
  assert.equal(shortTime(now + MINUTE, now), "jetzt", "eine Zeit aus der Zukunft bleibt jetzt");
});

test("die ausgeschriebene Zeit steht nur im title", () => {
  const now = new Date(2026, 8, 22, 12, 0, 0).getTime();
  assert.equal(longTime(now, now), "gerade eben");
  assert.equal(longTime(now - MINUTE, now), "vor 1 Minute");
  assert.equal(longTime(now - 5 * MINUTE, now), "vor 5 Minuten");
  assert.equal(longTime(now - HOUR, now), "vor 1 Stunde");
  assert.equal(longTime(now - 3 * HOUR, now), "vor 3 Stunden");
  assert.equal(longTime(now - DAY, now), "vor 1 Tag");
  assert.equal(longTime(now - 2 * DAY, now), "vor 2 Tagen");
  assert.equal(longTime(now - 9 * DAY, now), "13.09.2026");
});
