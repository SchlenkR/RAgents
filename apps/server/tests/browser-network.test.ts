import assert from "node:assert/strict";
import { createServer, request, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { browserDestination, browserOrigin, browserPublicAddress, startBrowserProxy, type BrowserNetworkPolicy, type BrowserProxy } from "../../../plugins/ragents.browser/executor/network.ts";
import { browserAllowedOrigins, browserConfigDescriptors, plugin } from "../../../plugins/ragents.browser/server/index.ts";
import type { PluginHost, PluginRegistration } from "@ragents/engine";

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};
const stop = async (server: Server): Promise<void> => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
};
const auth = (proxy: BrowserProxy): string => `Basic ${Buffer.from(`${proxy.settings.username}:${proxy.settings.password}`).toString("base64")}`;
const through = (proxy: BrowserProxy, url: string, headers: Record<string, string> = {}, authenticate = true): Promise<{ status: number; headers: Record<string, unknown>; body: string }> => new Promise((resolve, reject) => {
  const address = new URL(proxy.settings.server);
  const outgoing = request({ hostname: address.hostname, port: address.port, path: url, headers: { ...(authenticate ? { "Proxy-Authorization": auth(proxy) } : {}), ...headers }, agent: false }, (response) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer) => chunks.push(chunk));
    response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    response.on("error", reject);
  });
  outgoing.on("error", reject);
  outgoing.end();
});
const raw = (proxy: BrowserProxy, input: string): Promise<{ socket: Socket; response: string }> => new Promise((resolve, reject) => {
  const address = new URL(proxy.settings.server);
  const socket = connect({ host: address.hostname, port: Number(address.port) }, () => socket.write(input));
  let received = "";
  socket.on("error", reject);
  socket.on("data", function capture(chunk: Buffer) {
    received += chunk.toString();
    if (!received.includes("\r\n\r\n")) return;
    socket.removeListener("data", capture);
    resolve({ socket, response: received });
  });
});

test("browser destinations reject private, special and embedded IP addresses", async () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(browserPublicAddress(address), true, address);
  for (const address of [
    "0.0.0.0", "10.20.30.40", "100.100.100.200", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "100::1", "2001::1", "2001:db8::1", "2002:7f00:1::1", "3fff::1", "fc00::1", "fe80::1", "ff02::1", "not-an-ip",
  ]) assert.equal(browserPublicAddress(address), false, address);
  for (const url of ["http://127.1", "http://2130706433", "http://0x7f000001", "http://0177.0.0.1", "http://[::ffff:127.0.0.1]"]) {
    await assert.rejects(browserDestination(new URL(url), { allowedOrigins: [] }), /not permitted/, url);
  }
});

test("private browser exceptions require the exact scheme, hostname and port", async () => {
  const resolve = async () => [{ address: "127.0.0.1", family: 4 }];
  const policy = { allowedOrigins: ["http://preview.example:4173"] };
  assert.deepEqual(await browserDestination(new URL("http://preview.example:4173/page"), policy, resolve), { address: "127.0.0.1", family: 4, port: 4173 });
  for (const url of ["https://preview.example:4173", "http://preview.example:4174", "http://other.example:4173", "http://preview.example.:4173", "http://127.0.0.1:4173"]) {
    await assert.rejects(browserDestination(new URL(url), policy, resolve), /not permitted/);
  }
  assert.equal(browserOrigin("https://EXAMPLE.COM:443/"), "https://example.com");
  for (const origin of ["file:///tmp", "http://example.com/path", "https://example.com?query", "https://example.com/#fragment", "https://user:password@example.com", "*"]) assert.throws(() => browserOrigin(origin));
  await assert.rejects(browserDestination(new URL("http://example.com"), { allowedOrigins: ["http://example.com/path"] }, resolve), /origin must/);
});

