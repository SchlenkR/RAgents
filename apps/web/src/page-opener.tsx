import { createContext, useContext } from "react";

/** A host that can show web pages outside the UI, for example VS Code in the Simple Browser; without a host it stays with the built-in dialog with an iframe. */
export interface PageOpener {
  open(url: string, title: string): void;
}

const PageOpenerContext = createContext<PageOpener | undefined>(undefined);

export const PageOpenerProvider = PageOpenerContext.Provider;

export function useOptionalPageOpener(): PageOpener | undefined {
  return useContext(PageOpenerContext);
}
