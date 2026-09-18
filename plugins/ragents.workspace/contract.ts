export const WORKSPACE_PLUGIN_ID = "ragents.workspace";

export const BROWSE_ROOTS = ["workspace", "files"] as const;
export type BrowseRoot = typeof BROWSE_ROOTS[number];

export const BROWSE_ENTRY_LIMIT = 500;
export const BROWSE_PREVIEW_LIMIT = 256 * 1024;

export interface BrowseEntry {
  name: string;
  kind: "directory" | "file";
  size: number;
  modifiedAt: string;
}

export interface BrowseListing {
  root: BrowseRoot;
  location: string;
  path: string;
  entries: BrowseEntry[];
  truncated: boolean;
}

export type BrowsePreview =
  | { root: BrowseRoot; path: string; size: number; previewable: true; content: string }
  | { root: BrowseRoot; path: string; size: number; previewable: false; reason: string };

export const browseRootOf = (value: unknown): BrowseRoot | undefined =>
  BROWSE_ROOTS.find((root) => root === value);

export const browseListingPath = (
  routePrefix: string,
  runId: string,
  root: BrowseRoot,
  directory: string,
): string =>
  `${routePrefix}/runs/${encodeURIComponent(runId)}/browse?root=${root}&path=${encodeURIComponent(directory)}`;

export const browseChannel = (runId: string, root: BrowseRoot): string => `browse:${runId}:${root}`;

export const browseChannelOf = (channel: string): { runId: string; root: BrowseRoot } | undefined => {
  const match = /^browse:([A-Za-z0-9_-]{1,64}):([a-z]+)$/.exec(channel);
  const root = match && browseRootOf(match[2]!);
  return match && root ? { runId: match[1]!, root } : undefined;
};

export const browsePreviewPath = (
  routePrefix: string,
  runId: string,
  root: BrowseRoot,
  file: string,
): string =>
  `${routePrefix}/runs/${encodeURIComponent(runId)}/browse/file?root=${root}&path=${encodeURIComponent(file)}`;
