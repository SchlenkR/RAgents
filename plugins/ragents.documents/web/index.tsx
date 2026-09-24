import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ToolInfo } from "@ragents/web/chat/types";
import {
  DocumentPanel,
  DocumentToolCall,
  documentMessagesFrom,
  documentsFrom as documentsFromMessages,
  formatFromName,
  formatOf,
  type RunDocument as Document,
  type DocumentSection,
} from "./DocumentViewer";
import { fetchRunFiles, runFileContentUrl } from "./api";
import type { RunFileEntry, RunFilesListing } from "../contract";
import { runArtifactContentUrl, runViewFrom, type RunView } from "@ragents/web/run-view";
import { Alert, Badge } from "@ragents/web/ui";
import {
  pluginRoutePrefixFrom,
  type SessionContext,
  type SessionProviderProps,
  type ToolPresenterContext,
  type WebPlugin,
  type WebPluginDescriptor,
  type WorkspaceTabContext,
} from "@ragents/web/PluginRegistry";

export const DOCUMENTS_PLUGIN_ID = "ragents.documents";
export const DOCUMENTS_TAB_ID = "ragents.documents.library";

const pathArgumentsFrom = (tool: ToolInfo): { title: string; path: string; format?: string } | undefined => {
  if (tool.name !== "show_document") return undefined;
  try {
    const args = JSON.parse(tool.arguments) as { title?: unknown; path?: unknown; content?: unknown; format?: unknown };
    if (typeof args.title !== "string" || typeof args.path !== "string" || typeof args.content === "string") return undefined;
    return { title: args.title, path: args.path, ...(typeof args.format === "string" ? { format: args.format } : {}) };
  } catch {
    return undefined;
  }
};

const pathDocumentFrom = (tool: ToolInfo, routePrefix: string, runId: string): Document | undefined => {
  const args = pathArgumentsFrom(tool);
  if (!args) return undefined;
  const format = args.format === "markdown" || args.format === "text" || args.format === "html"
    ? args.format
    : formatFromName(args.path);
  return { id: tool.id, title: args.title, format, contentUrl: runFileContentUrl(routePrefix, runId, args.path) };
};

const chatDocumentFrom = (tool: ToolInfo, routePrefix: string, runId: string): Document | undefined =>
  documentsFromMessages([{
    key: tool.id,
    role: "tool",
    text: tool.name,
    tool,
  }])[0] ?? pathDocumentFrom(tool, routePrefix, runId);

const pathDocumentsFromMessages = (
  messages: SessionContext["messages"],
  routePrefix: string,
  runId: string,
): Document[] =>
  messages.flatMap((message) => {
    const tool = message.tool;
    if (!tool) return [];
    const document = pathDocumentFrom(tool, routePrefix, runId);
    return document ? [document] : [];
  });

interface RunFilesState {
  listing: RunFilesListing | undefined;
  error: string | undefined;
}

const RunFilesContext = createContext<RunFilesState | undefined>(undefined);

const useRunFilesContext = (): RunFilesState => {
  const state = useContext(RunFilesContext);
  if (!state) throw new Error("Dokumente-Plugin ist nicht aktiv");
  return state;
};

