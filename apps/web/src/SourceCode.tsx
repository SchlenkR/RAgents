import { cn } from "cn";
import { useMemo } from "react";
import { highlightLines, highlightSource } from "./highlighting";

const sourceClasses = "m-0 min-h-full min-w-max bg-transparent px-3 py-2.5 font-mono text-[11px] leading-[1.5] text-foreground [tab-size:4]";

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
      <code className={`hljs block language-${highlighted.language}`}>
        {highlighted.lines.map((line, index) => (
          <span className="block" key={index}>
            <span className="mr-[0.9em] inline-block w-[2.4em] select-none text-right text-muted-foreground">{index + 1}</span>
            <span dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }} />
          </span>
        ))}
      </code>
    </pre>
  );
}
