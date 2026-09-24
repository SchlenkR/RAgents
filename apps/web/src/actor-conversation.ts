import type { Message } from "./chat/types";
import { withToolSummaries } from "./toolLine";
import { runTurnOutputs, type RunActor, type RunActorInput, type RunView } from "./run-view";

const ACTOR_HUES = [212, 158, 28, 283, 350, 190, 95, 320, 55, 245];
const shortId = (id: string) => id.length > 12 ? `${id.slice(0, 12)}...` : id;

export const actorInputLabel = (view: RunView, input: RunActorInput): string => input.subscriptionId
  ? "Über Subscription zugestellt"
  : `Zugestellt von @${view.actors.find((actor) => actor.id === input.enqueuedBy)?.handle ?? shortId(input.enqueuedBy)}`;

export const actorConversation = (view: RunView, actor: RunActor): Message[] => {
  const colorOf = (actorId: string) => {
    if (view.actors.find((entry) => entry.id === actorId)?.kind === "script") return "hsl(220 10% 40%)";
    const position = Math.max(view.actors.filter((entry) => entry.kind === "agent").findIndex((entry) => entry.id === actorId), 0);
    return `hsl(${ACTOR_HUES[position % ACTOR_HUES.length]} 45% 42%)`;
  };
  const delivered = view.inputs.filter((input) => input.actorId === actor.id && input.lifecycle.kind !== "discarded" && input.presentation !== "background")
    .map((input): { sequence: number; message: Message } => {
      const fromOwner = input.enqueuedBy === view.ownerId;
      const attachments = input.artifactIds.map((id) => {
        const artifact = view.artifacts.find((entry) => entry.id === id);
        if (!artifact) throw new Error(`Anhang ${id} fehlt in der Run-Ansicht`);
        return {
          name: artifact.title, mediaType: artifact.mediaType, size: artifact.size,
          url: `/chat/${encodeURIComponent(view.id)}/attachments/${encodeURIComponent(id)}`,
        };
      });
      return {
        sequence: input.sequence,
        message: {
          key: input.id,
          role: fromOwner ? "user" : "assistant",
          sender: input.enqueuedBy,
          text: input.content,
          ...(attachments.length ? { attachments } : {}),
          closed: true,
          at: input.enqueuedAt,
          ...(fromOwner ? {} : { bubble: { color: colorOf(input.enqueuedBy), label: actorInputLabel(view, input), side: "start" } }),
        },
      };
    });
  const answers = view.turns.filter((turn) => turn.actorId === actor.id)
    .flatMap((turn) => runTurnOutputs(turn).map((output): { sequence: number; message: Message } => ({
      sequence: output.sequence,
      message: {
        key: `${turn.id}:${output.sequence}`,
        role: "assistant",
        sender: actor.id,
        text: output.text,
        closed: true,
        at: output.occurredAt,
        bubble: { color: colorOf(actor.id), label: `@${actor.handle}`, side: "end" },
      },
    })));
  return [...delivered, ...answers].sort((left, right) => left.sequence - right.sequence).map((entry) => entry.message);
};

export const actorChatMessages = (view: RunView, actor: RunActor, primaryMessages: readonly Message[], conversation?: readonly Message[]): Message[] =>
  actor.id === view.primaryActorId
    ? withToolSummaries(primaryMessages).map((message) => message.role === "user" || message.role === "assistant"
      ? { ...message, sender: message.role === "user" ? view.ownerId : actor.id }
      : message)
    : conversation ? withToolSummaries([...conversation]) : actorConversation(view, actor);
