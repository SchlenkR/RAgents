import { ArrowRightIcon } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import {
  Decoration, Diff, Hunk, isDelete, isInsert, isNormal, parseDiff, pickRanges, tokenize,
  type ChangeData, type FileData, type HunkData, type HunkTokens, type RangeTokenNode, type TokenNode,
} from "react-diff-view";
import { codeScrollbarClass, highlightTokens, resolveLanguage } from "./highlighting";
import { Empty } from "./ui";

const statusClasses = {
  A: "bg-success-soft text-success",
  D: "bg-destructive-soft text-destructive",
  M: "bg-info-soft text-info",
  R: "bg-warning-soft text-warning",
} as const;

interface DiffCodeProps {
  content: string;
  emptyText?: string;
  language?: string;
  path?: string;
}

export function DiffCode({ content, emptyText = "No textual diff available.", language, path }: DiffCodeProps) {
  const entries = useMemo(() => entriesOf(content, path), [content, path]);

  if (!entries.some((entry) => entry.file.hunks.length > 0 || noteOf(entry))) {
    return content
      ? <pre className="m-0 min-h-full min-w-max bg-transparent px-3 py-3 font-mono text-[length:calc(var(--text-sm)*0.95)] leading-[1.55] text-foreground [tab-size:4]">{content}</pre>
      : <Empty className="min-h-[100px] p-4 text-sm text-muted-foreground">{emptyText}</Empty>;
  }

  return (
    <div className="min-w-0">
      {entries.map((entry, index) => (
        <DiffFile
          emptyText={emptyText}
          entry={entry}
          key={`${entry.file.oldPath}-${entry.file.newPath}-${index}`}
          language={language}
          path={path}
          showName={entries.length > 1}
        />
      ))}
    </div>
  );
}

interface DiffEntry {
  readonly file: FileData;
  readonly notes: FileNotes;
}

interface FileNotes {
  readonly binary: boolean;
  readonly created: boolean;
  readonly deleted: boolean;
  readonly modes: readonly [string, string] | undefined;
  readonly renamed: boolean;
}

interface DiffFileProps {
  emptyText: string;
  entry: DiffEntry;
  language: string | undefined;
  path: string | undefined;
  showName: boolean;
}

function DiffFile({ emptyText, entry, language, path, showName }: DiffFileProps) {
  const { file } = entry;
  const filePath = path ?? pathOf(file);
  const tokens = useMemo(() => tokensFor(file, filePath, language), [file, filePath, language]);
  const digits = useMemo(() => digitsOf(file.hunks), [file.hunks]);
  const note = noteOf(entry);
  return (
    <section className="min-w-0">
      {showName && <FileHeader entry={entry} />}
      {file.hunks.length > 0
        ? (
            <div className={`overflow-x-auto ${codeScrollbarClass}`} style={{ "--diff-digits": digits } as CSSProperties}>
              <Diff diffType={file.type} hunks={file.hunks} tokens={tokens} viewType="unified">
                {(hunks) => hunks.flatMap((hunk) => [
                  <Decoration key={`decoration${hunkKey(hunk)}`}><HunkHeader hunk={hunk} /></Decoration>,
                  <Hunk key={`hunk${hunkKey(hunk)}`} hunk={hunk} />,
                ])}
              </Diff>
            </div>
          )
        : showName
          ? <p className="m-0 px-3 py-3 text-sm text-muted-foreground">{note ?? emptyText}</p>
          : <Empty className="min-h-[100px] p-4 text-sm text-muted-foreground">{note ?? emptyText}</Empty>}
    </section>
  );
}

function FileHeader({ entry }: { entry: DiffEntry }) {
  const { file } = entry;
  const status = statusOf(entry);
  const changes = file.hunks.flatMap((hunk) => hunk.changes);
  const added = changes.filter(isInsert).length;
  const removed = changes.filter(isDelete).length;
  return (
    <div className="sticky top-0 z-[2] flex min-h-9 min-w-0 items-center gap-3 border-y border-border bg-secondary px-3 py-2" data-status={status}>
      <span aria-label={statusLabels[status]} className={`inline-flex size-[1.2rem] shrink-0 items-center justify-center rounded-sm font-mono text-[0.74rem] font-bold ${statusClasses[status]}`} role="img" title={statusLabels[status]}>{status}</span>
      {status === "R" && (
        <>
          <FilePath muted path={file.oldPath} />
          <ArrowRightIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="sr-only">renamed to</span>
        </>
      )}
      <FilePath path={pathOf(file)} />
      {(added > 0 || removed > 0) && (
        <span className="ml-auto flex shrink-0 gap-2 pl-2 text-sm font-medium tabular-nums">
          {added > 0 && <span className="text-success">+{added}</span>}
          {removed > 0 && <span className="text-destructive">-{removed}</span>}
        </span>
      )}
    </div>
  );
}

