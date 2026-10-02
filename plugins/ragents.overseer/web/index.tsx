import { useAccess } from "@ragents/web/AccessContext";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Popover, PopoverContent, PopoverTrigger } from "@ragents/web/ui";
import { RunModalContext } from "@ragents/web/ui/dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessages, ChatInputToolbar, ChatPanel, type ChatInputHandle, type ChatEvent } from "quassel";
import { useChat } from "@ragents/web/chat/useChat";
import { useAttachmentCapabilities } from "@ragents/web/chat/useAttachmentCapabilities";
import { ChatStepsProvider, type OverviewPanelContext, type WebPlugin } from "@ragents/web/PluginRegistry";
import { ChatViewSwitches, useChatViewSettings } from "@ragents/web/chat-view-settings";
import { withToolSummaries } from "@ragents/web/toolLine";
import { rpc } from "@ragents/web/rpc";
import { interruptActorTurn } from "@ragents/web/api";
import { runContracts } from "@ragents/engine/src/http/contracts";
import { runViewFrom } from "@ragents/web/run-view";
import { OVERSEER_PLUGIN_ID, overseerContracts } from "../contract";
import { ModelSettings, useModelSettings } from "./ModelSettings";
import { overseerChatDisplayPolicy, overseerChatStorageKeyPrefix } from "./chat-display";

const toolbarClass = "flex h-header w-full min-w-0 flex-1 items-center px-2 py-1 max-md:px-1";
const triggerClass = "h-full min-w-0 flex-1 justify-start border-border-strong bg-background px-2 font-normal text-muted-foreground aria-expanded:border-primary data-[working=true]:animate-working-pulse data-[working=true]:border-primary motion-reduce:data-[working=true]:animate-none";
const noteClass = "text-[0.8rem] text-muted-foreground";

/** Interrupts only the coordinator's running turn; the run and its other actors keep running. */
const interruptCoordinator = async (runId: string) => {
  const coordinator = runViewFrom(await rpc.call(runContracts.view, { runId }))?.primaryActorId;
  if (!coordinator) throw new Error("The global coordinator is not available");
  await interruptActorTurn(runId, coordinator);
};
const errorClass = "text-[0.8rem] text-destructive";

/** Every user has their own coordinator; only the server knows its id. */
function useCoordinator() {
  const user = useAccess().user?.id;
  const [coordinator, setCoordinator] = useState<{ runId?: string; error?: string }>({});
  useEffect(() => {
    let current = true;
    setCoordinator({});
    rpc.call(overseerContracts.coordinator, {}).then(
      ({ runId }) => { if (current) setCoordinator({ runId }); },
      (cause: unknown) => { if (current) setCoordinator({ error: cause instanceof Error ? cause.message : String(cause) }); },
    );
    return () => { current = false; };
  }, [user]);
  return coordinator;
}

function OverseerToolbar(context: OverviewPanelContext) {
  const coordinator = useCoordinator();
  if (!coordinator.runId) {
    return <div className={toolbarClass} data-slot="overseer-toolbar" role="status">
      {coordinator.error && <span className="text-[0.7rem] font-bold text-destructive" title={coordinator.error} aria-label={coordinator.error}>!</span>}
    </div>;
  }
  return <ChatStepsProvider policy={overseerChatDisplayPolicy} storageKeyPrefix={overseerChatStorageKeyPrefix}>
    <OverseerConversation key={coordinator.runId} {...context} runId={coordinator.runId} />
  </ChatStepsProvider>;
}

