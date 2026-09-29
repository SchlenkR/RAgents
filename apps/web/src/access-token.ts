import { ACCESS_TOKEN_QUERY } from "../../../packages/ragents/src/access";

export { ACCESS_TOKEN_QUERY };

let installed: string | undefined;

const sameOrigin = (url: string, browser: Window): boolean => new URL(url, browser.location.href).origin === browser.location.origin;

/**
 * Holds the access token of a page that runs without a sign-in cookie (iframe in a VS Code webview):
 * every fetch to its own server carries it as a bearer, addresses without headers (event stream, frames) as a query parameter.
 */
export function installAccessToken(token: string, browser: Window = window): void {
  if (!token) throw new Error("The access token is empty.");
  if (installed !== undefined) throw new Error("The access token is already installed.");
  installed = token;
  const original = browser.fetch.bind(browser);
  browser.fetch = (input, init) => {
    const request = new Request(typeof input === "string" || input instanceof URL ? new URL(input, browser.location.href) : input, init);
    if (sameOrigin(request.url, browser) && !request.headers.has("authorization")) request.headers.set("authorization", `Bearer ${token}`);
    return original(request);
  };
}

export const accessTokenInstalled = (): boolean => installed !== undefined;

/** Appends the installed token to a server address; without a token the address stays unchanged. */
export function withAccessToken(path: string): string {
  if (installed === undefined) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${ACCESS_TOKEN_QUERY}=${encodeURIComponent(installed)}`;
}
