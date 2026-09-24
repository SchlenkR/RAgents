import { Button, cn } from "../ui";
import { type CSSProperties, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createChatScroll } from "./chat-scroll";
import { DetailMode, Message, PendingAction, prettyJson, stepState, ToolInfo } from "./types";
import { ChatTexts, defaultTexts } from "./texts";
import { Markdown, MarkdownCodeBlocks, MarkdownLinks, type LinkClickHandler } from "./Markdown";
import { StepPopover } from "./StepPopover";
import { PendingActionCard } from "./PendingActionCard";
import { WorkingScenes } from "./WorkingScenes";
import { attachmentDownloadUrl, formatAttachmentSize } from "./attachments";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, LayersIcon, SparklesIcon, WrenchIcon } from "lucide-react";
import { appearanceStyle, type ChatAppearance, type TimestampOptions, type CodeBlockOptions, type BubbleOptions, type MessageActionsOptions } from "./options";
import { messageDate, timestampDay, timestampLabel } from "./timestamps";
import { MessageActions } from "./MessageActions";
import { ChatSendContext } from "./ChatSendContext";

const stepClasses = "mt-[var(--chat-message-gap,16px)]";
const denseStepClasses = "mt-[var(--chat-dense-message-gap,8px)]";

const traceClasses = "flex w-full gap-2 pl-6 text-left text-[11px] leading-[1.375] text-muted-foreground";
const traceButtonClasses = "cursor-pointer rounded-md py-1 pr-2 transition-colors hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none";
const traceIconClasses = "mt-0.5 flex-none opacity-60";
const traceErrorIconClasses = "mt-0.5 flex-none text-destructive opacity-100";
const traceLineClasses = "min-w-0 self-baseline font-mono [overflow-wrap:anywhere]";
const traceRunningClasses = "ml-1.5 opacity-60";

const chipClasses = cn(
  "inline-flex max-w-[220px] items-center gap-[5px] rounded-full border border-border-soft px-2.5 py-0.5",
  "font-mono text-[10.5px] leading-[1.6] text-muted-foreground transition-colors",
  "data-[state=running]:border-[color-mix(in_srgb,var(--primary)_40%,var(--border-soft))]",
  "data-[state=thinking]:border-[color-mix(in_srgb,var(--primary)_40%,var(--border-soft))]",
  "data-[state=error]:border-[color-mix(in_srgb,var(--destructive)_45%,var(--border-soft))]",
  "data-[state=done]:opacity-85",
);
const chipInteractiveClasses = "cursor-pointer hover:border-border hover:bg-secondary hover:text-foreground focus-visible:border-border focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none data-[state=done]:hover:opacity-100 data-[state=done]:focus-visible:opacity-100";

const bubbleBodyClasses = "relative max-w-[86%] px-3 py-2 leading-[var(--chat-line-height,1.625)] [overflow-wrap:anywhere] @max-[620px]/chat:max-w-full";

function istSchritt(message?: Message): boolean {
  return !!message && (message.role === "thinking" || message.role === "tool");
}

function defaultArgumentsText(tool: ToolInfo): string {
  return prettyJson(tool.arguments);
}

/**
 * Der Verlauf: eigener Scroll-Container mit Autoscroll, solange man unten ist,
 * und einem Zum-Ende-Knopf, sobald man liest. Ohne Eingabe read-only nutzbar.
 */
