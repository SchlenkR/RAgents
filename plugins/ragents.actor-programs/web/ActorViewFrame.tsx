import { hostInputEnabled, isRunPanelKeyboardMessage, relayFrameInput } from "@ragents/web/run-panel/input-bridge";
import { useAccess } from "@ragents/web/AccessContext";
import { Badge } from "@ragents/web/ui";
import { usePalette, useResolvedTheme } from "@ragents/web/theme";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RunApp, RunAppInvocation, ActorProgramsApi } from "./api";
import { latestInvocation } from "./invocations";
import type { SessionContext } from "@ragents/web/PluginRegistry";
import { sendActorMessage } from "@ragents/web/api";
import { chatSnapshotOf, resolveChatActor } from "./chat-state";
import { getAttachmentCapabilities } from "@ragents/web/chat/useAttachmentCapabilities";
import type { ChatSnapshot } from "@ragents/web/actor-programs/client-ui/contracts";
import {
  RUN_APP_BRIDGE_VERSION,
  RUN_APP_CHAT_ACK,
  RUN_APP_CHAT_SEND,
  RUN_APP_CHAT_STATE,
  RUN_APP_CHAT_UNWATCH,
  RUN_APP_CHAT_WATCH,
  RUN_APP_CONNECTED,
  RUN_APP_ERROR,
  RUN_APP_FRAME_READY,
  RUN_APP_GET_STATE,
  RUN_APP_INVOCATION,
  RUN_APP_READY,
  RUN_APP_STATE,
  RUN_APP_THEME,
  validateRunAppBridgeRequest,
  type JsonValue,
  type RunAppInvokeRequest,
} from "./bridge";

interface ActorViewFrameProps {
  api: ActorProgramsApi;
  app: RunApp;
  invoke: (
    appId: string,
    revision: string,
    actionId: string,
    requestId: string,
    input: JsonValue,
  ) => Promise<RunAppInvocation>;
  pendingConfirmationInvocationId?: string;
  runId: string;
  session: SessionContext;
}

interface FrameLifecycle {
  frame: HTMLIFrameElement;
  url: string;
  resume: () => void;
  suspend: () => void;
  dispose: () => void;
}

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const REQUEST_ID_HISTORY_LIMIT = 512;
const RUNNING_CHIP_DELAY_MS = 400;

