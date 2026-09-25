import {
  languageServerSnapshotContract,
  languageServerSolutionsContract,
  languageServerSwitchContract,
  type LanguageServerSnapshot,
  type LanguageServerSolutions,
} from "@ragents/host/plugin-support/language-server/contract";
import { rpc } from "../rpc";

export const fetchLanguageServerSnapshot = (
  pluginId: string,
  runId: string,
): Promise<LanguageServerSnapshot> => rpc.call(languageServerSnapshotContract(pluginId), { runId });

export const fetchLanguageServerSolutions = (
  pluginId: string,
  runId: string,
): Promise<LanguageServerSolutions> => rpc.call(languageServerSolutionsContract(pluginId), { runId });

export const switchLanguageServerSolution = (
  pluginId: string,
  runId: string,
  root: string | null,
): Promise<LanguageServerSolutions> => rpc.call(languageServerSwitchContract(pluginId), { runId, root });
