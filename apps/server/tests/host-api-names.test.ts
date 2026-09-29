import assert from "node:assert/strict";
import test from "node:test";
import { HOST_API_VERSION } from "../src/host-api.ts";
import { describeHostApiChange, hostApiChanges, hostApiNames, readHostApiRecord, type HostApiRecord } from "../src/plugin-build/host-api-names.ts";

test("host-api.json names the export names of the listed modules; every change requires a decision about HOST_API_VERSION", async () => {
  const stored = readHostApiRecord();
  const current = await hostApiNames();
  const changes = hostApiChanges(stored, current).map(describeHostApiChange);
  assert.deepEqual(changes, [], [
    "The export names of the host API have changed:",
    ...changes,
    "Removed names or a changed meaning break built bundles: then raise HOST_API_VERSION in apps/server/src/host-api.ts.",
    "Then run pnpm update:host-api; it refuses removed names without a new number.",
  ].join("\n"));
  assert.equal(stored.version, HOST_API_VERSION, "host-api.json belongs to a different HOST_API_VERSION; pnpm update:host-api");
});

test("changes of the export names name new and removed names per module, a removed module with all its names", () => {
  const before: HostApiRecord = { version: 1, server: { a: ["x", "y"], gone: ["z"] }, web: { b: ["p"] } };
  const after: HostApiRecord = { version: 1, server: { a: ["x", "w"] }, web: { b: ["p"], c: ["q"] } };
  assert.deepEqual(hostApiChanges(before, after).map(describeHostApiChange), [
    "server a: +w -y",
    "server gone: -z",
    "web c: +q",
  ]);
});