function OverseerConversation({ open, onOpen, onClose, onBusy, userLocation, runId }: OverviewPanelContext & { runId: string }) {
  const writable = useAccess().can("ragents.overseer.write");
  const [activated, setActivated] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resetPending = useRef(false);
  const resetObserved = useRef(false);
  const composer = useRef<ChatInputHandle>(null);
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const dropdown = useRef<HTMLElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const conversationId = useRef<string | null | undefined>(undefined);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const setDropdown = useCallback((element: HTMLElement | null) => { dropdown.current = element; setDialogContainer(element); }, []);
  const [error, setError] = useState<string>();
  const [composerError, setComposerError] = useState<string>();
  const clearConversation = useCallback(() => {
    composer.current?.reset();
    setConfirmReset(false);
    setError(undefined);
  }, []);
  const onEvent = useCallback((event: ChatEvent) => {
    if (event.kind === "reset") {
      if (event.reason === "conversation-reset" || (conversationId.current != null && conversationId.current !== event.conversationId)) {
        if (resetPending.current) resetObserved.current = true;
        clearConversation();
      }
      conversationId.current = event.conversationId;
    }
    if (event.kind === "replay-end") conversationId.current = event.conversationId;
  }, [clearConversation]);
  const chat = useChat(runId, onEvent, activated);
  const chatView = useChatViewSettings(runId, "primary", "coordinator", undefined, "latest");
  const modelState = useModelSettings(open);
  const attachments = useAttachmentCapabilities(runId, "primary", JSON.stringify(modelState.settings && [modelState.settings.provider, modelState.settings.model]));
  const messages = useMemo(() => withToolSummaries(chat.messages), [chat.messages]);
  useEffect(() => { if (open) setActivated(true); }, [open]);
  useEffect(() => onBusy(chat.running), [chat.running, onBusy]);
  const belowHeader = useCallback(() => {
    if (!toolbar) return null;
    const boundary = toolbar.closest("header") ?? toolbar;
    return { contextElement: toolbar, getBoundingClientRect: () => {
      const bounds = toolbar.getBoundingClientRect();
      return new DOMRect(trigger?.getBoundingClientRect().left ?? bounds.left, boundary.getBoundingClientRect().bottom, bounds.width, 0);
    } };
  }, [toolbar, trigger]);
  const composerInput = () => {
    const input = dropdown.current?.querySelector("textarea");
    return input && !input.disabled ? input : scroller ?? true;
  };

  const perform = (work: () => Promise<void>) => {
    setError(undefined);
    void work().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const reset = async () => {
    if (resetPending.current) return;
    resetPending.current = true;
    resetObserved.current = false;
    setResetting(true);
    setError(undefined);
    try {
      await rpc.call(overseerContracts.reset, { confirm: true });
      clearConversation();
    } catch (cause) {
      if (!resetObserved.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      resetPending.current = false;
      setResetting(false);
    }
  };
  const connectionNote = activated && !chat.connected ? "No connection. Your draft is kept; sending is disabled." : undefined;
  const problem = error ?? composerError ?? modelState.error ?? connectionNote;
  return <div className={toolbarClass} data-slot="overseer-toolbar" ref={setToolbar}>
    <Popover modal={false} open={open} onOpenChange={(next) => { if (next) onOpen(); else if (!confirmReset) onClose(); }}>
      <div className="relative z-[110] flex h-full min-w-0 flex-1 items-center gap-1">
        <PopoverTrigger className={triggerClass} data-working={chat.running} render={<Button ref={setTrigger} variant="ghost" />}>
          <span className="truncate">Global coordinator</span>
        </PopoverTrigger>
        <span className="flex min-w-0 flex-none items-center justify-end gap-1.5 empty:hidden" role="status" aria-live="polite">
          {chat.running && <span className="sr-only">Working</span>}
          {problem && <span className="text-[0.7rem] font-bold text-destructive" title={problem} aria-label={problem}>!</span>}
        </span>
      </div>
      <PopoverContent align="start" anchor={belowHeader} aria-label="Global coordinator" className="flex min-h-0 flex-col gap-0 overflow-hidden rounded-t-none rounded-b-panel border-t-2 border-t-primary p-0" collisionPadding={8}
        container={toolbar} dim id="overseer-dropdown" initialFocus={composerInput} keepMounted ref={setDropdown} role="region" side="bottom"
        style={{ width: "min(760px, var(--available-width))", height: "min(650px, var(--available-height))" }}>
        {confirmReset && dialogContainer && <RunModalContext.Provider value={dialogContainer}>
          <Dialog open onOpenChange={(next) => { if (!next && !resetting) setConfirmReset(false); }} modal="trap-focus" disablePointerDismissal>
            <DialogContent initialFocus={cancelReset} onBackdropClick={() => { if (!resetting) setConfirmReset(false); }} scope="run" showCloseButton={false} size="small">
              <DialogHeader>
                <DialogTitle>Reset conversation?</DialogTitle>
                <DialogDescription>History and model context are deleted. Running answers are stopped.</DialogDescription>
              </DialogHeader>
              <p>Your runs and the model choice are kept.</p>
              {error && <p className="text-[0.8rem] text-destructive" role="alert">{error}</p>}
              <DialogFooter>
                <Button ref={cancelReset} disabled={resetting} onClick={() => setConfirmReset(false)} variant="outline">Cancel</Button>
                <Button disabled={resetting} onClick={() => { void reset(); }} variant="destructive">
                  {resetting ? "Resetting ..." : "Reset conversation"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </RunModalContext.Provider>}
        <ChatPanel className="flex-1" composer={<div className="[--qsl-input-card-radius:var(--radius-lg)]">
          {connectionNote && <p className={noteClass} role="status">{connectionNote}</p>}
          {error && <p className={errorClass} role="alert">{error}</p>}
          <ChatInputToolbar {...attachments} handleRef={composer}
            disabled={!writable || resetting || confirmReset} sendDisabled={!chat.connected || modelState.status === "saving" || resetting}
            maxRows={4} rows={1} onErrorChange={setComposerError} onSend={(text, attachments) => chat.send(text, attachments, userLocation)}
            onStop={writable && chat.running ? () => { if (!resetPending.current) perform(() => interruptCoordinator(runId)); } : undefined}
            running={chat.running}
            texts={{ placeholder: writable ? "Ask the global coordinator" : "Read access to the global coordinator" }}
            toolbarLeft={<ChatViewSwitches className="max-md:[&>span]:hidden" settings={chatView} />}
            toolbarRight={<ModelSettings active={open} compact disabled={resetting} actions={
              <Button aria-label="Reset conversation" aria-busy={resetting} disabled={!writable || resetting || !chat.connected} onClick={() => setConfirmReset(true)} size="sm" variant="outline">
                {resetting ? "Resetting ..." : "Reset"}
              </Button>
            } />}
          />
        </div>}>
          <ChatMessages announce={false} className="min-h-16!" scrollerRef={setScroller}
            detailMode={chatView.detailMode} transcriptMode={chatView.transcriptMode}
            emptyState={<div className="m-auto max-w-[480px] p-8 text-[0.9rem] leading-[1.6] text-muted-foreground max-md:p-5"><strong className="text-foreground">One chat for the whole workshop</strong><p>Ask about your runs or give a task below. Answers about your runs and ongoing work appear here.</p></div>}
            messages={messages} running={chat.running} showTimestamps={chatView.showTimestamps} stepsExpandable={chatView.stepsExpandable}
          />
        </ChatPanel>
      </PopoverContent>
    </Popover>
  </div>;
}

export const webPlugin: WebPlugin = {
  id: OVERSEER_PLUGIN_ID,
  settings: [{ category: "models", order: 10, readRight: "ragents.overseer.read", id: `${OVERSEER_PLUGIN_ID}.model`, label: "Global coordinator", Settings: ModelSettings }],
  overviewPanels: [
    { id: `${OVERSEER_PLUGIN_ID}.chat`, placement: "toolbar", order: 100, readRight: "ragents.overseer.read", Panel: OverseerToolbar },
  ],
};
