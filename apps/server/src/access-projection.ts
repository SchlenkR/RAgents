import { emptyUsage, type AccessContext, type AccessProjectionRegistry, type RunView } from "@ragents/engine";
import type { ChatEvent, Message } from "quassel/events";
import type { ActorConversations } from "./ragents/actor-chat-history.js";

/** Plugin-Zustände und Plugin-Ereignisse zeigt jedes Plugin selbst über seine Zugriffsprojektion (docs/spec/plugins.md, Registrierungen des PluginHost). */
export const accessibleRunView = (view: RunView, access: AccessContext, projections: AccessProjectionRegistry): RunView => access.can("runs.inspect") ? view : {
  ...view,
  actors: view.actors.map((actor) => actor.kind === "human" ? { ...actor, grants: [] } : {
    ...actor,
    ...(actor.kind === "agent" ? { prompt: "" } : {}),
    execution: {
      driver: actor.execution.driver.kind === "agent" ? { kind: "agent", config: { provider: "", model: "" } } : actor.execution.driver,
      workspacePath: null,
      turnTimeoutMs: null,
    },
    grants: [],
    toolNames: [],
    openedToolNames: [],
    usage: emptyUsage(),
    lifecycle: actor.lifecycle.kind === "stopped" ? { ...actor.lifecycle, reason: "Beendet" } : actor.lifecycle,
  }),
  inputs: view.inputs.map((input) => ({ ...input, content: input.enqueuedBy === view.ownerId && input.presentation !== "background" ? input.content : "",
    lifecycle: input.lifecycle.kind === "discarded" ? { ...input.lifecycle, reason: "Verworfen" } : input.lifecycle,
  })),
  turns: view.turns.map((turn) => ({ ...turn, usage: emptyUsage(), toolCalls: [], reason: turn.reason ? "Die Verarbeitung wurde beendet." : null })),
  subscriptions: [],
  pluginStates: view.pluginStates.flatMap((entry) => {
    const state = projections.state(entry, access);
    return state ? [state] : [];
  }),
};

export const accessibleChatEvent = (event: ChatEvent, access: AccessContext, projections: AccessProjectionRegistry): ChatEvent | undefined => {
  if (access.can("runs.inspect")) return event;
  if (event.kind === "status" && event.startup?.status === "failed") return {
    ...event,
    startup: { status: "failed", message: "Der Start konnte nicht abgeschlossen werden. Bitte wende Dich an den zuständigen Betreuer." },
  };
  const trace = access.can("runs.trace");
  if (event.kind === "thinking") return trace ? event : { kind: "thinking", delta: "", at: event.at };
  if (event.kind === "tool") return trace ? event : { kind: "tool", id: event.id, name: "", arguments: "", at: event.at };
  if (event.kind === "tool-result") return trace ? event : { kind: "tool-result", id: event.id, result: "", isError: event.isError };
  if (event.kind === "system") return { ...event, text: "Hinweis zur Verarbeitung. Bei Fragen wende Dich an den zuständigen Agenten." };
  if (event.kind !== "plugin") return event;
  return projections.chatEvent(event.pluginId, event, access);
};

const visibleMessage = (message: Message, actorId: string, trace: boolean): Message[] => {
  if (message.role === "system" || message.role === "assistant" && message.sender !== actorId) return [];
  if (trace && (message.role === "thinking" || message.role === "tool")) return [message];
  if (message.role === "thinking") return [{ key: message.key, role: "thinking", sender: message.sender, text: "", closed: message.closed, at: message.at }];
  if (message.role === "tool") return [{
    key: message.key, role: "tool", sender: message.sender, text: "", closed: message.closed, at: message.at,
    ...(message.tool ? { tool: {
      id: message.tool.id, name: "", arguments: "",
      ...(message.tool.result === undefined ? {} : { result: "" }),
      ...(message.tool.isError === undefined ? {} : { isError: message.tool.isError }),
    } } : {}),
  }];
  return [message];
};

export const accessibleActorConversations = (history: ActorConversations, access: AccessContext): ActorConversations =>
  access.can("runs.inspect") ? history : {
    revision: history.revision,
    actors: Object.fromEntries(Object.entries(history.actors).map(([id, messages]) => [id, messages.flatMap((message) => visibleMessage(message, id, access.can("runs.trace")))])),
  };
