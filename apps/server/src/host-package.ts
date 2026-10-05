import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { t } from "tar";
import { hasWorkstationOwner, type HttpRouteContribution } from "@ragents/engine";
import type { HostPackageDownload } from "./api/contracts.js";
import { hostRoot, readHostPackage } from "./host-version.js";
import { writeJson } from "./plugin-support/http.js";
import { isLocalRequest, isLoopbackRequest } from "./local-request.js";

export interface ServedHostPackage {
  readonly download: HostPackageDownload;
  readonly content: Buffer;
}

const installedFiles = async (root: string, prefix = ""): Promise<string[]> => {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = await Promise.all(entries.filter((entry) => entry.name !== "node_modules").map(async (entry) => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) return installedFiles(root, relative);
    if (!entry.isFile()) throw new Error(`The installed host contains a non-package file: ${relative}`);
    return [relative];
  }));
  return files.flat();
};

export const loadServedHostPackage = async (file: string | undefined, root = hostRoot()): Promise<ServedHostPackage | undefined> => {
  if (!file) return undefined;
  try {
    const host = readHostPackage(root);
    if (host?.name !== "@schlenkr/ragents") throw new Error("RAGENTS_HOST_TARBALL requires an installed @schlenkr/ragents host");
    const content = await readFile(file);
    const files = new Map<string, Promise<void>>();
    const problems: string[] = [];
    const archive = t({ strict: true, onReadEntry: (entry) => {
      const relative = entry.path.slice("package/".length);
      if (!entry.path.startsWith("package/") || !relative || relative.split("/").some((part) => ["..", ".", "node_modules", ".git", ""].includes(part)) || entry.type !== "File") {
        problems.push(`The host tarball contains a non-package entry: ${entry.path}`);
        entry.resume();
        return;
      }
      if (files.has(relative)) {
        problems.push(`The host tarball repeats ${relative}`);
        entry.resume();
        return;
      }
      const chunks: Buffer[] = [];
      const checked = new Promise<void>((resolve, reject) => {
        entry.on("data", (chunk: Buffer) => chunks.push(chunk));
        entry.once("error", reject);
        entry.once("end", () => {
          void readFile(path.join(root, relative)).then((installed) => {
            if (!installed.equals(Buffer.concat(chunks))) throw new Error(`The host tarball does not match the installed host: ${relative}`);
          }).then(resolve, reject);
        });
      });
      checked.catch(() => undefined);
      files.set(relative, checked);
    } });
    await new Promise<void>((resolve, reject) => {
      archive.once("error", reject);
      archive.once("end", resolve);
      archive.end(content);
    });
    if (problems.length) throw new Error(problems.join("; "));
    await Promise.all(files.values());
    const installed = (await installedFiles(root)).sort();
    if (installed.join("\n") !== [...files.keys()].sort().join("\n")) throw new Error("The host tarball file set does not match the installed host");
    return { content, download: { path: "/api/host-package", integrity: `sha512-${createHash("sha512").update(content).digest("base64")}` } };
  } catch (cause) {
    throw new Error(`RAGENTS_HOST_TARBALL ${file}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
};

export const hostPackageRoute = (host: ServedHostPackage | undefined): HttpRouteContribution => ({
  id: "ragents.host-package",
  requiredRights: ["runs.write"],
  isApiPath: (pathname) => pathname === "/api/host-package",
  matches: (request, url) => ["GET", "HEAD"].includes(request.method ?? "") && url.pathname === "/api/host-package",
  handle: async ({ request, response, access }) => {
    if (!access.can("runs.write")) {
      writeJson(response, 403, { error: "Downloading the host requires workstation registration access (runs.write).", code: "access-denied" });
      return;
    }
    if (!hasWorkstationOwner(access, isLoopbackRequest(request) && isLocalRequest(request))) {
      writeJson(response, 403, { error: "A host download over the network requires a profile with signed-in users.", code: "workspace-client-login-required" });
      return;
    }
    if (!host) {
      writeJson(response, 404, { error: "This server offers no host package download.", code: "host-package-unavailable" });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": host.content.length,
      "Content-Disposition": 'attachment; filename="ragents-host.tgz"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Ragents-Integrity": host.download.integrity,
    });
    response.end(request.method === "HEAD" ? undefined : host.content);
  },
});
