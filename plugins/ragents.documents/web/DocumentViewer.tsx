import { ArrowLeftIcon, XIcon } from "lucide-react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  ImagePreview,
  ImagePreviewGroup,
  InteractiveItem,
  Spinner,
} from "@ragents/web/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Markdown, QuasselProvider, type Message } from "quassel";
import { formatBytes } from "@ragents/web/lib/format";
import { SourceCode } from "@ragents/web/SourceCode";
import { useDocumentGrants, type GrantSnapshot } from "./grants";
import { baseAddressOf, documentUrlResolver, grantedAddressOf, htmlWithBase, type AddressState, type DocumentBase } from "./links";

export type DocumentFormat = "markdown" | "text" | "html" | "image" | "binary";

const copyClass = "grid min-w-0 gap-px";
const titleClass = "truncate text-[0.82rem] font-semibold";
const metaClass = "text-[0.68rem] text-muted-foreground tabular-nums";
const sourceClass = "min-w-0 p-0 whitespace-pre-wrap break-words";
const groupBadgeClass = "flex size-7 items-center justify-center rounded-[9px] text-[0.62rem] font-bold tracking-[0.02em]";

export interface RunDocument {
  id: string;
  title: string;
  format: DocumentFormat;
  content?: string;
  contentUrl?: string;
  /** Where relative addresses inside the document point; without it they stay as written. */
  base?: DocumentBase;
  createdAt?: string;
  size?: number;
  meta?: string;
}

export interface DocumentSection {
  id: string;
  label: string;
  kind: "store" | "results" | "chat";
  documents: RunDocument[];
}

const formatLabels: Record<DocumentFormat, string> = {
  markdown: "Markdown",
  text: "Text",
  html: "HTML",
  image: "Image",
  binary: "File",
};

const formatByExtension: Record<string, DocumentFormat> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".html": "html",
  ".htm": "html",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".svg": "image",
  ".webp": "image",
  ".pdf": "binary",
  ".zip": "binary",
  ".gz": "binary",
  ".tar": "binary",
  ".xlsx": "binary",
  ".docx": "binary",
  ".bin": "binary",
};

export const formatFromName = (name: string): DocumentFormat => {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "text" : formatByExtension[name.slice(dot).toLowerCase()] ?? "text";
};

export const formatOf = (mediaType: string): DocumentFormat =>
  mediaType.includes("html")
    ? "html"
    : mediaType.includes("markdown")
      ? "markdown"
      : mediaType.startsWith("image/")
        ? "image"
        : mediaType.startsWith("text/") || mediaType.includes("json") || mediaType.includes("xml")
          ? "text"
          : "binary";

const formatTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

export const documentMessagesFrom = (
  messages: readonly Message[],
  conversations: Readonly<Record<string, readonly Message[]>> = {},
): Message[] => [...new Map([...Object.values(conversations).flat(), ...messages]
  .filter((message) => message.tool?.name === "show_document")
  .map((message) => [message.tool!.id, message])).values()];

export const documentsFrom = (messages: Message[]): RunDocument[] =>
  messages.flatMap((message) => {
    const tool = message.tool;
    if (tool?.name !== "show_document") return [];
    try {
      const args = JSON.parse(tool.arguments) as { title?: unknown; content?: unknown; format?: unknown };
      if (typeof args.title !== "string" || typeof args.content !== "string") return [];
      const format = args.format === "text" || args.format === "html" ? args.format : "markdown";
      return [{ id: tool.id, title: args.title, content: args.content, format }];
    } catch {
      return [];
    }
  });

type LoadState = { text: string } | { error: string } | undefined;

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

const failureOf = async (response: Response): Promise<Error> => {
  const body = await response.json().catch(() => undefined) as { error?: unknown } | undefined;
  return new Error(typeof body?.error === "string" ? body.error : `Status ${response.status}`);
};

const useDocumentContent = (document: RunDocument | undefined): LoadState => {
  const [cache, setCache] = useState<Record<string, LoadState>>({});
  const textual = document?.format === "markdown" || document?.format === "text" || document?.format === "html";
  const url = document?.content === undefined && textual ? document?.contentUrl : undefined;

  useEffect(() => {
    if (!url || cache[url]) return;
    let alive = true;
    void fetch(url, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw await failureOf(response);
        return response.text();
      })
      .then((text) => alive && setCache((current) => ({ ...current, [url]: { text } })))
      .catch((error: unknown) => alive && setCache((current) => ({
        ...current,
        [url]: { error: messageOf(error) },
      })));
    return () => {
      alive = false;
    };
  }, [url, cache]);

  if (!document) return undefined;
  if (document.content !== undefined) return { text: document.content };
  if (!textual) return { text: "" };
  return url ? cache[url] : undefined;
};

