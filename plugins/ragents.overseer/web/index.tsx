import { useAccess } from "@ragents/web/AccessContext";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Popover, PopoverContent } from "@ragents/web/ui";
import { RunModalContext } from "@ragents/web/ui/dialog";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatMessages } from "@ragents/web/chat/ChatMessages";
import { ChatInputToolbar, type ChatInputHandle } from "@ragents/web/chat/ChatInputToolbar";
import { useChat } from "@ragents/web/chat/useChat";
import { useAttachmentCapabilities } from "@ragents/web/chat/useAttachmentCapabilities";
import { ChatStepsProvider, type OverviewPanelContext, type WebPlugin } from "@ragents/web/PluginRegistry";
import { ChatViewSwitches, useChatViewSettings } from "@ragents/web/chat-view-settings";
import { withToolSummaries } from "@ragents/web/toolLine";
import { rpc } from "@ragents/web/rpc";
import { interruptActorTurn } from "@ragents/web/api";
import { runContracts } from "@ragents/engine/src/http/contracts";
import { runViewFrom } from "@ragents/web/run-view";
import type { ChatEvent } from "@ragents/host/chat-events";
import { OVERSEER_PLUGIN_ID, overseerContracts } from "../contract";
import { ModelSettings, useModelSettings } from "./ModelSettings";
import { overseerChatDisplayPolicy, overseerChatStorageKeyPrefix } from "./chat-display";
import { createQuickAnswers, type QuickAnswerNotice } from "./quick-answers";

const toolbarClass = "flex h-header max-w-[720px] min-w-[190px] flex-[0_1_570px] items-center gap-1 border-r border-border bg-[color-mix(in_srgb,var(--primary)_4%,var(--card))] px-2 py-1 data-open:bg-accent max-md:min-w-[130px] max-md:flex-[0_1_210px] max-md:px-1 max-md:data-open:grow";
const noteClass = "mx-4 my-2 flex-none text-[0.8rem] text-muted-foreground";

/** Unterbricht nur den laufenden Turn des Koordinators; der Run und seine übrigen Actors laufen weiter. */
const interruptCoordinator = async (runId: string) => {
  const coordinator = runViewFrom(await rpc.call(runContracts.view, { runId }))?.primaryActorId;
  if (!coordinator) throw new Error("Der globale Koordinator ist nicht verfügbar");
  await interruptActorTurn(runId, coordinator);
};
const errorClass = "mx-4 my-2 flex-none text-[0.8rem] text-destructive";

