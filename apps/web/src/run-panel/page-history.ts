import { useEffect, useState } from "react";
import { pageIn, withPage } from "./run-panel-location";

/** The open plugin page by its ID, which the registry may not know; in the browser the address follows it with one history entry per change, and back and forward set it. */
export function usePageHistory(browser: boolean, initial: string | undefined) {
  const [pageId, setPageId] = useState(initial);
  useEffect(() => {
    if (!browser || pageIn(window.location.search) === pageId) return;
    window.history.pushState(null, "", withPage(window.location.href, pageId));
  }, [browser, pageId]);
  useEffect(() => {
    if (!browser) return;
    const follow = () => setPageId(pageIn(window.location.search));
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, [browser]);
  return [pageId, setPageId] as const;
}
