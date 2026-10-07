import { useAccess } from "@ragents/web/AccessContext";
import { useState, type ReactNode } from "react";
import { pauseRun, sendActorMessage } from "@ragents/web/api";
import { ChatViewSwitches, useChatViewSettings } from "@ragents/web/chat-view-settings";
import { ChatInputToolbar } from "quassel";
import { PausedRunNotice } from "@ragents/web/chat/PausedRunNotice";
import { StoppedActorNotice } from "@ragents/web/chat/StoppedActorNotice";
import { useAttachmentCapabilities } from "@ragents/web/chat/useAttachmentCapabilities";
import { programChatNotice, runPausable } from "@ragents/web/chat/chat-target";
import { actorAddress, type RunActor, type RunView } from "@ragents/web/run-view";

const controlsClass = "flex flex-shrink-0 items-center gap-2 border-t border-border-soft px-workspace-inset pt-2 pb-3";

const noteClass = "mt-2 text-[0.7rem] text-muted-foreground";

export function ActorChatControls({ actor, autoFocus, onAutoFocusSettled, view, composerVisible = true, presentation = "inspector", display = presentation, running = false, toolbarLeft, toolbarRight }: {
  actor: RunActor;
  autoFocus?: boolean;
  onAutoFocusSettled?: () => void;
  view: RunView;
  composerVisible?: boolean;
  presentation?: "inspector" | "panel";
  display?: string;
  running?: boolean;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
}) {
  const access = useAccess();
  const writable = access.can("runs.write");
  const [stopError, setStopError] = useState<string>();
  const chatView = useChatViewSettings(view.id, actor.id, "agents", display);
  const attachments = useAttachmentCapabilities(view.id, actor.id, JSON.stringify(actor.execution?.driver.config));
  const disabledReason = !writable ? "You have read access to this run." : undefined;
  const placeholder = disabledReason ?? `Message to @${actorAddress(actor)} ...`;
  const stoppable = (access.canStopRun ?? writable) && runPausable(view, view.id, running);
  const switches = <ChatViewSwitches settings={chatView} />;
  if (!composerVisible || actor.kind === "human") return <div className={controlsClass}>{toolbarLeft}{switches}</div>;
  if (actor.kind === "script") return <div className={controlsClass}><p className={noteClass}>{programChatNotice}</p>{toolbarLeft}{switches}</div>;
  if (actor.lifecycle?.kind === "stopped") return <div className={presentation === "inspector" ? "mx-auto w-[calc(100%_-_16px)] max-w-[var(--chat-max-width)] flex-shrink-0 pt-3 pb-4" : undefined}>
    <StoppedActorNotice actor={actor} runId={view.id} toolbar={<>{toolbarLeft}{switches}</>} />
  </div>;
  return <div className={presentation === "inspector" ? "mx-auto w-[calc(100%_-_16px)] max-w-[var(--chat-max-width)] flex-shrink-0 pt-3 pb-4" : undefined}>
    <PausedRunNotice runId={view.id} view={view} />
    <ChatInputToolbar
      {...attachments}
      autoFocus={autoFocus}
      onAutoFocusSettled={onAutoFocusSettled}
      disabled={disabledReason !== undefined}
      maxRows={4}
      onSend={(text, files) => sendActorMessage(view.id, actor.id, text, files)}
      onStop={stoppable ? () => {
        setStopError(undefined);
        void pauseRun(view.id).catch((error: unknown) =>
          setStopError(error instanceof Error ? error.message : String(error)));
      } : undefined}
      rows={1}
      running={running || stoppable}
      texts={running ? { placeholder } : { placeholder, steeringPlaceholder: placeholder, sendIntoRun: "Send" }}
      toolbarLeft={<>
        {toolbarLeft}
        {switches}
        {presentation === "inspector" && <span className="truncate text-[0.7rem] text-muted-foreground">to @{actorAddress(actor)}</span>}
      </>}
      toolbarRight={toolbarRight}
    />
    {stopError && <p className={noteClass} role="alert">{stopError}</p>}
    {disabledReason && presentation === "inspector" && <p className={noteClass}>{disabledReason}</p>}
  </div>;
}
