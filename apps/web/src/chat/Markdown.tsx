import { createContext, ReactNode, useContext, useRef } from "react";
import { cn } from "cn";
import { Streamdown, type Components } from "streamdown";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "../ui";
import type { CodeBlockOptions } from "./options";
import { type ChatTexts, defaultTexts } from "./texts";
import { copyChatText, useChatAction } from "./useChatAction";

export type LinkClickHandler = (href: string, label: string) => boolean;

const LinkClickContext = createContext<LinkClickHandler | undefined>(undefined);
const CodeBlockContext = createContext<{ options?: CodeBlockOptions; texts: ChatTexts }>({ texts: defaultTexts });

export function MarkdownCodeBlocks({ children, options, texts }: { children: ReactNode; options?: CodeBlockOptions; texts: ChatTexts }) {
  return <CodeBlockContext.Provider value={{ options, texts }}>{children}</CodeBlockContext.Provider>;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const { options, texts } = useContext(CodeBlockContext);
  const code = useRef<HTMLPreElement>(null);
  const action = useChatAction();
  const label = action.status === "done" ? texts.copied : texts.copyCode;
  const block = <pre ref={code} data-chat="code-block"
    className={cn(scrollbar, "my-2 overflow-auto rounded-lg bg-secondary px-3 py-2 font-mono text-sm leading-relaxed in-data-[tone=on-color]:bg-black/30 in-data-[tone=on-color]:text-inherit")}
    style={{ maxHeight: options?.maxHeight, whiteSpace: options?.wrap ? "pre-wrap" : undefined, overflowWrap: options?.wrap ? "anywhere" : undefined }}>{children}</pre>;
  if (!options?.showCopyButton) return block;
  return <div className="relative">
    {block}
    <Button aria-label={label} className="absolute top-1 right-1 bg-secondary" disabled={action.status === "pending"} size="icon-sm" title={label} variant="ghost"
      onClick={() => { void action.invoke(() => copyChatText(code.current?.textContent ?? "", texts.clipboardUnavailable), texts.actionFailed); }}>
      {action.status === "done" ? <CheckIcon /> : <CopyIcon />}
    </Button>
    {action.error && <p className="text-sm text-destructive" role="alert">{action.error}</p>}
  </div>;
}

export function MarkdownLinks({ children, onLinkClick }: { children: ReactNode; onLinkClick?: LinkClickHandler }) {
  return <LinkClickContext.Provider value={onLinkClick}>{children}</LinkClickContext.Provider>;
}

function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const onLinkClick = useContext(LinkClickContext);
  if (!href || href === "streamdown:incomplete-link") {
    return <span>{children}</span>;
  }
  return (
    <a
      className="text-primary [text-underline-offset:2px] in-data-[tone=on-color]:text-inherit in-data-[tone=on-color]:underline"
      href={href}
      onClick={(event) => {
        if (href && onLinkClick?.(href, event.currentTarget.textContent ?? "")) {
          event.preventDefault();
        }
      }}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

// Waagerechte Rollbalken bleiben sichtbar - sonst ist der Ueberlauf nicht auffindbar.
const scrollbar = "[scrollbar-width:thin] [&::-webkit-scrollbar]:block [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border";

// Die Deckstreifen verbergen den Umbruch am Rand; --scroll-cover kommt aus der umgebenden Blase.
const scrollCover = "bg-[linear-gradient(to_right,var(--scroll-cover,var(--background))_50%,transparent)_left/20px_100%_no-repeat_local,linear-gradient(to_left,var(--scroll-cover,var(--background))_50%,transparent)_right/20px_100%_no-repeat_local,linear-gradient(to_right,#00000047,transparent)_left/14px_100%_no-repeat_scroll,linear-gradient(to_left,#00000047,transparent)_right/14px_100%_no-repeat_scroll]";

const headingClasses = "mt-3 mb-1 text-[15px] font-medium";
const cellClasses = "max-w-[44ch] border border-border px-2 py-1 text-left align-top in-data-[tone=on-color]:border-white/35";

const components: Components = {
  h1: ({ children }) => <h1 className="mt-3 mb-1 text-lg font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className={headingClasses}>{children}</h2>,
  h3: ({ children }) => <h3 className={headingClasses}>{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-base font-medium">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-2 mb-1 text-base font-medium">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 text-base font-medium">{children}</h6>,
  p: ({ children }) => <p className="[p+&]:mt-2">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-6 [li>&]:my-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-6 [li>&]:my-0">{children}</ol>,
  li: ({ children }) => <li className="marker:text-muted-foreground in-data-[tone=on-color]:marker:text-inherit">{children}</li>,
  hr: () => <hr className="my-3 border-t border-border" />,
  img: ({ src, alt }) => <img alt={alt} className="h-auto max-w-full" src={typeof src === "string" ? src : undefined} />,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-border pl-3 text-muted-foreground in-data-[tone=on-color]:border-white/50 in-data-[tone=on-color]:text-inherit">{children}</blockquote>
  ),
  strong: ({ children }) => <strong className="font-medium">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ children, className }) => (
    <code className={cn(className, "rounded-sm bg-secondary px-1 py-0.5 font-mono text-sm [overflow-wrap:anywhere] in-data-[tone=on-color]:bg-white/20 in-data-[tone=on-color]:text-inherit", "[pre>&]:bg-transparent [pre>&]:p-0")}>{children}</code>
  ),
  // Ohne max-content schrumpft die Tabelle auf den Container und stapelt Buchstaben.
  table: ({ children }) => (
    <div className={cn(scrollbar, scrollCover, "my-2 overflow-x-auto")}>
      <table className="w-max min-w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th className={cn(cellClasses, "bg-secondary font-medium in-data-[tone=on-color]:bg-white/15 in-data-[tone=on-color]:text-inherit")}>{children}</th>,
  td: ({ children }) => <td className={cellClasses}>{children}</td>,
};

function transformUrl(url: string) {
  if (/^ablauf:(actor|input|turn|subscription|action|artifact)\/.+/.test(url)) return url;
  const scheme = /^[^/?#]*:/.exec(url);
  return !scheme || /^(https?|mailto|tel|ftp|irc|ircs|xmpp):$/i.test(scheme[0]) ? url : "";
}

export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <Streamdown
      className="space-y-0 text-inherit"
      mode={streaming ? "streaming" : "static"}
      isAnimating={streaming}
      parseIncompleteMarkdown={streaming}
      components={components}
      controls={false}
      rehypePlugins={[]}
      urlTransform={transformUrl}
      skipHtml
    >
      {text}
    </Streamdown>
  );
}
