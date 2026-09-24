import {
  languageServerSnapshotContract,
  type LanguageServerSnapshot,
} from "@ragents/host/plugin-support/language-server/contract";
import { rpc } from "../rpc";

export const fetchLanguageServerSnapshot = (
  pluginId: string,
  runId: string,
): Promise<LanguageServerSnapshot> => rpc.call(languageServerSnapshotContract(pluginId), { runId });
