import { ActorChat } from "./ActorChat";
import { ActorChatControls } from "./ActorChatControls";
import { ChatPanel } from "@ragents/web/chat/ChatPanel";
import { memo, useCallback } from "react";
import type { FlowSelection } from "./FlowInspector";
import type { RunActor, RunView } from "@ragents/web/run-view";
import type { Message } from "@ragents/web/chat/types";

export const ActorChatPreview = memo(function ActorChatPreview({ actor, view, primaryMessages, conversation, historyError, chatInput = true, running = false, onNavigate }: {
  actor: RunActor;
  view: RunView;
  primaryMessages?: readonly Message[];
  conversation?: readonly Message[];
  historyError?: string;
  chatInput?: boolean;
  running?: boolean;
  onNavigate: (selection: FlowSelection) => void;
}) {
  const focusableScroller = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    element.tabIndex = 0;
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", `Chatverlauf von @${actor.handle}`);
  }, [actor.handle]);
  return <div className="flex min-h-[106px] w-full min-w-0 flex-1 flex-col overflow-hidden rounded-b-[16px] text-left" data-surface-scroll="true">
    <ChatPanel className="flex-1" composer={<ActorChatControls actor={actor} view={view} composerVisible={chatInput} presentation="surface" running={running} />}>
      <ActorChat actor={actor} view={view} presentation="surface" primaryMessages={primaryMessages} conversation={conversation} historyError={historyError} running={running} onNavigate={onNavigate} scrollerRef={focusableScroller} />
    </ChatPanel>
  </div>;
});
