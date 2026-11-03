import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { announcement, isolatedDirectory, profileSource, stopChild } from "./foreign-plugin-fixture.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const upgradeStatus = (baseUrl: string, origin: string | undefined): Promise<number | undefined> => new Promise((resolve, reject) => {
  const request = httpRequest(`${baseUrl}/api/plugins/acme.demo/socket`, {
    headers: { connection: "Upgrade", upgrade: "websocket", ...(origin === undefined ? {} : { origin }) },
  }, (response) => { response.resume(); resolve(response.statusCode); });
  request.once("error", reject);
  request.end();
});

for (const mode of ["open", "anonymous", "users"] as const) {
  test(`HTTP origin checks apply before dispatch in a profile with ${mode} access`, { timeout: 120_000 }, async () => {
    const directory = isolatedDirectory("ragents-http-security-");
    const profile = path.join(directory, "ragents.config.security-check.ts");
    const source = profileSource("security-check", ["ragents.orchestration", "ragents.workspace", "ragents.product"])
      .replace("host: {", 'host: { ALLOWED_ORIGINS: ["https://portal.example"],');
    const access = mode === "anonymous" ? 'export const anonymousUser = { id: "demo", rights: ["*"] };'
      : mode === "users" ? 'export const users = [{ id: "alice", password: "demo-password", rights: ["*"] }];' : "";
    writeFileSync(profile, `${source}\n${access}\n`);
    const server = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], {
      cwd: path.join(root, "apps/server"),
      env: { ...process.env, PRODUCT_PROFILE: "security-check", PRODUCT_PROFILE_FILE: profile, DATA_DIR: path.join(directory, "data"), ACME_MODEL_KEY: "not-a-real-key", RAGENTS_DEV: "1", ACCESS_TOKEN: undefined, BIND_ADDRESS: undefined, ALLOWED_ORIGINS: undefined, PLUGINS: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const host = await announcement(server, []);
      const foreign = { origin: "https://foreign.example", "sec-fetch-site": "cross-site" };
      for (const [route, method] of [["/rpc", "POST"], ["/rpc/stream", "GET"], ["/api/access/login", "POST"], ["/api/access/logout", "POST"], ["/access", "POST"], ["/api/plugins/acme.demo/upload", "PUT"], ["/api/plugins/acme.demo/upload", "DELETE"]]) {
        const denied = await fetch(`${host.url}${route}`, { method, headers: foreign });
        assert.equal(denied.status, 403, route);
        assert.equal((await denied.json() as { code: string }).code, "origin-denied", route);
      }
      assert.equal(await upgradeStatus(host.url, foreign.origin), 403);
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (mode === "open") headers.authorization = `Bearer ${host.token}`;
      if (mode === "users") {
        const login = await fetch(`${host.url}/api/access/login`, { method: "POST", headers: { ...headers, origin: host.url }, body: JSON.stringify({ id: "alice", password: "demo-password" }) });
        assert.equal(login.status, 200);
        headers.cookie = login.headers.get("set-cookie")!.split(";")[0]!;
        await login.text();
      }
      for (const offered of [undefined, host.url, "https://portal.example"]) {
        const originHeaders = offered === undefined ? {} : { origin: offered, "sec-fetch-site": offered === host.url ? "same-origin" : "cross-site" };
        const response = await fetch(`${host.url}/rpc`, { method: "POST", headers: { ...headers, ...originHeaders }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ragents.api.openrpc", params: {} }) });
        assert.equal(response.status, 200, offered);
        const body = await response.json() as { result?: { openrpc: string; info: { description: string } }; error?: unknown };
        assert.equal(body.error, undefined);
        assert.equal(body.result?.openrpc, "1.3.0");
        assert.match(body.result!.info.description, mode === "users" ? /User sign-in/ : mode === "open" ? /ACCESS_TOKEN/ : /no sign-in/);
        const controller = new AbortController();
        const stream = await fetch(`${host.url}/rpc/stream`, { headers: { ...headers, ...originHeaders }, signal: controller.signal });
        assert.equal(stream.status, 200, offered);
        controller.abort();
        assert.equal(await upgradeStatus(host.url, offered), 404, "an accepted upgrade origin reaches route dispatch");
      }
      const nullOrigin = await fetch(`${host.url}/rpc`, { method: "POST", headers: { ...headers, origin: "null" }, body: "{}" });
      assert.equal(nullOrigin.status, 403);
      const missingOrigin = await fetch(`${host.url}/rpc`, { method: "POST", headers: { ...headers, "sec-fetch-site": "cross-site" }, body: "{}" });
      assert.equal(missingOrigin.status, 403);
    } finally {
      await stopChild(server);
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
