import { rpc } from "@ragents/web/rpc";
import { documentsContracts, type RunFilesListing } from "../contract";

export const fetchRunFiles = (runId: string, signal?: AbortSignal): Promise<RunFilesListing> =>
  rpc.call(documentsContracts.files, { runId }, { signal });

export const fetchGrant = (runId: string, root: string): Promise<{ grant: string }> =>
  rpc.call(documentsContracts.grant, { runId, root });
