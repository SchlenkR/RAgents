import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { cn } from "cn";
import { ChatSendContext, createChatSendScope } from "./ChatSendContext";
import { appearanceStyle, type ChatAppearance } from "./options";

/**
 * Verlauf mit ueberlagerter Eingabe. Der Rahmen misst die Eingabe selbst und
 * gibt dem Verlauf den noetigen Fussraum, damit kein Host Innenmasse setzen muss.
 */
export function ChatPanel({
  children,
  composer,
  className,
  nodeRef,
  maxWidth,
  horizontalPadding,
  appearance,
  scrollOnSend = false,
}: {
  children: ReactNode;
  /** Die Eingabe; sie liegt ueber dem Verlauf, nicht darunter. */
  composer?: ReactNode;
  className?: string;
  nodeRef?: Ref<HTMLDivElement>;
  maxWidth?: CSSProperties["maxWidth"];
  horizontalPadding?: CSSProperties["paddingInline"];
  appearance?: ChatAppearance;
  scrollOnSend?: boolean;
}) {
  const wurzel = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLDivElement>(null);
  const hasComposer = composer !== undefined;
  const scrollOnSendRef = useRef(scrollOnSend);
  const [sendScope] = useState(() => createChatSendScope(scrollOnSendRef));
  useLayoutEffect(() => { scrollOnSendRef.current = scrollOnSend; }, [scrollOnSend]);

  useEffect(() => {
    const element = eingabe.current;
    const rahmen = wurzel.current;
    if (!element || !rahmen) {
      return;
    }
    const messen = () => rahmen.style.setProperty("--composer-height", `${element.offsetHeight}px`);
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(element);
    messen();
    return () => {
      beobachter.disconnect();
      rahmen.style.removeProperty("--composer-height");
    };
  }, [hasComposer]);

  return (
    <ChatSendContext.Provider value={sendScope}>
    <div
      className={cn("relative flex min-h-0 min-w-0 flex-col overflow-hidden", className)}
      data-chat="panel"
      style={{
        ...appearanceStyle(appearance),
        "--chat-content-max-width": typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
        "--chat-horizontal-padding": typeof horizontalPadding === "number" ? `${horizontalPadding}px` : horizontalPadding,
      } as CSSProperties}
      ref={(element) => {
        wurzel.current = element;
        if (typeof nodeRef === "function") {
          nodeRef(element);
        } else if (nodeRef) {
          nodeRef.current = element;
        }
      }}
    >
      {children}
      {hasComposer && (
        <div className="absolute inset-x-0 bottom-0 z-[5] px-[var(--chat-horizontal-padding,24px)] pb-3.5 *:mx-auto *:max-w-[var(--chat-content-max-width,none)]" data-chat="composer" ref={eingabe}>
          {composer}
        </div>
      )}
    </div>
    </ChatSendContext.Provider>
  );
}
