import { useAccess } from "@aicontainer/web/AccessContext";
import { useState, type ReactNode } from "react";
import { stopChatActor } from "@aicontainer/web/api";
import { useChatSteps } from "@aicontainer/web/PluginRegistry";
import { ChatInputToolbar } from "@aicontainer/web/chat/ChatInputToolbar";
import { DetailModeSwitch } from "@aicontainer/web/chat/DetailModeSwitch";
import { useAttachmentCapabilities } from "@aicontainer/web/chat/useAttachmentCapabilities";
import { programChatNotice } from "@aicontainer/web/chat/chat-target";
import { sendActorMessage } from "./api";
import type { RunActor, RunView } from "./run-view";

const controlsClass = "flex flex-shrink-0 items-center gap-2 border-t border-border-soft px-workspace-inset pt-2 pb-2.5";

const noteClass = "mt-1.5 text-[0.7rem] text-muted-foreground";

export function ActorChatControls({ actor, view, composerVisible = true, presentation = "inspector", surface = presentation, running = false, toolbarLeft, toolbarRight }: {
  actor: RunActor;
  view: RunView;
  composerVisible?: boolean;
  presentation?: "canvas" | "inspector" | "column";
  surface?: string;
  running?: boolean;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
}) {
  const writable = useAccess().can("runs.write");
  const [stopError, setStopError] = useState<string>();
  const steps = useChatSteps(view.id, actor.id, surface);
  const attachments = useAttachmentCapabilities(view.id, actor.id, JSON.stringify(actor.execution?.driver.config));
  const disabledReason = !writable ? "Du hast Lesezugriff auf diesen Run."
    : actor.lifecycle?.kind === "stopped" ? "Dieser Actor ist gestoppt und nimmt keine Eingaben mehr an." : undefined;
  const detailSwitch = steps.selectable && <DetailModeSwitch
    collapsible={presentation === "canvas"}
    mode={steps.mode("agents")}
    onChange={(mode) => steps.setMode("agents", mode)}
  />;
  if (!composerVisible || actor.kind === "human") return detailSwitch && <div className={controlsClass}>{detailSwitch}</div>;
  if (actor.kind === "script") return <div className={controlsClass}><p className={noteClass}>{programChatNotice}</p>{detailSwitch}</div>;
  return <div className={presentation === "inspector" ? "flex-shrink-0 px-5 pt-2.5 pb-3.5" : undefined}>
    <ChatInputToolbar
      {...attachments}
      disabled={disabledReason !== undefined}
      layout={presentation === "canvas" ? "inline" : "card"}
      maxRows={4}
      onSend={(text, files) => sendActorMessage(view.id, actor.id, text, files)}
      onStop={disabledReason === undefined ? () => {
        setStopError(undefined);
        void stopChatActor(view.id, actor.id).catch((error: unknown) =>
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
