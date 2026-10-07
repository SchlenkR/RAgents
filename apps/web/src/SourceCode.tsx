import { cn } from "cn";
import { useMemo, type CSSProperties } from "react";
import { codeScrollbarClass, highlightLines, highlightSource } from "./highlighting";

const sourceClasses = `m-0 min-h-full min-w-max bg-transparent px-3 py-2.5 font-mono text-[length:calc(var(--text-sm)*0.95)] leading-[1.55] text-foreground [tab-size:4] ${codeScrollbarClass}`;

interface SourceCodeProps {
  className?: string;
  content: string;
  language?: string;
  lineNumbers?: boolean;
  path: string;
}

export function SourceCode({ className, content, language, lineNumbers = false, path }: SourceCodeProps) {
  return lineNumbers
    ? <NumberedSource className={className} content={content} language={language} path={path} />
    : <PlainSource className={className} content={content} language={language} path={path} />;
}

function PlainSource({ className, content, language, path }: Omit<SourceCodeProps, "lineNumbers">) {
  const highlighted = useMemo(() => {
    const result = highlightSource(content, path, language);
    return { language: result.language, content: { __html: result.html } };
  }, [content, language, path]);

  return (
    <pre className={cn(sourceClasses, className)} data-slot="source-code">
      <code className={`hljs block language-${highlighted.language}`} dangerouslySetInnerHTML={highlighted.content} />
    </pre>
  );
}

function NumberedSource({ className, content, language, path }: Omit<SourceCodeProps, "lineNumbers">) {
  const highlighted = useMemo(() => highlightLines(content.replace(/\n$/, ""), path, language), [content, language, path]);

  return (
    <pre className={cn(sourceClasses, className)} data-slot="source-code">
      <code className={`hljs block language-${highlighted.language}`} style={{ "--source-digits": Math.max(2, String(highlighted.lines.length).length) } as CSSProperties}>
        {highlighted.lines.map((line, index) => (
          <span className="block" key={index}>
            <span className="mr-[1.6ch] inline-block w-[calc(var(--source-digits)*1ch)] select-none text-right text-muted-foreground tabular-nums">{index + 1}</span>
            <span dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }} />
          </span>
        ))}
      </code>
    </pre>
  );
}
