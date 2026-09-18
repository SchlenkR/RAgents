import { canvasLayoutOf, ORCHESTRATION_PLUGIN_ID } from "../contract";
import { ActorChat } from "./ActorChat";
import { ActorChatControls } from "./ActorChatControls";
import { ChatPanel } from "@aicontainer/web/chat/ChatPanel";
import { memo, useCallback, useMemo } from "react";
import type { FlowSelection } from "./FlowInspector";
import type { RunActor, RunView } from "./run-view";
import type { Message } from "@aicontainer/web/chat/types";

export const ActorChatPreview = memo(function ActorChatPreview({ actor, view, primaryMessages, conversation, historyError, running = false, onNavigate }: {
  actor: RunActor;
  view: RunView;
  primaryMessages?: readonly Message[];
  conversation?: readonly Message[];
  historyError?: string;
  running?: boolean;
  onNavigate: (selection: FlowSelection) => void;
}) {
  const layoutState = view.pluginStates.find((entry) => entry.pluginId === ORCHESTRATION_PLUGIN_ID && entry.scope.kind === "run")?.state;
  const chatInput = useMemo(() => {
    if (layoutState === undefined) return true;
    const node = canvasLayoutOf(layoutState).nodes.find((entry) => "entity" in entry && entry.entity === `@${actor.handle}`);
    return !node || !("chatInput" in node) || node.chatInput !== false;
  }, [layoutState, actor.handle]);
  const focusableScroller = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    element.tabIndex = 0;
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", `Chatverlauf von @${actor.handle}`);
  }, [actor.handle]);
  return <div className="flex min-h-[106px] w-full min-w-0 flex-1 flex-col overflow-hidden rounded-b-[16px] text-left" data-canvas-scroll="true">
    <ChatPanel className="flex-1" composer={chatInput ? <ActorChatControls actor={actor} view={view} presentation="canvas" running={running} /> : undefined}>
      <ActorChat actor={actor} view={view} presentation="canvas" primaryMessages={primaryMessages} conversation={conversation} historyError={historyError} running={running} onNavigate={onNavigate} scrollerRef={focusableScroller} />
    </ChatPanel>
  </div>;
});
