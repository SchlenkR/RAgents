import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { DomainError } from "@ragents/engine";
import { processesContracts } from "../../../plugins/ragents.processes/contract";
import type { OperationInput, OperationResult } from "../../../packages/ragents/src/rpc/contract";
import { ServerClient } from "../src/server-client";
import { SERVICE_BODY_LIMIT, ServiceTunnels, serviceOnThisMachine } from "../src/service-tunnels";
import { startStubServer, waitFor } from "./fixtures";

type ForwardInput = OperationInput<typeof processesContracts.forward>;
type ForwardResult = OperationResult<typeof processesContracts.forward>;

const RUN = "run-forwarded";

/** A port that is free on this machine right now. */
const freePort = (): Promise<number> => new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => resolve(port));
  });
});

const occupied = async (t: TestContext, port: number): Promise<Server> => {
  const server = createServer((_request, response) => response.end("someone else"));
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return server;
};

const setup = async (t: TestContext, forward: (input: ForwardInput) => ForwardResult | Promise<ForwardResult>, checkIntervalMs = 60_000) => {
  const inputs: ForwardInput[] = [];
  const stub = await startStubServer({ forward: (input) => { inputs.push(input); return forward(input); } });
  const client = new ServerClient(stub.url, undefined, fetch);
  const log: string[] = [];
  const tunnels = new ServiceTunnels({ log: (line) => log.push(line), checkIntervalMs });
  t.after(async () => {
    await tunnels.dispose();
    await stub.close();
  });
  return { inputs, client, log, tunnels };
};

const service = (port: number) => ({ runId: RUN, port, workstation: "client-0001", forward: processesContracts.forward.id });

const refused = async (port: number): Promise<boolean> => {
  try {
    await fetch(`http://127.0.0.1:${port}/`);
    return false;
  } catch {
    return true;
  }
};

test("a service on this window's workstation or on the extension's own host opens directly, every other one through a tunnel", () => {
  const onWorkstation = service(5173);
  const onServer = { ...onWorkstation, workstation: null };
  assert.equal(serviceOnThisMachine(onWorkstation, { ownHost: false, workstation: "client-0001" }), true);
  assert.equal(serviceOnThisMachine(onWorkstation, { ownHost: true, workstation: "client-0002" }), false, "another window's workstation is reached through the server");
  assert.equal(serviceOnThisMachine(onWorkstation, { ownHost: true, workstation: undefined }), false);
  assert.equal(serviceOnThisMachine(onServer, { ownHost: true, workstation: "client-0001" }), true, "the extension's own host runs on this machine");
  assert.equal(serviceOnThisMachine(onServer, { ownHost: false, workstation: "client-0001" }), false, "a server by address is another machine");
});

test("a tunnel listens on the service's port number, forwards method, path, headers, and binary bodies, and is reused", async (t) => {
  const bytes = Buffer.from([0, 255, 1, 254]);
  const { inputs, client, log, tunnels } = await setup(t, (input) => input.request === null ? null : {
    status: 201,
    headers: [["Set-Cookie", "a=1"], ["Set-Cookie", "b=2"], ["Content-Type", "application/octet-stream"]],
    body: bytes.toString("base64"),
  });
  const port = await freePort();
  const local = await tunnels.open("stub", client.rpc, service(port));
  assert.equal(local, port, "a free port keeps its number");
  assert.equal(await tunnels.open("stub", client.rpc, service(port)), local, "a second click reuses the tunnel");
  assert.deepEqual(inputs.slice(), [{ runId: RUN, port, request: null }], "the server confirmed the port once before the listener started");

  const response = await new Promise<{ status: number; cookies: string[]; body: Buffer }>((resolve, reject) => {
    const outgoing = httpRequest({ host: "127.0.0.1", port: local, method: "POST", path: "/upload?name=a%20b", headers: { "X-Test": "1", "Content-Type": "application/octet-stream" } }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, cookies: incoming.headers["set-cookie"] ?? [], body: Buffer.concat(chunks) }));
    });
    outgoing.on("error", reject);
    outgoing.end(Buffer.from([7, 8, 9]));
  });
  assert.equal(response.status, 201);
  assert.deepEqual(response.cookies, ["a=1", "b=2"]);
  assert.deepEqual(response.body, bytes);
  const forwarded = inputs[1]?.request;
  assert.ok(forwarded);
  assert.equal(forwarded.method, "POST");
  assert.equal(forwarded.path, "/upload?name=a%20b");
  assert.deepEqual(forwarded.headers.filter(([name]) => name === "X-Test"), [["X-Test", "1"]]);
  assert.deepEqual([...Buffer.from(forwarded.body, "base64")], [7, 8, 9]);
  assert.ok(log.some((line) => line === `== Forwarding http://localhost:${port}/ to port ${port} of run ${RUN} on stub`), log.join("\n"));
  assert.ok(log.some((line) => /^== Forward run-forw:\d+ POST \/upload\?name=a%20b 201 \d+ ms$/.test(line)), log.join("\n"));
});

