import type { ReactElement, ReactNode } from "react";
import type { ChatAttachment, ChatAttachmentCapabilities, ChatAttachmentInput, Message } from "../../../../server/src/chat-events";

export * from "../../ui";
export * from "./file-contracts";
export * from "./form-contracts";
export * from "./layout-contracts";
export * from "./table-contracts";
export * from "./viewer-contracts";
export * from "./message-list-contracts";
export * from "./flow-diagram-contracts";
export * from "./workflow-diagram-contracts";

export type { ChatAttachment, ChatAttachmentCapabilities, ChatAttachmentInput, Message };

export interface ChatSnapshot {
  /** Resolved sender identity of the bound actor, used as the default presentation owner. */
  owner?: string;
  readOnly?: boolean;
  attachmentCapabilities?: ChatAttachmentCapabilities;
  attachmentCapabilitiesError?: string;
  messages: Message[];
  running: boolean;
  error?: string;
}

export interface ChatConnection {
  read(actor: string): ChatSnapshot | undefined;
  subscribe(actor: string, listener: () => void): () => void;
  send(actor: string, text: string, attachments?: ChatAttachmentInput[]): Promise<void>;
}

export interface ChatMessagesProps {
  messages: Message[];
  /** Matching Message.sender renders without bubbles; null uses message defaults, actor chats default to their bound actor. */
  owner?: string | null;
  running?: boolean;
  detailMode?: "off" | "current" | "icons" | "chips" | "grouped" | "compact" | "full";
  showTimestamps?: boolean;
  emptyState?: ReactNode;
  className?: string;
}

export interface ChatInputProps {
  attachmentCapabilities?: ChatAttachmentCapabilities;
  attachmentCapabilitiesError?: string;
  onSend: (text: string, attachments?: ChatAttachmentInput[]) => void | Promise<void>;
  placeholder?: string;
  rows?: number;
  maxRows?: number;
  running?: boolean;
  disabled?: boolean;
}

interface ChatBaseProps extends Omit<ChatMessagesProps, "messages" | "running"> {
  attachmentCapabilities?: ChatAttachmentCapabilities;
  attachmentCapabilitiesError?: string;
  title?: string;
  showInput?: boolean;
  placeholder?: string;
  rows?: number;
  maxRows?: number;
}

export interface ActorChatProps extends ChatBaseProps {
  actor: string;
  messages?: never;
  onSend?: never;
  running?: never;
}

export interface ControlledChatProps extends ChatBaseProps {
  actor?: never;
  messages: Message[];
  onSend?: (text: string, attachments?: ChatAttachmentInput[]) => void | Promise<void>;
  running?: boolean;
}

export type ChatProps = ActorChatProps | ControlledChatProps;

export declare function Chat(props: ChatProps): ReactElement;
export declare function ChatMessages(props: ChatMessagesProps): ReactElement;
export declare function ChatInput(props: ChatInputProps): ReactElement;
export declare function Markdown(props: { text: string }): ReactElement;