test("the browser denies this machine's public interface addresses unless the exact origin is permitted", async () => {
  const localAddresses = () => ["93.184.216.34", "2606:4700:4700::1111"];
  for (const address of ["93.184.216.34", "2606:4700:4700:0:0:0:0:1111"]) {
    const literal = new URL(`https://${address.includes(":") ? `[${address}]` : address}`);
    const named = new URL("https://machine.example");
    const resolve = async () => [{ address, family: address.includes(":") ? 6 : 4 }];
    for (const url of [literal, named]) {
      await assert.rejects(browserDestination(url, { allowedOrigins: [] }, resolve, localAddresses), /not permitted/);
      assert.equal((await browserDestination(url, { allowedOrigins: [url.origin] }, resolve, localAddresses)).address, url === named ? address : literal.hostname.replace(/[\[\]]/g, ""));
    }
  }
  const external = await browserDestination(new URL("https://external.example"), { allowedOrigins: [] }, async () => [{ address: "1.1.1.1", family: 4 }], localAddresses);
  assert.equal(external.address, "1.1.1.1");
});

test("every browser connection resolves afresh and uses only the checked address", async () => {
  let calls = 0;
  const resolve = async () => [{ address: ++calls === 1 ? "8.8.8.8" : "127.0.0.1", family: 4 }];
  const url = new URL("https://changing.example");
  assert.deepEqual(await browserDestination(url, { allowedOrigins: [] }, resolve), { address: "8.8.8.8", family: 4, port: 443 });
  await assert.rejects(browserDestination(url, { allowedOrigins: [] }, resolve), /not permitted/);
  assert.equal(calls, 2);
  await assert.rejects(browserDestination(url, { allowedOrigins: [] }, async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]), /not permitted/);
  await assert.rejects(browserDestination(url, { allowedOrigins: [] }, async () => []), /not permitted/);
  await assert.rejects(browserDestination(url, { allowedOrigins: [] }, async () => [{ address: "invalid", family: 4 }]), /not permitted/);
  await assert.rejects(browserDestination(new URL("https://public.example:8443"), { allowedOrigins: [] }, async () => [{ address: "8.8.8.8", family: 4 }]), /not permitted/);
  assert.equal((await browserDestination(new URL("https://public.example:8443"), { allowedOrigins: ["https://public.example:8443"] }, async () => [{ address: "8.8.8.8", family: 4 }])).port, 8443);
});

test("the browser proxy authenticates per run, strips proxy headers and checks redirects and policy changes", async (t) => {
  const hits: string[] = [];
  const server = createServer((message, response) => {
    hits.push(message.url!);
    if (message.url === "/redirect") { response.writeHead(302, { Location: "http://forbidden.example/hidden" }); response.end(); return; }
    response.end(JSON.stringify(message.headers));
  });
  const origin = await listen(server);
  const named = origin.replace("127.0.0.1", "preview.example");
  let policy: BrowserNetworkPolicy = { allowedOrigins: [named] };
  let resolutions = 0;
  const proxy = await startBrowserProxy({ timeoutMs: 1000, policy: async () => policy, lookup: async () => { resolutions += 1; return [{ address: "127.0.0.1", family: 4 }]; } });
  t.after(async () => { await proxy.close(); await stop(server); });
  assert.equal((await through(proxy, `${named}/`, {}, false)).status, 407);
  assert.equal(resolutions, 0);
  assert.equal((await through(proxy, `${named}/`, { "Proxy-Authorization": "Basic other-run" })).status, 407);
  const permitted = await through(proxy, `${named}/`, { Host: "forbidden.example", Connection: "X-Private", "X-Private": "hidden" });
  assert.equal(permitted.status, 200);
  const headers = JSON.parse(permitted.body) as Record<string, string>;
  assert.equal(headers.host, new URL(named).host);
  assert.equal(headers["proxy-authorization"], undefined);
  assert.equal(headers["x-private"], undefined);
  const redirect = await through(proxy, `${named}/redirect`);
  assert.equal(redirect.status, 302);
  assert.equal((await through(proxy, String(redirect.headers.location))).status, 403);
  assert.equal((await through(proxy, `${origin}/ip-literal`)).status, 403);
  policy = { allowedOrigins: [] };
  assert.equal((await through(proxy, `${named}/revoked`)).status, 403);
  assert.deepEqual(hits, ["/", "/redirect"]);
  await proxy.close();
  await assert.rejects(through(proxy, `${named}/closed`), /ECONNREFUSED|socket hang up/);
});

