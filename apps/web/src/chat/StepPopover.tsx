import { useMemo } from "react";
import { SparklesIcon, WrenchIcon, XIcon } from "lucide-react";
import { Button, cn, Popover, PopoverContent } from "../ui";
import { Message, prettyJson } from "./types";
import { ChatTexts } from "./texts";

const preClasses = "rounded-lg bg-secondary p-3 font-mono text-[11px] leading-[1.625] break-all whitespace-pre-wrap";

export function StepPopover({
  message,
  position,
  texts,
  toolArgumentsText,
  onClose,
}: {
  message: Message;
  position: { x: number; y: number };
  texts: ChatTexts;
  toolArgumentsText: (tool: NonNullable<Message["tool"]>) => string;
  onClose: () => void;
}) {
  const anchor = useMemo(() => ({
    getBoundingClientRect: () => new DOMRect(position.x, position.y, 0, 0),
    contextElement: document.documentElement,
  }), [position]);
  const tool = message.tool;
  const thinking = message.role === "thinking";
  const title = thinking ? texts.thinkingTitle : texts.toolTitle;

  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose(); }}>
      <PopoverContent
        align="start"
        anchor={anchor}
        aria-label={title}
        className={cn(
          "w-[min(680px,calc(100vw-32px))] gap-0 overflow-hidden p-0 text-[13px] shadow-pop",
          thinking ? "max-h-none" : "max-h-[min(70vh,620px)]",
        )}
        collisionPadding={16}
        side="bottom"
        sideOffset={10}
      >
        <div className="flex flex-none items-center gap-2 border-b border-border-soft px-4 py-2.5">
          {thinking ? (
            <SparklesIcon className="text-muted-foreground" size={14} />
          ) : (
            <WrenchIcon className={tool?.isError ? "text-destructive" : "text-muted-foreground"} size={14} />
          )}
          <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium">{title}</span>
          <Button aria-label={texts.close} className="flex-none" onClick={onClose} size="icon-sm" title={texts.close} variant="ghost">
            <XIcon />
          </Button>
        </div>
        <div className={cn("min-h-0 p-4", thinking ? "overflow-visible" : "overflow-auto")}>
          {thinking ? (
            <div className="text-sm leading-[1.625] whitespace-pre-wrap">{message.text}</div>
          ) : tool ? (
            <div className="flex flex-col gap-4">
              <div className="font-mono text-sm">{message.text}</div>
              <PopoverSection label={texts.argumentsLabel} value={toolArgumentsText(tool)} />
              {tool.result === undefined ? (
                <div className="text-sm text-muted-foreground">{texts.toolStillRunning}</div>
              ) : (
                <PopoverSection error={tool.isError} label={texts.resultLabel} value={prettyJson(tool.result)} />
              )}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PopoverSection({ label, value, error = false }: { label: string; value: string; error?: boolean }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-[0.04em] text-muted-foreground uppercase">{label}</h3>
      <pre className={cn(preClasses, error && "text-destructive")}>{value}</pre>
    </section>
  );
}
