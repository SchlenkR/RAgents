import { withAccessToken } from "@ragents/web/access-token";
import { contentPathOf, grantedPathOf, rootOfReference } from "../contract";

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

/** An address of the run carries the access token where the page has one; the anchor stays at the end. */
export const withToken = (url: string): string => {
  const hash = url.indexOf("#");
  return hash < 0 ? withAccessToken(url) : `${withAccessToken(url.slice(0, hash))}${url.slice(hash)}`;
};

/** The resolver a Markdown display hands to quassel: only an address it changes gets the token, every other stays as written. */
export const documentUrlResolver = (base: DocumentBase) => (url: string): string => {
  const resolved = resolveDocumentUrl(base, url);
  return resolved === url ? url : withToken(resolved);
};

/** Puts a base address in front of the document, after a doctype so that it keeps its rendering mode; its requests send no referrer, because the page's own address may carry a token. */
export const htmlWithBase = (html: string, href: string): string => {
  const head = `<base href="${href.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")}"><meta name="referrer" content="no-referrer">`;
  const start = html.length - html.trimStart().length;
  const doctypeEnd = html.slice(start, start + 9).toLowerCase() === "<!doctype" ? html.indexOf(">", start) + 1 : 0;
  return `${html.slice(0, doctypeEnd)}${head}${html.slice(doctypeEnd)}`;
};
