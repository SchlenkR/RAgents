import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { builtinPermissions } from "@ragents/engine";

const probe = (declarations: string) => {
  const root = mkdtempSync(path.join(tmpdir(), "ragents-profile-access-"));
  const profile = path.join(root, "ragents.config.access-fixture.ts");
  writeFileSync(profile, `export const config = {};\n${declarations}\n`);
  const loader = fileURLToPath(new URL("../src/config-file.ts", import.meta.url));
  const compose = fileURLToPath(new URL("../src/profile/compose.ts", import.meta.url));
  const hostServices = fileURLToPath(new URL("../src/ragents/host-services.ts", import.meta.url));
  const profileAccess = fileURLToPath(new URL("../src/ragents/profile-access.ts", import.meta.url));
  const support = fileURLToPath(new URL("../../../packages/ragents/tests/support.ts", import.meta.url));
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      const { loadConfigFile } = await import(${JSON.stringify(loader)});
      await loadConfigFile(${JSON.stringify(root)});
      const { profileAccessFor } = await import(${JSON.stringify(profileAccess)});
      const { composeProfile } = await import(${JSON.stringify(compose)});
      const { runOwnerAccessToken, userAccessToken } = await import(${JSON.stringify(hostServices)});
      const { Journal, Orchestration } = await import("@ragents/engine");
      const { testServices } = await import(${JSON.stringify(support)});
      const services = testServices();
      const journal = new Journal(":memory:", services);
      const runtime = new Orchestration(journal, services);
      const guarded = [];
      const host = composeProfile({ product: { id: "test", title: "Test" }, pluginIds: [], modules: new Map(), web: new Map(), executor: [] }, {
        ensureSession: (runId) => { guarded.push(runId); runtime.state(runId); },
        ensureWorkspaceAccess: () => {}, runtime: () => runtime,
        sessionWorkspaceFor: async () => { throw new Error("No workspace expected"); },
      });
      const describe = (access) => ({ user: access.user?.id ?? null, administrator: access.can("*"), read: access.can("runs.read") });
      const rows = ["administrator", "employee", "unknown", null].map((userId, index) => {
        const runId = "run-" + index;
        runtime.createRun({ commandId: "create:" + runId }, { runId, title: "Fixture", ownerHandle: "owner", ownerDisplayName: "Owner", ...(userId === null ? {} : { ownerUserId: userId }) });
        return { userId, direct: describe(profileAccessFor(userId)), userService: describe(host.service(userAccessToken)(userId)), ownerService: describe(host.service(runOwnerAccessToken)(runId)) };
      });
      let missingDenied = false;
      try { host.service(runOwnerAccessToken)("missing"); }
      catch (error) { missingDenied = error.code === "run-not-found"; }
      console.log(JSON.stringify({ rows, guarded, missingDenied }));
      journal.close();
    `], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env, PRODUCT_PROFILE: "access-fixture", PRODUCT_PROFILE_FILE: profile,
        PRODUCT_ID: "test", PRODUCT_TITLE: "Test", DATA_DIR: path.join(root, "data"),
      },
      encoding: "utf8", timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim().split("\n").at(-1)!) as {
      rows: { userId: string | null; direct: { user: string | null; administrator: boolean; read: boolean }; userService: unknown; ownerService: unknown }[];
      guarded: string[];
      missingDenied: boolean;
    };
    for (const row of output.rows) {
      assert.deepEqual(row.userService, row.direct);
      assert.deepEqual(row.ownerService, row.direct);
    }
    assert.deepEqual(output.guarded, ["run-0", "run-1", "run-2", "run-3", "missing"]);
    assert.equal(output.missingDenied, true);
    return output.rows.map(({ userId, direct }) => ({ userId, ...direct }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("profile and owner access grant administrator status only to the configured wildcard user", () => {
  const users = [
    { id: "administrator", password: "fixture-password", rights: ["*"] },
    { id: "employee", password: "fixture-password", rights: builtinPermissions.map((permission) => permission.id) },
  ];
  assert.deepEqual(probe(`export const users = ${JSON.stringify(users)};`), [
    { userId: "administrator", user: "administrator", administrator: true, read: true },
    { userId: "employee", user: "employee", administrator: false, read: true },
    { userId: "unknown", user: null, administrator: false, read: false },
    { userId: null, user: null, administrator: false, read: false },
  ]);
});

test("an open local profile keeps anonymous administrator access while unknown stored owners remain restricted", () => {
  assert.deepEqual(probe(""), [
    ...["administrator", "employee", "unknown"].map((userId) => ({ userId, user: null, administrator: false, read: false })),
    { userId: null, user: null, administrator: true, read: true },
  ]);
});

test("anonymous profile rights remain restricted unless the profile explicitly grants the wildcard", () => {
  for (const rights of [["runs.read"], ["*"]]) {
    const rows = probe(`export const anonymousUser = ${JSON.stringify({ id: "anonymous", rights })};`);
    assert.deepEqual(rows.slice(0, 3), ["administrator", "employee", "unknown"]
      .map((userId) => ({ userId, user: null, administrator: false, read: false })));
    assert.deepEqual(rows[3], { userId: null, user: "anonymous", administrator: rights.includes("*"), read: true });
  }
});
