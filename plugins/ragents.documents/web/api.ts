import { rpc } from "@aicontainer/web/rpc";
import { documentsContracts, type RunFilesListing } from "../contract";

export const runFileContentUrl = (routePrefix: string, runId: string, filePath: string): string =>
  `${routePrefix}/runs/${encodeURIComponent(runId)}/files/content?path=${encodeURIComponent(filePath)}`;

export const fetchRunFiles = (runId: string): Promise<RunFilesListing> =>
  rpc.call(documentsContracts.files, { runId });
