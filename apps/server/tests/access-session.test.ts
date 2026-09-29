import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import test from "node:test";
import { createAccessSessionManager, isSameOriginRequest } from "../src/access-session.ts";
import { writeJson } from "../src/plugin-support/http.ts";

const users = [
  { id: "admin", label: "Administration", password: "admin-secret", rights: ["*"] },
  { id: "reader", label: "Read access", password: "reader-secret", rights: ["runs.read"] },
];

const request = (method = "GET", body?: unknown, headers: Record<string, string> = {}): IncomingMessage =>
  Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]), {
    method, headers: { host: "localhost:3000", "content-type": "application/json", ...headers }, socket: {},
  }) as unknown as IncomingMessage;

const response = () => {
  const emitter = new EventEmitter();
  const headers = new Map<string, string>();
  let status = 0;
  let text = "";
  let ended = false;
  const value = Object.assign(emitter, {
    destroyed: false,
    setHeader: (name: string, content: string) => headers.set(name.toLowerCase(), content),
    writeHead: (code: number, values: Record<string, string>) => {
      status = code;
      for (const [key, content] of Object.entries(values)) headers.set(key.toLowerCase(), content);
    },
    end: (body = "") => { ended = true; text += body; emitter.emit("finish"); },
    destroy: () => { ended = true; value.destroyed = true; emitter.emit("close"); return value; },
  }) as unknown as ServerResponse;
  return { value, headers, get status() { return status; }, get text() { return text; }, get ended() { return ended; } };
};

const call = async (
  manager: ReturnType<typeof createAccessSessionManager>, pathname: string, req: IncomingMessage = request(),
) => {
  const res = response();
  assert.equal(await manager.handle(req, res.value, new URL(pathname, "http://localhost:3000")), true);
  return res;
};

const login = async (manager: ReturnType<typeof createAccessSessionManager>, id = "reader", cookie?: string) => {
  const res = await call(manager, "/api/access/login", request("POST", {
    id, password: users.find((user) => user.id === id)!.password,
  }, cookie ? { cookie } : {}));
  assert.equal(res.status, 200);
  const cookieValue = res.headers.get("set-cookie")!;
  return { res, cookie: cookieValue.split(";")[0]! };
};

test("without profile users sign-in is off and is not silently enabled", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access" });
  assert.deepEqual(manager.snapshot(request()), { enabled: false, user: null });
  assert.equal((await call(manager, "/api/access")).status, 200);
  assert.equal((await call(manager, "/api/access/login", request("POST", { id: "reader", password: "reader-secret" }))).status, 409);
  assert.throws(() => createAccessSessionManager({ cookieName: "test", users: [] }), /at least one user/);
  manager.close();
});

test("two users get their own rights and random cookies without secrets", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access", users });
  try {
    assert.deepEqual(manager.snapshot(request()), { enabled: true, user: null });
    const reader = await login(manager);
    const admin = await login(manager, "admin");
    assert.notEqual(reader.cookie, admin.cookie);
    assert.match(reader.res.headers.get("set-cookie")!, /Path=\/; HttpOnly; SameSite=Lax; Max-Age=43200$/);
    assert.equal(reader.res.headers.get("cache-control"), "no-store");
    assert.deepEqual(manager.snapshot(request("GET", undefined, { cookie: reader.cookie })).user?.rights, ["runs.read"]);
    assert.deepEqual(manager.snapshot(request("GET", undefined, { cookie: admin.cookie })).user?.rights, ["*"]);
    const exposed = JSON.stringify([...reader.res.headers]) + reader.res.text + admin.res.text;
    for (const secret of ["reader-secret", "admin-secret", "password", "salt", "hash"]) assert.equal(exposed.includes(secret), false);
  } finally { manager.close(); }
});

test("a wrong password, an unknown user and tampered cookies give no identity", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access", users });
  try {
    for (const id of ["reader", "unknown"]) {
      const res = await call(manager, "/api/access/login", request("POST", { id, password: "wrong-password" }));
      assert.equal(res.status, 401);
      assert.equal(res.headers.has("set-cookie"), false);
    }
    const { cookie } = await login(manager);
    for (const invalid of ["test_access=%GG", `${cookie}x`, `${cookie}; ${cookie}`, "test_access=anything"]) {
      assert.equal(manager.snapshot(request("GET", undefined, { cookie: invalid })).user, null);
    }
    assert.equal(manager.snapshot(request("GET", undefined, { authorization: "Bearer reader-secret" })).user, null);
  } finally { manager.close(); }
});

