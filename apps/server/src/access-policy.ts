import type { IncomingMessage, ServerResponse } from "node:http";
import { defaultHttpRights, type AccessContext } from "@aicontainer/ragents";
import { writeJson } from "./plugin-support/http.js";

export const hostAccessRules = [
  { path: "^/api/settings(?:/|$)", read: "settings.read", write: "settings.write" },
  { path: "^/extern$", read: "settings.read", write: "settings.write" },
  { path: "^/chat(?:/|$)", read: "runs.read", write: "runs.write", delete: "runs.delete" },
  { path: "^/ragents(?:/|$)", read: "runs.read", write: "runs.write" },
] as const;

export interface GlobalAccessPolicy {
  runId: string;
  read: string;
  write: string;
}

export const hostRequiredRights = (method: string | undefined, pathname: string, global?: GlobalAccessPolicy): readonly string[] => {
  const read = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const normalized = "/" + pathname.split("/").filter(Boolean).map(decodeURIComponent).join("/");
  if (global) {
    const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const targetsGlobal = parts[0] === "chat" && parts[1] === global.runId
      || parts.some((part, index) => part === "runs" && parts[index + 1] === global.runId);
    if (targetsGlobal) {
      const technical = /\/events$/.test(normalized) ? ["runs.inspect"] : [];
      return read ? [global.read, ...technical] : [global.read, global.write, ...technical];
    }
  }
  if (/^\/chat\/[^/]+\/options(?:\/|$)/.test(normalized)) {
    return read ? ["runs.read", "runs.create", "runs.inspect"] : ["runs.read", "runs.write", "runs.create", "runs.inspect"];
  }
  if (/^\/chat\/[^/]+\/prepare$/.test(normalized)) return ["runs.read", "runs.write", "runs.create"];
  if (/^\/ragents\/api\/runs\/[^/]+\/events$/.test(normalized)) return ["runs.read", "runs.inspect"];
  if (/^\/ragents\/api\/runs\/[^/]+\/actors\/[^/]+\/(?:inputs|restart)$/.test(normalized)) return ["runs.read", "runs.write", "runs.inspect"];
  const rule = hostAccessRules.find((candidate) => new RegExp(candidate.path).test(normalized));
  if (!rule) return [];
  if (read) return [rule.read];
  return [rule.read, method === "DELETE" && "delete" in rule ? rule.delete : rule.write];
};

export const enforceRights = (response: ServerResponse, access: AccessContext, rights: readonly string[]): boolean => {
  const missing = rights.find((right) => !access.can(right));
  if (!missing) return false;
  writeJson(response, 403, { error: `Das Recht ${missing} fehlt.`, code: "access-denied", right: missing });
  return true;
};

export const enforceHostAccess = (request: IncomingMessage, response: ServerResponse, url: URL, access: AccessContext, global?: GlobalAccessPolicy): boolean => {
  try {
    return enforceRights(response, access, hostRequiredRights(request.method, url.pathname, global));
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
    writeJson(response, 400, { error: "Ungültige URL-Kodierung" });
    return true;
  }
};

export { defaultHttpRights };
