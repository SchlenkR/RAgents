import { actorByHandle } from "@ragents/engine/src/http/contracts";
import type { SessionContext } from "@ragents/web/PluginRegistry";
import type { ChatSnapshot } from "@ragents/web/actor-programs/client-ui/contracts";
import { actorChatMessages } from "@ragents/web/actor-conversation";
import { runViewFrom } from "@ragents/web/run-view";
import { programChatNotice } from "@ragents/web/chat/chat-target";

export const resolveChatActor = (session: SessionContext, target: string) => {
  const view = runViewFrom(session.runView);
  if (!view || view.id !== session.session.id) throw new Error("Die Run-Ansicht für diesen Chat ist noch nicht verfügbar");
  const actor = target === "primary"
    ? view.actors.find((entry) => entry.id === view.primaryActorId)
    : actorByHandle(view.actors, target);
  if (!actor || actor.kind === "human") {
    const names = view.actors.filter((entry) => entry.kind !== "human").map((entry) => `@${entry.handle}`).join(", ");
    throw new Error(`Das Chat-Ziel ist nicht verfügbar. Erlaubt sind primary und: ${names || "noch keine Actors"}`);
  }
  return { view, actor };
};

export const chatSnapshotOf = (session: SessionContext, target: string): ChatSnapshot => {
  try {
    const { view, actor } = resolveChatActor(session, target);
    const primary = actor.id === view.primaryActorId;
    const error = actor.kind === "script" ? programChatNotice : session.conversationError ?? (!session.connected
      ? "Die Verbindung zum Run ist unterbrochen"
      : actor.lifecycle?.kind === "stopped" ? `@${actor.handle} gestoppt: ${actor.lifecycle.reason}. Er nimmt keine Eingaben an, bis er neu gestartet wird` : undefined);
    return {
      owner: actor.id,
      messages: actorChatMessages(view, actor, session.messages, session.actorConversations?.[actor.id]),
      running: primary ? session.running : actor.lifecycle?.kind === "running",
      ...(actor.kind === "script" ? { readOnly: true } : {}),
      ...(error ? { error } : {}),
    };
  } catch (error) {
    return { messages: [], running: false, error: error instanceof Error ? error.message : String(error) };
  }
};
