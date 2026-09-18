import React, { useMemo } from "react";
import { cn } from "../../../apps/web/src/ui";
import { ChatMessages } from "../../../apps/web/src/chat/ChatMessages";
import type { Message } from "../../../apps/server/src/chat-events";
import type { MessageListProps } from "./message-list-contracts";

const hues = [212, 158, 28, 283, 350, 190, 95, 320, 55, 245];
const senderColor = (sender: string): string => {
  let hash = 0;
  for (const character of sender) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return `hsl(${hues[hash % hues.length]} 45% 42%)`;
};

export function MessageList({ messages, label = "Nachrichten", className, ...props }: MessageListProps) {
  const rendered = useMemo(() => messages.map((message): Message => ({
    key: message.key,
    role: "assistant",
    sender: message.sender,
    text: message.text,
    closed: true,
    at: message.at,
    attachments: message.attachments,
    bubble: { label: message.sender, color: message.color ?? senderColor(message.sender), side: message.side ?? "start" },
  })), [messages]);
  return (
    <section aria-label={label} className={cn("flex h-full min-h-0 w-full min-w-0 flex-col text-foreground", className)}>
      <ChatMessages {...props} detailMode="off" messages={rendered} />
    </section>
  );
}