function FilePath({ muted = false, path }: { muted?: boolean; path: string }) {
  const slash = path.lastIndexOf("/") + 1;
  return (
    <span className="flex min-w-0 font-mono text-[0.8rem]" title={path}>
      <span className="truncate text-muted-foreground">{path.slice(0, slash)}</span>
      <span className={muted ? "max-w-full shrink-0 truncate text-muted-foreground" : "max-w-full shrink-0 truncate font-semibold text-foreground"}>{path.slice(slash)}</span>
    </span>
  );
}

function HunkHeader({ hunk }: { hunk: HunkData }) {
  const [, range = hunk.content, section = ""] = /^(@@[^@]*@@)\s*(.*)$/.exec(hunk.content) ?? [];
  return (
    <div className="sticky left-0 flex w-max items-baseline gap-3 px-3 py-[0.2em]">
      <span className="text-muted-foreground">{range}</span>
      {section && <span className="text-foreground">{section}</span>}
    </div>
  );
}

const statusLabels = { A: "Added", D: "Deleted", M: "Modified", R: "Renamed" } as const;

const statusOf = ({ file, notes }: DiffEntry): keyof typeof statusLabels =>
  file.type === "add" || notes.created ? "A" : file.type === "delete" || notes.deleted ? "D" : file.type === "rename" || notes.renamed ? "R" : "M";

const pathOf = (file: FileData) => file.type === "delete" ? file.oldPath : file.newPath || file.oldPath;

const hunkKey = (hunk: HunkData) => `-${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines}`;

const digitsOf = (hunks: readonly HunkData[]) =>
  Math.max(2, ...hunks.map((hunk) => String(Math.max(hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines)).length));

const noteOf = ({ file, notes }: DiffEntry) => {
  if (file.hunks.length > 0) return undefined;
  if (notes.binary) return notes.created ? "Binary file added." : notes.deleted ? "Binary file deleted." : "Binary file changed; there is no text to compare.";
  if (notes.modes) return `File mode changed from ${notes.modes[0]} to ${notes.modes[1]}.`;
  if (file.type === "rename" || notes.renamed) return "Renamed without content changes.";
  if (notes.created) return "Empty file added.";
  if (notes.deleted) return "Empty file deleted.";
  return undefined;
};

const notesOf = (section: string): FileNotes => {
  const oldMode = /^old mode (\d+)$/m.exec(section)?.[1];
  const newMode = /^new mode (\d+)$/m.exec(section)?.[1];
  return {
    binary: /^(Binary files .* differ|GIT binary patch)$/m.test(section),
    created: /^new file mode /m.test(section),
    deleted: /^deleted file mode /m.test(section),
    modes: oldMode && newMode ? [oldMode, newMode] : undefined,
    renamed: /^rename from /m.test(section),
  };
};

const entriesOf = (content: string, path: string | undefined): readonly DiffEntry[] => {
  try {
    const files = parseDiff(withHeader(content, path));
    const sections = content.split(/^(?=diff --git )/m).filter((section) => section.startsWith("diff --git "));
    return files.map((file, index) => ({ file, notes: notesOf(sections.length === files.length ? sections[index] : "") }));
  } catch {
    return [];
  }
};

const withHeader = (content: string, path: string | undefined) =>
  /^(diff --git|--- )/m.test(content) || !content.startsWith("@@")
    ? content
    : `--- a/${path ?? "file"}\n+++ b/${path ?? "file"}\n${content}`;

const tokensFor = (file: FileData, path: string, language: string | undefined): HunkTokens | undefined => {
  const resolved = resolveLanguage(path, language);
  try {
    const tokens = tokenize(file.hunks, {
      enhancers: [wordEdits(file.hunks)],
      highlight: true,
      language: resolved ?? "plaintext",
      refractor: { highlight: (text: string) => highlightTokens(text, path, resolved ?? "plaintext") },
    });
    return { old: tokens.old.map(joinedEdits), new: tokens.new.map(joinedEdits) };
  } catch {
    return undefined;
  }
};

const joinedEdits = (nodes: readonly TokenNode[]) =>
  nodes.reduce<TokenNode[]>((joined, node) => {
    const previous = joined.at(-1);
    return previous?.type === "edit" && node.type === "edit"
      ? [...joined.slice(0, -1), { ...previous, children: [...(previous.children ?? []), ...(node.children ?? [])] }]
      : [...joined, node];
  }, []);

interface MarkToken {
  readonly line: number;
  readonly start: number;
  readonly text: string;
}

type Step = readonly ["equal", number, number] | readonly ["remove", number] | readonly ["add", number];

const MAX_CELLS = 250_000;

const MIN_SIMILARITY = 0.45;

const wordEdits = (hunks: readonly HunkData[]) => {
  const edits = hunks.flatMap((hunk) => changeBlocks(hunk.changes)).map(blockEdits);
  return pickRanges(edits.flatMap(([removed]) => removed), edits.flatMap(([, added]) => added));
};

