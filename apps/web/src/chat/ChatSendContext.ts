import { createContext, type RefObject } from "react";

export interface ChatSendScope {
  notify: () => void;
  subscribe: (listener: () => void) => () => void;
}

export const ChatSendContext = createContext<ChatSendScope | undefined>(undefined);

export function createChatSendScope(enabled: RefObject<boolean>): ChatSendScope {
  const listeners = new Set<() => void>();
  return {
    notify: () => { if (enabled.current) listeners.forEach((listener) => listener()); },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
