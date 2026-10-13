import assert from "node:assert/strict";
import test from "node:test";
import type { WorkspaceProcessContext } from "../src/context.ts";
import { checkedPublishedPorts, withSandboxedLaunch } from "../src/process-sandbox.ts";

test("published ports accept only distinct TCP port numbers", () => {
  assert.deepEqual(checkedPublishedPorts([1, 65535]), [1, 65535]);
  assert.deepEqual(checkedPublishedPorts([]), []);
  for (const value of [null, undefined, "12000", [0], [-1], [65536], [1.5], [NaN], [Infinity], ["12000"], [12000, 12000]]) {
    assert.throws(() => checkedPublishedPorts(value), { code: "process-port-invalid" }, String(value));
  }
});

test("the managed launch closes its publication on success and failure without using plain wrap", async () => {
  const launch = { command: "acme", args: ["serve"] };
  for (const fail of [false, true]) {
    const calls: string[] = [];
    const context = { sandbox: {
      wrap: async () => { throw new Error("Publishing must use its prepared launch"); },
      publishPorts: async (input: typeof launch, ports: readonly number[]) => {
        assert.deepEqual(input, launch);
        assert.deepEqual(ports, [12000]);
        calls.push("publish");
        return { launch: { command: "wrapped", args: [] }, close: async () => { calls.push("close"); } };
      },
    } } as unknown as WorkspaceProcessContext;
    const finished = withSandboxedLaunch(context, launch, [12000], async (wrapped) => {
      assert.equal(wrapped.command, "wrapped");
      calls.push("execute");
      if (fail) throw new Error("Process failed");
      return "done";
    });
    if (fail) await assert.rejects(finished, /Process failed/);
    else assert.equal(await finished, "done");
    assert.deepEqual(calls, ["publish", "execute", "close"]);
  }
});

test("a sandbox without publication support rejects the option before starting a process", async () => {
  const context = { sandbox: { wrap: async (launch: unknown) => launch } } as unknown as WorkspaceProcessContext;
  await assert.rejects(withSandboxedLaunch(context, { command: "acme", args: [] }, [12000], async () => {
    assert.fail("The unsupported launch must not start");
  }), { code: "process-port-unsupported" });
});
