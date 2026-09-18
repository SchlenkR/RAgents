import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { applyEvent, type ChatEvent, type Message, type ChatAttachmentInput, type ChatStartupStatus } from "../../../server/src/chat-events";
import type { ChatUserLocation } from "../../../server/src/chat-context";
import { chatChannel } from "../../../server/src/event-channels";
import { eventHub, type EventHubLike } from "../events";
import { postChatRequest, sendChatMessage } from "./requests";

export function useChat(sessionId: string, onEvent?: (event: ChatEvent) => void, enabled = true, hub: EventHubLike = eventHub): {
  messages: Message[];
  running: boolean;
  connected: boolean;
  startup: ChatStartupStatus | undefined;
  send: (text: string, attachments?: ChatAttachmentInput[], userLocation?: ChatUserLocation) => Promise<void>;
  start: (entryId: string, input: unknown) => Promise<void>;
  stop: () => Promise<void>;
} {
  const [messages, dispatch] = useReducer(applyEvent, [] as Message[]);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [startup, setStartup] = useState<ChatStartupStatus>();
  const baseUrl = `/chat/${encodeURIComponent(sessionId)}`;
  const observer = useRef(onEvent);
  observer.current = onEvent;

  useEffect(() => {
    setConnected(false);
    if (!enabled) return;
    return hub.subscribe({
      channel: chatChannel(sessionId),
      onMessage: (data) => {
        const event = data as ChatEvent;
        if (event.kind === "replay-end") setConnected(true);
        if (event.kind === "status") {
          setRunning(event.running);
          setStartup(event.startup);
        }
        observer.current?.(event);
        dispatch(event);
      },
      onError: () => setConnected(false),
    });
  }, [sessionId, enabled, hub]);

  const post = useCallback((action: "start" | "stop", body: unknown) => postChatRequest(baseUrl, action, body), [baseUrl]);

  const send = useCallback((text: string, attachments?: ChatAttachmentInput[], userLocation?: ChatUserLocation) =>
    sendChatMessage(baseUrl, text, attachments, userLocation), [baseUrl]);

  const start = useCallback((entryId: string, input: unknown) => post("start", { entry: entryId, input }), [post]);

  const stop = useCallback(() => post("stop", {}), [post]);

  return { messages, running, connected, startup, send, start, stop };
}
