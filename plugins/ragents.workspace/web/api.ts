import { rpc } from "@ragents/web/rpc";
import { workspaceContracts, type BrowseListing, type BrowsePreview, type BrowseRoot } from "../contract";

export const fetchBrowseListing = (runId: string, root: BrowseRoot, directory: string): Promise<BrowseListing> =>
  rpc.call(workspaceContracts.browse.list, { runId, root, path: directory });

export const fetchBrowsePreview = (runId: string, root: BrowseRoot, file: string): Promise<BrowsePreview> =>
  rpc.call(workspaceContracts.browse.preview, { runId, root, path: file });
