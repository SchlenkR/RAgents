import {
  languageServerSnapshotPath,
  type LanguageServerSnapshot,
} from "@aicontainer/server/plugin-support/language-server/contract";
import { errorFrom } from "@aicontainer/web/lib/http";

export const fetchLanguageServerSnapshot = async (
  routePrefix: string,
  runId: string,
): Promise<LanguageServerSnapshot> => {
  const response = await fetch(languageServerSnapshotPath(routePrefix, runId), { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response, "Der Zustand des Sprachservers konnte nicht geladen werden");
  return await response.json() as LanguageServerSnapshot;
};
