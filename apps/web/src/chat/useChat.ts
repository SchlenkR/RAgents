import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { coreContracts } from "@ragents/host/api/contracts";
import { applyEvent, type ChatEvent, type Message, type ChatAttachmentInput, type ChatStartupStatus } from "../../../server/src/chat-events";
import type { ChatUserLocation } from "../../../server/src/chat-context";
import { rpc } from "../rpc";
import { sendChatMessage, startChatEntry, startSkillEntry, stopChat } from "./requests";

export function useChat(sessionId: string, onEvent?: (event: ChatEvent) => void, enabled = true): {
  messages: Message[];
  running: boolean;
  connected: boolean;
  startup: ChatStartupStatus | undefined;
  send: (text: string, attachments?: ChatAttachmentInput[], userLocation?: ChatUserLocation) => Promise<void>;
  startSkill: (entryId: string, text: string, attachments?: ChatAttachmentInput[]) => Promise<void>;
  start: (entryId: string, input: unknown) => Promise<void>;
  stop: () => Promise<void>;
} {
  const [messages, dispatch] = useReducer(applyEvent, [] as Message[]);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [startup, setStartup] = useState<ChatStartupStatus>();
  const observer = useRef(onEvent);
  observer.current = onEvent;

  useEffect(() => {
    setConnected(false);
    if (!enabled) return;
    return rpc.subscribe(coreContracts.channels.chat, { runId: sessionId }, (event) => {
      if (event.kind === "replay-end") setConnected(true);
      if (event.kind === "status") {
        setRunning(event.running);
        setStartup(event.startup);
      }
      observer.current?.(event);
      dispatch(event);
    }, () => setConnected(false));
  }, [sessionId, enabled]);

  const send = useCallback((text: string, attachments?: ChatAttachmentInput[], userLocation?: ChatUserLocation) =>
    sendChatMessage(sessionId, text, attachments, userLocation), [sessionId]);

  const startSkill = useCallback((entryId: string, text: string, attachments?: ChatAttachmentInput[]) =>
    startSkillEntry(sessionId, entryId, text, attachments), [sessionId]);

  const start = useCallback((entryId: string, input: unknown) => startChatEntry(sessionId, entryId, input), [sessionId]);

  const stop = useCallback(() => stopChat(sessionId), [sessionId]);

  return { messages, running, connected, startup, send, startSkill, start, stop };
}
