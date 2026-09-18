import assert from "node:assert/strict";
import test from "node:test";
import { createActorProgramsApi, type RunAppInvocation, type ActorProgramsApi, type RunApp } from "../../../plugins/ragents.actor-programs/web/api.ts";
import { invokeActorFunction } from "../../../plugins/ragents.actor-programs/web/function-call.ts";
import { activeActorInvocations, readActorInvocation } from "../../../plugins/ragents.actor-programs/web/invocations.ts";
import { actorFunctionInput } from "../../../plugins/ragents.actor-programs/web/function-input.ts";
import type { RunToolParameter } from "../../../plugins/ragents.actor-programs/web/api.ts";

const parameter = (name: string, type: RunToolParameter["type"], required = true): RunToolParameter => ({ name, type, required, description: name });
const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
};

test("function forms preserve text and convert numeric, boolean and structured input", () => {
  assert.deepEqual(actorFunctionInput([
    parameter("text", "string"), parameter("amount", "number"), parameter("count", "integer"),
    parameter("enabled", "boolean"), parameter("tags", "string[]"), parameter("values", "number[]"), parameter("options", "json"),
  ], form({ text: "  first\nsecond  ", amount: "0", count: "-2", tags: "first\nsecond", values: "[0, 2.5]", options: '{"nested":[false,null]}' })), {
    text: "  first\nsecond  ", amount: 0, count: -2, enabled: false, tags: ["first", "second"], values: [0, 2.5], options: { nested: [false, null] },
  });
  assert.deepEqual(actorFunctionInput([parameter("tags", "string[]")], form({ tags: '["a,b", " c "]' })), { tags: ["a,b", " c "] });
});

test("optional parameters can be omitted and optional booleans distinguish omission from false", () => {
  const parameters = [parameter("text", "string", false), parameter("count", "integer", false), parameter("enabled", "boolean", false)];
  assert.deepEqual(actorFunctionInput(parameters, form({})), {});
  assert.deepEqual(actorFunctionInput(parameters, form({ enabled: "false" })), { enabled: false });
  assert.deepEqual(actorFunctionInput(parameters, form({ enabled: "true" })), { enabled: true });
  assert.deepEqual(actorFunctionInput([], form({})), {});
});

test("invalid numeric and JSON input fails before a function can be invoked", () => {
  for (const [type, raw] of [
    ["number", " "], ["number", "Infinity"], ["integer", "2.5"], ["json", "{"],
    ["json", "1e400"], ["number[]", '[1,"2"]'], ["number[]", "2"], ["string[]", "[1]"],
  ] as const) {
    assert.throws(() => actorFunctionInput([parameter("value", type)], form({ value: raw })), /value/);
  }
});

const request = { actorHandle: "counter", functionId: "increment", revision: "build" };
const invocation: RunAppInvocation = { id: "call", actorId: "actor", actorHandle: "counter", appId: "counter", actionId: "increment", revision: "build", requestId: "request", output: [], createdAt: "now", status: "queued" };

test("views of one actor poll a shared function invocation only once through its actor", () => {
  const first: RunApp = { id: "counter--board", title: "Board", actorId: "actor", actorHandle: "counter", revision: "build", actions: [], placements: [], state: { version: 1, revision: 0, values: {} }, invocations: [invocation] };
  const second = { ...first, id: "counter--detail" };
  assert.deepEqual(activeActorInvocations([first, second]), [{ kind: "function", actorHandle: "counter", invocationId: "call" }]);
  assert.deepEqual(activeActorInvocations([first, second], false), []);
  const done: RunAppInvocation = { ...invocation, status: "succeeded", startedAt: "now", finishedAt: "later", result: {} };
  assert.deepEqual(activeActorInvocations([{ ...first, invocations: [done] }, { ...second, invocations: [done] }]), []);
});

test("shared mini-app invocations poll their originating view without calling the restricted actor endpoint", async () => {
  const running: RunAppInvocation = { ...invocation, appId: "counter--board", status: "running", startedAt: "now" };
  const first: RunApp = { id: "counter--board", title: "Board", actorId: "actor", actorHandle: "counter", revision: "build", actions: [], placements: [], state: { version: 1, revision: 0, values: {} }, invocations: [running, { ...invocation, id: "function-call" }] };
  const second = { ...first, id: "counter--detail" };
  const requests: string[] = [];
  const signal = new AbortController().signal;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    assert.equal(init?.signal, signal);
    if (url.includes("/actors/")) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    return new Response(JSON.stringify({ ...running, status: "succeeded", finishedAt: "later", result: { count: 1 } }), { status: 200 });
  };
  try {
    const targets = activeActorInvocations([first, second], false);
    assert.deepEqual(targets, [{ kind: "app", appId: "counter--board", invocationId: "call" }]);
    const results = await Promise.all(targets.map((target) => readActorInvocation(createActorProgramsApi("/api/plugins/ragents.actor-programs"), "run", target, signal)));
    assert.deepEqual(results.map((result) => result.status), ["succeeded"]);
    assert.deepEqual(requests, ["/api/plugins/ragents.actor-programs/runs/run/apps/counter--board/invocations/call"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("a function card invokes its actor directly and follows completion without an LLM input", async () => {
  const requests: { url: string; body: unknown }[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (init?.method === "POST") return new Response(JSON.stringify(invocation), { status: 202 });
    return new Response(JSON.stringify({ ...invocation, status: "succeeded", startedAt: "now", finishedAt: "later", result: { count: 1 } }), { status: 200 });
  };
  try {
    const states: string[] = [];
    const result = await invokeActorFunction(createActorProgramsApi("/api/plugins/ragents.actor-programs"), "run", request, { amount: 1 }, new AbortController().signal, (value) => states.push(value.status));
    assert.equal(result.status, "succeeded");
    assert.deepEqual(states, ["queued", "succeeded"]);
    assert.deepEqual(requests.map((entry) => entry.url), [
      "/api/plugins/ragents.actor-programs/runs/run/actors/counter/functions/increment",
      "/api/plugins/ragents.actor-programs/runs/run/actors/counter/invocations/call",
    ]);
    assert.deepEqual({ ...(requests[0]!.body as object), requestId: "generated" }, { revision: "build", requestId: "generated", input: { amount: 1 } });
  } finally { globalThis.fetch = originalFetch; }
});

test("unmounting a function card stops its polling without submitting another invocation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const api = {
    invokeFunction: async () => { calls += 1; return invocation; },
    functionInvocation: async () => { throw new Error("Polling must be cancelled"); },
  } as unknown as ActorProgramsApi;
  await assert.rejects(invokeActorFunction(api, "run", request, {}, controller.signal, () => controller.abort(new Error("view removed"))), /view removed/);
  assert.equal(calls, 1);
});
