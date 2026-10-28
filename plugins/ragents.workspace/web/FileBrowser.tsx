import {
  Alert,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "@ragents/web/ui";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight, Eye, EyeOff, FolderOpen, RefreshCw } from "lucide-react";
import { workspaceAccessible, type WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { rpc } from "@ragents/web/rpc";
import { BROWSE_ROOTS, workspaceContracts, type BrowseListing, type BrowsePreview, type BrowseRoot } from "../contract";
import { fetchBrowseListing, fetchBrowsePreview } from "./api";
import { fileIconFor, fileToneClass } from "./file-icons";
import { SourceCode } from "@ragents/web/SourceCode";
import { Markdown, QuasselProvider } from "@schlenkr/quassel";

const rowClass = "h-auto w-full justify-start gap-2 rounded-none py-1 pr-3 pl-(--row-indent) text-base font-normal";
const previewSourceClass = "min-w-0 px-3 pt-0 pb-3 whitespace-pre-wrap break-words";
const indent = (depth: number) => ({ "--row-indent": `${8 + depth * 12}px` }) as CSSProperties;
const keepUrl = (url: string): string => url;
type MarkdownView = "rendered" | "source";

const rootLabels: Readonly<Record<BrowseRoot, string>> = {
  workspace: "Working directory",
  files: "File storage",
};

const emptyHints: Readonly<Record<BrowseRoot, string>> = {
  workspace: "There is nothing in the run's working directory yet.",
  files: "There is nothing in the run's file storage yet.",
};

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const sizeLabel = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const timeLabel = (value: string): string => {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString();
};

interface BrowserMemory {
  expanded: ReadonlySet<string>;
  selected: string | undefined;
}

export function FileBrowserPanel({ active, session }: WorkspaceTabContext) {
  const runId = session.session.id;
  const treeMemory = useRef(new Map<string, BrowserMemory>());
  const reachable = workspaceAccessible(session.session);
  const roots: readonly BrowseRoot[] = reachable ? BROWSE_ROOTS : ["files"];
  const [chosenRoot, setRoot] = useState<BrowseRoot>("workspace");
  const [showHidden, setShowHidden] = useState(false);
  const [markdownView, setMarkdownView] = useState<MarkdownView>("rendered");
  const root: BrowseRoot = reachable ? chosenRoot : "files";
  return <RootBrowser key={JSON.stringify([runId, root])} active={active} runId={runId} root={root}
    roots={roots} setRoot={setRoot} memory={treeMemory.current} showHidden={showHidden} setShowHidden={setShowHidden}
    markdownView={markdownView} setMarkdownView={setMarkdownView} />;
}

function RootBrowser({ active, runId, root, roots, setRoot, memory, showHidden, setShowHidden, markdownView, setMarkdownView }: {
  active: boolean;
  runId: string;
  root: BrowseRoot;
  roots: readonly BrowseRoot[];
  setRoot: (root: BrowseRoot) => void;
  memory: Map<string, BrowserMemory>;
  showHidden: boolean;
  setShowHidden: (showHidden: boolean) => void;
  markdownView: MarkdownView;
  setMarkdownView: (view: MarkdownView) => void;
}) {
  const stateKey = JSON.stringify([runId, root]);
  const saved = memory.get(stateKey);
  const [listings, setListings] = useState<ReadonlyMap<string, BrowseListing>>(() => new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => saved?.expanded ?? new Set());
  const [selected, setSelected] = useState<string | undefined>(saved?.selected);
  const [preview, setPreview] = useState<BrowsePreview>();
  const [listingError, setListingError] = useState<string>();
  const [previewError, setPreviewError] = useState<string>();
  const [listingPending, setListingPending] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [previewRevision, setPreviewRevision] = useState(0);
  const pending = listingPending || previewPending;
  const error = previewError ?? listingError;

  useEffect(() => {
    memory.set(stateKey, { expanded, selected });
  }, [expanded, memory, selected, stateKey]);

  useEffect(() => {
    if (!active || selected === undefined || document.visibilityState === "hidden") return;
    let alive = true;
    const controller = new AbortController();
    setPreviewPending(true);
    setPreviewError(undefined);
    void fetchBrowsePreview(runId, root, selected, controller.signal)
      .then((value) => {
        if (alive) {
          setPreview((current) => current?.previewable && value.previewable && current.path === value.path && current.content === value.content ? current : value);
          setPreviewPending(false);
        }
      })
      .catch((cause: unknown) => {
        if (alive) {
          setPreviewError(messageOf(cause));
          setPreviewPending(false);
        }
      });
    return () => {
      alive = false;
      controller.abort();
    };
  }, [active, previewRevision, reload, root, runId, selected]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const controller = new AbortController();
    let timer: number | undefined;
    let busy = false;
    let queued = false;

    const load = async (visible: boolean) => {
      if (document.visibilityState === "hidden") return;
      if (busy) { queued = true; return; }
      busy = true;
      if (visible) setListingPending(true);
      try {
        const targets = ["", ...expanded];
        const results = await Promise.all(targets.map(async (directory) => ({
          directory,
          listing: await fetchBrowseListing(runId, root, directory, controller.signal).catch((cause: unknown) =>
            directory === "" ? Promise.reject(cause) : null),
        })));
        if (!alive) return;
        const gone = results.filter((result) => result.listing === null).map((result) => result.directory);
        setListings(new Map(results
          .filter((result) => result.listing !== null)
          .map((result) => [result.directory, result.listing as BrowseListing])));
        if (gone.length > 0) {
          setExpanded((current) => new Set([...current].filter((directory) =>
            !gone.some((missing) => directory === missing || directory.startsWith(`${missing}/`)))));
        }
        setListingError(undefined);
      } catch (cause) {
        if (alive) setListingError(messageOf(cause));
      } finally {
        busy = false;
        if (alive) {
          if (visible) setListingPending(false);
          if (queued) {
            queued = false;
            void load(false);
            return;
          }
          if (timer !== undefined) window.clearTimeout(timer);
          timer = window.setTimeout(() => void load(false), 30000);
        }
      }
    };

    const changed = () => {
      if (document.visibilityState === "hidden") return;
      setPreviewRevision((value) => value + 1);
      void load(false);
    };
    const unsubscribe = rpc.subscribe(workspaceContracts.channels.browse, { runId, root }, changed, setListingError);
    const connected = rpc.onConnected(changed);
    document.addEventListener("visibilitychange", changed);
    void load(true);
    return () => {
      alive = false;
      controller.abort();
      unsubscribe();
      connected();
      document.removeEventListener("visibilitychange", changed);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, expanded, reload, root, runId]);

  const toggleDirectory = (directory: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(directory)) next.delete(directory);
      else next.add(directory);
      return next;
    });
  };

  const openFile = (file: string) => {
    if (selected === file) return;
    setSelected(file);
    setPreview(undefined);
    setPreviewError(undefined);
  };

  const renderLevel = (directory: string, depth: number): ReactNode => {
    const listing = listings.get(directory);
    if (!listing) return null;
    const visible = showHidden ? listing.entries : listing.entries.filter((entry) => !entry.name.startsWith("."));
    return (
      <>
        {visible.map((entry) => {
          const full = directory ? `${directory}/${entry.name}` : entry.name;
          const open = expanded.has(full);
          const { Icon, tone } = fileIconFor(entry.name, entry.kind, open);
          return (
            <div key={full}>
              <Button
                className={rowClass}
                data-selected={selected === full}
                onClick={() => entry.kind === "directory" ? toggleDirectory(full) : openFile(full)}
                style={indent(depth)}
                aria-description={`${entry.name} - ${sizeLabel(entry.size)} - ${timeLabel(entry.modifiedAt)}`}
                variant="ghost"
              >
                <span className={`inline-flex w-3 flex-none items-center justify-center text-muted-foreground${open ? " [&>svg]:rotate-90" : ""}`}>
                  {entry.kind === "directory" ? <ChevronRight size={11} strokeWidth={2} /> : null}
                </span>
                <Icon aria-hidden className={`flex-none ${fileToneClass[tone]}`} size={14} strokeWidth={1.7} />
                <span className="min-w-0 flex-1 whitespace-normal wrap-anywhere text-left font-mono">{entry.name}</span>
                {entry.kind === "file" && <span className="flex-none text-sm text-muted-foreground tabular-nums">{sizeLabel(entry.size)}</span>}
              </Button>
              {entry.kind === "directory" && open && renderLevel(full, depth + 1)}
            </div>
          );
        })}
        {listing.truncated && (
          <div className="py-1 pr-3 pl-(--row-indent) text-sm text-muted-foreground" style={indent(depth)}>
            Further entries are not listed.
          </div>
        )}
      </>
    );
  };

  const rootListing = listings.get("");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-3 py-2">
        <ToggleGroup aria-label="File root" className="mr-auto" size="sm" value={[root]} onValueChange={([value]) => { if (value) setRoot(value); }}>
          {roots.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {rootLabels[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex items-center gap-1">
          <Toggle
            aria-label={showHidden ? "Hide hidden entries" : "Show hidden entries"}
            onPressedChange={setShowHidden}
            pressed={showHidden}
            size="sm"
            aria-description={showHidden ? "Hide hidden entries" : "Show hidden entries"}
          >
            {showHidden ? <Eye size={15} strokeWidth={1.8} /> : <EyeOff size={15} strokeWidth={1.8} />}
          </Toggle>
          <Button aria-label="Refresh files" aria-busy={pending} onClick={() => setReload((value) => value + 1)} size="icon" aria-description="Refresh" variant="ghost">
            <RefreshCw className={pending ? "animate-spin" : undefined} size={15} strokeWidth={1.8} />
          </Button>
        </div>
      </header>
      {error && (
        <Alert className="shrink-0 rounded-none border-x-0 border-t-0 border-b-border-soft bg-destructive/8 px-3 py-2 text-sm" variant="destructive">
          {error}
        </Alert>
      )}
      {rootListing && <div className="whitespace-normal wrap-anywhere px-3 pt-0.5 pb-2 font-mono text-sm text-muted-foreground" aria-label={rootListing.location}>{rootListing.location}</div>}
      {rootListing && rootListing.entries.length === 0 && (
        <Empty className="min-h-30 flex-none gap-2 p-6">
          <EmptyHeader>
            <EmptyMedia><FolderOpen size={15} strokeWidth={1.7} /></EmptyMedia>
            <EmptyTitle>No files</EmptyTitle>
            <EmptyDescription>{emptyHints[root]}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <div className="min-h-0 flex-1 overflow-auto pb-2">{renderLevel("", 0)}</div>
      {selected && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border-soft">
          <header className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="whitespace-normal wrap-anywhere font-mono text-sm text-muted-foreground" aria-label={selected}>{selected}</span>
            {/\.(md|markdown)$/i.test(selected) && (
              <ToggleGroup aria-label="Markdown view" size="sm" value={[markdownView]} onValueChange={([value]) => { if (value) setMarkdownView(value); }}>
                <ToggleGroupItem value="rendered">Rendered</ToggleGroupItem>
                <ToggleGroupItem value="source">Source</ToggleGroupItem>
              </ToggleGroup>
            )}
          </header>
          {previewPending && preview === undefined && <div className="px-3 pb-2 text-sm text-muted-foreground" role="status">Loading preview...</div>}
          {preview && !preview.previewable && <div className="px-3 pb-2 text-sm text-muted-foreground">{preview.reason}</div>}
          {preview && preview.previewable && (
            <div className="min-h-0 flex-1 overflow-auto">
              {/\.(md|markdown)$/i.test(selected) && markdownView === "rendered"
                ? <QuasselProvider resolveUrl={keepUrl}><div className="px-3 pb-3"><Markdown text={preview.content} /></div></QuasselProvider>
                : <SourceCode className={previewSourceClass} content={preview.content} path={selected} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
