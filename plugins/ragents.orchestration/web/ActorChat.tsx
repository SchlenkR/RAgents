import { useAccess } from "@ragents/web/AccessContext";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ragents/web/ui";
import { useCallback, useMemo } from "react";
import { ChatMessages } from "@ragents/web/chat/ChatMessages";
import type { Message } from "@ragents/web/chat/types";
import { useActionRenderer, useChatSteps, useToolRenderer } from "@ragents/web/PluginRegistry";
import { actorChatMessages } from "@ragents/web/actor-conversation";
import type { FlowSelection } from "./FlowInspector";
import type { RunActor, RunView } from "@ragents/web/run-view";

const emptyMessages: readonly Message[] = [];

export function ActorChat({ actor, view, presentation, display = presentation, primaryMessages = emptyMessages, conversation, historyError, running = false, className, onNavigate, scrollerRef }: {
  actor: RunActor;
  view: RunView;
  presentation: "surface" | "inspector";
  /** Schlüssel der Anzeigefläche für den gemerkten Detailgrad; Default ist die Darstellung. */
  display?: string;
  primaryMessages?: readonly Message[];
  conversation?: readonly Message[];
  historyError?: string;
  running?: boolean;
  className?: string;
  onNavigate: (selection: FlowSelection) => void;
  scrollerRef?: (element: HTMLDivElement | null) => void;
}) {
  const inspect = useAccess().can("runs.inspect");
  const steps = useChatSteps(view.id, actor.id, display);
  const renderTool = useToolRenderer();
  const renderAction = useActionRenderer();
  const configuredMode = steps.mode("agents");
  const detailMode = inspect || configuredMode === "off" ? configuredMode : "current";
  const messages = useMemo(() => actorChatMessages(view, actor, primaryMessages, conversation), [view, actor, primaryMessages, conversation]);
  const openLink = useCallback((href: string) => {
    const match = /^ablauf:(actor|input|turn|subscription|action|artifact)\/(.+)$/.exec(href);
    if (!match) return false;
    if (!inspect) return true;
    onNavigate({ type: match[1] as FlowSelection["type"], id: match[2] });
    return true;
  }, [inspect, onNavigate]);
  return <>
    {historyError && <p className="my-1.5 text-[0.72rem] text-destructive" role="alert">{historyError}</p>}
    <ChatMessages
    className={className}
    detailMode={detailMode}
    emptyState={<Empty><EmptyHeader><EmptyTitle>{actor.kind === "script" ? "Noch kein Verlauf" : "Noch kein Gespräch"}</EmptyTitle><EmptyDescription>{actor.kind === "script" ? "Hier erscheinen Programmeingaben und ihre Verarbeitung." : "Schreibe eine Nachricht, um das Gespräch zu beginnen."}</EmptyDescription></EmptyHeader></Empty>}
    messages={messages}
    renderAction={renderAction}
    renderTool={renderTool}
    owner={actor.id}
    onLinkClick={openLink}
    running={running}
    showTimestamps={presentation === "inspector"}
    stepsExpandable={inspect && steps.stepsExpandable}
    scrollerRef={scrollerRef}
    />
  </>;
}
