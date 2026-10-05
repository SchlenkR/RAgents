import { randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http";
import { BlockList, connect, isIP, type Socket } from "node:net";
import { networkInterfaces } from "node:os";
import type { Duplex } from "node:stream";

export interface BrowserNetworkPolicy {
  readonly allowedOrigins: readonly string[];
}

export type BrowserLookup = (hostname: string) => Promise<readonly { readonly address: string; readonly family: number }[]>;

const reserved = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) reserved.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) reserved.addSubnet(address, prefix, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

export const browserPublicAddress = (address: string): boolean => {
  const family = isIP(address);
  return family === 4 ? !reserved.check(address, "ipv4")
    : family === 6 && globalV6.check(address, "ipv6") && !reserved.check(address, "ipv6");
};

const denied = (): Error => new Error("The browser network target is not permitted.");
const unbracketed = (hostname: string): string => hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
const resolveAddresses: BrowserLookup = (hostname) => lookup(hostname, { all: true, verbatim: true });
const interfaceAddresses = (): readonly string[] => Object.values(networkInterfaces()).flatMap((entries) => entries?.map(({ address }) => address) ?? []);

export const browserOrigin = (value: string): string => {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("A permitted browser origin must contain only an HTTP or HTTPS scheme, hostname and optional port.");
  }
  return parsed.origin;
};

export const browserDestination = async (url: URL, policy: BrowserNetworkPolicy, resolve: BrowserLookup = resolveAddresses, localAddresses: () => readonly string[] = interfaceAddresses): Promise<{
  readonly address: string;
  readonly family: 4 | 6;
  readonly port: number;
}> => {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw denied();
  const allowed = policy.allowedOrigins.map(browserOrigin).includes(url.origin);
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!allowed && port !== 80 && port !== 443) throw denied();
  const hostname = unbracketed(url.hostname);
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => !isIP(address))) throw denied();
  if (!allowed) {
    const local = new BlockList();
    for (const address of localAddresses()) {
      const family = isIP(address);
      if (family) local.addAddress(address, family === 4 ? "ipv4" : "ipv6");
    }
    if (hostname === "localhost" || hostname.endsWith(".localhost")
      || addresses.some(({ address }) => !browserPublicAddress(address) || local.check(address, isIP(address) === 4 ? "ipv4" : "ipv6"))) throw denied();
  }
  const first = addresses[0]!;
  return { address: first.address, family: isIP(first.address) as 4 | 6, port };
};

const headersFor = (headers: IncomingHttpHeaders, host: string | undefined, upgrade = false): IncomingHttpHeaders => {
  const removed = new Set(["connection", "proxy-connection", "proxy-authorization", "proxy-authenticate", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade",
    ...(headers.connection ?? "").split(",").map((name) => name.trim().toLowerCase())]);
  return {
    ...Object.fromEntries(Object.entries(headers).filter(([name]) => !removed.has(name))),
    ...(host === undefined ? {} : { host }),
    connection: upgrade ? "Upgrade" : "close",
    ...(upgrade ? { upgrade: "websocket" } : {}),
  };
};

export interface BrowserProxy {
  readonly settings: { readonly server: string; readonly username: string; readonly password: string; readonly bypass: string };
  readonly authenticationUrl: string;
  readonly close: () => Promise<void>;
}

export interface BrowserProxyOptions {
  readonly policy: () => Promise<BrowserNetworkPolicy>;
  readonly timeoutMs: number;
  readonly lookup?: BrowserLookup;
}

