import { useAccess } from "@ragents/web/AccessContext";
import { useState, type ReactNode } from "react";
import { interruptActorTurn, sendActorMessage } from "@ragents/web/api";
import { useChatSteps } from "@ragents/web/PluginRegistry";
import { ChatInputToolbar } from "@ragents/web/chat/ChatInputToolbar";
import { DetailModeSwitch } from "@ragents/web/chat/DetailModeSwitch";
import { StoppedActorNotice } from "@ragents/web/chat/StoppedActorNotice";
import { useAttachmentCapabilities } from "@ragents/web/chat/useAttachmentCapabilities";
import { programChatNotice } from "@ragents/web/chat/chat-target";
import type { RunActor, RunView } from "@ragents/web/run-view";

const controlsClass = "flex flex-shrink-0 items-center gap-2 border-t border-border-soft px-workspace-inset pt-2 pb-2.5";

const noteClass = "mt-1.5 text-[0.7rem] text-muted-foreground";

export function ActorChatControls({ actor, view, composerVisible = true, presentation = "inspector", display = presentation, running = false, toolbarLeft, toolbarRight }: {
  actor: RunActor;
  view: RunView;
  composerVisible?: boolean;
  presentation?: "surface" | "inspector" | "panel";
  display?: string;
  running?: boolean;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
}) {
  const writable = useAccess().can("runs.write");
  const [stopError, setStopError] = useState<string>();
  const steps = useChatSteps(view.id, actor.id, display);
  const attachments = useAttachmentCapabilities(view.id, actor.id, JSON.stringify(actor.execution?.driver.config));
  const disabledReason = !writable ? "Du hast Lesezugriff auf diesen Run." : undefined;
  const detailSwitch = steps.selectable && <DetailModeSwitch
    collapsible={presentation === "surface"}
    mode={steps.mode("agents")}
    onChange={(mode) => steps.setMode("agents", mode)}
  />;
  if (!composerVisible || actor.kind === "human") return detailSwitch && <div className={controlsClass}>{detailSwitch}</div>;
  if (actor.kind === "script") return <div className={controlsClass}><p className={noteClass}>{programChatNotice}</p>{detailSwitch}</div>;
  if (actor.lifecycle?.kind === "stopped") return <div className={presentation === "inspector" ? "flex-shrink-0 px-5 pt-2.5 pb-3.5" : undefined}>
    <StoppedActorNotice actor={actor} runId={view.id} toolbar={(toolbarLeft || detailSwitch) && <>{toolbarLeft}{detailSwitch}</>} />
  </div>;
  return <div className={presentation === "inspector" ? "flex-shrink-0 px-5 pt-2.5 pb-3.5" : undefined}>
    <ChatInputToolbar
      {...attachments}
      disabled={disabledReason !== undefined}
      layout={presentation === "surface" ? "inline" : "card"}
      maxRows={4}
      onSend={(text, files) => sendActorMessage(view.id, actor.id, text, files)}
      onStop={writable && actor.lifecycle?.kind === "running" ? () => {
        setStopError(undefined);
        void interruptActorTurn(view.id, actor.id).catch((error: unknown) =>
          setStopError(error instanceof Error ? error.message : String(error)));
      } : undefined}
      rows={1}
      running={running}
      texts={{ placeholder: disabledReason ?? `Nachricht an @${actor.handle} ...` }}
      toolbarLeft={<>
        {toolbarLeft}
        {detailSwitch}
        {presentation === "inspector" && <span className="truncate text-[0.7rem] text-muted-foreground">an @{actor.handle}</span>}
      </>}
      toolbarRight={toolbarRight}
    />
    {stopError && <p className={noteClass} role="alert">{stopError}</p>}
    {disabledReason && presentation === "inspector" && <p className={noteClass}>{disabledReason}</p>}
  </div>;
}
