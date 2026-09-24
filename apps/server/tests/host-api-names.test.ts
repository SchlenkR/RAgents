import assert from "node:assert/strict";
import test from "node:test";
import { HOST_API_VERSION } from "../src/host-api.ts";
import { describeHostApiChange, hostApiChanges, hostApiNames, readHostApiRecord, type HostApiRecord } from "../src/plugin-build/host-api-names.ts";

test("host-api.json nennt die Exportnamen der gelisteten Module; jede Änderung verlangt die Entscheidung über HOST_API_VERSION", async () => {
  const stored = readHostApiRecord();
  const current = await hostApiNames();
  const changes = hostApiChanges(stored, current).map(describeHostApiChange);
  assert.deepEqual(changes, [], [
    "Die Exportnamen der Host-API haben sich geändert:",
    ...changes,
    "Entfernte Namen oder eine geänderte Bedeutung brechen gebaute Bundles: dann HOST_API_VERSION in apps/server/src/host-api.ts erhöhen.",
    "Danach pnpm update:host-api; es verweigert entfernte Namen ohne neue Nummer.",
  ].join("\n"));
  assert.equal(stored.version, HOST_API_VERSION, "host-api.json gehört zu einer anderen HOST_API_VERSION; pnpm update:host-api");
});

test("Änderungen der Exportnamen nennen neue und entfernte Namen je Modul, ein entferntes Modul mit allen Namen", () => {
  const before: HostApiRecord = { version: 1, server: { a: ["x", "y"], gone: ["z"] }, web: { b: ["p"] } };
  const after: HostApiRecord = { version: 1, server: { a: ["x", "w"] }, web: { b: ["p"], c: ["q"] } };
  assert.deepEqual(hostApiChanges(before, after).map(describeHostApiChange), [
    "server a: +w -y",
    "server gone: -z",
    "web c: +q",
  ]);
});
