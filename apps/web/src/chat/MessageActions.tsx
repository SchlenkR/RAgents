import { CheckIcon, CopyIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { useState } from "react";
import { Button, cn } from "../ui";
import type { MessageActionsOptions, MessageAction } from "./options";
import type { ChatTexts } from "./texts";
import type { Message } from "./types";
import { copyChatText, useChatAction } from "./useChatAction";

const actionClasses = cn(
  "absolute top-1 right-1 z-[1] flex flex-wrap rounded-sm bg-secondary opacity-0",
  "shadow-[0_2px_6px_color-mix(in_srgb,var(--foreground)_15%,transparent)]",
  "pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
  "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
);

export function MessageActions({ message, options, texts }: { message: Message; options?: MessageActionsOptions; texts: ChatTexts }) {
  const action = useChatAction();
  const [lastAction, setLastAction] = useState<string>();
  const copy = typeof options?.copy === "function" ? options.copy(message) : options?.copy ?? message.role === "user";
  const actions: MessageAction[] = [
    ...(copy && message.text.trim() ? [{ id: "copy", label: texts.copyMessage, icon: <CopyIcon />, onClick: () => copyChatText(message.text, texts.clipboardUnavailable) }] : []),
    ...(options?.edit && message.role === "user" ? [{ id: "edit", label: texts.editMessage, icon: <PencilIcon />, onClick: options.edit }] : []),
    ...(options?.retry && message.role === "assistant" ? [{ id: "retry", label: texts.retryMessage, icon: <RotateCcwIcon />, onClick: options.retry }] : []),
    ...options?.custom?.(message) ?? [],
  ];
  return <>
    {actions.length > 0 && <div className={actionClasses}>
      {actions.map((item) => {
        const copied = item.id === "copy" && lastAction === item.id && action.status === "done";
        const label = copied ? texts.copied : item.label;
        return <Button aria-label={label} className="text-inherit" disabled={item.disabled || action.status === "pending"}
          key={item.id} size={item.icon ? "icon-sm" : "sm"} title={label} variant="ghost"
          onClick={() => {
            setLastAction(item.id);
            void action.invoke(() => item.onClick(message), texts.actionFailed);
          }}>{copied ? <CheckIcon /> : item.icon ?? item.label}</Button>;
      })}
    </div>}
    {action.error && <p className="mt-2 text-sm text-destructive" role="alert">{action.error}</p>}
  </>;
}
