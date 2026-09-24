import { emptyUsage, type AccessContext, type JsonValue, type PluginState, type RunView } from "@ragents/engine";
import type { ChatEvent, Message } from "./chat-events.js";
import type { ActorConversations } from "./ragents/actor-chat-history.js";

const record = (value: JsonValue | undefined): Record<string, JsonValue | undefined> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;

const hiddenStates = new Set(["ragents.system-prompt", "ragents.model", "ragents.start-options"]);

const visibleState = (entry: PluginState): PluginState | undefined => {
  if (hiddenStates.has(entry.pluginId)) return undefined;
  if (entry.pluginId === "ragents.actor-programs.invocations") return { ...entry, state: { version: 1, revision: entry.updatedAt } };
  if (entry.pluginId !== "ragents.actor-programs") return entry;
  const state = record(entry.state);
  const program = state?.program ? record(state.program) : undefined;
  if (!program) return entry;
  const views = Array.isArray(program.views) ? program.views.map((value) => {
    const view = record(value);
    return view ? { id: view.id, key: view.key, title: view.title, visible: view.visible, placements: view.placements } : value;
  }) : [];
  return { ...entry, state: {
    version: 1,
    program: {
      name: program.name,
      title: program.title,
      actorId: program.actorId,
      actorHandle: program.actorHandle,
      revision: program.revision,
      views,
    },
  } };
};

export const accessibleRunView = (view: RunView, access: AccessContext): RunView => access.can("runs.inspect") ? view : {
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
    const state = visibleState(entry);
    return state ? [state] : [];
  }),
};

export const accessibleChatEvent = (event: ChatEvent, access: AccessContext): ChatEvent | undefined => {
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
  if (event.kind !== "extension") return event;
  if (hiddenStates.has(event.pluginId)) return undefined;
  if (event.pluginId === "ragents.actor-programs" || event.pluginId === "ragents.actor-programs.invocations") return undefined;
  return event;
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
