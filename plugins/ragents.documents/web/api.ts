import { errorFrom } from "@aicontainer/web/lib/http";

export interface RunFileEntry {
  path: string;
  size: number;
  modifiedAt: string;
}

export interface RunFilesListing {
  groups: Array<{ directory: string; files: RunFileEntry[] }>;
  loose: RunFileEntry[];
  truncated: boolean;
}

export const runFileContentUrl = (routePrefix: string, runId: string, filePath: string): string =>
  `${routePrefix}/runs/${encodeURIComponent(runId)}/files/content?path=${encodeURIComponent(filePath)}`;

export const fetchRunFiles = async (routePrefix: string, runId: string): Promise<RunFilesListing> => {
  const response = await fetch(`${routePrefix}/runs/${encodeURIComponent(runId)}/files`, { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response, "Die Ablage konnte nicht geladen werden");
  return await response.json() as RunFilesListing;
};
