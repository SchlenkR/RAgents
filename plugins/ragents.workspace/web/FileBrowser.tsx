import {
  Alert,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Toggle,
} from "@ragents/web/ui";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronRight, Eye, EyeOff, FolderOpen, RefreshCw } from "lucide-react";
import { workspaceAccessible, type WorkspaceTabContext } from "@ragents/web/PluginRegistry";
import { rpc } from "@ragents/web/rpc";
import { BROWSE_ROOTS, workspaceContracts, type BrowseListing, type BrowsePreview, type BrowseRoot } from "../contract";
import { fetchBrowseListing, fetchBrowsePreview } from "./api";
import { fileIconFor, fileToneClass } from "./file-icons";
import { SourceCode } from "@ragents/web/SourceCode";

const rowClass = "h-auto w-full justify-start gap-1.5 rounded-none py-[3px] pr-2.5 pl-(--row-indent) text-[0.7rem] font-normal data-selected:bg-primary/12 data-selected:text-primary";
const previewSourceClass = "min-w-0 px-2.5 pt-0 pb-2.5 text-xs leading-[1.45] whitespace-pre-wrap break-words";
const indent = (depth: number) => ({ "--row-indent": `${8 + depth * 12}px` }) as CSSProperties;

const rootLabels: Readonly<Record<BrowseRoot, string>> = {
  workspace: "Arbeitsverzeichnis",
  files: "Dateiablage",
};

const emptyHints: Readonly<Record<BrowseRoot, string>> = {
  workspace: "Im Arbeitsverzeichnis des Runs liegt noch nichts.",
  files: "In der Dateiablage des Runs liegt noch nichts.",
};

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause);

