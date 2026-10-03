import { rpc } from "@ragents/web/rpc";
import { documentsContracts, type RunFilesListing } from "../contract";

export const fetchRunFiles = (runId: string): Promise<RunFilesListing> =>
  rpc.call(documentsContracts.files, { runId });