export function ChatMessages({
  messages,
  owner,
  detailMode = "current",
  running = false,
  working,
  stepsExpandable = true,
  texts,
  toolArgumentsText = defaultArgumentsText,
  renderTool,
  renderAction,
  onDismissAction,
  onLinkClick,
  emptyState,
  className,
  showTimestamps = false,
  announceMessages = true,
  scrollerRef,
  maxWidth,
  horizontalPadding,
  jumpToEndThreshold = 120,
  appearance,
  timestampOptions,
  codeBlockOptions,
  bubbleOptions,
  messageActions,
}: {
  messages: Message[];
  /** Beiträge mit diesem Message.sender erscheinen ohne Sprechblase; null behält die Nachrichtenvorgaben. */
  owner?: string | null;
  detailMode?: DetailMode;
  running?: boolean;
  working?: ReactNode;
  /** false = Denk- und Werkzeug-Schritte lassen sich nicht aufklappen (kein Popover). */
  stepsExpandable?: boolean;
  texts?: Partial<ChatTexts>;
  toolArgumentsText?: (tool: ToolInfo) => string;
  /** Eigene Darstellung fuer einzelne Werkzeuge; undefined = Standarddarstellung. */
  renderTool?: (tool: ToolInfo) => ReactNode | undefined;
  /** Darstellung einer wartenden Aktion durch ihren Eigentümer; undefined = generische Karte. */
  renderAction?: (action: PendingAction, text: string) => ReactNode | undefined;
  onDismissAction?: (actionId: string) => void;
  /** Faengt Klicks auf Markdown-Links ab; true = behandelt, der Browser folgt nicht. */
  onLinkClick?: LinkClickHandler;
  emptyState?: ReactNode;
  className?: string;
  /** true = dezente HH:MM-Spalte links an jedem Block (Message.at). */
  showTimestamps?: boolean;
  announceMessages?: boolean;
  /** Exposes the scroll container so hosts can scroll without querying the DOM. */
  scrollerRef?: (element: HTMLDivElement | null) => void;
  maxWidth?: CSSProperties["maxWidth"];
  horizontalPadding?: CSSProperties["paddingInline"];
  jumpToEndThreshold?: number;
  appearance?: ChatAppearance;
  timestampOptions?: TimestampOptions;
  codeBlockOptions?: CodeBlockOptions;
  bubbleOptions?: BubbleOptions;
  messageActions?: MessageActionsOptions;
}) {
  const alleTexte = { ...defaultTexts, ...texts };
  const scrollBereich = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const scrollbarDragging = useRef(false);
  const touchY = useRef<number | undefined>(undefined);
  const [showJumpToEnd, setShowJumpToEnd] = useState(false);
  const [scroll] = useState(() => createChatScroll());
  const sendScope = useContext(ChatSendContext);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!showTimestamps || timestampOptions?.format !== "relative") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [showTimestamps, timestampOptions?.format]);
  const updateJumpVisibility = useCallback((viewport: HTMLDivElement) => {
    if (viewport.clientHeight > 0) setShowJumpToEnd(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > jumpToEndThreshold);
  }, [jumpToEndThreshold]);
  useLayoutEffect(() => sendScope?.subscribe(() => {
    const viewport = scrollBereich.current;
    if (!viewport) return;
    scroll.jump(viewport);
    updateJumpVisibility(viewport);
  }), [sendScope, scroll, updateJumpVisibility]);

  const pauseUp = (viewport: HTMLDivElement, target: EventTarget) => {
    let element = target instanceof Element ? target : null;
    while (element && element !== viewport) {
      if (element.scrollTop > 0 && /auto|scroll/.test(getComputedStyle(element).overflowY)) return;
      element = element.parentElement;
    }
    scroll.pause(viewport);
  };

  const pruefeEnde = useCallback(() => {
    const bereich = scrollBereich.current;
    if (bereich) {
      scroll.scroll(bereich, scrollbarDragging.current);
      updateJumpVisibility(bereich);
    }
  }, [scroll, updateJumpVisibility]);

  useEffect(() => {
    const finishDrag = () => {
      if (scrollbarDragging.current && scrollBereich.current) scroll.scroll(scrollBereich.current, true);
      scrollbarDragging.current = false;
    };
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    return () => {
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
    };
  }, [scroll]);

  // Inhaltswachstum ändert den Folgemodus nicht; auch nachgeladene Medien und die Eingabe zählen.
  useLayoutEffect(() => {
    const bereich = scrollBereich.current;
    if (!bereich) return;
    const align = () => {
      scroll.layout(bereich, scrollbarDragging.current);
      updateJumpVisibility(bereich);
    };
    align();
    const beobachter = new ResizeObserver(align);
    beobachter.observe(bereich);
    if (threadRef.current) beobachter.observe(threadRef.current, { box: "border-box" });
    return () => beobachter.disconnect();
  });

  const visible = useMemo(
    () => {
      // Eigene Eingaben hinter dem laufenden Schritt beenden ihn nicht; jede andere Nachricht schon.
      const letzterFremder = messages.reduce((last, message, index) => message.role === "user" ? last : index, -1);
      return messages.filter((message, index) => {
        if (detailMode === "current" && istSchritt(message)) {
          return running && index === letzterFremder
            && (message.role === "thinking" ? !message.closed : stepState(message) === "running");
        }
        if ((message.role === "thinking" || message.role === "assistant") && message.text.trim() === "" && !message.attachments?.length) {
          return false;
        }
        if (message.role === "thinking" || message.role === "tool") {
          return detailMode !== "off";
        }
        return true;
      });
    },
    [messages, detailMode, running],
  );

  const mitZeit = (inhalt: ReactNode, key: string, at: string | undefined, dicht = false): ReactNode =>
    showTimestamps
      ? (
        <div className={cn("flex items-baseline gap-2", dicht ? denseStepClasses : stepClasses)} key={`zeit-${key}`}>
          <time dateTime={messageDate(at)?.toISOString()} className={cn("flex-none text-[10.5px] tabular-nums text-muted-foreground opacity-85",
            timestampOptions?.format && timestampOptions.format !== "time" ? "w-[clamp(60px,20%,120px)]" : "w-[34px]")}>
            {messageDate(at) ? timestampLabel(messageDate(at)!, timestampOptions, now) : ""}
          </time>
          <div className="min-w-0 flex-1 [&>*:first-child]:mt-0">{inhalt}</div>
        </div>
      )
      : inhalt;

  // In den Chip-Modi ruecken aufeinanderfolgende Schritte in eine umbrechende Zeile zusammen, gruppiert in eine aufklappbare Zeile.
  const chipModus = detailMode === "current" || detailMode === "chips" || detailMode === "icons";
  const gruppenModus = detailMode === "grouped";
  const bloecke: ReactNode[] = [];
  let lastDay: string | undefined;
  let gruppe: Message[] = [];
  const schliesseGruppe = () => {
    if (gruppe.length > 0) {
      const letzterZustand = stepState(gruppe[gruppe.length - 1]);
      bloecke.push(mitZeit(
        gruppenModus ? (
          <StepGroup
            aktiv={running && (letzterZustand === "running" || letzterZustand === "thinking")}
            expandierbar={stepsExpandable}
            key={gruppe[0].key}
            messages={gruppe}
            texts={alleTexte}
            toolArgumentsText={toolArgumentsText}
          />
        ) : (
          <StepRow
            expandierbar={stepsExpandable}
            key={gruppe[0].key}
            messages={gruppe}
            mitText={detailMode !== "icons"}
            texts={alleTexte}
            toolArgumentsText={toolArgumentsText}
            toolLabel={detailMode === "current" && !stepsExpandable ? alleTexte.currentTool : undefined}
          />
        ),
        gruppe[0].key,
        gruppe[0].at,
      ));
      gruppe = [];
    }
  };
  visible.forEach((message, index) => {
    const date = timestampOptions?.showDaySeparators ? messageDate(message.at) : undefined;
    if (date) {
      const day = timestampDay(date, timestampOptions);
      if (day.key !== lastDay) {
        schliesseGruppe();
        bloecke.push(<div className={cn(stepClasses, "text-center text-xs text-muted-foreground")} data-chat="day-separator" data-day={day.key} key={`day-${message.key}`}>{day.label}</div>);
        lastDay = day.key;
      }
    }
    const eigeneDarstellung = message.role === "tool" && message.tool && detailMode !== "current" ? renderTool?.(message.tool) : undefined;
    if (eigeneDarstellung !== undefined) {
      schliesseGruppe();
      bloecke.push(mitZeit(
        <div className={stepClasses} key={message.key}>
          {eigeneDarstellung}
        </div>,
        message.key,
        message.at,
      ));
      return;
    }
    if ((chipModus || gruppenModus) && istSchritt(message)) {
      gruppe = [...gruppe, message];
      return;
    }
    schliesseGruppe();
    const dicht = istSchritt(message) && istSchritt(visible[index - 1]);
    bloecke.push(mitZeit(
      <Bubble
        detailMode={detailMode}
        dicht={dicht}
        expandierbar={stepsExpandable}
        key={message.key}
        message={message}
        plain={owner != null && message.sender === owner}
        texts={alleTexte}
        toolArgumentsText={toolArgumentsText}
        renderAction={renderAction}
        onDismissAction={onDismissAction}
        bubbleOptions={bubbleOptions}
        messageActions={messageActions}
      />,
      message.key,
      message.at,
      dicht,
    ));
  });
  schliesseGruppe();

  const verlauf = (
    <div className={cn("@container/chat relative flex min-h-0 flex-1 flex-col", className)} style={{
      ...appearanceStyle(appearance),
      "--chat-content-max-width": typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
      "--chat-horizontal-padding": typeof horizontalPadding === "number" ? `${horizontalPadding}px` : horizontalPadding,
    } as CSSProperties}>
      <div
        aria-label="Chatverlauf"
        className={cn(
          "min-h-0 flex-1 cursor-default overflow-y-auto text-[length:var(--chat-font-size,13px)] text-foreground",
          "[--fade-edge:calc(100%_-_var(--composer-height,0px))]",
          "[-webkit-mask-image:linear-gradient(to_bottom,#000_calc(var(--fade-edge)_-_40px),transparent_calc(var(--fade-edge)_+_16px))]",
          "[mask-image:linear-gradient(to_bottom,#000_calc(var(--fade-edge)_-_40px),transparent_calc(var(--fade-edge)_+_16px))]",
          "in-data-[tone=material]:p-0",
        )}
        onScroll={pruefeEnde}
        onWheel={(event) => { if (!event.ctrlKey && event.deltaY < 0) pauseUp(event.currentTarget, event.target); }}
        onKeyDown={(event) => {
          const editable = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]");
          if (!editable && (["ArrowUp", "PageUp", "Home"].includes(event.key) || event.target === event.currentTarget && event.key === " " && event.shiftKey)) pauseUp(event.currentTarget, event.target);
        }}
        onPointerDown={(event) => {
          const viewport = event.currentTarget;
          scrollbarDragging.current = event.clientX >= viewport.getBoundingClientRect().right - Math.max(16, viewport.offsetWidth - viewport.clientWidth);
        }}
        onTouchStart={(event) => { touchY.current = event.touches[0]?.clientY; }}
        onTouchMove={(event) => {
          const next = event.touches[0]?.clientY;
          if (next !== undefined && touchY.current !== undefined && next > touchY.current) pauseUp(event.currentTarget, event.target);
          touchY.current = next;
        }}
        role="region"
        tabIndex={0}
        ref={(element) => {
          scrollBereich.current = element;
          scrollerRef?.(element);
        }}
      >
        {visible.length === 0 && !running ? (
          emptyState ?? null
        ) : (
          <div
            aria-live={announceMessages ? "polite" : "off"}
            className={cn(
              "mx-auto w-[calc(100%_-_2_*_var(--chat-horizontal-padding,24px))] max-w-[var(--chat-content-max-width,none)] pt-2",
              "pb-[calc(var(--composer-height,0px)_+_max(3.25em,40px))]",
              "in-data-[tone=material]:[&>*:first-child]:mt-0",
            )}
            ref={threadRef}
          >
            {bloecke}
            {running && (working ?? <WorkingScenes label={alleTexte.working} />)}
          </div>
        )}
      </div>
      {showJumpToEnd && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--composer-height,0px)_+_12px)] z-10 flex justify-center">
          <Button aria-label={alleTexte.jumpToEnd} className="pointer-events-auto rounded-full border border-primary-foreground/20 shadow-md" size="icon" title={alleTexte.jumpToEnd} variant="default" onClick={() => {
            if (scrollBereich.current) {
              scroll.jump(scrollBereich.current);
              updateJumpVisibility(scrollBereich.current);
            }
          }}>
            <ChevronDownIcon />
          </Button>
        </div>
      )}
    </div>
  );

  return <MarkdownLinks onLinkClick={onLinkClick}><MarkdownCodeBlocks options={codeBlockOptions} texts={alleTexte}>{verlauf}</MarkdownCodeBlocks></MarkdownLinks>;
}