const sizeLabel = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const timeLabel = (value: string): string => {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value : at.toLocaleString("de-DE");
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
  const root: BrowseRoot = reachable ? chosenRoot : "files";
  const stateKey = `${runId}|${root}`;
  const [listings, setListings] = useState<ReadonlyMap<string, BrowseListing>>(() => new Map());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<string | undefined>();
  const [preview, setPreview] = useState<BrowsePreview>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const [showHidden, setShowHidden] = useState(false);

  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;

  const keyRef = useRef(stateKey);
  useEffect(() => {
    if (keyRef.current === stateKey) return;
    keyRef.current = stateKey;
    const saved = treeMemory.current.get(stateKey);
    setListings(new Map());
    setExpanded(saved?.expanded ?? new Set());
    setSelected(saved?.selected);
    setPreview(undefined);
    setError(undefined);
  }, [stateKey]);

  useEffect(() => {
    treeMemory.current.set(stateKey, { expanded, selected });
  }, [expanded, root, runId, selected, stateKey]);

  useEffect(() => {
    if (!active || selected === undefined || preview !== undefined) return;
    let alive = true;
    void fetchBrowsePreview(runId, root, selected)
      .then((value) => alive && setPreview(value))
      .catch(() => alive && setSelected(undefined));
    return () => {
      alive = false;
    };
  }, [active, preview, root, runId, selected]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: number | undefined;
    let busy = false;

    const load = async (visible: boolean) => {
      if (busy) return;
      busy = true;
      if (visible) setPending(true);
      try {
        const targets = ["", ...expandedRef.current];
        const results = await Promise.all(targets.map(async (directory) => ({
          directory,
          listing: await fetchBrowseListing(runId, root, directory).catch((cause: unknown) =>
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
        setError(undefined);
      } catch (cause) {
        if (alive) setError(messageOf(cause));
      } finally {
        busy = false;
        if (alive) {
          if (visible) setPending(false);
          if (timer !== undefined) window.clearTimeout(timer);
          timer = window.setTimeout(() => void load(false), 30000);
        }
      }
    };

    const unsubscribe = rpc.subscribe(workspaceContracts.channels.browse, { runId, root }, () => void load(false));
    void load(true);
    return () => {
      alive = false;
      unsubscribe();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, reload, root, runId]);

  const toggleDirectory = (directory: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(directory)) next.delete(directory);
      else next.add(directory);
      return next;
    });
    if (listings.has(directory)) return;
    setPending(true);
    void fetchBrowseListing(runId, root, directory)
      .then((listing) => {
        setListings((current) => new Map(current).set(directory, listing));
        setError(undefined);
      })
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setPending(false));
  };

  const openFile = (file: string) => {
    setSelected(file);
    setPreview(undefined);
    setPending(true);
    void fetchBrowsePreview(runId, root, file)
      .then((value) => {
        setPreview(value);
        setError(undefined);
      })
      .catch((cause: unknown) => setError(messageOf(cause)))
      .finally(() => setPending(false));
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
                title={`${entry.name} - ${sizeLabel(entry.size)} - ${timeLabel(entry.modifiedAt)}`}
                variant="ghost"
              >
                <span className={`inline-flex w-3 flex-none items-center justify-center text-muted-foreground${open ? " [&>svg]:rotate-90" : ""}`}>
                  {entry.kind === "directory" ? <ChevronRight size={11} strokeWidth={2} /> : null}
                </span>
                <Icon aria-hidden className={`flex-none ${fileToneClass[tone]}`} size={14} strokeWidth={1.7} />
                <span className="min-w-0 flex-1 truncate text-left font-mono">{entry.name}</span>
                {entry.kind === "file" && <span className="flex-none text-[0.64rem] text-muted-foreground tabular-nums">{sizeLabel(entry.size)}</span>}
              </Button>
              {entry.kind === "directory" && open && renderLevel(full, depth + 1)}
            </div>
          );
        })}
        {listing.truncated && (
          <div className="py-1 pr-2.5 pl-(--row-indent) text-[0.64rem] text-muted-foreground" style={indent(depth)}>
            Weitere Einträge sind nicht gelistet.
          </div>
        )}
      </>
    );
  };

  const rootListing = listings.get("");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-2.5 py-2">
        <div className="flex min-w-0 flex-1 gap-1">
          {roots.map((value) => (
            <Toggle key={value} onPressedChange={() => setRoot(value)} pressed={value === root} size="sm" variant="outline">
              {rootLabels[value]}
            </Toggle>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Toggle
            aria-label={showHidden ? "Versteckte Einträge ausblenden" : "Versteckte Einträge anzeigen"}
            onPressedChange={setShowHidden}
            pressed={showHidden}
            size="sm"
            title={showHidden ? "Versteckte Einträge ausblenden" : "Versteckte Einträge anzeigen"}
          >
            {showHidden ? <Eye size={15} strokeWidth={1.8} /> : <EyeOff size={15} strokeWidth={1.8} />}
          </Toggle>
          <Button aria-label="Dateien aktualisieren" onClick={() => setReload((value) => value + 1)} size="icon" title="Aktualisieren" variant="ghost">
            <RefreshCw className={pending ? "animate-spin" : undefined} size={15} strokeWidth={1.8} />
          </Button>
        </div>
      </header>
      {error && (
        <Alert className="shrink-0 rounded-none border-x-0 border-t-0 border-b-border-soft bg-destructive/8 px-2.5 py-2 text-[0.68rem]" variant="destructive">
          {error}
        </Alert>
      )}
      {rootListing && <div className="truncate px-2.5 pt-0.5 pb-1.5 font-mono text-[0.66rem] text-muted-foreground" title={rootListing.location}>{rootListing.location}</div>}
      {rootListing && rootListing.entries.length === 0 && (
        <Empty className="min-h-30 flex-none gap-2 p-7">
          <EmptyHeader>
            <EmptyMedia><FolderOpen size={15} strokeWidth={1.7} /></EmptyMedia>
            <EmptyTitle>Keine Dateien</EmptyTitle>
            <EmptyDescription>{emptyHints[root]}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <div className="min-h-0 flex-1 overflow-auto pb-2">{renderLevel("", 0)}</div>
      {selected && (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border-soft">
          <div className="truncate px-2.5 py-1.5 font-mono text-[0.66rem] text-muted-foreground" title={selected}>{selected}</div>
          {preview && !preview.previewable && <div className="px-2.5 pb-2 text-[0.68rem] text-muted-foreground">{preview.reason}</div>}
          {preview && preview.previewable && (
            <div className="min-h-0 flex-1 overflow-auto">
              <SourceCode className={previewSourceClass} content={preview.content} path={selected} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
