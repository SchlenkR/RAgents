import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DOCUMENT_GRANT_LIFETIME_MS } from "../../../plugins/ragents.documents/contract";
import { DocumentGrantStore, type GrantSnapshot, type GrantState } from "../../../plugins/ragents.documents/web/grants";
import { documentBaseOf, documentUrlResolver, grantedAddressOf } from "../../../plugins/ragents.documents/web/links";

const prefix = "/api/plugins/ragents.documents";
const raw = `${prefix}/runs/run-1/raw`;
const granted = (grant: string) => `${prefix}/runs/run-1/grant/${grant}`;
const report = documentBaseOf(prefix, "run-1", "@documents/review/report.md");

const snapshotOf = (states: Readonly<Record<string, GrantState>>): GrantSnapshot & { asked: string[] } => {
  const asked: string[] = [];
  return { asked, revision: 1, grantFor: (runId, root) => { asked.push(`${runId}:${root}`); return states[root]; } };
};

const settled = () => new Promise((resolve) => setImmediate(resolve));

/** A store with a clock, recorded requests and renewals, and a switch per request between grant and failure. */
const storeWith = () => {
  const clock = { now: 0 };
  const requests: string[] = [];
  const renewals: Array<() => void> = [];
  const failures = new Set<number>();
  const store = new DocumentGrantStore({
    request: async (runId, root) => {
      requests.push(`${runId}:${root}`);
      if (failures.has(requests.length)) throw new Error("The right runs.inspect is missing.");
      return { grant: `grant-${requests.length}` };
    },
    now: () => clock.now,
    schedule: (task, delay) => {
      assert.equal(delay, DOCUMENT_GRANT_LIFETIME_MS / 2);
      renewals.push(task);
    },
  });
  return { store, clock, requests, renewals, failures };
};

test("the store asks once per run and root, announces the grant, and renews it after half its lifetime", async () => {
  const { store, clock, requests } = storeWith();
  const notices: number[] = [];
  store.subscribe(() => notices.push(clock.now));
  const first = store.current();
  assert.equal(first.grantFor("run-1", "@documents"), undefined, "a grant loads first");
  assert.equal(first.grantFor("run-1", "@documents"), undefined);
  await settled();
  assert.deepEqual(requests, ["run-1:@documents"], "one request per run and root");
  assert.deepEqual(notices, [0]);
  const second = store.current();
  assert.notEqual(second, first, "a change brings a new snapshot");
  assert.equal(second.revision, first.revision + 1);
  assert.equal(store.current(), second, "and the same one until the next change");
  assert.deepEqual(second.grantFor("run-1", "@documents"), { grant: "grant-1" });
  assert.equal(second.grantFor("run-1", ""), undefined, "another root has its own grant");
  await settled();
  assert.deepEqual(second.grantFor("run-1", ""), { grant: "grant-2" });

  clock.now = DOCUMENT_GRANT_LIFETIME_MS / 2;
  assert.deepEqual(store.current().grantFor("run-1", "@documents"), { grant: "grant-1" }, "an older grant still serves while its renewal loads");
  await settled();
  assert.deepEqual(requests, ["run-1:@documents", "run-1:", "run-1:@documents"]);
  assert.deepEqual(store.current().grantFor("run-1", "@documents"), { grant: "grant-3" });
  assert.equal(requests.length, 3);
});

test("a grant close to its end is not handed out, and a failure is reported and asked again later", async () => {
  const { store, clock, requests, failures } = storeWith();
  store.current().grantFor("run-1", "@documents");
  await settled();
  failures.add(2);
  clock.now = DOCUMENT_GRANT_LIFETIME_MS - 30_000;
  assert.equal(store.current().grantFor("run-1", "@documents"), undefined, "an address would not outlive the grant");
  await settled();
  assert.deepEqual(store.current().grantFor("run-1", "@documents"), { error: "The right runs.inspect is missing." });
  assert.equal(requests.length, 2, "a failure is not asked again at once");
  clock.now += 30_000;
  assert.equal(store.current().grantFor("run-1", "@documents"), undefined);
  await settled();
  assert.deepEqual(store.current().grantFor("run-1", "@documents"), { grant: "grant-3" });
});

test("a scheduled renewal fetches a new grant while a view watches and forgets the grant otherwise", async () => {
  const { store, requests, renewals } = storeWith();
  const stop = store.subscribe(() => {});
  store.current().grantFor("run-1", "@documents");
  await settled();
  renewals.shift()!();
  await settled();
  assert.deepEqual(store.current().grantFor("run-1", "@documents"), { grant: "grant-2" }, "a watched grant is renewed on time");
  stop();
  renewals.shift()!();
  assert.equal(store.current().grantFor("run-1", "@documents"), undefined, "an unwatched grant is forgotten and asked again when needed");
  await settled();
  assert.equal(requests.length, 3);
});

test("with grants an address of the content route takes the grant of its root and keeps query and anchor", () => {
  const grants = snapshotOf({ "@documents": { grant: "store-grant" }, "": { grant: "project-grant" } });
  const resolve = documentUrlResolver(report, grants);
  assert.equal(resolve("shots/home.png?size=1#top"), `${granted("store-grant")}/%40documents/review/shots/home.png?size=1#top`);
  assert.equal(resolve("@documents/browser/a.png"), `${granted("store-grant")}/@documents/browser/a.png`);
  assert.equal(resolve("../../src/app.ts"), `${granted("project-grant")}/src/app.ts`, "an address that climbs into the run's root takes that root's grant");
  for (const kept of ["https://example.com/a.png", "#results", "/api/other", ""]) assert.equal(resolve(kept), kept);
  assert.deepEqual(grants.asked, ["run-1:@documents", "run-1:@documents", "run-1:"], "only an address it resolves asks for a grant");
  assert.equal(documentUrlResolver(report, snapshotOf({}))("shots/home.png"), "", "while the grant loads the address stays empty");
  assert.equal(documentUrlResolver(report, snapshotOf({ "@documents": { error: "expired" } }))("shots/home.png"), `${raw}/%40documents/review/shots/home.png`,
    "a failed grant leaves the plain address, which fails visibly");
  assert.equal(documentUrlResolver(report)("shots/home.png"), `${raw}/%40documents/review/shots/home.png`, "with a cookie no address needs a grant");
  assert.deepEqual(grantedAddressOf(report, `${raw}/%40documents/review/shots/home.png?v=2026`, grants), { url: `${granted("store-grant")}/%40documents/review/shots/home.png?v=2026` });
  assert.deepEqual(grantedAddressOf(report, "/files/runs/run-1/artifacts/a-1", grants), { url: "/files/runs/run-1/artifacts/a-1" }, "an address outside the route stays");
});

test("the page sends only its origin as referrer, before it loads anything", async () => {
  const page = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const policy = page.indexOf('<meta name="referrer" content="strict-origin" />');
  assert.ok(policy > 0, "the shared web entry declares strict-origin");
  assert.ok(policy < page.indexOf("<link") && policy < page.indexOf("<script"), "the policy precedes every request of the page");
});
