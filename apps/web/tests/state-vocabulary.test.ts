import assert from "node:assert/strict";
import test from "node:test";
import { connectionStateWord, runStateWord, type ConnectionStateName, type RunStateName } from "../src/ui/state-vocabulary";
import { longTime, shortTime } from "../src/ui/relative-time";
import { connectionState, routeLabel } from "../src/panel/connection-state";
import type { ConnectionState, ConnectionView } from "../src/panel/contract";

const connection = (state: ConnectionState, kind: ConnectionView["kind"] = "server"): ConnectionView => ({
  name: "workshop", kind, address: "http://localhost:4715", state, runs: [], entries: [], canCreate: true,
  route: kind === "profile" ? { kind: "profile", profile: "workshop" } : { kind: "server", host: "localhost:4715", localHost: false },
});

test("every run state has exactly one word, a waiting one names the number of open inputs", () => {
  const words: Record<RunStateName, string> = {
    running: "running",
    waiting: "waiting for input",
    idle: "idle",
    ended: "ended",
    failed: "failed",
    cancelled: "cancelled",
  };
  for (const [state, word] of Object.entries(words)) assert.equal(runStateWord(state as RunStateName), word);
  assert.equal(runStateWord("waiting", 2), "waiting for input (2)");
  assert.equal(runStateWord("waiting", 0), "waiting for input");
  assert.equal(runStateWord("running", 3), "running", "the number belongs only to waiting");
  for (const word of Object.values(words)) assert.doesNotMatch(word, /question|tool/i, "no tool term in the state");
});

test("every server state has exactly one word", () => {
  const words: Record<ConnectionStateName, string> = {
    connected: "connected",
    ready: "ready",
    starting: "starting",
    "login-required": "sign-in required",
    unreachable: "unreachable",
    stopped: "stopped",
    failed: "failed",
    forbidden: "no access",
  };
  for (const [state, word] of Object.entries(words)) assert.equal(connectionStateWord(state as ConnectionStateName), word);
});

test("a connected local profile is ready, a connected server is connected", () => {
  assert.equal(connectionState(connection({ kind: "connected" })), "connected");
  assert.equal(connectionState(connection({ kind: "connected" }, "profile")), "ready");
  assert.equal(connectionState(connection({ kind: "starting" }, "profile")), "starting");
  assert.equal(connectionState(connection({ kind: "connecting" })), "starting");
  assert.equal(connectionState(connection({ kind: "login-required", mode: "password" })), "login-required");
  assert.equal(connectionState(connection({ kind: "login-required", mode: "token" })), "login-required");
  assert.equal(connectionState(connection({ kind: "unreachable", message: "fetch failed" })), "unreachable");
  assert.equal(connectionState(connection({ kind: "forbidden", message: "no access" })), "forbidden");
  assert.equal(connectionState(connection({ kind: "failed", message: "no checkout" }, "profile")), "failed");
  assert.equal(connectionState(connection({ kind: "stopped" })), "stopped");
});

test("the target line names local and profile, the host, or the host with local when its profile runs here", () => {
  const workshop = connection({ kind: "connected" });
  assert.equal(routeLabel(workshop), "localhost:4715");
  assert.equal(routeLabel({ ...workshop, route: { kind: "server", host: "workshop.example.com:8443", localHost: true } }), "workshop.example.com:8443 \u00b7 local");
  assert.equal(routeLabel(connection({ kind: "connected" }, "profile")), "local \u00b7 workshop");
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("the time is compact, without ago and without a special case for yesterday", () => {
  const now = new Date(2026, 8, 22, 12, 0, 0).getTime();
  assert.equal(shortTime(now, now), "now");
  assert.equal(shortTime(now - 59_000, now), "now");
  assert.equal(shortTime(now - MINUTE, now), "1 min");
  assert.equal(shortTime(now - 5 * MINUTE, now), "5 min");
  assert.equal(shortTime(now - 59 * MINUTE, now), "59 min");
  assert.equal(shortTime(now - HOUR, now), "1 h");
  assert.equal(shortTime(now - 3 * HOUR, now), "3 h");
  assert.equal(shortTime(now - 23 * HOUR, now), "23 h");
  assert.equal(shortTime(now - DAY, now), "1 d", "yesterday is 1 d");
  assert.equal(shortTime(now - 2 * DAY, now), "2 d");
  assert.equal(shortTime(now - 6 * DAY, now), "6 d");
  assert.equal(shortTime(now - 9 * DAY, now), "09/13");
  assert.equal(shortTime(now + MINUTE, now), "now", "a time in the future stays now");
});

test("the written-out time appears only in the title", () => {
  const now = new Date(2026, 8, 22, 12, 0, 0).getTime();
  assert.equal(longTime(now, now), "just now");
  assert.equal(longTime(now - MINUTE, now), "1 minute ago");
  assert.equal(longTime(now - 5 * MINUTE, now), "5 minutes ago");
  assert.equal(longTime(now - HOUR, now), "1 hour ago");
  assert.equal(longTime(now - 3 * HOUR, now), "3 hours ago");
  assert.equal(longTime(now - DAY, now), "1 day ago");
  assert.equal(longTime(now - 2 * DAY, now), "2 days ago");
  assert.equal(longTime(now - 9 * DAY, now), "09/13/2026");
});
