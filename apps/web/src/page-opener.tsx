import { createContext, useContext } from "react";

/** Ein Host, der Webseiten außerhalb der Oberfläche zeigen kann, etwa VS Code im Simple Browser; ohne Host bleibt es beim eigenen Dialog mit iframe. */
export interface PageOpener {
  open(url: string, title: string): void;
}

const PageOpenerContext = createContext<PageOpener | undefined>(undefined);

export const PageOpenerProvider = PageOpenerContext.Provider;

export function useOptionalPageOpener(): PageOpener | undefined {
  return useContext(PageOpenerContext);
}
