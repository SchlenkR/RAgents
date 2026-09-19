import {
  languageServerSnapshotContract,
  type LanguageServerSnapshot,
} from "@aicontainer/server/plugin-support/language-server/contract";
import { rpc } from "@aicontainer/web/rpc";

export const fetchLanguageServerSnapshot = (
  pluginId: string,
  runId: string,
): Promise<LanguageServerSnapshot> => rpc.call(languageServerSnapshotContract(pluginId), { runId });