interface DocumentToolCallProps {
  active: boolean;
  document: RunDocument;
  onOpen: () => void;
  status: "error" | "ready" | "running";
}

export function DocumentToolCall({ active, document, onOpen, status }: DocumentToolCallProps) {
  const lineCount = useMemo(
    () => !document.content ? 0 : document.content.split(/\r\n|\r|\n/).length,
    [document.content],
  );
  const statusLabel = status === "error"
    ? "Error"
    : status === "running"
      ? "Opening"
      : active
        ? "Opened"
        : "Open";

  return (
    <InteractiveItem
      aria-pressed={active}
      className="group/call grid w-[min(100%,620px)] grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border bg-[color-mix(in_srgb,var(--background)_95%,var(--primary))] px-3.5 py-3 text-left shadow-sm duration-100 data-[status=error]:border-destructive/45 max-[620px]:grid-cols-[38px_minmax(0,1fr)_auto] max-[620px]:gap-2.5 max-[620px]:px-2.5 max-[620px]:py-2.5"
      data-status={status}
      onClick={onOpen}
      type="button"
    >
      <span className="flex h-12 w-[42px] items-center justify-center rounded-lg border border-primary/25 bg-primary/12 text-primary group-data-[status=error]/call:text-destructive max-[620px]:h-11 max-[620px]:w-[38px]">
        <IconDocument size={22} />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[0.62rem] font-semibold tracking-[0.05em] text-primary uppercase group-aria-pressed/call:text-selected-foreground">Document</span>
        <strong className="truncate text-[0.84rem] leading-[1.35]" title={document.title}>{document.title}</strong>
        <span className="text-[0.7rem] leading-[1.35] text-muted-foreground">
          {document.content === undefined
            ? formatLabels[document.format]
            : `${formatLabels[document.format]}, ${lineCount.toLocaleString()} ${lineCount === 1 ? "line" : "lines"}`}
        </span>
      </span>
      <span className="flex items-center gap-1 text-[0.7rem] font-semibold text-primary group-aria-pressed/call:text-selected-foreground group-data-[status=error]/call:text-destructive">
        <span className="max-[620px]:sr-only">{statusLabel}</span>
        {status === "running" ? <Spinner className="size-3" /> : status === "error" ? <IconError /> : <IconOpen />}
      </span>
    </InteractiveItem>
  );
}

/** A result lies outside the content route and its grants: with a token its bytes load with the page's sign-in and show under a blob address. */
const useBlobAddress = (url: string | undefined): AddressState => {
  const [state, setState] = useState<{ url: string; value: AddressState }>();

  useEffect(() => {
    if (url === undefined) return;
    let alive = true;
    let objectUrl: string | undefined;
    void fetch(url, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw await failureOf(response);
        return response.blob();
      })
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ url, value: { url: objectUrl } });
      })
      .catch((error: unknown) => alive && setState({ url, value: { error: messageOf(error) } }));
    return () => {
      alive = false;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return url !== undefined && state?.url === url ? state.value : undefined;
};

/** Where an image or a download loads from: with a cookie the route itself, with a token the grant of its root or, for a result, its bytes. */
const useFileAddress = (url: string | undefined, base: DocumentBase | undefined, grants: GrantSnapshot | undefined): AddressState => {
  const blob = useBlobAddress(url !== undefined && grants !== undefined && base === undefined ? url : undefined);
  if (url === undefined || grants === undefined) return url === undefined ? undefined : { url };
  return base === undefined ? blob : grantedAddressOf(base, url, grants);
};

type FrameGrant = { grant?: string } | { error: string } | undefined;

/** With a token an HTML document reaches its files through the grant of its root and keeps the one it opened with until its file changes, so that a renewal does not reload it. */
const useFrameGrant = (document: RunDocument, grants: GrantSnapshot | undefined): FrameGrant => {
  const base = document.base;
  const current: FrameGrant = document.format === "html" && base !== undefined && grants !== undefined ? grants.grantFor(base.runId, base.root) : {};
  const [opened, setOpened] = useState<{ key: string; grant: string }>();
  const key = `${document.id}\n${document.contentUrl ?? ""}`;
  const ready = current !== undefined && "grant" in current ? current.grant : undefined;
  if (ready !== undefined && opened?.key !== key) setOpened({ key, grant: ready });
  return opened?.key === key ? { grant: opened.grant } : current;
};

/** A document without a base keeps its addresses as written, also inside a run whose chat resolves them. */
const keepUrl = (url: string): string => url;

function ContentLoading() {
  return (
    <div className="flex items-center justify-center gap-2.5 p-9 text-[0.76rem] text-muted-foreground">
      <Spinner className="size-3" />
      <span>Loading</span>
    </div>
  );
}

