import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRelease, findRequestedRun } from "./build-release.ts";

const version = "1.2.3";
const source = "a".repeat(40);
const request = "test-request";
const title = `Build release ${version} (${request})`;

test("a build request selects its exact workflow run among concurrent releases of the same version", async () => {
  const calls: string[][] = [];
  let lists = 0;
  const tools = {
    run: (command: string, args: readonly string[]): string => {
      assert.equal(command, "gh");
      calls.push([...args]);
      if (args[0] === "api") return source;
      if (args[0] === "repo") return "main";
      if (args[0] === "workflow") return "";
      if (args[1] === "list") {
        lists++;
        return JSON.stringify([
          { databaseId: 40, displayTitle: `Build release ${version} (other-request)` },
          ...(lists === 1 ? [] : [{ databaseId: 42, displayTitle: title }]),
        ]);
      }
      if (args[1] === "view") return JSON.stringify({ displayTitle: title, status: "completed", conclusion: "success" });
      if (args[1] === "download") return "";
      throw new Error(`Unexpected gh call: ${args.join(" ")}`);
    },
    watch: (id: number) => { assert.equal(id, 42); },
    pause: async () => undefined,
    request: () => request,
  };
  await buildRelease(version, source, "artifacts", tools);
  assert.deepEqual(calls.find((args) => args[0] === "workflow"), ["workflow", "run", "release.yml", "--ref", "main", "-f", `version=${version}`, "-f", `source=${source}`, "-f", `request=${request}`]);
  assert.deepEqual(calls.at(-1), ["run", "download", "42", "--name", "release-assets", "--dir", "artifacts"]);
  assert.equal(lists, 2);
});

test("failed or mismatched workflow results never download release artifacts", async () => {
  for (const result of [
    { displayTitle: title, status: "completed", conclusion: "failure" },
    { displayTitle: title, status: "in_progress", conclusion: "" },
    { displayTitle: "another-request", status: "completed", conclusion: "success" },
  ]) {
    await assert.rejects(buildRelease(version, source, "artifacts", {
      run: (_command, args) => {
        if (args[0] === "api") return source;
        if (args[0] === "repo") return "main";
        if (args[0] === "workflow") return "";
        if (args[1] === "list") return JSON.stringify([{ databaseId: 42, displayTitle: title }]);
        if (args[1] === "view") return JSON.stringify(result);
        assert.fail("A failed build must not download artifacts");
      },
      watch: () => undefined,
      pause: async () => undefined,
      request: () => request,
    }), /did not complete successfully/);
  }
  assert.throws(() => findRequestedRun([{ databaseId: 1, displayTitle: title }, { databaseId: 2, displayTitle: title }], title), /Multiple/);
});

test("GitHub only builds artifacts and has no publishing secrets, write permission, or automatic tag trigger", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /secrets\.|contents: write|npm publish|vsce publish|gh release|\n  push:/);
  assert.match(workflow, /name: release-assets/);
});
