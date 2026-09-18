import { useMemo } from "react";
import { Diff, markEdits, parseDiff, tokenize, type FileData, type HunkTokens } from "react-diff-view";
import { highlightTokens, resolveLanguage } from "./highlighting";
import { Empty } from "./ui";

const diffVariables = [
  "[--diff-font-family:var(--font-mono)]",
  "[--diff-background-color:transparent]",
  "[--diff-text-color:var(--foreground)]",
  "[--diff-gutter-insert-background-color:color-mix(in_srgb,var(--success)_34%,transparent)]",
  "[--diff-gutter-insert-text-color:var(--success)]",
  "[--diff-gutter-delete-background-color:color-mix(in_srgb,var(--destructive)_30%,transparent)]",
  "[--diff-gutter-delete-text-color:var(--destructive)]",
  "[--diff-code-insert-background-color:color-mix(in_srgb,var(--success)_18%,transparent)]",
  "[--diff-code-delete-background-color:color-mix(in_srgb,var(--destructive)_16%,transparent)]",
  "[--diff-code-insert-edit-background-color:color-mix(in_srgb,var(--success)_46%,transparent)]",
  "[--diff-code-delete-edit-background-color:color-mix(in_srgb,var(--destructive)_42%,transparent)]",
  "[--diff-selection-background-color:color-mix(in_srgb,var(--primary)_25%,transparent)]",
].join(" ");

interface DiffCodeProps {
  content: string;
  emptyText?: string;
  language?: string;
  path?: string;
}

export function DiffCode({ content, emptyText = "Keine textuelle Differenz verfügbar.", language, path }: DiffCodeProps) {
  const files = useMemo(() => {
    try {
      return parseDiff(withHeader(content, path), { nearbySequences: "zip" });
    } catch {
      return [];
    }
  }, [content, path]);

  if (files.length === 0 || files.every((file) => file.hunks.length === 0)) {
    return content
      ? <pre className="m-0 min-h-full min-w-max bg-transparent px-3 py-2.5 font-mono text-[11px] leading-[1.5] text-foreground [tab-size:4]">{content}</pre>
      : <Empty className="min-h-[100px] p-5 text-xs text-muted-foreground">{emptyText}</Empty>;
  }

  return (
    <div className={diffVariables}>
      {files.map((file, index) => (
        <DiffFile file={file} key={`${file.oldPath}-${file.newPath}-${index}`} language={language} path={path} showName={files.length > 1} />
      ))}
    </div>
  );
}

interface DiffFileProps {
  file: FileData;
  language: string | undefined;
  path: string | undefined;
  showName: boolean;
}

function DiffFile({ file, language, path, showName }: DiffFileProps) {
  const filePath = path ?? file.newPath ?? file.oldPath ?? "";
  const tokens = useMemo(() => tokensFor(file, filePath, language), [file, filePath, language]);
  return (
    <section>
      {showName && <div className="sticky top-0 z-[1] border-b border-border-soft bg-secondary px-2 py-1 font-mono text-[0.65rem] text-muted-foreground">
        {file.newPath || file.oldPath}
      </div>}
      <Diff diffType={file.type} hunks={file.hunks} tokens={tokens} viewType="unified" />
    </section>
  );
}

const withHeader = (content: string, path: string | undefined) =>
  /^(diff --git|--- )/m.test(content) || !content.startsWith("@@")
    ? content
    : `--- a/${path ?? "datei"}\n+++ b/${path ?? "datei"}\n${content}`;

const tokensFor = (file: FileData, path: string, language: string | undefined): HunkTokens | undefined => {
  const resolved = resolveLanguage(path, language);
  try {
    return tokenize(file.hunks, {
      enhancers: [markEdits(file.hunks, { type: "block" })],
      highlight: true,
      language: resolved ?? "plaintext",
      refractor: { highlight: (text: string) => highlightTokens(text, path, resolved ?? "plaintext") },
    });
  } catch {
    return undefined;
  }
};
