import { ACCESS_TOKEN_QUERY } from "../../../packages/ragents/src/access";

export { ACCESS_TOKEN_QUERY };

let installed: string | undefined;

const sameOrigin = (url: string, browser: Window): boolean => new URL(url, browser.location.href).origin === browser.location.origin;

/**
 * Hält den Zugangstoken einer Seite, die ohne Anmeldecookie läuft (iframe in einem VS-Code-Webview):
 * jeder Abruf an den eigenen Server trägt ihn als Bearer, Adressen ohne Header (Ereignisstrom, Frames) als Abfrageparameter.
 */
export function installAccessToken(token: string, browser: Window = window): void {
  if (!token) throw new Error("Der Zugangstoken ist leer.");
  if (installed !== undefined) throw new Error("Der Zugangstoken ist bereits installiert.");
  installed = token;
  const original = browser.fetch.bind(browser);
  browser.fetch = (input, init) => {
    const request = new Request(typeof input === "string" || input instanceof URL ? new URL(input, browser.location.href) : input, init);
    if (sameOrigin(request.url, browser) && !request.headers.has("authorization")) request.headers.set("authorization", `Bearer ${token}`);
    return original(request);
  };
}

export const accessTokenInstalled = (): boolean => installed !== undefined;

/** Hängt den installierten Token an eine Serveradresse an; ohne Token bleibt die Adresse unverändert. */
export function withAccessToken(path: string): string {
  if (installed === undefined) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${ACCESS_TOKEN_QUERY}=${encodeURIComponent(installed)}`;
}
