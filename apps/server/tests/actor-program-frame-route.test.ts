import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import test from "node:test";
import { Value } from "typebox/value";
import { unrestrictedAccess } from "@ragents/engine";
import { allGrants } from "../../../packages/ragents/tests/support.ts";
import { ACTOR_VIEW_ID_MAX_LENGTH, actorProgramContracts } from "../src/plugin-support/actor-programs/contract.ts";
import { createMiniAppFrameRoutes, miniAppsApiPrefix } from "../../../plugins/ragents.actor-programs/server/routes.ts";
import { actorProgramFixture } from "./actor-programs-fixture.ts";
import { writeAppFiles } from "./actor-runtime-fixture.ts";

test("the frame route takes the room-qualified view identifier of a run script's actor", () => {
  const [route] = createMiniAppFrameRoutes({ ensureSession: () => undefined, runtime: {} } as never);
  const request = { method: "GET" } as IncomingMessage;
  const at = (view: string) => new URL(`http://host${miniAppsApiPrefix}/runs/run-1/apps/${view}/frame`);
  assert.equal(route!.matches(request, at("review.review--main")), true);
  assert.equal(route!.matches(request, at("board")), true);
  assert.equal(route!.matches(request, at("Review--main")), false);
});

test("a view whose room, package, and view key each have the longest name opens through the frame route over HTTP", async (t) => {
  const f = await actorProgramFixture(t);
  const longest = (letter: string) => letter + "x".repeat(63);
  const room = longest("r");
  const owner = f.setup.view.ownerId;
  f.setup.runtime.createScriptActor({ actorId: owner, commandId: "open-room" }, f.runId, {
    handle: "keeper", displayName: "Keeper", grants: allGrants(), toolNames: null, room: { kind: "open", name: room, origin: null },
  });
  const keeper = f.setup.runtime.view(f.runId).actors.find((actor) => actor.handle === "keeper")!;
  await writeAppFiles(f.directory, `${room}.${longest("p")}`, {
    "package.json": JSON.stringify({ name: "board", private: true, type: "module", ragents: { title: "Board", views: [{ id: longest("v"), client: "src/client.tsx" }] } }),
    "src/client.tsx": 'document.body.dataset.board = "longest-view"; export {};',
  });
  await f.runtime.activate({ actorId: keeper.id, commandId: "activate-board" }, f.runId, longest("p"));
  const app = f.runtime.apps(f.runId).find((entry) => entry.actorId === keeper.id)!;
  assert.equal(app.id, `${room}.${longest("p")}--${longest("v")}`);
  assert.equal(app.id.length, ACTOR_VIEW_ID_MAX_LENGTH);
  const action = { runId: f.runId, appId: app.id, revision: app.revision, actionId: "show", requestId: "longest", input: {} };
  assert.ok(Value.Check(actorProgramContracts.action.input, action));
  assert.ok(Value.Check(actorProgramContracts.invocation.input, { runId: f.runId, appId: app.id, invocationId: "call-1" }));
  assert.equal(Value.Check(actorProgramContracts.action.input, { ...action, appId: `${app.id}x` }), false);

  const [route] = createMiniAppFrameRoutes({ ensureSession: () => undefined, runtime: f.runtime });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://host");
    if (route!.matches(request, url)) void route!.handle({ request, response, url, access: unrestrictedAccess });
    else { response.writeHead(404); response.end("no route"); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const frame = (view: string) => fetch(`http://127.0.0.1:${address.port}${miniAppsApiPrefix}/runs/${f.runId}/apps/${view}/frame?revision=${app.revision}`);

  const response = await frame(app.id);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html/);
  assert.match(await response.text(), /longest-view/);
  const longer = await frame(`${app.id}x`);
  assert.equal(longer.status, 404);
  assert.equal(await longer.text(), "no route", "one character more is no view identifier");
});
