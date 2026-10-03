import assert from "node:assert/strict";
import test from "node:test";
import {
  createTaskOutputToolDefinition,
  createTaskStopToolDefinition,
  type BackgroundTaskOperations,
  type BackgroundTaskOutput,
  type BackgroundTaskStatus,
} from "../src/core/tools/background-tasks.ts";

const running: BackgroundTaskStatus = { state: "running" };

const operationsWith = (output: BackgroundTaskOutput, stopped: BackgroundTaskStatus = running) => {
  const calls: Array<[string, string, number?]> = [];
  const operations: BackgroundTaskOperations = {
    output: async (id, { maxBytes }) => {
      calls.push(["output", id, maxBytes]);
      return output;
    },
    stop: async (id) => {
      calls.push(["stop", id]);
      return stopped;
    },
  };
  return { calls, operations };
};

const textOf = async (result: Promise<{ content: Array<{ type: string; text?: string }> }>): Promise<string> =>
  (await result).content.map((part) => part.text ?? "").join("\n");

test("task_output and task_stop take only task_id, like the standard's output and stop tools, with closed schemas", () => {
  for (const definition of [createTaskOutputToolDefinition(), createTaskStopToolDefinition()]) {
    const schema = JSON.parse(JSON.stringify(definition.parameters)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(schema.properties as object), ["task_id"], definition.name);
    assert.deepEqual(schema.required, ["task_id"]);
    assert.equal(schema.additionalProperties, false);
  }
  assert.deepEqual([createTaskOutputToolDefinition().name, createTaskStopToolDefinition().name], ["task_output", "task_stop"]);
});

test("task_output shows the new output and the status, and asks for at most the bash output limit", async () => {
  const { calls, operations } = operationsWith({ text: "ready on 5173\n", skippedBytes: 0, status: running });
  const definition = createTaskOutputToolDefinition(operations);
  assert.equal(await textOf(definition.execute("call", { task_id: "b1" }, undefined, undefined)), "ready on 5173\n\nStatus: running");
  assert.deepEqual(calls, [["output", "b1", 20 * 1024]]);
  const quiet = createTaskOutputToolDefinition(operationsWith({ text: "", skippedBytes: 0, status: { state: "exited", exitCode: 1, signal: null, stopped: false } }).operations);
  assert.equal(await textOf(quiet.execute("call", { task_id: "b1" }, undefined, undefined)), "(no new output)\n\nStatus: exited with code 1");
  const signalled = createTaskOutputToolDefinition(operationsWith({ text: "x", skippedBytes: 0, status: { state: "exited", exitCode: null, signal: "SIGKILL", stopped: false } }).operations);
  assert.match(await textOf(signalled.execute("call", { task_id: "b1" }, undefined, undefined)), /Status: ended by signal SIGKILL$/);
});

test("task_output keeps the last 2000 lines, shortens long lines, and says how much was left out", async () => {
  const lines = Array.from({ length: 2100 }, (_, index) => `line ${index}`);
  const text = `${lines.join("\n")}\n${"z".repeat(1200)}\n`;
  const definition = createTaskOutputToolDefinition(operationsWith({ text, skippedBytes: 2048, status: running }).operations);
  const result = (await textOf(definition.execute("call", { task_id: "b1" }, undefined, undefined))).split("\n");
  const leftOut = 2048 + lines.slice(0, 101).reduce((sum, line) => sum + line.length + 1, 0);
  assert.equal(result[0], `[${(leftOut / 1024).toFixed(1)}KB of earlier output left out]`);
  assert.equal(result[1], "line 101");
  assert.equal(result.at(-3), `${"z".repeat(1000)} [line shortened, 200 more characters]`);
  assert.equal(result.at(-1), "Status: running");
});

test("task_stop says whether it stopped the command or the command had ended before", async () => {
  const stopped = createTaskStopToolDefinition(operationsWith({ text: "", skippedBytes: 0, status: running },
    { state: "exited", exitCode: null, signal: "SIGTERM", stopped: true }).operations);
  assert.equal(await textOf(stopped.execute("call", { task_id: "b1" }, undefined, undefined)), "Stopped background command b1.");
  const ended = createTaskStopToolDefinition(operationsWith({ text: "", skippedBytes: 0, status: running },
    { state: "exited", exitCode: 0, signal: null, stopped: false }).operations);
  assert.equal(await textOf(ended.execute("call", { task_id: "b1" }, undefined, undefined)), "Background command b1 had already exited with code 0.");
});

test("without operations the tools name the cause instead of guessing", async () => {
  await assert.rejects(createTaskOutputToolDefinition().execute("call", { task_id: "b1" }, undefined, undefined),
    /^Error: task_output is not available: these operations know no background commands of bash\.$/);
  await assert.rejects(createTaskStopToolDefinition().execute("call", { task_id: "b1" }, undefined, undefined), /^Error: task_stop is not available/);
});