/** Aufeinanderfolgende Schritte als Chips nebeneinander; bei Platzmangel bricht die Zeile um. */
function StepRow({
  messages,
  mitText,
  expandierbar,
  texts,
  toolArgumentsText,
  toolLabel,
}: {
  messages: Message[];
  mitText: boolean;
  expandierbar: boolean;
  texts: ChatTexts;
  toolArgumentsText: (tool: ToolInfo) => string;
  toolLabel?: string;
}) {
  const [detail, setDetail] = useState<{ key: string; position: { x: number; y: number } }>();
  const offen = expandierbar && detail && messages.find((message) => message.key === detail.key);

  return (
    <div className={cn(stepClasses, "flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-6")} data-step="row">
      {messages.map((message) => {
        const thinking = message.role === "thinking";
        const tool = message.tool;
        const state = stepState(message);
        const running = state === "running" || state === "thinking";
        const label = thinking ? texts.thinkingChip : toolLabel ?? (tool?.name || message.text || texts.toolChip);
        const content = (
          <>
            {thinking ? (
              <SparklesIcon size={11} />
            ) : (
              <WrenchIcon className={tool?.isError ? "text-destructive" : undefined} size={11} />
            )}
            {mitText && <span className="min-w-0 self-baseline overflow-hidden text-ellipsis whitespace-nowrap">{label}</span>}
            {mitText && <span className="inline-flex w-2.5 flex-none items-center justify-center text-success">{state === "done" && <CheckIcon size={10} />}</span>}
          </>
        );
        const classes = cn(chipClasses, !mitText && "p-1", running && "animate-fade-pulse motion-reduce:animate-none");
        if (!expandierbar) {
          return (
            <span className={classes} data-kind={thinking ? "thinking" : "tool"} data-state={state} data-step="chip" key={message.key} title={label}>
              {content}
            </span>
          );
        }
        return (
          <button
            aria-haspopup="dialog"
            className={cn(classes, chipInteractiveClasses)}
            data-kind={thinking ? "thinking" : "tool"}
            data-state={state}
            data-step="chip"
            key={message.key}
            onClick={(event) => setDetail({ key: message.key, position: { x: event.clientX, y: event.clientY } })}
            title={label}
            type="button"
          >
            {content}
          </button>
        );
      })}
      {offen && detail && (
        <StepPopover
          message={offen}
          position={detail.position}
          texts={texts}
          toolArgumentsText={toolArgumentsText}
          onClose={() => setDetail(undefined)}
        />
      )}
    </div>
  );
}

