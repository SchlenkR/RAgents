import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contentPathOf, documentsApiPrefix, grantedPathOf } from "../../../plugins/ragents.documents/contract.ts";
import { announcement, isolatedDirectory, profileSource, stopChild } from "./foreign-plugin-fixture.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

test("the host lets a document grant in the address stand in for the access token, and only on the content route", { timeout: 120_000 }, async () => {
  const directory = isolatedDirectory("ragents-document-grant-");
  const output: string[] = [];
  const profile = path.join(directory, "ragents.config.grant-check.ts");
  writeFileSync(profile, profileSource("grant-check", ["ragents.orchestration", "ragents.workspace", "ragents.product", "ragents.documents"]));
  // Development mode skips the check of the built web, which the host tests run before.
  const server = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], {
    cwd: path.join(root, "apps/server"),
    env: { ...process.env, ACME_MODEL_KEY: "not-a-real-key", RAGENTS_DEV: "1", PRODUCT_PROFILE: "grant-check", PRODUCT_PROFILE_FILE: profile, DATA_DIR: path.join(directory, "data") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const host = await announcement(server, output);
    const call = async (method: string, params: object) => (await (await fetch(`${host.url}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${host.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    })).json()) as { result?: { grant: string }; error?: unknown };
    const minted = await call("ragents.documents.grant", { runId: "run-1", root: "@documents" });
    assert.equal(minted.error, undefined, JSON.stringify(minted.error));
    const grant = minted.result!.grant;

    const plain = await fetch(`${host.url}${contentPathOf(documentsApiPrefix, "run-1", "@documents/shot.png")}`);
    assert.equal(plain.status, 401, "without a token the content route stays closed");
    const withGrant = await fetch(`${host.url}${grantedPathOf(documentsApiPrefix, "run-1", grant, "@documents/shot.png")}`);
    assert.deepEqual({ status: withGrant.status, ...await withGrant.json() as object }, {
      status: 409, error: "The run has not started yet; the working directory is created with the first message.",
    }, "the grant passes the gate and the route answers for the run");
    const unknown = await fetch(`${host.url}${grantedPathOf(documentsApiPrefix, "run-1", "x".repeat(43), "@documents/shot.png")}`);
    assert.deepEqual({ status: unknown.status, ...await unknown.json() as object }, {
      status: 403, code: "document-grant-invalid", error: "The grant in this address is unknown or expired; open the document again.",
    });
    const elsewhere = await fetch(`${host.url}/api/plugins/ragents.documents/runs/run-1/files?grant=${grant}`);
    assert.equal(elsewhere.status, 401, "a grant opens nothing but the content route");
    assert.equal((await fetch(`${host.url}${grantedPathOf(documentsApiPrefix, "run-1", grant, "@documents/shot.png")}`, { method: "POST" })).status, 401,
      "a grant only reads");
  } finally {
    await stopChild(server);
    rmSync(directory, { recursive: true, force: true });
  }
});