const useRunFiles = (session: SessionContext): RunFilesState => {
  const [listing, setListing] = useState<RunFilesListing>();
  const [error, setError] = useState<string>();
  const runId = session.session.id;

  useEffect(() => {
    let alive = true;
    const load = () => void fetchRunFiles(runId)
      .then((value) => {
        if (!alive) return;
        setListing(value);
        setError(undefined);
      })
      .catch((cause: unknown) => alive && setError(cause instanceof Error ? cause.message : String(cause)));
    load();
    if (!session.running) {
      return () => {
        alive = false;
      };
    }
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [runId, session.running]);

  return useMemo(() => ({ listing, error }), [listing, error]);
};

function DocumentsSessionProvider({ children, session }: SessionProviderProps) {
  const state = useRunFiles(session);
  return <RunFilesContext.Provider value={state}>{children}</RunFilesContext.Provider>;
}

const resultSection = (runId: string, view: RunView): DocumentSection => {
  const handles = new Map(view.actors.map((actor) => [actor.id, actor.handle]));
  return {
    id: "ergebnisse",
    label: "Ergebnisse",
    kind: "ergebnisse",
    documents: view.artifacts.map((artifact) => {
      const handle = handles.get(artifact.createdBy);
      return {
        id: artifact.id,
        title: artifact.title,
        format: formatOf(artifact.mediaType),
        contentUrl: runArtifactContentUrl(runId, artifact.id),
        createdAt: artifact.createdAt,
        size: artifact.size,
        ...(handle ? { meta: `@${handle}` } : {}),
      };
    }),
  };
};

const sectionsFrom = (
  routePrefix: string,
  session: SessionContext,
  listing: RunFilesListing | undefined,
): { sections: DocumentSection[]; truncated: boolean } => {
  const runId = session.session.id;
  const view = runViewFrom(session.runView);
  const fileDocument = (directory: string | undefined, entry: RunFileEntry): Document => {
    const relative = directory ? `${directory}/${entry.path}` : entry.path;
    return {
      id: `file:${relative}`,
      title: entry.path,
      format: formatFromName(entry.path),
      contentUrl: `${runFileContentUrl(routePrefix, runId, relative)}&v=${encodeURIComponent(entry.modifiedAt)}`,
      createdAt: entry.modifiedAt,
      size: entry.size,
    };
  };

  const sections: DocumentSection[] = [
    ...(listing?.groups ?? []).map((group) => ({
      id: `ablage/${group.directory}`,
      label: group.directory,
      kind: "ablage" as const,
      documents: group.files.map((entry) => fileDocument(group.directory, entry)),
    })),
    ...(listing && listing.loose.length > 0
      ? [{
          id: "ablage",
          label: "Ablage",
          kind: "ablage" as const,
          documents: listing.loose.map((entry) => fileDocument(undefined, entry)),
        }]
      : []),
    ...(view && view.artifacts.length > 0 ? [resultSection(runId, view)] : []),
  ];
  const documentMessages = documentMessagesFrom(session.messages, session.actorConversations);
  const chat = [
    ...documentsFromMessages(documentMessages),
    ...pathDocumentsFromMessages(documentMessages, routePrefix, session.session.id),
  ];
  if (chat.length > 0) sections.push({ id: "chat", label: "Im Chat gezeigt", kind: "chat", documents: chat });
  return { sections, truncated: listing?.truncated ?? false };
};

const contribution = (routePrefix: string) => {
  function DocumentsPanelContribution({ navigation, selection, session }: WorkspaceTabContext) {
    const { listing, error } = useRunFilesContext();
    const { sections, truncated } = useMemo(
      () => sectionsFrom(routePrefix, session, listing),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- session is rebuilt per render; only these parts matter
      [session.messages, session.actorConversations, session.runView, session.session.id, listing],
    );
    return (
      <>
        {error && (
          <Alert className="shrink-0 rounded-none border-x-0 border-t-0 border-b-border-soft bg-destructive/8 px-2.5 py-2 text-[0.68rem]" variant="destructive">
            {error}
          </Alert>
        )}
        <DocumentPanel
          activeId={typeof selection === "string" ? selection : undefined}
          sections={sections}
          truncated={truncated}
          onSelect={(id) => navigation.openTab(DOCUMENTS_TAB_ID, id ?? null)}
        />
      </>
    );
  }

  function DocumentsBadge({ session }: WorkspaceTabContext) {
    const { listing } = useRunFilesContext();
    const { sections } = useMemo(
      () => sectionsFrom(routePrefix, session, listing),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- session is rebuilt per render; only these parts matter
      [session.messages, session.actorConversations, session.runView, session.session.id, listing],
    );
    const count = sections.reduce((sum, section) => sum + section.documents.length, 0);
    return count > 0 ? <Badge className="tabular-nums" variant="secondary">{count}</Badge> : null;
  }

  return { DocumentsPanelContribution, DocumentsBadge };
};

function DocumentInline({ navigation, session, tool, routePrefix }: ToolPresenterContext & { routePrefix: string }) {
  const document = chatDocumentFrom(tool, routePrefix, session.session.id);
  if (!document) return null;
  const status = tool.isError ? "error" : tool.result === undefined ? "running" : "ready";
  return (
    <DocumentToolCall
      active={navigation.activeTabId === DOCUMENTS_TAB_ID && navigation.selectionFor(DOCUMENTS_TAB_ID) === document.id}
      document={document}
      onOpen={() => navigation.openTab(DOCUMENTS_TAB_ID, document.id)}
      status={status}
    />
  );
}

function IconDocument() {
  return (
    <svg aria-hidden fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24" width="15">
      <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 13h6M9 17h4" />
    </svg>
  );
}

const configuredPlugin = (descriptor: WebPluginDescriptor, routePrefix: string): WebPlugin => {
  const { DocumentsPanelContribution, DocumentsBadge } = contribution(routePrefix);
  return {
    ...descriptor,
    needsRunView: true,
    SessionProvider: DocumentsSessionProvider,
    workspaceTabs: [{
      id: DOCUMENTS_TAB_ID,
      label: "Dokumente",
      order: 200,
      Icon: IconDocument,
      Panel: DocumentsPanelContribution,
      Badge: DocumentsBadge,
    }],
    toolPresenters: [{
      toolName: "show_document",
      Inline: (props) => <DocumentInline {...props} routePrefix={routePrefix} />,
      reveal: (tool, session) => chatDocumentFrom(tool, routePrefix, session.session.id)
        ? { tabId: DOCUMENTS_TAB_ID, selection: tool.id }
        : undefined,
    }],
    entityPresenters: [{
      reveal: (entity) => entity.type === "artifact"
        ? { tabId: DOCUMENTS_TAB_ID, selection: entity.id }
        : undefined,
    }],
  };
};

const descriptor: WebPluginDescriptor = { id: DOCUMENTS_PLUGIN_ID };

export const webPlugin: WebPlugin = {
  ...descriptor,
  activate: (config) => configuredPlugin(descriptor, pluginRoutePrefixFrom(descriptor.id, config)),
};
