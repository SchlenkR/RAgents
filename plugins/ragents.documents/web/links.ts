import { contentPathOf, grantedPathOf, rootOfReference } from "../contract";
import type { GrantSnapshot } from "./grants";

/** Where the addresses inside a document point: its run, the folder of the document in it (encoded), and the root that folder lies in. */
export interface DocumentBase {
  routePrefix: string;
  runId: string;
  folder: string;
  /** The alias of the document's root, empty for the run's root. */
  root: string;
}

/** A document without a file of its own, such as text the model wrote, resolves against the run's root. */
export const documentBaseOf = (routePrefix: string, runId: string, reference = ""): DocumentBase => ({
  routePrefix,
  runId,
  folder: reference.slice(0, reference.lastIndexOf("/") + 1).split("/").map(encodeURIComponent).join("/"),
  root: rootOfReference(reference),
});

/** The address relative addresses of the document start from; with a grant the one that carries it in its path. */
export const baseAddressOf = (base: DocumentBase, grant?: string): string =>
  `${grant === undefined ? contentPathOf(base.routePrefix, base.runId, "") : grantedPathOf(base.routePrefix, base.runId, grant, "")}${base.folder}`;

const ORIGIN = "http://document.invalid";

/** Anchors, schemes, and addresses from the site root stay as they are. */
const kept = (url: string): boolean => url === "" || url.startsWith("#") || url.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);

/** A relative address resolves against the document's folder, one with an alias against that root, both with plain URL semantics. */
export const resolveDocumentUrl = (base: DocumentBase, url: string): string => {
  if (kept(url)) return url;
  const resolved = new URL(url, `${ORIGIN}${contentPathOf(base.routePrefix, base.runId, "")}${url.startsWith("@") ? "" : base.folder}`);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
};

/** The root an address of the content route names by its first segment, and the address after `raw/`; undefined for every other address. */
const routeAddressOf = (base: DocumentBase, address: string): { root: string; rest: string } | undefined => {
  const prefix = contentPathOf(base.routePrefix, base.runId, "");
  if (!address.startsWith(prefix)) return undefined;
  const rest = address.slice(prefix.length);
  try {
    return { root: rootOfReference(decodeURIComponent(rest.split(/[/?#]/, 1)[0]!)), rest };
  } catch {
    return { root: "", rest };
  }
};

/** An address the page can load, the reason it cannot, or undefined while that is still open. */
export type AddressState = { readonly url: string } | { readonly error: string } | undefined;

/** An address of the content route with the grant of its root instead of `raw/`; an address elsewhere stays as it is. */
export const grantedAddressOf = (base: DocumentBase, address: string, grants: GrantSnapshot): AddressState => {
  const found = routeAddressOf(base, address);
  if (found === undefined) return { url: address };
  const state = grants.grantFor(base.runId, found.root);
  return state === undefined || "error" in state ? state : { url: `${grantedPathOf(base.routePrefix, base.runId, state.grant, "")}${found.rest}` };
};

/** The resolver a Markdown display hands to quassel: with grants an address it changes takes the grant of its root, empty while that loads and without one where it failed. */
export const documentUrlResolver = (base: DocumentBase, grants?: GrantSnapshot) => (url: string): string => {
  const resolved = resolveDocumentUrl(base, url);
  if (resolved === url || grants === undefined) return resolved;
  const granted = grantedAddressOf(base, resolved, grants);
  return granted === undefined ? "" : "url" in granted ? granted.url : resolved;
};

/** Puts a base address in front of the document, after a doctype so that it keeps its rendering mode; its requests send no referrer, because the page's own address may carry a token. */
export const htmlWithBase = (html: string, href: string): string => {
  const head = `<base href="${href.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")}"><meta name="referrer" content="no-referrer">`;
  const start = html.length - html.trimStart().length;
  const doctypeEnd = html.slice(start, start + 9).toLowerCase() === "<!doctype" ? html.indexOf(">", start) + 1 : 0;
  return `${html.slice(0, doctypeEnd)}${head}${html.slice(doctypeEnd)}`;
};
