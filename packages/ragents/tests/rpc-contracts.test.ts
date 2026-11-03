import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { defineChannel, defineOperation } from "../src/rpc/contract.ts";
import { ChannelContributionRegistry, MethodContributionRegistry } from "../src/plugin-host.ts";
import { implement, implementChannel } from "../src/rpc/contribution.ts";

test("local scope survives operation and channel declarations and registry descriptions", () => {
  const operation = defineOperation({ id: "acme.local", description: "Local operation", scope: "local", timeoutMs: 45_000, input: Type.Object({}), result: Type.Null() });
  const channel = defineChannel({ id: "acme.changes", description: "Local changes", scope: "local", params: Type.Object({}), message: Type.Null() });
  const methods = new MethodContributionRegistry();
  const channels = new ChannelContributionRegistry();
  methods.register("acme", [implement(operation, () => null)]);
  channels.register("acme", [implementChannel(channel, () => () => undefined)]);
  assert.equal(Object.isFrozen(operation), true);
  assert.equal(Object.isFrozen(channel), true);
  assert.equal(methods.describe()[0]?.scope, "local");
  assert.equal(methods.describe()[0]?.timeoutMs, 45_000);
  assert.equal(channels.describe()[0]?.scope, "local");
  assert.equal(defineOperation({ id: "acme.open", description: "Unrestricted operation", input: operation.input, result: operation.result }).scope, undefined);
  assert.equal(defineChannel({ id: "acme.openChanges", description: "Unrestricted changes", params: channel.params, message: channel.message }).scope, undefined);
  assert.throws(() => defineOperation({ ...operation, scope: "remote" as "local" }), /Invalid access scope/);
  assert.throws(() => defineChannel({ ...channel, scope: "remote" as "local" }), /Invalid access scope/);
});
