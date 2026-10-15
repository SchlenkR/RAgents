import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { coreContracts } from "@ragents/host/api/contracts";
import { applyEvent, type ChatEvent, type Message, type ChatAttachmentInput, type ChatStartupStatus } from "@schlenkr/quassel/events";
import type { ChatUserLocation } from "../../../server/src/chat-context";
import { rpc } from "../rpc";
import { sendChatMessage, startChatEntry, startSkillEntry } from "./requests";

const applyEvents = (messages: Message[], events: ChatEvent[]) => events.reduce(applyEvent, messages);

export function useChat(sessionId: string, onEvent?: (event: ChatEvent) => void, enabled = true): {
  messages: Message[];
  running: boolean;
  connected: boolean;
  startup: ChatStartupStatus | undefined;
  send: (text: string, attachments?: ChatAttachmentInput[], userLocation?: ChatUserLocation) => Promise<void>;
  startSkill: (entryId: string, text: string, attachments?: ChatAttachmentInput[]) => Promise<void>;
  start: (entryId: string, parameters: Readonly<Record<string, unknown>>) => Promise<void>;
} {
  const [messages, dispatch] = useReducer(applyEvents, [] as Message[]);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [startup, setStartup] = useState<ChatStartupStatus>();
  const observer = useRef(onEvent);
  observer.current = onEvent;

  useEffect(() => {
    setConnected(false);
    if (!enabled) return;
    let replay: ChatEvent[] | undefined;
    let disposed = false;
    const publish = (events: ChatEvent[]) => {
      for (const event of events) {
        if (event.kind === "replay-end") setConnected(true);
        if (event.kind === "status") {
          setRunning(event.running);
          setStartup(event.startup);
        }
        observer.current?.(event);
      }
      dispatch(events);
    };
    const unsubscribe = rpc.subscribe(coreContracts.channels.chat, { runId: sessionId }, (event) => {
      if (disposed) return;
      if (event.kind === "reset") {
        setConnected(false);
        replay = event.reason === "conversation-reset" ? [] : [event];
        if (event.reason === "conversation-reset") publish([event]);
        return;
      }
      if (replay !== undefined) {
        replay.push(event);
        if (event.kind !== "replay-end") return;
        const events = replay;
        replay = undefined;
        publish(events);
      } else publish([event]);
    }, () => {
      if (disposed) return;
      replay = undefined;
      setConnected(false);
    });
    return () => { disposed = true; unsubscribe(); };
  }, [sessionId, enabled]);

  const send = useCallback((text: string, attachments?: ChatAttachmentInput[], userLocation?: ChatUserLocation) =>
    sendChatMessage(sessionId, text, attachments, userLocation), [sessionId]);

  const startSkill = useCallback((entryId: string, text: string, attachments?: ChatAttachmentInput[]) =>
    startSkillEntry(sessionId, entryId, text, attachments), [sessionId]);

  const start = useCallback((entryId: string, parameters: Readonly<Record<string, unknown>>) => startChatEntry(sessionId, entryId, parameters), [sessionId]);

  return { messages, running, connected, startup, send, startSkill, start };
}
