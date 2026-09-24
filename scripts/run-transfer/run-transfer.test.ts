import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "./run-transfer.ts";

test("--workspace nennt einen Ordner des Zielservers und wird nie gegen den lokalen Ordner aufgelöst", () => {
  assert.deepEqual(parseArguments(["http://quelle", "http://ziel", "run-1", "--workspace", "/srv/projekt"]), {
    sourceUrl: "http://quelle", targetUrl: "http://ziel", runId: "run-1", workspacePath: "/srv/projekt",
  });
  assert.throws(() => parseArguments(["http://quelle", "http://ziel", "run-1", "--workspace", "projekt"]), /Zielserver und braucht einen absoluten Pfad: projekt/);
  assert.throws(() => parseArguments(["http://quelle", "http://ziel"]), /Pflicht/);
});
