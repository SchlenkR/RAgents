import assert from "node:assert/strict";
import test from "node:test";
import { builtinPermissions, createAccessContext, DomainError, MethodContributionRegistry, unrestrictedAccess } from "@ragents/engine";
import { coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { coreSources, dispatchMethod } from "./rpc-fixture.ts";

test("run import requires administrator access before decoding an archive or binding a folder", async () => {
  const imported = {
    manifest: {
      formatVersion: 1,
      runId: "restored-run",
      hostVersion: "test-host",
      executorVersion: "test-executor",
      profile: "test",
      title: "Restored run",
      revision: 1,
      events: 1,
      boundDirectory: null,
      exportedAt: "2026-10-05T00:00:00.000Z",
    },
    sequence: 1,
    events: 1,
    workspace: "/example/restored-run",
    boundDirectory: null,
  };
  const imports: { archive: string; workspacePath: string | undefined }[] = [];
  const methods = new MethodContributionRegistry();
  methods.register("test", coreMethods(coreSources({
    importRun: async (archive, workspacePath) => {
      imports.push({ archive: archive.toString(), workspacePath });
      return imported;
    },
  })));
  const parameters = { archive: Buffer.from("test archive").toString("base64"), workspacePath: "/example/project" };
  const rights = builtinPermissions.map((permission) => permission.id);
  const nonAdministrators = [
    createAccessContext({ enabled: true, user: { id: "developer", label: "Developer", rights } }),
    createAccessContext({ enabled: false, user: { id: "guest", label: "Guest", rights } }),
    createAccessContext({ enabled: true, user: null }),
  ];
  for (const access of nonAdministrators) {
    for (const input of [parameters, {}]) {
      await assert.rejects(dispatchMethod(methods, coreContracts.transfer.import.id, input, access),
        (error: unknown) => error instanceof DomainError && error.code === "access-denied" && error.status === 403);
    }
  }
  assert.deepEqual(imports, []);

  const administrator = createAccessContext({ enabled: true, user: { id: "admin", label: "Administrator", rights: ["*"] } });
  for (const access of [administrator, unrestrictedAccess]) {
    assert.deepEqual(await dispatchMethod(methods, coreContracts.transfer.import.id, parameters, access), imported);
  }
  assert.deepEqual(imports, [
    { archive: "test archive", workspacePath: "/example/project" },
    { archive: "test archive", workspacePath: "/example/project" },
  ]);
});