const changeBlocks = (changes: readonly ChangeData[]) =>
  changes.flatMap((change, index) => isNormal(change) || (index > 0 && !isNormal(changes[index - 1])) ? [] : [blockFrom(changes, index)]);

const blockFrom = (changes: readonly ChangeData[], start: number) => {
  const end = changes.findIndex((change, index) => index > start && isNormal(change));
  return changes.slice(start, end === -1 ? undefined : end);
};

const markTokens = (changes: readonly ChangeData[]): MarkToken[] =>
  changes.flatMap((change) => isNormal(change)
    ? []
    : [...change.content.matchAll(/[\p{L}\p{N}_]+|\S/gu)].map((match) => ({ line: change.lineNumber, start: match.index, text: match[0] })));

const blockEdits = (block: readonly ChangeData[]): readonly [RangeTokenNode[], RangeTokenNode[]] => {
  const removed = markTokens(block.filter(isDelete));
  const added = markTokens(block.filter(isInsert));
  const steps = removed.length > 0 && added.length > 0 ? alignment(removed.map((token) => token.text), added.map((token) => token.text)) : undefined;
  if (!steps) return [[], []];
  const kept = semanticSteps(steps, removed, added);
  const equal = kept.filter((step) => step[0] === "equal").reduce((sum, step) => sum + removed[step[1]].text.length, 0);
  const total = [...removed, ...added].reduce((sum, token) => sum + token.text.length, 0);
  if ((2 * equal) / total < MIN_SIMILARITY) return [[], []];
  const removedMarks = new Set(kept.flatMap((step) => step[0] === "remove" ? [step[1]] : []));
  const addedMarks = new Set(kept.flatMap((step) => step[0] === "add" ? [step[1]] : []));
  return [rangesOf(removed, removedMarks), rangesOf(added, addedMarks)];
};

const alignment = (left: readonly string[], right: readonly string[]): Step[] | undefined => {
  const prefix = commonPrefix(left, right);
  const rows = left.length - prefix;
  const columns = right.length - prefix;
  if (rows * columns > MAX_CELLS) return undefined;
  const width = columns + 1;
  const lengths = new Uint16Array((rows + 1) * width);
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      lengths[row * width + column] = left[prefix + row] === right[prefix + column]
        ? lengths[(row + 1) * width + column + 1] + 1
        : Math.max(lengths[(row + 1) * width + column], lengths[row * width + column + 1]);
    }
  }
  const middle: Step[] = [];
  let row = 0;
  let column = 0;
  while (row < rows || column < columns) {
    if (row < rows && column < columns && left[prefix + row] === right[prefix + column]) middle.push(["equal", prefix + row++, prefix + column++]);
    else if (column >= columns || (row < rows && lengths[(row + 1) * width + column] >= lengths[row * width + column + 1])) middle.push(["remove", prefix + row++]);
    else middle.push(["add", prefix + column++]);
  }
  return [...Array.from({ length: prefix }, (_, index): Step => ["equal", index, index]), ...middle];
};

const commonPrefix = (left: readonly string[], right: readonly string[]) => {
  const limit = Math.min(left.length, right.length);
  return Array.from({ length: limit }, (_, index) => index).find((index) => left[index] !== right[index]) ?? limit;
};

const semanticSteps = (steps: readonly Step[], removed: readonly MarkToken[], added: readonly MarkToken[]): Step[] => {
  const runs = runsBy(steps, (step) => step[0] === "equal");
  const size = (run: readonly Step[], kind: Step[0]) =>
    run.reduce((sum, step) => step[0] === kind ? sum + (step[0] === "add" ? added : removed)[step[1]].text.length : sum, 0);
  const changeSize = (run: readonly Step[]) => Math.max(size(run, "remove"), size(run, "add"));
  return runs.flatMap((run, index) => run[0][0] === "equal" && index > 0 && index < runs.length - 1
    && size(run, "equal") <= changeSize(runs[index - 1]) && size(run, "equal") <= changeSize(runs[index + 1])
    ? run.flatMap((step): Step[] => step[0] === "equal" ? [["remove", step[1]], ["add", step[2]]] : [step])
    : run);
};

const rangesOf = (tokens: readonly MarkToken[], marked: ReadonlySet<number>): RangeTokenNode[] =>
  runsBy(tokens.map((token, index) => ({ ...token, marked: marked.has(index) })), (token) => token.line)
    .filter((line) => line.some((token) => !token.marked))
    .flatMap((line) => runsBy(line, (token) => token.marked)
      .filter((run) => run[0].marked)
      .map((run) => ({ type: "edit", lineNumber: run[0].line, start: run[0].start, length: run[run.length - 1].start + run[run.length - 1].text.length - run[0].start })));

const runsBy = <T,>(items: readonly T[], key: (item: T) => unknown): T[][] => {
  const starts = items.flatMap((item, index) => index === 0 || key(item) !== key(items[index - 1]) ? [index] : []);
  return starts.map((start, index) => items.slice(start, starts[index + 1]));
};