function ContentFailure({ failure }: { failure: string }) {
  return (
    <Empty className="min-h-30 gap-2 p-7">
      <EmptyHeader>
        <EmptyMedia><IconError /></EmptyMedia>
        <EmptyTitle>Content not readable</EmptyTitle>
        <EmptyDescription>{failure}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function DocumentContent({ document, loaded }: { document: RunDocument; loaded: LoadState }) {
  const grants = useDocumentGrants();
  const base = document.base;
  const routePrefix = base?.routePrefix;
  const runId = base?.runId;
  const folder = base?.folder;
  const root = base?.root;
  const resolveUrl = useMemo(
    () => routePrefix !== undefined && runId !== undefined && folder !== undefined && root !== undefined
      ? documentUrlResolver({ routePrefix, runId, folder, root }, grants)
      : keepUrl,
    [routePrefix, runId, folder, root, grants],
  );
  const fileUrl = document.format === "image" || document.format === "binary" ? document.contentUrl : undefined;
  const file = useFileAddress(fileUrl, base, grants);
  const grant = useFrameGrant(document, grants);
  if (fileUrl !== undefined) {
    if (file === undefined) return <ContentLoading />;
    if ("error" in file) return <ContentFailure failure={file.error} />;
    if (document.format === "image") {
      return <ImagePreview className="block max-w-full border border-border" fileName={document.title} src={file.url} />;
    }
    return (
      <Empty className="min-h-30 gap-2 p-7">
        <EmptyHeader>
          <EmptyMedia><IconDocument /></EmptyMedia>
          <EmptyTitle>No preview for this format</EmptyTitle>
        </EmptyHeader>
        <EmptyContent>
          <Button render={<a download={document.title} href={file.url} />} size="sm" variant="outline">Download</Button>
        </EmptyContent>
      </Empty>
    );
  }
  const failure = loaded && "error" in loaded ? loaded.error : grant && "error" in grant ? grant.error : undefined;
  if (failure !== undefined) return <ContentFailure failure={failure} />;
  if (!loaded || "error" in loaded || !grant || "error" in grant) return <ContentLoading />;
  if (document.format === "html") {
    // Scripts stay off; the app's origin lets the sign-in cookie reach the images the document names, a grant in the base does so without one.
    const html = base ? htmlWithBase(loaded.text, baseAddressOf(base, grant.grant)) : loaded.text;
    return <iframe className="h-full min-h-full w-full border-0 bg-white" sandbox="allow-same-origin" srcDoc={html} title={document.title} />;
  }
  if (document.format === "text") {
    return <SourceCode className={sourceClass} content={loaded.text} path={document.title} />;
  }
  // quassel resolves an address only when its Markdown mounts, so a changed grant mounts it again.
  return <ImagePreviewGroup><QuasselProvider resolveUrl={resolveUrl}><Markdown key={grants?.revision} text={loaded.text} /></QuasselProvider></ImagePreviewGroup>;
}

function DocumentHead({ document }: { document: RunDocument }) {
  const meta = [
    formatLabels[document.format],
    document.size !== undefined ? formatBytes(document.size) : undefined,
    document.createdAt ? formatTime(document.createdAt) : undefined,
    document.meta,
  ].filter(Boolean);

  return (
    <>
      <strong className={titleClass} title={document.title}>{document.title}</strong>
      <span className={metaClass}>{meta.join(" · ")}</span>
    </>
  );
}

interface DocumentModalProps {
  document: RunDocument;
  onClose: () => void;
}

export function DocumentModal({ document, onClose }: DocumentModalProps) {
  const loaded = useDocumentContent(document);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="w-[min(1080px,calc(100%-2*clamp(16px,calc(var(--ragents-viewport-width,100vw)*0.05),72px)))] gap-0 rounded-panel border border-border bg-card p-0 shadow-pop" scope="run" showCloseButton={false} size="full">
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3.5 py-3">
        <span className="flex size-8 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--primary)_12%,var(--background))] text-primary"><IconDocument size={20} /></span>
        <DialogTitle className={copyClass} render={<span />}>
          <DocumentHead document={document} />
        </DialogTitle>
        <Button aria-label="Close" className="rounded-full" onClick={onClose} size="icon" title="Close" variant="outline">
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[clamp(18px,calc(var(--ragents-viewport-width,100vw)*0.04),54px)] pt-5 pb-10 text-[13.5px] leading-[1.65]">
        <DocumentContent document={document} loaded={loaded} />
      </div>
    </DialogContent>
    </Dialog>
  );
}

interface DocumentPanelProps {
  activeId: string | undefined;
  sections: DocumentSection[];
  truncated: boolean;
  onSelect: (id: string | undefined) => void;
}

export function DocumentPanel({ activeId, sections, truncated, onSelect }: DocumentPanelProps) {
  const active = sections.flatMap((section) => section.documents).find((document) => document.id === activeId);
  const loaded = useDocumentContent(active);
  const [modalOpen, setModalOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!active) setModalOpen(false);
  }, [active]);

  if (sections.every((section) => section.documents.length === 0)) {
    return (
      <Empty className="h-full gap-2 p-7">
        <EmptyHeader>
          <EmptyMedia><IconDocument /></EmptyMedia>
          <EmptyTitle>No documents yet</EmptyTitle>
          <EmptyDescription>Files from the run's store, results, and documents shown in chat collect here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!active) {
    return (
      <div className="flex h-full flex-col gap-3.5 overflow-y-auto px-workspace-inset pt-2.5 pb-4.5 [scrollbar-width:thin]">
        {sections.filter((section) => section.documents.length > 0).map((section) => {
          const open = !collapsed.has(section.id);
          return (
            <section key={section.id}>
              <button
                aria-expanded={open}
                className="grid w-full grid-cols-[14px_26px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-primary/7"
                onClick={() => toggle(section.id)}
                type="button"
              >
                <span aria-hidden className={`flex text-muted-foreground transition-transform duration-150${open ? " rotate-90" : ""}`}>
                  <IconChevron />
                </span>
                {section.kind === "store" && <span aria-hidden className={`${groupBadgeClass} bg-[color-mix(in_srgb,var(--foreground)_8%,var(--background))] text-[0.85rem] text-foreground`}>#</span>}
                {section.kind === "results" && <span aria-hidden className={`${groupBadgeClass} bg-[color-mix(in_srgb,var(--primary)_16%,var(--background))] text-primary`}><IconResult /></span>}
                {section.kind === "chat" && <span aria-hidden className={`${groupBadgeClass} bg-[color-mix(in_srgb,var(--foreground)_9%,var(--background))] text-muted-foreground`}><IconChat /></span>}
                <span className="truncate text-sm font-semibold" title={section.label}>{section.label}</span>
                <Badge className="tabular-nums" variant="secondary">{section.documents.length}</Badge>
              </button>
              {open && (
                <div className="ml-[23px] border-l border-border-soft pl-2.5">
                  <ul className="mt-0.5 list-none">
                    {section.documents.map((document) => (
                      <li key={document.id}>
                        <button
                          className="group/entry mt-1.5 grid w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2.5 text-left transition-colors duration-100 hover:border-primary/55 hover:bg-[color-mix(in_srgb,var(--primary)_7%,var(--card))]"
                          onClick={() => onSelect(document.id)}
                          type="button"
                        >
                          <span className="flex text-primary"><IconDocument size={18} /></span>
                          <span className="grid min-w-0 gap-0.5">
                            <strong className="truncate text-[0.79rem] font-semibold" title={document.title}>{document.title}</strong>
                            <small className={metaClass}>
                              {[
                                formatLabels[document.format],
                                document.size !== undefined ? formatBytes(document.size) : undefined,
                                document.createdAt ? formatTime(document.createdAt) : undefined,
                                document.meta,
                              ].filter(Boolean).join(" · ")}
                            </small>
                          </span>
                          <span aria-hidden className="flex text-muted-foreground opacity-0 transition-opacity duration-100 group-hover/entry:opacity-100"><IconOpen /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
        {truncated && <p className="text-[0.72rem] text-muted-foreground">The store contains more files than are shown here.</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border-soft px-workspace-inset py-2.5">
        <Button aria-label="Back to overview" onClick={() => onSelect(undefined)} size="icon-sm" title="Back to overview" variant="outline">
          <ArrowLeftIcon />
        </Button>
        <span className={copyClass}>
          <DocumentHead document={active} />
        </span>
        {active.format !== "image" && <Button onClick={() => setModalOpen(true)} size="sm" variant="outline">Expand document</Button>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-workspace-inset py-4 text-[13px] leading-[1.6]">
        <DocumentContent document={active} loaded={loaded} />
      </div>
      {modalOpen && <DocumentModal document={active} onClose={() => setModalOpen(false)} />}
    </div>
  );
}

function IconDocument({ size = 28 }: { size?: number }) {
  return (
    <svg aria-hidden fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width={size}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h4M9 13h6M9 17h4" />
    </svg>
  );
}

function IconOpen() {
  return (
    <svg aria-hidden fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg aria-hidden fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg aria-hidden fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z" />
    </svg>
  );
}

function IconResult() {
  return (
    <svg aria-hidden fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function IconError() {
  return (
    <svg aria-hidden fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="14">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </svg>
  );
}
