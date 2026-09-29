import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "./run-transfer.ts";

test("--workspace names a folder of the target server and is never resolved against the local folder", () => {
  assert.deepEqual(parseArguments(["http://source", "http://target", "run-1", "--workspace", "/srv/project"]), {
    sourceUrl: "http://source", targetUrl: "http://target", runId: "run-1", workspacePath: "/srv/project",
  });
  assert.throws(() => parseArguments(["http://source", "http://target", "run-1", "--workspace", "project"]), /target server and needs an absolute path: project/);
  assert.throws(() => parseArguments(["http://source", "http://target"]), /required/);
});
