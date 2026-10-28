import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DomainError } from "../../../packages/ragents/src/runtime/domain-error";
import { FullAccessConfirmations, type FullAccessOptions } from "../../../plugins/ragents.workspace/client/full-access";

const run = { runId: "run-a", name: "Review project" };

const fixture = async (t: TestContext) => {
  const directory = await mkdtemp(join(tmpdir(), "ragents-full-access-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return (options: FullAccessOptions = {}, origin = "https://server.example") =>
    new FullAccessConfirmations(join(directory, "runs"), origin, options);
};

test("full access without a local confirmation fails with all remedies", async (t) => {
  const create = await fixture(t);
  await assert.rejects(create().accept(run), (cause: unknown) => {
    assert.ok(cause instanceof DomainError);
    assert.equal(cause.code, "workspace-full-access-refused");
    assert.match(cause.message, /Isolated.*VS Code.*--allow-full-access/);
    return true;
  });
});

test("a local confirmation names the run and is remembered across workstation restarts", async (t) => {
  const create = await fixture(t);
  const calls: unknown[] = [];
  await create({ confirmFullAccess: async (value) => { calls.push(value); return true; } }).accept(run);
  await create({ confirmFullAccess: async () => { assert.fail("The confirmed run must not ask again"); } }).accept(run);
  assert.deepEqual(calls, [run]);
});

test("refusing full access does not remember approval", async (t) => {
  const create = await fixture(t);
  await assert.rejects(create({ confirmFullAccess: async () => false }).accept(run), /not allowed full access/);
  await assert.rejects(create().accept(run), /not allowed full access/);
});

test("concurrent full access operations share one local confirmation", async (t) => {
  const create = await fixture(t);
  const answer = Promise.withResolvers<boolean>();
  let calls = 0;
  const confirmations = create({ confirmFullAccess: () => { calls += 1; return answer.promise; } });
  const first = confirmations.accept(run);
  const second = confirmations.accept(run);
  answer.resolve(true);
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test("the deny policy overrides a remembered approval and the allow policy needs no dialog", async (t) => {
  const create = await fixture(t);
  await create({ fullAccess: () => "allow", confirmFullAccess: async () => { assert.fail("Allow needs no dialog"); } }).accept(run);
  await assert.rejects(create({ fullAccess: () => "deny" }).accept(run), /not allowed full access/);
});

test("local consent is scoped to the server and the run", async (t) => {
  const create = await fixture(t);
  await create({ fullAccess: () => "allow" }).accept(run);
  await assert.rejects(create({}, "https://other.example").accept(run), /not allowed full access/);
  await assert.rejects(create().accept({ runId: "run-b", name: "Another run" }), /not allowed full access/);
});

test("deleting a run removes its local confirmation", async (t) => {
  const create = await fixture(t);
  const confirmations = create({ fullAccess: () => "allow" });
  await confirmations.accept(run);
  assert.deepEqual(await create().confirmedRuns(), [run.runId]);
  assert.deepEqual(await create({}, "https://other.example").confirmedRuns(), []);
  await confirmations.forget(run.runId);
  assert.deepEqual(await create().confirmedRuns(), []);
  await assert.rejects(create().accept(run), /not allowed full access/);
  await confirmations.forget(run.runId);
});

test("a policy changed to deny while the dialog is open refuses approval", async (t) => {
  const create = await fixture(t);
  let denied = false;
  const confirmations = create({ fullAccess: () => denied ? "deny" : "ask", confirmFullAccess: async () => { denied = true; return true; } });
  await assert.rejects(confirmations.accept(run), /not allowed full access/);
  await assert.rejects(create().accept(run), /not allowed full access/);
});

test("run identifiers cannot escape the confirmation folder", async (t) => {
  const create = await fixture(t);
  await assert.rejects(create({ fullAccess: () => "allow" }).accept({ runId: "../escape", name: "Invalid" }), /not usable as a folder name/);
});


test("deleting a run while its confirmation is open cannot recreate the approval", async (t) => {
  const create = await fixture(t);
  const answer = Promise.withResolvers<boolean>();
  const asked = Promise.withResolvers<void>();
  const confirmations = create({ confirmFullAccess: () => { asked.resolve(); return answer.promise; } });
  const accepting = confirmations.accept(run);
  const refused = assert.rejects(accepting, /not allowed full access/);
  await asked.promise;
  await confirmations.forget(run.runId);
  answer.resolve(true);
  await refused;
  assert.deepEqual(await create().confirmedRuns(), []);
});
