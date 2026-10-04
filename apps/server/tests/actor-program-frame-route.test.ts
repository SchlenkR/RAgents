import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import test from "node:test";
import { createMiniAppFrameRoutes, miniAppsApiPrefix } from "../../../plugins/ragents.actor-programs/server/routes.ts";

test("the frame route takes the room-qualified view identifier of a run script's actor", () => {
  const [route] = createMiniAppFrameRoutes({ ensureSession: () => undefined, runtime: {} } as never);
  const request = { method: "GET" } as IncomingMessage;
  const at = (view: string) => new URL(`http://host${miniAppsApiPrefix}/runs/run-1/apps/${view}/frame`);
  assert.equal(route!.matches(request, at("review.review--main")), true);
  assert.equal(route!.matches(request, at("board")), true);
  assert.equal(route!.matches(request, at("Review--main")), false);
});