test("a taken local port leads to a free one, a refused port opens nothing", async (t) => {
  const { client, tunnels } = await setup(t, (input) => {
    if (input.port === 1) throw new DomainError("forward-port-unknown", `No process of run ${RUN} listens on port 1 on this machine`, 404);
    return null;
  });
  const port = await freePort();
  await occupied(t, port);
  const local = await tunnels.open("stub", client.rpc, service(port));
  assert.notEqual(local, port);
  await assert.rejects(tunnels.open("stub", client.rpc, service(1)), /listens on port 1/);
});

test("the server's refusal reaches the browser with its status and ends the tunnel", async (t) => {
  let listening = true;
  const { client, log, tunnels } = await setup(t, () => {
    if (!listening) throw new DomainError("forward-port-unknown", `No process of run ${RUN} listens on the port on this machine`, 404);
    return null;
  });
  const local = await tunnels.open("stub", client.rpc, service(await freePort()));
  listening = false;
  const response = await fetch(`http://127.0.0.1:${local}/page`);
  assert.equal(response.status, 404);
  assert.match(await response.text(), /RAgents could not forward GET \/page to port \d+ of run run-forwarded: No process of run run-forwarded listens/);
  await waitFor(() => log.some((line) => line.includes("ended: No process of run")));
  assert.equal(await refused(local), true, "the listener is gone");
});

test("the tunnel ends when the check finds the port gone, when the connection ends, and when the extension ends", async (t) => {
  let listening = true;
  const { client, log, tunnels } = await setup(t, (input) => {
    if (!listening) throw new DomainError("forward-port-unknown", "gone", 404);
    return input.request === null ? null : { status: 200, headers: [], body: "" };
  }, 30);
  const first = await tunnels.open("stub", client.rpc, service(await freePort()));
  listening = false;
  await waitFor(() => log.some((line) => line.endsWith("ended: gone")));
  assert.equal(await refused(first), true);

  listening = true;
  const second = await tunnels.open("stub", client.rpc, service(await freePort()));
  tunnels.retain(() => client.rpc);
  assert.equal((await fetch(`http://127.0.0.1:${second}/`)).status, 200, "the same client keeps the tunnel");
  tunnels.retain(() => undefined);
  await waitFor(() => log.some((line) => line.endsWith("ended: the connection to stub ended")));
  assert.equal(await refused(second), true);

  const third = await tunnels.open("stub", client.rpc, service(await freePort()));
  await tunnels.dispose();
  await waitFor(() => log.some((line) => line.endsWith("ended: the extension ends")));
  assert.equal(await refused(third), true);
});

test("an oversized body and a WebSocket upgrade are refused locally with their cause", async (t) => {
  const { inputs, client, tunnels } = await setup(t, () => null);
  const local = await tunnels.open("stub", client.rpc, service(await freePort()));
  const large = await fetch(`http://127.0.0.1:${local}/upload`, { method: "POST", body: Buffer.alloc(SERVICE_BODY_LIMIT + 1) });
  assert.equal(large.status, 413);
  assert.match(await large.text(), /exceeds 16 MiB/);
  assert.deepEqual(inputs.filter((input) => input.request !== null), [], "the oversized request never reached the server");
  const upgrade = await new Promise<number>((resolve, reject) => {
    const outgoing = httpRequest({ host: "127.0.0.1", port: local, path: "/socket", headers: { Connection: "Upgrade", Upgrade: "websocket" } });
    outgoing.on("response", (incoming) => resolve(incoming.statusCode ?? 0));
    outgoing.on("error", reject);
    outgoing.end();
  });
  assert.equal(upgrade, 501);
});
