import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceProcessContext } from "../src/context.ts";
import { checkedTcpForwards, tcpEndpoints, withSandboxedLaunch } from "../src/process-sandbox.ts";

const forwards = [{ host: "db.example.test", port: 1433, insidePort: 11433 }];

test("TCP forwards validate hosts, target ports, distinct inside ports and publication conflicts", () => {
  assert.deepEqual(checkedTcpForwards(forwards), forwards);
  assert.deepEqual(checkedTcpForwards([]), []);
  assert.deepEqual(checkedTcpForwards([{ host: "::1", port: 1, insidePort: 65535 }]), [{ host: "::1", port: 1, insidePort: 65535 }]);
  for (const value of [null, undefined, "db.example.test:1433", [null], [{}],
    ...["", "*", "*.example.test", "http://db.example.test", "db.example.test:1433", "db.example.test/", " db.example.test", "db\0.example.test", "::1%lo"].map((host) => [{ ...forwards[0], host }]),
    ...[0, -1, 65536, 1.5, NaN, Infinity, "1433", null].flatMap((port) => [[{ ...forwards[0], port }], [{ ...forwards[0], insidePort: port }]]),
    [...forwards, ...forwards],
  ]) assert.throws(() => checkedTcpForwards(value), { code: "process-tcp-invalid" });
  assert.throws(() => checkedTcpForwards(forwards, [11433]), { code: "process-tcp-invalid" });
});

test("TCP endpoints without a sandbox return the original targets and allocate no bridge", async () => {
  const context = {} as WorkspaceProcessContext;
  assert.deepEqual(await tcpEndpoints(context, forwards), [{ host: "db.example.test", port: 1433 }]);
  const launch = { command: "acme", args: [] };
  await withSandboxedLaunch(context, launch, [], async (actual) => assert.equal(actual, launch), forwards);
});

test("a combined TCP launch closes once after completion, failure or cancellation during preparation", async () => {
  for (const mode of ["success", "failure", "cancel"]) {
    const calls: string[] = [];
    const controller = new AbortController();
    const launch = { command: "acme", args: [] };
    const context = { sandbox: {
      wrap: async () => { assert.fail("The launch must use its combined bridge"); },
      publishPorts: async () => { assert.fail("Publication must share the TCP bridge"); },
      tcpEndpoints: async () => [{ host: "127.0.0.1", port: 11433 }],
      forwardTcp: async (input: typeof launch, targets: typeof forwards, ports: readonly number[]) => {
        assert.deepEqual(input, launch);
        assert.deepEqual(targets, forwards);
        assert.deepEqual(ports, [12000]);
        calls.push("prepare");
        if (mode === "cancel") controller.abort(new Error("Cancelled during preparation"));
        return { launch: { command: "wrapped", args: [] }, close: async () => { calls.push("close"); } };
      },
    } } as unknown as WorkspaceProcessContext;
    assert.deepEqual(await tcpEndpoints(context, forwards), [{ host: "127.0.0.1", port: 11433 }]);
    const running = withSandboxedLaunch(context, launch, [12000], async (actual) => {
      controller.signal.throwIfAborted();
      assert.equal(actual.command, "wrapped");
      calls.push("execute");
      if (mode === "failure") throw new Error("Process failed");
      return "done";
    }, forwards);
    if (mode === "success") assert.equal(await running, "done");
    else await assert.rejects(running, mode === "failure" ? /Process failed/ : /Cancelled during preparation/);
    assert.deepEqual(calls, mode === "cancel" ? ["prepare", "close"] : ["prepare", "execute", "close"]);
  }
});

test("a sandbox without TCP support fails before resolving or launching", async () => {
  const context = { sandbox: { wrap: async () => { assert.fail("An unsupported launch must not start"); } } } as unknown as WorkspaceProcessContext;
  await assert.rejects(async () => tcpEndpoints(context, forwards), { code: "process-tcp-unsupported" });
  await assert.rejects(withSandboxedLaunch(context, { command: "acme", args: [] }, [], async () => undefined, forwards), { code: "process-tcp-unsupported" });
});