/** DNS is resolved once per connection and the connection uses that checked IP, including TLS and WebSockets. */
export const startBrowserProxy = async (options: BrowserProxyOptions): Promise<BrowserProxy> => {
  (await options.policy()).allowedOrigins.forEach(browserOrigin);
  const username = randomBytes(16).toString("hex");
  const password = randomBytes(32).toString("hex");
  const authorization = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`);
  const authenticationUrl = `http://${username}.browser-proxy.invalid/`;
  const sockets = new Set<Duplex>();
  let stopped = false;
  let stopping: Promise<void> | undefined;
  const track = <T extends Duplex>(socket: T): T => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    return socket;
  };
  const authenticated = (message: IncomingMessage): boolean => {
    const given = Buffer.from(message.headers["proxy-authorization"] ?? "");
    return given.length === authorization.length && timingSafeEqual(given, authorization);
  };
  const rejectResponse = (response: ServerResponse, code: number): void => {
    if (response.destroyed) return;
    response.writeHead(code, { "Content-Type": "text/plain", "Connection": "close", ...(code === 407 ? { "Proxy-Authenticate": 'Basic realm="run-browser"' } : {}) });
    response.end(code === 407 ? "Proxy authentication required." : "The browser network target is not permitted.");
  };
  const rejectSocket = (socket: Duplex, code: number): void => {
    if (socket.destroyed) return;
    socket.end(`HTTP/1.1 ${code} ${code === 407 ? "Proxy Authentication Required" : "Forbidden"}\r\nConnection: close\r\nContent-Length: 0\r\n${code === 407 ? 'Proxy-Authenticate: Basic realm="run-browser"\r\n' : ""}\r\n`);
  };
  const target = async (url: URL) => {
    if (stopped) throw denied();
    const destination = await browserDestination(url, await options.policy(), options.lookup);
    if (stopped) throw denied();
    return destination;
  };
  const parsedRequest = (message: IncomingMessage, upgrade = false): URL => {
    const url = new URL(message.url ?? "");
    if (upgrade && url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol !== "http:" || url.username || url.password || url.hash) throw denied();
    return url;
  };
  const forward = async (message: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!authenticated(message)) return rejectResponse(response, 407);
    if (message.url === authenticationUrl) {
      response.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'", "Connection": "close" });
      response.end("<!doctype html><title>Browser proxy authentication</title>");
      return;
    }
    try {
      const url = parsedRequest(message);
      const destination = await target(url);
      if (message.destroyed || response.destroyed) return;
      const upstream = request({
        hostname: destination.address, family: destination.family, port: destination.port,
        method: message.method, path: url.pathname + url.search,
        headers: headersFor(message.headers, url.host), agent: false,
      }, (received) => {
        response.writeHead(received.statusCode ?? 502, headersFor(received.headers, undefined));
        received.on("error", () => response.destroy());
        received.pipe(response);
      });
      upstream.on("socket", track);
      upstream.setTimeout(options.timeoutMs, () => upstream.destroy());
      upstream.on("error", () => response.headersSent ? response.destroy() : rejectResponse(response, 502));
      message.on("error", () => upstream.destroy());
      response.on("close", () => upstream.destroy());
      message.pipe(upstream);
    } catch {
      rejectResponse(response, 403);
    }
  };
  const nextBytes = (client: Duplex, deadline: number): Promise<Buffer> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(denied()); }, Math.max(0, deadline - Date.now()));
    const data = (chunk: Buffer) => { client.pause(); cleanup(); resolve(chunk); };
    const ended = () => { cleanup(); reject(denied()); };
    const cleanup = () => {
      clearTimeout(timer);
      client.removeListener("data", data);
      client.removeListener("close", ended);
      client.removeListener("end", ended);
    };
    client.once("data", data);
    client.once("close", ended);
    client.once("end", ended);
    client.resume();
  });
  const handshake = async (client: Duplex, initial: Buffer, authority: string): Promise<{ url: URL; bytes: Buffer }> => {
    client.pause();
    const deadline = Date.now() + options.timeoutMs;
    let bytes = initial;
    while (bytes.length < 3) bytes = Buffer.concat([bytes, await nextBytes(client, deadline)]);
    if (bytes[0] === 22 && bytes[1] === 3) return { url: new URL(`https://${authority}/`), bytes };
    while (!bytes.includes("\r\n\r\n")) {
      if (bytes.length >= 16_384) throw denied();
      bytes = Buffer.concat([bytes, await nextBytes(client, deadline)]);
    }
    const end = bytes.indexOf("\r\n\r\n");
    if (end >= 16_384) throw denied();
    const lines = bytes.subarray(0, end).toString("latin1").split("\r\n");
    if (!/^GET \/[^\s]* HTTP\/1\.1$/.test(lines[0]!)) throw denied();
    const headers = lines.slice(1).map((line) => {
      const colon = line.indexOf(":");
      if (colon < 1) throw denied();
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()] as const;
    });
    const value = (name: string): string | undefined => {
      const matches = headers.filter(([key]) => key === name);
      if (matches.length > 1) throw denied();
      return matches[0]?.[1];
    };
    const url = new URL(`http://${authority}/`);
    if (value("upgrade")?.toLowerCase() !== "websocket" || !value("connection")?.toLowerCase().split(/\s*,\s*/).includes("upgrade")
      || browserOrigin(`http://${value("host") ?? ""}/`) !== url.origin
      || value("transfer-encoding") !== undefined || (value("content-length") !== undefined && value("content-length") !== "0")) throw denied();
    const forwarded = lines.filter((line, index) => index === 0 || !["proxy-authorization", "proxy-authenticate", "proxy-connection"].includes(headers[index - 1]![0]));
    return { url, bytes: Buffer.concat([Buffer.from(forwarded.join("\r\n") + "\r\n\r\n", "latin1"), bytes.subarray(end + 4)]) };
  };
  const tunnel = async (message: IncomingMessage, client: Duplex, head: Buffer): Promise<void> => {
    if (!authenticated(message)) return rejectSocket(client, 407);
    try {
      const authority = message.url ?? "";
      if (!/^(?:\[[0-9a-f:]+\]|[^\s:/?#@\\]+):[0-9]{1,5}$/i.test(authority)) throw denied();
      new URL(`https://${authority}/`);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      const started = await handshake(client, head, authority);
      const destination = await target(started.url);
      if (client.destroyed) return;
      const upstream = track(connect({ host: destination.address, family: destination.family, port: destination.port }));
      upstream.setTimeout(options.timeoutMs, () => upstream.destroy());
      upstream.once("connect", () => {
        upstream.setTimeout(0);
        upstream.write(started.bytes);
        client.pipe(upstream).pipe(client);
      });
      upstream.once("error", () => rejectSocket(client, 502));
      upstream.once("close", () => client.destroy());
      client.once("close", () => upstream.destroy());
    } catch {
      rejectSocket(client, 403);
    }
  };
  const upgrade = async (message: IncomingMessage, client: Duplex, head: Buffer): Promise<void> => {
    if (!authenticated(message)) return rejectSocket(client, 407);
    try {
      if (message.method !== "GET" || message.headers.upgrade?.toLowerCase() !== "websocket") throw denied();
      const url = parsedRequest(message, true);
      const destination = await target(url);
      if (client.destroyed) return;
      const upstream = request({
        hostname: destination.address, family: destination.family, port: destination.port,
        method: "GET", path: url.pathname + url.search,
        headers: headersFor(message.headers, url.host, true), agent: false,
      });
      upstream.on("socket", track);
      upstream.setTimeout(options.timeoutMs, () => upstream.destroy());
      upstream.on("error", () => rejectSocket(client, 502));
      upstream.once("response", (response) => { response.resume(); rejectSocket(client, 502); });
      upstream.once("upgrade", (response, socket, receivedHead) => {
        track(socket);
        socket.setTimeout(0);
        const headers = headersFor(response.headers, undefined, true);
        client.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(headers).flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).map((entry) => `${name}: ${entry}\r\n`)).join("")}\r\n`);
        if (receivedHead.length) client.write(receivedHead);
        if (head.length) socket.write(head);
        client.pipe(socket).pipe(client);
        socket.once("close", () => client.destroy());
      });
      client.once("close", () => upstream.destroy());
      upstream.end();
    } catch {
      rejectSocket(client, 403);
    }
  };
  const server = createServer({ requestTimeout: options.timeoutMs, headersTimeout: options.timeoutMs, maxHeaderSize: 16_384 }, (message, response) => { void forward(message, response); });
  server.maxConnections = 128;
  server.on("connection", (socket: Socket) => track(socket));
  server.on("connect", (message, socket, head) => { void tunnel(message, socket, head); });
  server.on("upgrade", (message, socket, head) => { void upgrade(message, socket, head); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  const address = server.address();
  if (address === null || typeof address === "string") { server.close(); throw new Error("The browser network proxy has no local address."); }
  const close = (): Promise<void> => stopping ??= (async () => {
    stopped = true;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  })();
  server.on("error", () => { void close().catch((error) => console.error("Browser network proxy stop failed:", error)); });
  return { settings: { server: `http://127.0.0.1:${address.port}`, username, password, bypass: "<-loopback>" }, authenticationUrl, close };
};
