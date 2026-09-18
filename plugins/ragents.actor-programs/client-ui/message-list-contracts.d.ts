import type { ReactElement, ReactNode } from "react";
import type { ChatAttachment } from "../../../apps/server/src/chat-events";

export interface MessageListItem {
  /** Stable key within this list. */
  key: string;
  /** Visible sender name; also determines the default bubble color. */
  sender: string;
  /** Message content as Markdown. */
  text: string;
  /** Optional ISO timestamp, shown when showTimestamps is enabled. */
  at?: string;
  attachments?: ChatAttachment[];
  /** Optional CSS color overriding the stable sender color. */
  color?: string;
  /** Bubble alignment, default start. */
  side?: "start" | "end";
}

export interface MessageListProps {
  /** Displayed in the supplied order; new props update the view. */
  messages: readonly MessageListItem[];
  /** Sender name whose messages render without bubbles; omitted or null shows all sender bubbles. */
  owner?: string | null;
  showTimestamps?: boolean;
  emptyState?: ReactNode;
  className?: string;
  /** Accessible name of the display, default Nachrichten. */
  label?: string;
}

/** Read-only messages from named senders, with the shared chat renderer and automatic scrolling. */
export declare function MessageList(props: MessageListProps): ReactElement;
