import { errorFrom } from "@aicontainer/web/lib/http";
import {
  browseListingPath,
  browsePreviewPath,
  type BrowseListing,
  type BrowsePreview,
  type BrowseRoot,
} from "../contract";

export const fetchBrowseListing = async (
  routePrefix: string,
  runId: string,
  root: BrowseRoot,
  directory: string,
): Promise<BrowseListing> => {
  const response = await fetch(browseListingPath(routePrefix, runId, root, directory), { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response, "Das Verzeichnis konnte nicht geladen werden");
  return await response.json() as BrowseListing;
};

export const fetchBrowsePreview = async (
  routePrefix: string,
  runId: string,
  root: BrowseRoot,
  file: string,
): Promise<BrowsePreview> => {
  const response = await fetch(browsePreviewPath(routePrefix, runId, root, file), { cache: "no-store" });
  if (!response.ok) throw await errorFrom(response, "Die Datei konnte nicht geladen werden");
  return await response.json() as BrowsePreview;
};