test("signing out and signing in again revoke cookies and close open streams", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access", users });
  try {
    const first = await login(manager);
    const firstRequest = request("GET", undefined, { cookie: first.cookie });
    const stream = response();
    manager.track(firstRequest, stream.value);
    const second = await login(manager, "admin", first.cookie);
    assert.equal(stream.ended, true);
    assert.equal(manager.snapshot(firstRequest).user, null);
    const secondRequest = request("GET", undefined, { cookie: second.cookie });
    const secondStream = response();
    manager.track(secondRequest, secondStream.value);
    const logout = await call(manager, "/api/access/logout", request("POST", {}, { cookie: second.cookie }));
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal(secondStream.ended, true);
    assert.equal(manager.snapshot(secondRequest).user, null);
  } finally { manager.close(); }
});

test("expiry and a server restart discard the session", async () => {
  let now = 0;
  const manager = createAccessSessionManager({ cookieName: "test_access", users, now: () => now, sessionTtlMs: 1000 });
  const other = createAccessSessionManager({ cookieName: "test_access", users });
  try {
    const { cookie } = await login(manager);
    const req = request("GET", undefined, { cookie });
    const stream = response();
    manager.track(req, stream.value);
    now = 999;
    assert.equal(manager.snapshot(req).user?.id, "reader");
    assert.equal(other.snapshot(req).user, null);
    now = 1000;
    assert.equal(manager.snapshot(req).user, null);
    assert.equal(stream.ended, true);
  } finally { manager.close(); other.close(); }
});

test("the cookie is set as Secure for direct TLS connections", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access", users });
  try {
    const req = request("POST", { id: "reader", password: "reader-secret" });
    Object.assign(req.socket, { encrypted: true });
    const res = await call(manager, "/api/access/login", req);
    assert.match(res.headers.get("set-cookie")!, /; Secure$/);
  } finally { manager.close(); }
});

test("the expiry timer closes a stream even without another HTTP request", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access", users, sessionTtlMs: 30 });
  try {
    const { cookie } = await login(manager);
    const req = request("GET", undefined, { cookie });
    const stream = response();
    manager.track(req, stream.value);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Stream stays open after expiry")), 1000);
      stream.value.once("close", () => { clearTimeout(timeout); resolve(); });
    });
    assert.equal(stream.ended, true);
    assert.equal(manager.snapshot(req).user, null);
  } finally { manager.close(); }
});

