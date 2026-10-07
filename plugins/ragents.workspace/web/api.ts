import { rpc } from "@ragents/web/rpc";
import { workspaceContracts, type BrowseListing, type BrowsePreview, type BrowseRoot } from "../contract";

export const fetchBrowseListing = (runId: string, root: BrowseRoot, directory: string, signal?: AbortSignal): Promise<BrowseListing> =>
  rpc.call(workspaceContracts.browse.list, { runId, root, path: directory }, { signal });

export const fetchBrowsePreview = (runId: string, root: BrowseRoot, file: string, signal?: AbortSignal): Promise<BrowsePreview> =>
  rpc.call(workspaceContracts.browse.preview, { runId, root, path: file }, { signal });
