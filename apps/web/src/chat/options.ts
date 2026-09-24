import type { CSSProperties, ReactNode } from "react";
import type { Message } from "./types";

export interface ChatAppearance {
  fontSize?: CSSProperties["fontSize"];
  lineHeight?: CSSProperties["lineHeight"];
  messageGap?: CSSProperties["marginTop"];
  denseMessageGap?: CSSProperties["marginTop"];
}

export interface TimestampOptions {
  format?: "time" | "date-time" | "relative";
  locale?: string;
  timeZone?: string;
  showDaySeparators?: boolean;
}

export interface CodeBlockOptions {
  wrap?: boolean;
  maxHeight?: CSSProperties["maxHeight"];
  showCopyButton?: boolean;
}

export interface BubbleOptions {
  variant?: "default" | "plain" | "bubbles";
  maxWidth?: CSSProperties["maxWidth"];
  userSide?: "start" | "end";
  assistantSide?: "start" | "end";
  showSender?: boolean;
  senderLabel?: (message: Message) => string | undefined;
}

export interface MessageAction {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onClick: (message: Message) => void | Promise<void>;
}

export interface MessageActionsOptions {
  copy?: boolean | ((message: Message) => boolean);
  edit?: (message: Message) => void | Promise<void>;
  retry?: (message: Message) => void | Promise<void>;
  custom?: (message: Message) => readonly MessageAction[];
}

export type SendShortcut = "enter" | "mod-enter";

const cssLength = (value: string | number | undefined) => typeof value === "number" ? `${value}px` : value;

export const appearanceStyle = (appearance?: ChatAppearance): CSSProperties => ({
  "--chat-font-size": cssLength(appearance?.fontSize),
  "--chat-line-height": appearance?.lineHeight,
  "--chat-message-gap": cssLength(appearance?.messageGap),
  "--chat-dense-message-gap": cssLength(appearance?.denseMessageGap),
} as CSSProperties);
