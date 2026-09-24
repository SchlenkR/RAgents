import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const WEB_BUNDLE_FILE = /^\/plugins\/([^/]+)\/web\/(.+)$/;

/** An address in the web folder of a profile bundle; the host serves it before any plugin route, so no route can take its place. */
export const isWebBundlePath = (folders: ReadonlyMap<string, string>, pathname: string): boolean => {
  const match = WEB_BUNDLE_FILE.exec(pathname);
  return match !== null && folders.has(match[1]!);
};

/** Source maps carry the plugin sources and stay behind access; everything else of a web half loads without token, as in an iframe without cookie. */
export const isBundleSourceMap = (folders: ReadonlyMap<string, string>, pathname: string): boolean =>
  isWebBundlePath(folders, pathname) && pathname.endsWith(".map");

export const isPublicBundleFile = (folders: ReadonlyMap<string, string>, pathname: string): boolean =>
  isWebBundlePath(folders, pathname) && !pathname.endsWith(".map");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export interface WebFileResponse {
  readonly status: 200 | 304 | 404;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Buffer;
}

/** A content hash as ETag; the browser revalidates every file, because entry and exports keep their names across builds. */
export const etagOf = (content: Buffer | string): string => `"${createHash("sha256").update(content).digest("base64url").slice(0, 22)}"`;

const notFound: WebFileResponse = { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: Buffer.from("Nicht gefunden") };

const relativeFile = (encoded: string): string | undefined => {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
};

/** Serves only the web folder of the profile's bundles; server code and assets of a bundle never leave the host. */
export const webBundleFile = async (
  folders: ReadonlyMap<string, string>,
  pathname: string,
  ifNoneMatch: string | undefined,
): Promise<WebFileResponse> => {
  const match = WEB_BUNDLE_FILE.exec(pathname);
  const folder = match ? folders.get(match[1]!) : undefined;
  const relative = match ? relativeFile(match[2]!) : undefined;
  if (!folder || relative === undefined) return notFound;
  const webFolder = path.join(folder, "web");
  const file = path.resolve(webFolder, relative);
  if (!file.startsWith(webFolder + path.sep)) return notFound;
  const content = await readFile(file).catch(() => undefined);
  if (!content) return notFound;
  const etag = etagOf(content);
  // Chunks und Assets tragen ihren Hash im Namen und ändern sich nie; Einstieg und Exporte behalten ihren Namen über jeden Bau.
  const hashed = /^(chunks|assets)\//.test(path.relative(webFolder, file).split(path.sep).join("/"));
  const caching = { "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache", ETag: etag };
  if (ifNoneMatch === etag) return { status: 304, headers: caching };
  return { status: 200, headers: { ...caching, "Content-Type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" }, body: content };
};
