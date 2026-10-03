import { fromMarkdown, type CompileContext, type Token } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { contentPathOf } from "../contract";

/** Where the addresses inside a document point: the content route of its run and the folder of the document below it, both encoded. */
export interface DocumentBase {
  root: string;
  folder: string;
}

/** A document without a file of its own, such as text the model wrote, resolves against the run's root. */
export const documentBaseOf = (routePrefix: string, runId: string, reference = ""): DocumentBase => ({
  root: contentPathOf(routePrefix, runId, ""),
  folder: reference.slice(0, reference.lastIndexOf("/") + 1).split("/").map(encodeURIComponent).join("/"),
});

const ORIGIN = "http://document.invalid";

/** Anchors, schemes, and addresses from the site root stay as they are. */
const kept = (url: string): boolean => url === "" || url.startsWith("#") || url.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);

/** A relative address resolves against the document's folder, one with an alias against that root, both with plain URL semantics. */
export const resolveDocumentUrl = (base: DocumentBase, url: string): string => {
  if (kept(url)) return url;
  const resolved = new URL(url, `${ORIGIN}${base.root}${url.startsWith("@") ? "" : base.folder}`);
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
};

interface Destination {
  start: number;
  end: number;
  url: string;
}

/** The destinations of links, images, and definitions with their place in the source; the parser has set the url of the node by then. */
const destinationsOf = (markdown: string): readonly Destination[] => {
  const found: Destination[] = [];
  const record = function (this: CompileContext, token: Token): undefined {
    const url = (this.stack[this.stack.length - 1] as { url?: unknown }).url;
    if (typeof url === "string") found.push({ start: token.start.offset, end: token.end.offset, url });
  };
  fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown(), { exit: { resourceDestination: record, definitionDestination: record } }],
  });
  return found;
};

/** Replaces every link and image destination the resolver changes; the rest of the source stays byte for byte. */
export const markdownWithResolvedUrls = (markdown: string, resolve: (url: string) => string): string =>
  destinationsOf(markdown).reduceRight((text, { start, end, url }) => {
    const resolved = resolve(url);
    return resolved === url ? text : `${text.slice(0, start)}${resolved.replaceAll("(", "%28").replaceAll(")", "%29")}${text.slice(end)}`;
  }, markdown);

/** Puts a base address in front of the document, after a doctype so that it keeps its rendering mode. */
export const htmlWithBase = (html: string, href: string): string => {
  const base = `<base href="${href.replaceAll("&", "&amp;").replaceAll("\"", "&quot;")}">`;
  const start = html.length - html.trimStart().length;
  const doctypeEnd = html.slice(start, start + 9).toLowerCase() === "<!doctype" ? html.indexOf(">", start) + 1 : 0;
  return `${html.slice(0, doctypeEnd)}${base}${html.slice(doctypeEnd)}`;
};
