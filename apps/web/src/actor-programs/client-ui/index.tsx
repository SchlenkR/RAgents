import { useCallback, useSyncExternalStore } from "react";
import { cn } from "../../ui";
import { ChatPanel } from "../../chat/ChatPanel";
import { ChatMessages } from "../../chat/ChatMessages";
import { ChatInputToolbar } from "../../chat/ChatInputToolbar";
import { Markdown } from "../../chat/Markdown";
import type { ActorChatProps, ChatAttachmentInput, ChatConnection, ChatInputProps, ChatProps, ControlledChatProps } from "./contracts";

export * from "../../ui";
export { FilePicker } from "./FilePicker";
export { Form } from "./Form";
export { AppLayout, Stack, Grid } from "./Layout";
export { DataTable } from "./DataTable";
export { TaskProgress, DocumentViewer, DiffViewer } from "./Viewers";
export { MessageList } from "./MessageList";
export { FlowDiagram } from "./FlowDiagram";
export { WorkflowDiagram } from "./WorkflowDiagram";

const appChat = (): ChatConnection => {
  const bridge = (globalThis as typeof globalThis & { __ragentsAppContext?: { chat: ChatConnection } }).__ragentsAppContext;
  if (!bridge) throw new Error("The actor view host bridge is missing.");
  return bridge.chat;
};

const emptyMessages: never[] = [];

const chatDisplay = "flex h-full min-h-0 w-full min-w-0 flex-col text-foreground";

function ChatInput({ onSend, placeholder, ...props }: ChatInputProps) {
  return <ChatInputToolbar {...props} onSend={onSend} texts={placeholder === undefined ? undefined : {
    placeholder,
    steeringPlaceholder: placeholder,
  }} />;
}

function ChatView({ title, showInput = true, onSend, placeholder, rows = 2, maxRows = 6,
  className, error, disabled, attachmentCapabilities, attachmentCapabilitiesError, ...messages }: ControlledChatProps & { error?: string; disabled?: boolean }) {
  return (
    <section aria-label={title ?? "Chat"} className={cn(chatDisplay, "[&_[data-chat=composer]]:px-3 [&_[data-chat=composer]]:pb-3", className)}>
      {title && <h2 className="px-4 pt-3 pb-1 text-[14px] font-semibold">{title}</h2>}
      {error && <p className="px-4 py-3 text-[13px] text-destructive" role="alert">{error}</p>}
      <ChatPanel className="flex-1" composer={showInput && onSend ? <ChatInput
        attachmentCapabilities={attachmentCapabilities}
        attachmentCapabilitiesError={attachmentCapabilitiesError}
        disabled={disabled}
        maxRows={maxRows}
        onSend={onSend}
        placeholder={placeholder}
        rows={rows}
        running={messages.running}
      /> : undefined}>
        <ChatMessages {...messages} />
      </ChatPanel>
    </section>
  );
}

function ActorChat({ actor, ...props }: ActorChatProps) {
  const subscribe = useCallback((listener: () => void) => appChat().subscribe(actor, listener), [actor]);
  const read = useCallback(() => appChat().read(actor), [actor]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const send = useCallback((text: string, attachments?: ChatAttachmentInput[]) => appChat().send(actor, text, attachments), [actor]);
  return <ChatView {...props}
    showInput={props.showInput !== false && snapshot?.readOnly !== true}
    attachmentCapabilities={snapshot?.attachmentCapabilities}
    attachmentCapabilitiesError={snapshot?.attachmentCapabilitiesError}
    disabled={snapshot === undefined || snapshot.error !== undefined || snapshot.readOnly === true}
    emptyState={props.emptyState ?? (snapshot === undefined ? <p className="px-4 py-3 text-[13px] text-muted-foreground">Loading conversation...</p> : undefined)}
    error={snapshot?.error}
    messages={snapshot?.messages ?? emptyMessages}
    owner={props.owner === undefined ? snapshot?.owner : props.owner}
    onSend={send}
    running={snapshot?.running ?? false}
  />;
}

function Chat(props: ChatProps) {
  return props.actor !== undefined ? <ActorChat {...props} key={props.actor} /> : <ChatView {...props} />;
}

export { Chat, ChatMessages, ChatInput, Markdown };
