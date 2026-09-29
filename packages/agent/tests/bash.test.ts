import assert from "node:assert/strict";
import test from "node:test";
import {
  BASH_DEFAULT_TIMEOUT_SECONDS,
  BASH_MAX_TIMEOUT_SECONDS,
  createBashToolDefinition,
  type BashOperations,
} from "../src/core/tools/bash.ts";

/** Records the timeout the tool hands its operations; a command either finishes or runs into its timeout. */
const recording = (outcome: "finished" | "timeout" = "finished") => {
  const timeouts: number[] = [];
  const operations: BashOperations = {
    exec: async (_command, _cwd, { onData, timeout }) => {
      timeouts.push(timeout);
      onData(Buffer.from("partial output\n"));
      if (outcome === "timeout") throw new Error(`timeout:${timeout}`);
      return { exitCode: 0 };
    },
  };
  return { timeouts, operations };
};

const call = (definition: ReturnType<typeof createBashToolDefinition>, input: { command: string; timeout?: number }) =>
  definition.execute("call", input, undefined, undefined);

const timeoutSchemaOf = (definition: ReturnType<typeof createBashToolDefinition>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(definition.parameters.properties.timeout)) as Record<string, unknown>;

test("the description and the schema name the default and the maximum timeout and ask long commands for one", () => {
  assert.equal(BASH_DEFAULT_TIMEOUT_SECONDS, 120);
  assert.equal(BASH_MAX_TIMEOUT_SECONDS, 3600);
  const definition = createBashToolDefinition(".");
  assert.match(definition.description,
    /A command is stopped after 120 seconds unless you pass a larger timeout \(at most 3600 seconds\); builds, test runs, installs and other long commands need one\.$/);
  assert.deepEqual(timeoutSchemaOf(definition), {
    type: "number",
    exclusiveMinimum: 0,
    maximum: 3600,
    default: 120,
    description: "Timeout in seconds (default 120, maximum 3600)",
  });
});

test("a call without timeout gets the default, a call may pass any positive timeout up to the maximum", async () => {
  const { timeouts, operations } = recording();
  const definition = createBashToolDefinition(".", { operations });
  await call(definition, { command: "true" });
  await call(definition, { command: "true", timeout: 3600 });
  await call(definition, { command: "true", timeout: 0.5 });
  assert.deepEqual(timeouts, [120, 3600, 0.5]);
});

test("a timeout above the maximum or not above zero is an input error before anything runs", async () => {
  const { timeouts, operations } = recording();
  const definition = createBashToolDefinition(".", { operations });
  await assert.rejects(call(definition, { command: "dotnet build", timeout: 3601 }), /^Error: Invalid timeout 3601: the maximum is 3600 seconds$/);
  await assert.rejects(call(definition, { command: "true", timeout: 0 }), /Invalid timeout 0: must be a positive number of seconds/);
  await assert.rejects(call(definition, { command: "true", timeout: Number.NaN }), /must be a positive number of seconds/);
  assert.deepEqual(timeouts, []);
});

test("an operator default replaces the built-in one in description, schema and calls, and may not exceed the maximum", async () => {
  const { timeouts, operations } = recording();
  const definition = createBashToolDefinition(".", { operations, defaultTimeoutSeconds: 300 });
  assert.match(definition.description, /stopped after 300 seconds unless you pass a larger timeout \(at most 3600 seconds\)/);
  assert.equal(timeoutSchemaOf(definition).default, 300);
  assert.equal(timeoutSchemaOf(definition).description, "Timeout in seconds (default 300, maximum 3600)");
  await call(definition, { command: "true" });
  assert.deepEqual(timeouts, [300]);
  assert.throws(() => createBashToolDefinition(".", { defaultTimeoutSeconds: 4000 }), /^Error: Invalid default timeout 4000: the maximum is 3600 seconds$/);
  assert.throws(() => createBashToolDefinition(".", { defaultTimeoutSeconds: -1 }), /Invalid default timeout -1: must be a positive number of seconds/);
});

test("a stopped command keeps its output and says after how many seconds it stopped and what to do", async () => {
  const { operations } = recording("timeout");
  await assert.rejects(call(createBashToolDefinition(".", { operations }), { command: "grep -r needle ." }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "partial output\n\n\nCommand stopped after 120 seconds (timeout). Narrow the command, for example search with rg "
      + "instead of grep -r, or pass a larger timeout, up to 3600 seconds.");
    return true;
  });
  await assert.rejects(call(createBashToolDefinition(".", { operations }), { command: "dotnet build", timeout: 3600 }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Command stopped after 3600 seconds, the maximum timeout\. Narrow the command, for example search with rg instead of grep -r, or split it into shorter steps\.$/);
    return true;
  });
});

test("the local shell stops a command at its timeout", { skip: process.platform === "win32", timeout: 10_000 }, async () => {
  const definition = createBashToolDefinition(process.cwd());
  await assert.rejects(call(definition, { command: "printf 'started\\n'; sleep 5", timeout: 0.3 }),
    /^Error: started\n\n\nCommand stopped after 0\.3 seconds \(timeout\)\./);
});