test("CONNECT and WebSocket upgrades share the browser's exact origin boundary", async (t) => {
  const server = createServer((_message, response) => response.end("fixture"));
  const upgraded = new Set<Socket>();
  server.on("upgrade", (message, socket) => {
    assert.equal(message.headers["proxy-authorization"], undefined);
    upgraded.add(socket as Socket);
    socket.on("close", () => upgraded.delete(socket as Socket));
    socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
    socket.on("data", (chunk) => socket.write(chunk));
  });
  const origin = await listen(server);
  const named = origin.replace("127.0.0.1", "preview.example");
  const proxy = await startBrowserProxy({ timeoutMs: 1000, policy: async () => ({ allowedOrigins: [named] }), lookup: async () => [{ address: "127.0.0.1", family: 4 }] });
  const clients: Socket[] = [];
  t.after(async () => { for (const client of clients) client.destroy(); await proxy.close(); for (const socket of upgraded) socket.destroy(); await stop(server); });
  const authority = new URL(named).host;
  const tunnel = await raw(proxy, `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`);
  clients.push(tunnel.socket);
  assert.match(tunnel.response, /^HTTP\/1.1 200/);
  const response = new Promise<string>((resolve) => tunnel.socket.once("data", (chunk: Buffer) => resolve(chunk.toString())));
  tunnel.socket.write(`GET /socket HTTP/1.1\r\nHost: ${authority}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`);
  assert.match(await response, /^HTTP\/1.1 101/);
  const websocket = await raw(proxy, `GET ws://${authority}/socket HTTP/1.1\r\nHost: ${authority}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`);
  clients.push(websocket.socket);
  assert.match(websocket.response, /^HTTP\/1.1 101/);
  const echo = new Promise<string>((resolve) => websocket.socket.once("data", (chunk: Buffer) => resolve(chunk.toString())));
  websocket.socket.write("neutral-fixture");
  assert.equal(await echo, "neutral-fixture");
  for (const input of [
    `CONNECT user@${authority} HTTP/1.1\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`,
    `GET ws://forbidden.example/socket HTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`,
  ]) {
    const blocked = await raw(proxy, input);
    clients.push(blocked.socket);
    assert.match(blocked.response, /^HTTP\/1.1 403/);
  }
  for (const target of [authority, "forbidden.example:443"]) {
    const tls = await raw(proxy, `CONNECT ${target} HTTP/1.1\r\nProxy-Authorization: ${auth(proxy)}\r\n\r\n`);
    clients.push(tls.socket);
    assert.match(tls.response, /^HTTP\/1.1 200/);
    const rejected = new Promise<string>((resolve) => tls.socket.once("data", (chunk: Buffer) => resolve(chunk.toString())));
    tls.socket.write(Buffer.from([22, 3, 1, 0, 0]));
    assert.match(await rejected, /^HTTP\/1.1 403/, "an HTTP origin does not permit a TLS tunnel");
  }
  await proxy.close();
  await new Promise<void>((resolve) => websocket.socket.destroyed ? resolve() : websocket.socket.once("close", () => resolve()));
});

test("a missing or invalid network policy never starts a browser proxy", async () => {
  await assert.rejects(startBrowserProxy({ timeoutMs: 1000, policy: async () => { throw new Error("Run policy missing"); } }), /Run policy missing/);
  await assert.rejects(startBrowserProxy({ timeoutMs: 1000, policy: async () => ({ allowedOrigins: ["http://example.com/path"] }) }), /origin must/);
});

test("browser origin exceptions are profile configuration and older hosts fail explicitly", () => {
  assert.deepEqual(browserConfigDescriptors, [{ key: "BROWSER_EXECUTABLE_PATH", source: "environment" }, { key: "BROWSER_ALLOWED_ORIGINS", source: "profile" }]);
  assert.deepEqual(browserAllowedOrigins('["https://EXAMPLE.COM:443", "https://example.com/", "http://localhost:4173"]'), ["https://example.com", "http://localhost:4173"]);
  assert.deepEqual(browserAllowedOrigins("[]"), []);
  for (const configured of ["not-json", '"https://example.com"', '["http://example.com/path"]', '["https://user:password@example.com"]', '["file:///tmp"]', "[12]"]) assert.throws(() => browserAllowedOrigins(configured));
  const registration = { service: () => ({}) } as unknown as PluginRegistration;
  assert.throws(() => plugin.create({} as PluginHost).register(registration), /host does not support browser network policies/);
});
