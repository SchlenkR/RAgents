import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";
import { SandboxManager, type SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import { PROCESS_SANDBOX_DEFAULT_NETWORK, ServerProcessSandbox } from "../src/plugin-support/process-sandbox.ts";

test("shared public web grants allow web domains and expire with their holder", { skip: process.platform !== "darwin" && process.platform !== "linux" }, async (context) => {
  const initialized = context.mock.method(SandboxManager, "initialize", async () => undefined);
  const updated = context.mock.method(SandboxManager, "updateConfig", () => undefined);
  const reset = context.mock.method(SandboxManager, "reset", async () => undefined);
  context.mock.method(SandboxManager, "checkDependencies", () => ({ errors: [], warnings: [] }));
  context.mock.method(SandboxManager, "wrapWithSandbox", async () => "true");
  const create = (network: readonly string[], serverAddress?: string) => new ServerProcessSandbox({
    network,
    serverAddress,
    dataDirectory: tmpdir(),
    disableSetting: 'SANDBOX: "off"',
    platform: "linux",
  });
  const restricted = create(["registry.example.com", "*.packages.example.com"], "http://127.0.0.1:4710");
  const permissive = create(PROCESS_SANDBOX_DEFAULT_NETWORK);
  try {
    await restricted.start();
    const [initial, request] = initialized.mock.calls[0]!.arguments as Parameters<typeof SandboxManager.initialize>;
    assert.ok(request);
    assert.deepEqual(initial.network.allowedDomains, ["registry.example.com", "*.packages.example.com", "127.0.0.1:4710"]);
    assert.equal(initial.network.deniedResolvedAddresses, undefined);
    assert.equal(await request({ host: "example.com", port: 443 }), false);

    await permissive.start();
    assert.equal(initialized.mock.callCount(), 1);
    const [publicConfig] = updated.mock.calls.at(-1)!.arguments as [SandboxRuntimeConfig];
    assert.deepEqual(publicConfig.network.allowedDomains, initial.network.allowedDomains);
    assert.deepEqual(publicConfig.network.deniedResolvedAddresses, ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "fc00::/7"]);
    for (const host of ["example.com", "api.example.com", "EXAMPLE.COM."]) {
      for (const port of [80, 443]) assert.equal(await request({ host, port }), true, `${host}:${port}`);
      for (const port of [22, 3000, 8080, 8443]) assert.equal(await request({ host, port }), false, `${host}:${port}`);
    }
    for (const host of ["localhost", "LOCALHOST.", "api.localhost", "127.0.0.1", "127.1", "2130706433", "0x7f000001", "10.0.0.1", "192.168.1.1", "169.254.169.254", "8.8.8.8", "[::1]", "[::ffff:127.0.0.1]", "[2606:4700:4700::1111]"]) {
      for (const port of [80, 443]) assert.equal(await request({ host, port }), false, `${host}:${port}`);
    }

    await permissive.stop();
    assert.equal(reset.mock.callCount(), 0);
    assert.equal(await request({ host: "example.com", port: 443 }), false);
    const [restrictedConfig] = updated.mock.calls.at(-1)!.arguments as [SandboxRuntimeConfig];
    assert.deepEqual(restrictedConfig.network.allowedDomains, initial.network.allowedDomains);
    assert.equal(restrictedConfig.network.deniedResolvedAddresses, undefined);
    await restricted.stop();
    assert.equal(reset.mock.callCount(), 1);
  } finally {
    await permissive.stop();
    await restricted.stop();
  }
});
