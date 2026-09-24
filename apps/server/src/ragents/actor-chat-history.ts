import { DomainError, type JournalEvent, type RunView } from "@ragents/engine";
import { applyEvent, type ChatEvent, type Message } from "../chat-events.js";
import { ChatTextPositions } from "./chat-text-positions.js";
import { attachmentContentPath } from "../api/contracts.js";
import { actionEventOf, actionResolvedEventOf, journalChatEventsOf } from "./journal-chat-events.js";

export interface ActorConversations {
  revision: number;
  actors: Record<string, Message[]>;
}

const ACTOR_HUES = [212, 158, 28, 283, 350, 190, 95, 320, 55, 245];
const actorToolId = (turnId: string, callId: string): string => JSON.stringify([turnId, callId]);

export function actorChatHistoryOf(view: RunView, events: readonly JournalEvent[]): ActorConversations {
  const actors: Record<string, Message[]> = Object.fromEntries(view.actors.filter((actor) => actor.kind !== "human").map((actor) => [actor.id, []]));
  const positions = new ChatTextPositions();
  const actorOf = (id: string) => {
    const actor = view.actors.find((entry) => entry.id === id);
    if (!actor) throw new DomainError("actor-not-found", `Der Actor ${id} fehlt in der Laufansicht.`, 404);
    return actor;
  };
  const colorOf = (id: string) => {
    if (actorOf(id).kind === "script") return "hsl(220 10% 40%)";
    const index = Math.max(view.actors.filter((actor) => actor.kind === "agent").findIndex((actor) => actor.id === id), 0);
    return `hsl(${ACTOR_HUES[index % ACTOR_HUES.length]} 45% 42%)`;
  };
  const interrupted = (turnId: string) =>
    view.turns.find((entry) => entry.id === turnId)?.toolCalls.filter((call) => call.status === "interrupted").map((call) => call.id) ?? [];
  const turnActorOf = (id: string) => {
    const turn = view.turns.find((entry) => entry.id === id);
    if (!turn) throw new Error(`Der Turn ${id} fehlt in der Laufansicht.`);
    return turn.actorId;
  };
  const interruptingCommands = new Set(events.flatMap((event) =>
    event.type === "turn.interrupted" ? [JSON.stringify([event.commandId, turnActorOf(event.payload.turnId)])] : []));
  const append = (id: string, event: ChatEvent, source: JournalEvent) => {
    const actor = actorOf(id);
    if (actor.kind === "human") throw new DomainError("actor-not-executable", "Ein menschlicher Actor besitzt keinen Actor-Chat.", 400);
    const previous = actors[id];
    const next = applyEvent(previous, event);
    if (next.length > previous.length) {
      const message = next[next.length - 1];
      next[next.length - 1] = { ...message, key: source.eventId, sender: id,
        ...(message.role === "assistant" ? { bubble: { color: colorOf(id), label: `@${actor.handle}`, side: "end" as const } } : {}),
      };
    }
    actors[id] = next;
  };

  for (const event of events) {
    if (event.runId !== view.id) throw new Error("Das Actor-Journal gehört zu einem anderen Run.");
    const cursor = positions.observe(event);
    const at = event.occurredAt;
    switch (event.type) {
      case "actor.input.enqueued": {
        const input = view.inputs.find((entry) => entry.id === event.payload.inputId);
        if (!input) throw new Error(`Die Eingabe ${event.payload.inputId} fehlt in der Laufansicht.`);
        if (input.lifecycle.kind === "discarded") break;
        actorOf(input.actorId);
        if (input.presentation === "background") break;
        const fromOwner = input.enqueuedBy === view.ownerId;
        const sender = actorOf(input.enqueuedBy);
        const attachments = input.artifactIds.map((id) => {
          const artifact = view.artifacts.find((entry) => entry.id === id);
          if (!artifact) throw new Error(`Der Anhang ${id} fehlt in der Laufansicht.`);
          return { name: artifact.title, mediaType: artifact.mediaType, size: artifact.size,
            url: attachmentContentPath(view.id, id) };
        });
        actors[input.actorId].push({ key: event.eventId, role: fromOwner ? "user" : "assistant", sender: input.enqueuedBy,
          text: input.content, closed: true, at, ...(attachments.length ? { attachments } : {}),
          ...(fromOwner ? {} : { bubble: { color: colorOf(input.enqueuedBy),
            label: input.subscriptionId ? "Über Subscription zugestellt" : `Zugestellt von @${sender.handle}`, side: "start" } }),
        });
        break;
      }
      case "model.output.completed":
      case "model.output.interrupted":
      case "model.reasoning.completed":
      case "tool.call.started":
      case "tool.call.completed":
      case "tool.call.failed":
      case "runtime.output.recorded":
      case "turn.finished":
      case "turn.interrupted": {
        const actorId = turnActorOf(event.payload.turnId);
        for (const mapped of journalChatEventsOf(event, cursor, interrupted, actorToolId)) append(actorId, mapped, event);
        if (event.type === "model.reasoning.completed") append(actorId, { kind: "turn-done" }, event);
        break;
      }
      case "actor.stopped":
        if (interruptingCommands.has(JSON.stringify([event.commandId, event.payload.actorId]))) break;
        for (const mapped of journalChatEventsOf(event, cursor, interrupted, actorToolId)) append(event.payload.actorId, mapped, event);
        break;
      case "action.proposed":
        if (actorOf(event.actorId).kind !== "human") append(event.actorId, actionEventOf(event.payload, at), event);
        break;
      case "action.resolved": {
        const action = view.actions.find((entry) => entry.id === event.payload.actionId);
        if (!action) throw new Error(`Die Aktion ${event.payload.actionId} fehlt in der Laufansicht.`);
        if (actorOf(action.askedBy).kind !== "human") append(action.askedBy, actionResolvedEventOf(event), event);
        break;
      }
    }
  }
  return { revision: view.revision, actors };
}