const useSustained = (active: boolean, delayMs: number): boolean => {
  const [sustained, setSustained] = useState(false);
  useEffect(() => {
    if (!active) {
      setSustained(false);
      return;
    }
    const timer = setTimeout(() => setSustained(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return sustained;
};

const invocationSignature = (invocation: RunAppInvocation): string => JSON.stringify(invocation);

export function ActorViewFrame({
  api,
  app,
  invoke,
  pendingConfirmationInvocationId,
  runId,
  session,
}: ActorViewFrameProps) {
  const access = useAccess();
  const theme = useResolvedTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const palette = usePalette();
  const paletteRef = useRef(palette);
  paletteRef.current = palette;
  const writableRef = useRef(access.can("runs.write"));
  writableRef.current = access.can("runs.write");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const portRef = useRef<MessagePort | undefined>(undefined);
  const frameLifecycleRef = useRef<FrameLifecycle | undefined>(undefined);
  const bridgeGenerationRef = useRef(0);
  const bridgeConnectedRef = useRef(false);
  const appRef = useRef(app);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const invokeRef = useRef(invoke);
  invokeRef.current = invoke;
  const watchedChats = useRef(new Map<string, string>());
  const chatCapabilities = useRef(new Map<string, { result?: Pick<ChatSnapshot, "attachmentCapabilities" | "attachmentCapabilitiesError">; pending: Promise<Pick<ChatSnapshot, "attachmentCapabilities" | "attachmentCapabilitiesError">> }>());
  const recentRequestIdsRef = useRef(new Set<string>());
  const sentStateRef = useRef("");
  const sentInvocationsRef = useRef(new Map<string, string>());
  const [bridgeReady, setBridgeReady] = useState(false);
  const [frameError, setFrameError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [submitting, setSubmitting] = useState<string[]>([]);
  appRef.current = app;
  const frameUrl = useMemo(() => api.frameUrl(runId, app.id, app.revision), [api, app.id, app.revision, runId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a fresh token is minted per frame url on purpose
  const bridgeToken = useMemo(() => crypto.randomUUID().replaceAll("-", ""), [frameUrl]);

  const closeBridge = useCallback(() => {
    bridgeGenerationRef.current += 1;
    bridgeConnectedRef.current = false;
    portRef.current?.close();
    portRef.current = undefined;
    watchedChats.current.clear();
    chatCapabilities.current.clear();
    setBridgeReady(false);
    setSubmitting([]);
  }, []);

  const sendChatState = useCallback((port: MessagePort, actor: string, requestId?: string) => {
    const generation = bridgeGenerationRef.current;
    const publish = (capabilities: Pick<ChatSnapshot, "attachmentCapabilities" | "attachmentCapabilitiesError">) => {
      if (generation !== bridgeGenerationRef.current || port !== portRef.current || !watchedChats.current.has(actor)) return;
      const chat = chatSnapshotOf(sessionRef.current, actor);
      const snapshot = { ...chat, ...capabilities, readOnly: chat.readOnly === true || !writableRef.current };
      const signature = JSON.stringify(snapshot);
      if (requestId === undefined && watchedChats.current.get(actor) === signature) return;
      watchedChats.current.set(actor, signature);
      port.postMessage({ type: RUN_APP_CHAT_STATE, version: RUN_APP_BRIDGE_VERSION, actor, snapshot, ...(requestId ? { requestId } : {}) });
    };
    try {
      const current = sessionRef.current;
      const target = resolveChatActor(current, actor).actor;
      const key = JSON.stringify([current.session.id, target.id, target.execution?.driver]);
      let entry = chatCapabilities.current.get(key);
      if (!entry) {
        const pending = getAttachmentCapabilities(current.session.id, target.id).then(
          (attachmentCapabilities) => ({ attachmentCapabilities }),
          (cause: unknown) => ({ attachmentCapabilitiesError: cause instanceof Error ? cause.message : String(cause) }),
        );
        entry = { pending };
        chatCapabilities.current.set(key, entry);
        const saved = entry;
        void pending.then((result) => { saved.result = result; });
      }
      publish(entry.result ?? { attachmentCapabilitiesError: "Checking model capabilities ..." });
      if (!entry.result) void entry.pending.then(publish);
    } catch (cause) {
      publish({ attachmentCapabilitiesError: cause instanceof Error ? cause.message : String(cause) });
    }
  }, []);

  const postError = useCallback((port: MessagePort, requestId: string | undefined, message: string) => {
    port.postMessage({
      type: RUN_APP_ERROR,
      version: RUN_APP_BRIDGE_VERSION,
      ...(requestId ? { requestId } : {}),
      message,
    });
  }, []);

  const executeRequest = useCallback(async (
    request: RunAppInvokeRequest,
    port: MessagePort,
    generation: number,
    installedApp: Pick<RunApp, "id" | "revision">,
  ) => {
    if (generation !== bridgeGenerationRef.current || port !== portRef.current) return;
    setActionError(undefined);
    setSubmitting((current) => [...current, request.requestId]);
    try {
      if (!writableRef.current) throw new Error("You have read-only access to this actor view.");
      const invocation = await invokeRef.current(
        installedApp.id,
        installedApp.revision,
        request.actionId,
        request.requestId,
        request.input,
      );
      if (generation !== bridgeGenerationRef.current || port !== portRef.current) return;
      sentInvocationsRef.current.set(invocation.id, invocationSignature(invocation));
      port.postMessage({
        type: RUN_APP_INVOCATION,
        version: RUN_APP_BRIDGE_VERSION,
        requestId: request.requestId,
        invocation,
      });
    } catch (caught) {
      if (generation !== bridgeGenerationRef.current || port !== portRef.current) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      setActionError(message);
      postError(port, request.requestId, message);
    } finally {
      if (generation === bridgeGenerationRef.current && port === portRef.current) {
        setSubmitting((current) => current.filter((requestId) => requestId !== request.requestId));
      }
    }
  }, [postError]);

  const sendState = useCallback((port: MessagePort, requestId?: string) => {
    const current = appRef.current;
    port.postMessage({
      type: RUN_APP_STATE,
      version: RUN_APP_BRIDGE_VERSION,
      ...(requestId ? { requestId } : {}),
      state: current.state ?? null,
    });
  }, []);

  const handlePortMessage = useCallback((
    value: unknown,
    port: MessagePort,
    generation: number,
    installedApp: RunApp,
  ) => {
    if (generation !== bridgeGenerationRef.current || port !== portRef.current) return;
    if (relayFrameInput(window, value, (message) => {
      if (generation === bridgeGenerationRef.current && port === portRef.current) iframeRef.current?.contentWindow?.postMessage(message, "*");
    })) return;
    const message = value as { type?: unknown; version?: unknown } | null;
    if (message?.type === RUN_APP_CONNECTED && message.version === RUN_APP_BRIDGE_VERSION) {
      bridgeConnectedRef.current = true;
      setFrameError(undefined);
      setBridgeReady(true);
      return;
    }
    const validation = validateRunAppBridgeRequest(value);
    if (!validation.ok) {
      postError(port, validation.requestId, validation.error);
      return;
    }
    const { request } = validation;
    if (recentRequestIdsRef.current.has(request.requestId)) {
      postError(port, request.requestId, "This requestId has already been used");
      return;
    }
    recentRequestIdsRef.current.add(request.requestId);
    if (recentRequestIdsRef.current.size > REQUEST_ID_HISTORY_LIMIT) {
      const oldest = recentRequestIdsRef.current.values().next().value;
      if (oldest !== undefined) recentRequestIdsRef.current.delete(oldest);
    }
    if (request.type === RUN_APP_CHAT_WATCH) {
      watchedChats.current.set(request.actor, "");
      sendChatState(port, request.actor, request.requestId);
      return;
    }
    if (request.type === RUN_APP_CHAT_UNWATCH) {
      watchedChats.current.delete(request.actor);
      port.postMessage({ type: RUN_APP_CHAT_ACK, version: RUN_APP_BRIDGE_VERSION, requestId: request.requestId });
      return;
    }
    if (request.type === RUN_APP_CHAT_SEND) {
      void (async () => {
        try {
          if (!writableRef.current) throw new Error("You have read-only access to this chat.");
          const current = sessionRef.current;
          const snapshot = chatSnapshotOf(current, request.actor);
          if (snapshot.error) throw new Error(snapshot.error);
          const { actor } = resolveChatActor(current, request.actor);
          await sendActorMessage(current.session.id, actor.id, request.text, request.attachments);
          if (generation === bridgeGenerationRef.current && port === portRef.current) {
            port.postMessage({ type: RUN_APP_CHAT_ACK, version: RUN_APP_BRIDGE_VERSION, requestId: request.requestId });
          }
        } catch (error) {
          if (generation === bridgeGenerationRef.current && port === portRef.current) {
            postError(port, request.requestId, error instanceof Error ? error.message : String(error));
          }
        }
      })();
      return;
    }
    if (request.type === RUN_APP_GET_STATE) {
      sendState(port, request.requestId);
      return;
    }
    const action = installedApp.actions.find((entry) => entry.id === request.actionId);
    if (!action) {
      postError(port, request.requestId, "The requested app action is not installed");
      return;
    }
    void executeRequest(request, port, generation, installedApp);
  }, [executeRequest, postError, sendChatState, sendState]);

  const attachBridge = useCallback((port: MessagePort, installedApp: RunApp) => {
    if (portRef.current) {
      port.close();
      return;
    }
    closeBridge();
    const generation = bridgeGenerationRef.current;
    portRef.current = port;
    port.onmessage = (event) => handlePortMessage(event.data, port, generation, installedApp);
    port.onmessageerror = () => {
      if (generation === bridgeGenerationRef.current && port === portRef.current) {
        postError(port, undefined, "The app sent an unreadable message");
      }
    };
    port.start();
    recentRequestIdsRef.current = new Set();
    sentStateRef.current = JSON.stringify(installedApp.state ?? null);
    sentInvocationsRef.current = new Map(installedApp.invocations.map((invocation) => [
      invocation.id,
      invocationSignature(invocation),
    ]));
    port.postMessage({
      type: RUN_APP_READY,
      version: RUN_APP_BRIDGE_VERSION,
      theme: themeRef.current,
      palette: paletteRef.current,
      hostInput: hostInputEnabled(window),
      app: {
        id: installedApp.id,
        actorId: installedApp.actorId,
        actorHandle: installedApp.actorHandle,
        title: installedApp.title,
        description: installedApp.description,
        actions: installedApp.actions,
      },
      actor: { id: installedApp.actorId, handle: installedApp.actorHandle },
      state: installedApp.state ?? null,
      invocations: installedApp.invocations,
    });
    setFrameError(undefined);
  }, [closeBridge, handlePortMessage, postError]);

  useLayoutEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const retained = frameLifecycleRef.current;
    if (retained?.frame === frame && retained.url === frameUrl) {
      retained.resume();
      return retained.suspend;
    }
    retained?.dispose();
    closeBridge();
    setActionError(undefined);
    setFrameError(undefined);
    const installedApp = appRef.current;
    let initialLoaded = false;
    let disposed = false;
    let active = true;
    let navigated = false;
    let timeout: number | undefined;
    let pendingPort: MessagePort | undefined;
    const clearTimeout = () => {
      window.clearTimeout(timeout);
      timeout = undefined;
    };
    const awaitConnection = () => {
      clearTimeout();
      if (!active || !initialLoaded || navigated || bridgeConnectedRef.current) return;
      timeout = window.setTimeout(() => {
        if (!disposed && !bridgeConnectedRef.current) setFrameError("The app did not open a valid host bridge.");
      }, 5_000);
    };
    const connect = (port: MessagePort) => {
      if (initialLoaded) attachBridge(port, installedApp);
      else pendingPort = port;
    };
    const receiveReady = (event: MessageEvent<unknown>) => {
      if (disposed || navigated) return;
      const data = event.data as { type?: unknown; version?: unknown; token?: unknown; keyboard?: unknown } | null;
      if (event.source === frame.contentWindow && event.origin === "null"
        && data?.type === "ragents.app.escape" && data.version === RUN_APP_BRIDGE_VERSION
        && data.token === bridgeToken) {
        window.dispatchEvent(new KeyboardEvent("keydown", { ...(isRunPanelKeyboardMessage(data.keyboard) ? data.keyboard.event : { key: "Escape" }), bubbles: true, cancelable: true }));
        return;
      }
      if (event.source !== frame.contentWindow
        || event.origin !== "null"
        || data?.type !== RUN_APP_FRAME_READY
        || data.version !== RUN_APP_BRIDGE_VERSION
        || data.token !== bridgeToken
        || event.ports.length !== 1) return;
      if (pendingPort || portRef.current) {
        event.ports[0]!.close();
        return;
      }
      connect(event.ports[0]!);
    };
    const handleLoad = () => {
      if (disposed) return;
      if (!initialLoaded) {
        initialLoaded = true;
        if (pendingPort) {
          const port = pendingPort;
          pendingPort = undefined;
          attachBridge(port, installedApp);
        }
        awaitConnection();
        return;
      }
      navigated = true;
      clearTimeout();
      pendingPort?.close();
      pendingPort = undefined;
      closeBridge();
      setFrameError("The app left its installed page and was disconnected.");
    };
    const lifecycle = {
      frame,
      url: frameUrl,
      resume: () => { active = true; awaitConnection(); },
      suspend: () => {
        active = false;
        clearTimeout();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        clearTimeout();
        observer.disconnect();
        window.removeEventListener("message", receiveReady);
        frame.removeEventListener("load", handleLoad);
        pendingPort?.close();
        if (frameLifecycleRef.current === lifecycle) {
          frameLifecycleRef.current = undefined;
          closeBridge();
        }
      },
    };
    const observer = new MutationObserver(() => { if (!frame.isConnected) lifecycle.dispose(); });
    observer.observe(frame.ownerDocument, { childList: true, subtree: true });
    frameLifecycleRef.current = lifecycle;
    window.addEventListener("message", receiveReady);
    frame.addEventListener("load", handleLoad);
    frame.src = `${frameUrl}#ragentsBridge=${encodeURIComponent(bridgeToken)}`;
    return lifecycle.suspend;
  }, [attachBridge, bridgeToken, closeBridge, frameUrl]);

  useEffect(() => {
    if (!bridgeReady) return;
    portRef.current?.postMessage({ type: RUN_APP_THEME, version: RUN_APP_BRIDGE_VERSION, theme, palette });
  }, [bridgeReady, palette, theme]);

  useEffect(() => {
    if (!bridgeReady) return;
    const stateSignature = JSON.stringify(app.state ?? null);
    if (stateSignature !== sentStateRef.current) {
      sentStateRef.current = stateSignature;
      const port = portRef.current;
      if (port) sendState(port);
    }
    app.invocations.forEach((invocation) => {
      const signature = invocationSignature(invocation);
      if (sentInvocationsRef.current.get(invocation.id) === signature) return;
      sentInvocationsRef.current.set(invocation.id, signature);
      portRef.current?.postMessage({
        type: RUN_APP_INVOCATION,
        version: RUN_APP_BRIDGE_VERSION,
        invocation,
      });
    });
  }, [app.invocations, app.state, bridgeReady, sendState]);

  useEffect(() => {
    if (!bridgeReady || !portRef.current) return;
    for (const actor of watchedChats.current.keys()) sendChatState(portRef.current, actor);
  }, [bridgeReady, sendChatState, session]);

  const latest = latestInvocation(app);
  const active = app.invocations.filter((invocation) => ACTIVE_STATUSES.has(invocation.status));
  const confirmationInvocation = active.find((invocation) => invocation.id === pendingConfirmationInvocationId);
  const confirmationAction = confirmationInvocation
    ? app.actions.find((action) => action.id === confirmationInvocation.actionId)
    : undefined;
  const status = frameError
    ? { tone: "error", title: "App disconnected", detail: frameError }
    : submitting.length > 0
      ? { tone: "running", title: "Starting action", detail: `${submitting.length} request(s)` }
      : confirmationAction
        ? { tone: "confirm", title: "Waiting for your confirmation", detail: confirmationAction.label }
        : active.length > 0
          ? { tone: "running", title: "Action running", detail: active.map((invocation) =>
            app.actions.find((action) => action.id === invocation.actionId)?.label.trim()
              || (access.can("runs.inspect") ? invocation.actionId : "")).filter(Boolean).join(", ") }
          : actionError
            ? { tone: "error", title: "Action failed", detail: actionError }
            : latest?.status === "failed"
              ? { tone: "error", title: "Last action failed", detail: latest.error }
              : latest?.status === "cancelled"
                ? { tone: "muted", title: "Last action cancelled", detail: latest.actionId }
                : latest?.status === "succeeded"
                  ? {
                      tone: "success",
                      title: "Last action completed",
                      detail: latest.output.at(-1) ?? latest.actionId,
                    }
                  : bridgeReady
                    ? undefined
                    : { tone: "muted", title: "Loading app", detail: "Bridge not connected yet" };

  const running = status?.tone === "running" ? status : undefined;
  const showRunning = useSustained(running !== undefined, RUNNING_CHIP_DELAY_MS);
  const visibleStatus = status && status.tone !== "success" && !running ? status : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div aria-live="polite" role="status"
        className={`order-1 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 overflow-hidden px-workspace-inset text-xs text-muted-foreground ${visibleStatus ? "h-7 flex-[0_0_28px] py-1" : "h-0 flex-none"}`}>
        {visibleStatus && <>
          <Badge tone={visibleStatus.tone === "error" ? "danger" : visibleStatus.tone === "confirm" ? "warning" : "neutral"}>{visibleStatus.title}</Badge>
          <span className="truncate" title={visibleStatus.detail}>{visibleStatus.detail}</span>
        </>}
      </div>
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-transparent">
        <iframe
          allow="camera 'none'; geolocation 'none'; microphone 'none'"
          className="absolute inset-0 h-full w-full min-h-0 min-w-0 border-0 bg-transparent"
          ref={iframeRef}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms allow-downloads"
          aria-label={app.title}
          title=""
        />
        <div aria-live="polite" role="status" className="pointer-events-none absolute right-2 bottom-2 left-2 flex justify-end">
          {showRunning && running && <span className="flex max-w-full items-center gap-1.5 rounded-full border border-border-soft bg-background/90 py-0.5 pr-2.5 pl-1 text-xs text-muted-foreground shadow-sm">
            <Badge tone="active">{running.title}</Badge>
            <span className="truncate" title={running.detail}>{running.detail}</span>
          </span>}
        </div>
      </div>
    </div>
  );
}