/** Jeder Benutzer hat seinen eigenen Koordinator; seine Kennung kennt nur der Server. */
function OverseerToolbar(context: OverviewPanelContext) {
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
  const anchor = useRef<HTMLDivElement>(null);
  const dropdown = useRef<HTMLElement>(null);
  const suppressFocus = useRef(false);
  const [detailsContainer, setDetailsContainer] = useState<HTMLDivElement | null>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const conversationId = useRef<string | null | undefined>(undefined);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);
  const cancelReset = useRef<HTMLButtonElement>(null);
  const setDropdown = useCallback((element: HTMLElement | null) => { dropdown.current = element; setDialogContainer(element); }, []);
  const [quickAnswers] = useState(createQuickAnswers);
  const [quickAnswer, setQuickAnswer] = useState<QuickAnswerNotice>();
  const panelOpen = useRef(open);
  panelOpen.current = open;
  const [error, setError] = useState<string>();
  const [composerError, setComposerError] = useState<string>();
  const clearConversation = useCallback(() => {
    composer.current?.reset();
    setConfirmReset(false);
    setError(undefined);
    setQuickAnswer(undefined);
  }, []);
  const onEvent = useCallback((event: ChatEvent) => {
    const notice = quickAnswers.event(event);
    if (event.kind === "reset") {
      if (event.reason === "conversation-reset" || (conversationId.current != null && conversationId.current !== event.conversationId)) {
        if (resetPending.current) resetObserved.current = true;
        clearConversation();
      }
      conversationId.current = event.conversationId;
    }
    if (event.kind === "replay-end") conversationId.current = event.conversationId;
    if (notice && !panelOpen.current) setQuickAnswer(notice);
  }, [clearConversation, quickAnswers]);
  const chat = useChat(runId, onEvent, activated);
  const chatView = useChatViewSettings(runId, "primary", "coordinator");
  const modelState = useModelSettings(open);
  const attachments = useAttachmentCapabilities(runId, "primary", JSON.stringify(modelState.settings && [modelState.settings.provider, modelState.settings.model]));
  const messages = useMemo(() => withToolSummaries(chat.messages), [chat.messages]);
  const requestOpen = () => { suppressFocus.current = false; setQuickAnswer(undefined); onOpen(); };
  useEffect(() => { if (open) { setActivated(true); setQuickAnswer(undefined); } }, [open]);
  useEffect(() => onBusy(chat.running), [chat.running, onBusy]);
  const belowHeader = useCallback(() => {
    const element = anchor.current;
    if (!element) return null;
    const boundary = element.closest("header") ?? element;
    return { contextElement: element, getBoundingClientRect: () => {
      const bounds = element.getBoundingClientRect();
      return new DOMRect(bounds.left, boundary.getBoundingClientRect().bottom, bounds.width, 0);
    } };
  }, []);
  const dismiss = (reason: string, event: Event) => {
    if (confirmReset) return;
    if (reason === "outside-press") {
      if (event.target instanceof Node && anchor.current?.contains(event.target)) return;
      onClose();
      return;
    }
    if (reason !== "escape-key") return;
    suppressFocus.current = !(document.activeElement instanceof HTMLTextAreaElement && anchor.current?.contains(document.activeElement));
    onClose();
    composer.current?.focus();
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
  const connectionNote = activated && !chat.connected ? "Keine Verbindung. Dein Entwurf bleibt erhalten; Senden ist gesperrt." : undefined;
  const problem = error ?? composerError ?? modelState.error ?? connectionNote;
  return <div className={toolbarClass} data-open={open} data-slot="overseer-toolbar" ref={anchor}
    onFocus={(event) => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      if (suppressFocus.current) suppressFocus.current = false;
      else onOpen();
    }}
    onKeyDown={(event) => {
      if (event.defaultPrevented) return;
      if (!open && event.target instanceof HTMLTextAreaElement && (event.key.length === 1 || event.key === "Enter")) requestOpen();
    }}>
    <div className="min-w-0 flex-1" onClick={(event) => { if (event.target instanceof HTMLTextAreaElement) requestOpen(); }}>
      <ChatInputToolbar {...attachments} detailsContainer={detailsContainer} layout="toolbar" handleRef={composer}
        inputAriaControls="overseer-dropdown"
        disabled={!writable || resetting || confirmReset} sendDisabled={!chat.connected || modelState.status === "saving" || resetting}
        maxRows={2} rows={1} onErrorChange={setComposerError} onSend={(text, attachments) => chat.send(text, attachments, userLocation)}
        onStop={writable && chat.running ? () => { if (!resetPending.current) perform(() => interruptCoordinator(runId)); } : undefined}
        running={chat.running}
        texts={{ placeholder: "Globaler Koordinator", steeringPlaceholder: "Globaler Koordinator" }}
        toolbarRight={<ModelSettings active={open} compact disabled={resetting} actions={
          <Button aria-label="Gespräch zurücksetzen" aria-busy={resetting} disabled={!writable || resetting || !chat.connected} onClick={() => setConfirmReset(true)} size="sm" variant="outline">
            {resetting ? "Wird zurückgesetzt ..." : "Zurücksetzen"}
          </Button>
        } />}
        toolbarLeft={<ChatViewSwitches className="max-md:[&>span]:hidden" collapsible={false} settings={chatView} />}
      />
    </div>
      <span className="flex min-w-0 flex-none items-center justify-end gap-1.5 empty:hidden" role="status" aria-live="polite">
        {chat.running && <span className="sr-only">Bearbeitet</span>}
        {problem && <span className="text-[0.7rem] font-bold text-destructive" title={problem} aria-label={problem}>!</span>}
      </span>
    <Popover modal={false} open={quickAnswer !== undefined}>
      <PopoverContent align="start" anchor={belowHeader} aria-atomic="true" aria-live="polite" className="flex max-w-[calc(100vw-16px)] flex-row items-start gap-1 p-1.5 text-[0.76rem]" collisionPadding={8}
        finalFocus={false} initialFocus={false} role="status" side="bottom" sideOffset={6}
        style={{ width: "min(max(calc(var(--anchor-width) * 2), 480px), var(--available-width))" }}>
        {quickAnswer && <>
          <Button className="h-auto min-w-0 flex-1 justify-start rounded-lg px-2.5 py-2 text-left text-[0.76rem] leading-[1.45] font-normal whitespace-normal [overflow-wrap:anywhere]" variant="ghost" aria-label={`Verlauf öffnen: ${quickAnswer.question} ${quickAnswer.text}`}
            onClick={() => {
              requestOpen();
              if (writable) composer.current?.focus();
              else requestAnimationFrame(() => scroller?.focus());
            }}><span className="grid min-w-0 gap-1"><span className="text-muted-foreground">{quickAnswer.question}</span><strong className="font-semibold">{quickAnswer.text}</strong></span></Button>
          <Button aria-label="Kurzantwort schließen" className="mt-1 flex-none rounded-full" onClick={() => setQuickAnswer(undefined)} size="icon-sm" title="Kurzantwort schließen" variant="ghost"><XIcon /></Button>
        </>}
      </PopoverContent>
    </Popover>
    <Popover modal={false} open={open} onOpenChange={(next, details) => { if (!next) dismiss(details.reason, details.event); }}>
    <PopoverContent align="start" anchor={belowHeader} aria-label="Globaler Koordinator" className="flex min-h-0 flex-col gap-0 overflow-hidden rounded-t-none rounded-b-panel border-t-2 border-t-primary p-0" collisionPadding={8}
      finalFocus={false} id="overseer-dropdown" initialFocus={false} keepMounted ref={setDropdown} role="region" side="bottom" sideOffset={0}
      style={{ width: "min(760px, var(--available-width))", height: "min(650px, var(--available-height))" }}>
      <div className="flex-none border-b border-border-soft" data-tone="overseer-details" ref={setDetailsContainer} />
      {confirmReset && dialogContainer && <RunModalContext.Provider value={dialogContainer}>
        <Dialog open onOpenChange={(next) => { if (!next && !resetting) setConfirmReset(false); }} modal="trap-focus" disablePointerDismissal>
          <DialogContent initialFocus={cancelReset} onBackdropClick={() => { if (!resetting) setConfirmReset(false); }} scope="run" showCloseButton={false} size="small">
            <DialogHeader>
              <DialogTitle>Gespräch zurücksetzen?</DialogTitle>
              <DialogDescription>Verlauf und Modellkontext werden gelöscht. Laufende Antworten werden gestoppt.</DialogDescription>
            </DialogHeader>
            <p>Deine Runs und die Modellwahl bleiben erhalten.</p>
            {error && <p className="text-[0.8rem] text-destructive" role="alert">{error}</p>}
            <DialogFooter>
              <Button ref={cancelReset} disabled={resetting} onClick={() => setConfirmReset(false)} variant="outline">Abbrechen</Button>
              <Button disabled={resetting} onClick={() => { void reset(); }} variant="destructive">
                {resetting ? "Wird zurückgesetzt ..." : "Gespräch zurücksetzen"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </RunModalContext.Provider>}
      {!writable && <p className={noteClass}>Du hast Lesezugriff auf dieses Gespräch.</p>}
      {connectionNote && <p className={noteClass} role="status">{connectionNote}</p>}
      {error && <p className={errorClass} role="alert">{error}</p>}
      <ChatMessages announceMessages={false} className="min-h-16 flex-1" scrollerRef={setScroller}
        detailMode={chatView.detailMode}
        emptyState={<div className="m-auto max-w-[480px] p-8 text-[0.9rem] leading-[1.6] text-muted-foreground max-md:p-5"><strong className="text-foreground">Ein Chat für die gesamte Werkstatt</strong><p>Schreibe deinen Auftrag oben in die Titelleiste. Hier erscheinen Antworten zu deinen Runs und laufenden Arbeiten.</p></div>}
        messages={messages} running={chat.running} showTimestamps={chatView.showTimestamps} stepsExpandable={chatView.stepsExpandable}
      />
    </PopoverContent>
    </Popover>
  </div>;
}

export const webPlugin: WebPlugin = {
  id: OVERSEER_PLUGIN_ID,
  settings: [{ category: "models", order: 10, readRight: "ragents.overseer.read", id: `${OVERSEER_PLUGIN_ID}.model`, label: "Globaler Koordinator", Settings: ModelSettings }],
  overviewPanels: [{ id: `${OVERSEER_PLUGIN_ID}.chat`, placement: "toolbar", order: 100, readRight: "ragents.overseer.read", Panel: OverseerToolbar }],
};
