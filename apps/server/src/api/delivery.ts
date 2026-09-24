import { DomainError, type HttpRouteContribution } from "@ragents/engine";
import type { ChatSessionProvider } from "../chat-handler.js";
import { writeJson } from "../plugin-support/http.js";
import { ATTACHMENT_CONTENT_PATH } from "./contracts.js";
import { assertRunRights, type RunAccessPolicy } from "./rights.js";

/** Anhänge sind Auslieferung: ein GET mit dem Medientyp, inline für Bilder und Videos. */
export const attachmentContentRoute = (sessions: ChatSessionProvider, policy: RunAccessPolicy): HttpRouteContribution => ({
  id: "ragents.chat.attachment-content",
  requiredRights: [],
  isApiPath: (pathname) => ATTACHMENT_CONTENT_PATH.test(pathname),
  matches: (request, url) => request.method === "GET" && ATTACHMENT_CONTENT_PATH.test(url.pathname),
  handle: async ({ response, url, access }) => {
    const match = url.pathname.match(ATTACHMENT_CONTENT_PATH)!;
    const runId = decodeURIComponent(match[1]!);
    const artifactId = decodeURIComponent(match[2]!);
    try {
      assertRunRights(access, runId, "read", policy);
      const session = await sessions.get(runId);
      if (!session.attachment) throw new DomainError("attachments-unavailable", "Anhänge sind nicht verfügbar", 404);
      const { attachment, content } = session.attachment(artifactId);
      const inline = !url.searchParams.has("download")
        && (attachment.mediaType.startsWith("image/") || attachment.mediaType.startsWith("video/"));
      response.writeHead(200, {
        "Content-Type": attachment.mediaType,
        "Content-Length": content.byteLength,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=31536000, immutable",
      });
      response.end(Buffer.from(content));
    } catch (error) {
      writeJson(response, error instanceof DomainError ? error.status : 500, {
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof DomainError ? { code: error.code } : {}),
      });
    }
  },
});
