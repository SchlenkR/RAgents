import { readFile } from "node:fs/promises";
import path from "node:path";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

interface HelpResponse {
  status: number;
  headers: Record<string, string>;
  body?: Buffer | string;
}

export async function readHelpResponse(url: URL, webDistDir: string, method = "GET"): Promise<HelpResponse | undefined> {
  if (url.pathname !== "/help" && !url.pathname.startsWith("/help/")) return undefined;
  if (method !== "GET" && method !== "HEAD") {
    return { status: 405, headers: { Allow: "GET, HEAD" } };
  }
  if (url.pathname === "/help") {
    return { status: 302, headers: { Location: `/help/${url.search}` } };
  }

  const notFound = (): HelpResponse => ({
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: method === "HEAD" ? undefined : "Nicht gefunden",
  });
  let requested: string;
  try {
    requested = decodeURIComponent(url.pathname.slice("/help/".length)) || "index.html";
  } catch {
    return { status: 400, headers: {} };
  }
  const root = path.resolve(webDistDir, "help");
  const file = path.resolve(root, requested);
  if (!file.startsWith(`${root}${path.sep}`) || requested.includes("\0")) return notFound();

  try {
    const body = await readFile(file);
    return {
      status: 200,
      headers: { "Content-Type": contentTypes[path.extname(file)] ?? "application/octet-stream" },
      body: method === "HEAD" ? undefined : body,
    };
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return notFound();
    throw error;
  }
}
