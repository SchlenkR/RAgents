import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import {
  claimTurn,
  type ClaimedTurn,
  type Orchestration,
  type RunView,
} from "@ragents/engine";

export const enqueueAndClaim = (
  runtime: Orchestration,
  view: RunView,
  actorId: string,
  inputCommandId: string,
  content: string,
  turnCommandId: string,
): ClaimedTurn => {
  const updated = runtime.enqueueInput(
    { actorId: view.ownerId, commandId: inputCommandId },
    view.id,
    { actorId, content },
  );
  const input = updated.inputs.findLast((entry) => entry.actorId === actorId && entry.lifecycle.kind === "pending");

  if (!input) throw new Error(`ActorInput for ${actorId} was not enqueued.`);

  return claimTurn(runtime, view.id, actorId, input.id, turnCommandId);
};

export const capturedJson = () => {
  const captured: { status: number; body: unknown } = { status: 0, body: undefined };
  const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false });
  Object.assign(response, {
    writeHead: (status: number) => {
      captured.status = status;
      return response;
    },
    end: (chunk?: string) => {
      response.writableEnded = true;
      captured.body = chunk === undefined ? undefined : JSON.parse(chunk);
    },
  });
  return { captured, response: response as unknown as ServerResponse };
};