test("logout during a slow HTTP response disconnects the client without a late header error", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access", users });
  const errors: unknown[] = [];
  let announceStart!: () => void;
  const started = new Promise<void>((resolve) => { announceStart = resolve; });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  let announceFinish!: () => void;
  const finished = new Promise<void>((resolve) => { announceFinish = resolve; });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url!, "http://localhost");
      if (await manager.handle(req, res, url)) return;
      assert.equal(manager.snapshot(req).user?.id, "reader");
      manager.track(req, res);
      announceStart();
      await waiting;
      writeJson(res, 200, { sensitive: "must-not-arrive" });
    } catch (error) {
      errors.push(error);
      res.destroy();
    } finally {
      if (req.url === "/slow") announceFinish();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;
    const authenticated = await fetch(`${origin}/api/access/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "reader", password: "reader-secret" }),
    });
    assert.equal(authenticated.status, 200);
    await authenticated.text();
    const cookie = authenticated.headers.get("set-cookie")!.split(";")[0]!;
    const slow = fetch(`${origin}/slow`, { headers: { cookie } })
      .then(async (res) => ({ data: await res.text() }), (error: unknown) => ({ error }));
    await started;
    const logout = await fetch(`${origin}/api/access/logout`, { method: "POST", headers: { cookie } });
    assert.equal(logout.status, 200);
    await logout.text();
    const result = await slow;
    assert.ok("error" in result);
    release();
    await finished;
    assert.deepEqual(errors, []);
  } finally {
    release();
    manager.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("foreign origins, wrong methods and oversized data are rejected", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access", users });
  try {
    assert.equal(isSameOriginRequest(request("POST", {}, { origin: "https://localhost:3000" })), true);
    for (const headers of [{ origin: "https://attacker.example" }, { origin: "null" }, { "sec-fetch-site": "cross-site" }]) {
      const res = await call(manager, "/api/access/login", request("POST", {}, headers));
      assert.equal(res.status, 403);
    }
    assert.equal((await call(manager, "/api/access/login")).status, 405);
    assert.equal((await call(manager, "/api/access/login", request("POST", {}, { "content-type": "text/plain" }))).status, 415);
    assert.equal((await call(manager, "/api/access/login", request("POST", "invalid"))).status, 400);
    assert.equal((await call(manager, "/api/access/login", request("POST", "x".repeat(4097)))).status, 413);
    assert.equal((await call(manager, "/api/access/login", request("POST", { id: "reader", password: "reader-secret", rights: ["*"] }))).status, 400);
    const res = response();
    assert.equal(await manager.handle(request(), res.value, new URL("http://localhost:3000/api/other")), false);
  } finally { manager.close(); }
});


test("anonymous access applies the same restrictions without login or cookie", async () => {
  const anonymousUser = { id: "operator", label: "Operator", rights: ["runs.read", "runs.write"], startEntries: ["example.allowed"] };
  const manager = createAccessSessionManager({ cookieName: "test_access", anonymousUser });
  try {
    const result = await call(manager, "/api/access");
    assert.deepEqual(JSON.parse(result.text), { enabled: false, user: anonymousUser });
    assert.equal(result.headers.has("set-cookie"), false);
    assert.equal((await call(manager, "/api/access/login", request("POST", { id: "operator", password: "anything" }))).status, 409);
    assert.throws(() => createAccessSessionManager({ cookieName: "test_access", users, anonymousUser }), /exclude each other/);
  } finally { manager.close(); }
});

test("signing in carries the setup permissions into the session", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access", users: [{ ...users[1], startEntries: ["example.allowed"] }] });
  try {
    const { cookie } = await login(manager);
    assert.deepEqual(manager.snapshot(request("GET", undefined, { cookie })).user?.startEntries, ["example.allowed"]);
  } finally { manager.close(); }
});

test("the session token also counts as a bearer and, for GET requests, as the query parameter access", async () => {
  const manager = createAccessSessionManager({ cookieName: "test_access", users });
  const { cookie } = await login(manager, "reader");
  const token = cookie.split("=")[1]!;
  assert.equal(manager.snapshot(request("GET", undefined, { authorization: `Bearer ${token}` })).user?.id, "reader");
  assert.equal(manager.snapshot(Object.assign(request(), { url: `/rpc/stream?access=${token}` })).user?.id, "reader");
  assert.equal(manager.snapshot(Object.assign(request("POST"), { url: `/rpc/stream?access=${token}` })).user, null);
  assert.equal(manager.snapshot(request("GET", undefined, { authorization: "Bearer not-valid" })).user, null);
  assert.equal(manager.snapshot(request("GET", undefined, { authorization: "Basic abc", cookie })).user, null);
  assert.equal(manager.snapshot(request("GET", undefined, { cookie })).user?.id, "reader");
  const logout = await call(manager, "/api/access/logout", request("POST", undefined, { authorization: `Bearer ${token}` }));
  assert.equal(logout.status, 200);
  assert.equal(manager.snapshot(request("GET", undefined, { authorization: `Bearer ${token}` })).user, null);
});

test("a personal token counts as a bearer and query parameter, never as a cookie, and survives signing out", async () => {
  const token = "dev-token-0123456789abcdef";
  const manager = createAccessSessionManager({ cookieName: "test_access", users: [
    ...users, { id: "dev", label: "Developer", password: "dev-secret", rights: ["models.use"], token },
  ] });
  try {
    assert.deepEqual(manager.snapshot(request("POST", undefined, { authorization: `Bearer ${token}` })).user?.rights, ["models.use"]);
    assert.equal(manager.snapshot(request("GET", undefined, { authorization: `Bearer ${token}` })).user?.id, "dev");
    const query = Object.assign(request("GET"), { url: `/rpc/stream?access=${token}` });
    assert.equal(manager.snapshot(query).user?.id, "dev");
    assert.equal(manager.snapshot(request("GET", undefined, { cookie: `test_access=${token}` })).user, null);
    assert.equal(manager.snapshot(request("GET", undefined, { authorization: `Bearer ${token.slice(0, -1)}x` })).user, null);
    assert.equal(manager.snapshot(request("GET", undefined, { authorization: "Bearer dev-secret" })).user, null);
    const logout = await call(manager, "/api/access/logout", request("POST", undefined, { authorization: `Bearer ${token}` }));
    assert.equal(logout.status, 200);
    assert.equal(manager.snapshot(request("GET", undefined, { authorization: `Bearer ${token}` })).user?.id, "dev");
  } finally { manager.close(); }
  assert.throws(() => createAccessSessionManager({ cookieName: "test", users: [
    { ...users[0]!, token }, { ...users[1]!, token },
  ] }), /already belongs to another user/);
});
