import { useEffect, useRef, type ReactNode, type Ref } from "react";
import { cn } from "cn";

/**
 * Verlauf mit ueberlagerter Eingabe. Der Rahmen misst die Eingabe selbst und
 * gibt dem Verlauf den noetigen Fussraum, damit kein Host Innenmasse setzen muss.
 */
export function ChatPanel({
  children,
  composer,
  className,
  nodeRef,
}: {
  children: ReactNode;
  /** Die Eingabe; sie liegt ueber dem Verlauf, nicht darunter. */
  composer?: ReactNode;
  className?: string;
  nodeRef?: Ref<HTMLDivElement>;
}) {
  const wurzel = useRef<HTMLDivElement>(null);
  const eingabe = useRef<HTMLDivElement>(null);
  const hasComposer = composer !== undefined;

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
    <div
      className={cn("relative flex min-h-0 min-w-0 flex-col overflow-hidden", className)}
      data-chat="panel"
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
        <div className="absolute inset-x-0 bottom-0 z-[5] px-6 pb-3.5 *:mx-auto *:max-w-composer" data-chat="composer" ref={eingabe}>
          {composer}
        </div>
      )}
    </div>
  );
}