/** Aufeinanderfolgende Schritte hinter einer Kopfzeile; aufgeklappt stehen sie als einzeilige Zeilen darunter. */
function StepGroup({
  messages,
  aktiv,
  expandierbar,
  texts,
  toolArgumentsText,
}: {
  messages: Message[];
  aktiv: boolean;
  expandierbar: boolean;
  texts: ChatTexts;
  toolArgumentsText: (tool: ToolInfo) => string;
}) {
  const [offen, setOffen] = useState(false);
  const letzte = messages[messages.length - 1];
  const fehler = messages.some((message) => message.tool?.isError);
  const anzahl = messages.length === 1 ? texts.stepGroupOne : texts.stepGroupMany.replace("{count}", String(messages.length));
  const laufend = aktiv ? (letzte.role === "thinking" ? texts.thinkingChip : letzte.tool?.name || letzte.text || texts.toolChip) : undefined;

  return (
    <div className={stepClasses} data-step="group">
      <button
        aria-expanded={offen}
        className={cn(traceClasses, traceButtonClasses, "items-center pl-1", aktiv && "animate-fade-pulse motion-reduce:animate-none")}
        onClick={() => setOffen((wert) => !wert)}
        type="button"
      >
        <ChevronRightIcon className={cn("flex-none opacity-60 transition-transform", offen && "rotate-90")} size={12} />
        <LayersIcon className={fehler ? traceErrorIconClasses : traceIconClasses} size={12} />
        <span className={cn(traceLineClasses, "overflow-hidden text-ellipsis whitespace-nowrap")}>
          {anzahl}
          {laufend && <span className={traceRunningClasses}>{laufend} {texts.toolRunning}</span>}
        </span>
      </button>
      {offen && (
        <div className="mt-0.5 flex flex-col gap-0.5 pl-3">
          {messages.map((message) => (
            <TraceLine className="pl-3" expandierbar={expandierbar} key={message.key} message={message} texts={texts} toolArgumentsText={toolArgumentsText} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Ein Schritt als eine Zeile; mit Freigabe oeffnet ein Klick die Details im Popover. */
function TraceLine({
  message,
  className,
  expandierbar,
  texts,
  toolArgumentsText,
}: {
  message: Message;
  className: string;
  expandierbar: boolean;
  texts: ChatTexts;
  toolArgumentsText: (tool: ToolInfo) => string;
}) {
  const [detailPosition, setDetailPosition] = useState<{ x: number; y: number }>();
  const thinking = message.role === "thinking";
  const tool = message.tool;
  const classes = cn(traceClasses, className);
  const zeile = cn(traceLineClasses, thinking && "font-sans italic whitespace-pre-wrap", "overflow-hidden text-ellipsis whitespace-nowrap");
  const inhalt = (
    <>
      {thinking ? (
        <SparklesIcon className={traceIconClasses} size={12} />
      ) : (
        <WrenchIcon className={tool?.isError ? traceErrorIconClasses : traceIconClasses} size={12} />
      )}
      <span className={zeile}>
        {message.text}
        {tool && tool.result === undefined && <span className={traceRunningClasses}>{texts.toolRunning}</span>}
      </span>
    </>
  );
  const marks = { "data-compact": "true", "data-kind": thinking ? "thinking" : "tool", "data-step": "line" } as const;
  if (!expandierbar) {
    return <div className={classes} {...marks}>{inhalt}</div>;
  }
  return (
    <>
      <button
        aria-expanded={detailPosition !== undefined}
        aria-haspopup="dialog"
        className={cn(classes, traceButtonClasses)}
        {...marks}
        onClick={(event) => setDetailPosition({ x: event.clientX, y: event.clientY })}
        type="button"
      >
        {inhalt}
      </button>
      {detailPosition && (
        <StepPopover
          message={message}
          position={detailPosition}
          texts={texts}
          toolArgumentsText={toolArgumentsText}
          onClose={() => setDetailPosition(undefined)}
        />
      )}
    </>
  );
}

function Bubble({
  message,
  plain,
  detailMode,
  dicht,
  expandierbar,
  texts,
  toolArgumentsText,
  renderAction,
  onDismissAction,
  bubbleOptions,
  messageActions,
}: {
  message: Message;
  plain: boolean;
  detailMode: DetailMode;
  dicht: boolean;
  expandierbar: boolean;
  texts: ChatTexts;
  toolArgumentsText: (tool: ToolInfo) => string;
  renderAction?: (action: PendingAction, text: string) => ReactNode | undefined;
  onDismissAction?: (actionId: string) => void;
  bubbleOptions?: BubbleOptions;
  messageActions?: MessageActionsOptions;
}) {
  const schritt = dicht ? denseStepClasses : stepClasses;

  if (message.role === "thinking" || (message.role === "tool" && message.tool)) {
    if (detailMode === "compact") {
      return <TraceLine className={schritt} expandierbar={expandierbar} message={message} texts={texts} toolArgumentsText={toolArgumentsText} />;
    }
    const thinking = message.role === "thinking";
    const tool = message.tool;
    const icon = thinking ? (
      <SparklesIcon className={traceIconClasses} size={12} />
    ) : (
      <WrenchIcon className={tool?.isError ? traceErrorIconClasses : traceIconClasses} size={12} />
    );
    const zeile = (
      <>
        {message.text}
        {tool && tool.result === undefined && <span className={traceRunningClasses}>{texts.toolRunning}</span>}
      </>
    );
    return (
      <div className={cn(traceClasses, schritt)} data-kind={thinking ? "thinking" : "tool"} data-step="detail">
        {icon}
        <div className="min-w-0 flex-1">
          <div className={cn(traceLineClasses, thinking && "font-sans italic whitespace-pre-wrap")}>{zeile}</div>
          {tool && (
            <div className="mt-0.5 border-l-2 border-border-soft pl-2">
              <pre className="mb-0.5 max-h-[208px] overflow-auto font-mono text-[10.5px] leading-[1.375] break-all whitespace-pre-wrap opacity-80">{toolArgumentsText(tool)}</pre>
              {tool.result !== undefined && (
                <pre className={cn("mb-0.5 max-h-[208px] overflow-auto font-mono text-[10.5px] leading-[1.375] break-all whitespace-pre-wrap opacity-80",
                  tool.isError && "text-destructive opacity-100")}>{prettyJson(tool.result)}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (message.role === "action" && message.action) {
    const action = message.action;
    return (
      <div className={schritt}>
        {renderAction?.(action, message.text) ?? (
          <PendingActionCard
            action={action}
            dismissedLabel={texts.actionDismissed}
            dismissLabel={texts.dismissAction}
            onDismiss={onDismissAction ? () => onDismissAction(action.actionId) : undefined}
            text={message.text}
            waitingLabel={texts.pendingAction}
          />
        )}
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <div className={cn(schritt, "border-l-2 border-destructive/50 pl-3 text-sm text-muted-foreground")} data-message="system">
        <Markdown text={message.text} />
        <MessageAttachments message={message} />
      </div>
    );
  }

  if (!message.text.trim() && !message.attachments?.length) return null;

  const variant = bubbleOptions?.variant ?? "default";
  const useBubble = !plain && variant !== "plain" && (variant === "bubbles" || message.role === "user" || !!message.bubble);
  const side = (message.role === "user" ? bubbleOptions?.userSide : bubbleOptions?.assistantSide)
    ?? message.bubble?.side ?? (message.role === "user" ? "end" : "start");
  const sender = bubbleOptions?.senderLabel?.(message) ?? message.bubble?.label ?? message.sender;
  const showSender = bubbleOptions?.showSender ?? (!!message.bubble?.label && !plain);
  const content = <>
    {showSender && sender && <span className={cn("mb-[5px] table text-[0.72rem] leading-[1.45] font-semibold",
      useBubble && message.bubble && "rounded-full border border-white/30 bg-black/15 px-[7px] py-px tracking-[0.02em]")} data-chat="sender">{sender}</span>}
    <Markdown text={message.text} streaming={message.role === "assistant" && !message.closed} />
    <MessageAttachments message={message} />
    {message.steered && <small className="mt-1 block text-[0.72rem] leading-[1.45] opacity-70" data-chat="steered">{texts.steered}</small>}
    <MessageActions message={message} options={messageActions} texts={texts} />
  </>;
  const cursor = message.role === "assistant" && message.textCursor ? JSON.stringify(message.textCursor) : undefined;
  if (!useBubble) return (
    <div data-chat-text-cursor={cursor} className={cn(schritt, "group relative w-full leading-[var(--chat-line-height,1.625)] text-foreground")} data-message="answer">
      {content}
    </div>
  );
  return (
    <div data-chat-text-cursor={cursor} className={cn(schritt, "flex", side === "end" ? "justify-end" : "justify-start")}
      data-message={message.role === "user" && !message.bubble && variant === "default" ? "user" : "bubble"} data-side={side}>
      <div className={cn(bubbleBodyClasses, "group", message.bubble
        ? "rounded-lg text-white [--scroll-cover:var(--primary)]"
        : "rounded-[10px_10px_4px_10px] border border-border bg-secondary text-foreground [--scroll-cover:var(--secondary)] in-data-[tone=material]:rounded-[9px] in-data-[tone=material]:border-glass-edge/20 in-data-[tone=material]:bg-primary/15 in-data-[tone=material]:text-foreground")}
        data-tone={message.bubble ? "on-color" : undefined}
        style={{ background: message.bubble?.color, maxWidth: bubbleOptions?.maxWidth }}>
        {content}
      </div>
    </div>
  );
}

function MessageAttachments({ message }: { message: Message }) {
  if (!message.attachments?.length) return null;
  return (
    <ul className="mt-2.5 flex flex-wrap gap-2" aria-label="Anhänge">
      {message.attachments.map((attachment, index) => (
        <li className="relative flex w-[190px] max-w-full min-w-0 flex-col overflow-hidden rounded-lg border border-border text-sm" key={`${attachment.url}-${index}`}>
          {attachment.mediaType.startsWith("image/") && <a href={attachmentDownloadUrl(attachment.url)} download={attachment.name}><img className="block h-[112px] w-full bg-secondary object-contain" src={attachment.url} alt={attachment.name} loading="lazy" /></a>}
          {attachment.mediaType.startsWith("video/") && <video className="block h-[112px] w-full bg-secondary object-contain" src={attachment.url} controls preload="metadata" aria-label={attachment.name} />}
          <div className="flex flex-col gap-1 p-2 [overflow-wrap:anywhere]">
            <a className="font-medium" href={attachmentDownloadUrl(attachment.url)} download={attachment.name}>{attachment.name}</a>
            <small>{formatAttachmentSize(attachment.size)}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}
