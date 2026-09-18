import { IncomingMessage, ServerResponse } from "node:http";
import type { ChatAttachment, ChatAttachmentInput, ChatEvent } from "./chat-events.js";
import { MAX_CHAT_REQUEST_BYTES, parseChatAttachments } from "./chat-attachments.js";
import { canStartEntry, DomainError, unrestrictedAccess, type AccessContext } from "@aicontainer/ragents";
import type { ActorConversations } from "./ragents/actor-chat-history.js";
import { accessibleActorConversations } from "./access-projection.js";

export interface SessionInfo {
  id: string;
  title: string;
  createdAt?: number;
  updatedAt: number;
  revision?: number;
}

export interface ChatUser {
  id: string;
  label: string;
}

/** Was der HTTP-Adapter von einer Unterhaltung braucht. */
export interface ChatSessionLike {
  readonly running: boolean;
  subscribe(listener: (event: ChatEvent) => void): () => void;
  send(text: string, attachments?: ChatAttachmentInput[], userLocation?: unknown, user?: ChatUser): void | Promise<void>;
  sendToActor?(actorId: string, text: string, attachments?: ChatAttachmentInput[]): Promise<void>;
  actorConversations?(): ActorConversations;
  capabilities?(actor?: string): Promise<{ input: string[]; model: string }>;
  attachment?(artifactId: string): { attachment: ChatAttachment; content: Uint8Array };
  start(entryId: string, input: unknown, user?: ChatUser): void;
  stop(): void | Promise<void>;
}

export interface ChatSessionProvider {
  get(id: string): Promise<ChatSessionLike>;
  hasRun?(id: string): boolean;
  list(): Promise<SessionInfo[]>;
  subscribeList?(listener: () => void): () => void;
  delete(id: string): Promise<void>;
}

export interface ChatHandlerOptions {
  manager: ChatSessionProvider;
  prefix?: string;
  cors?: boolean;
}

/**
 * Framework-freier HTTP-Adapter. Routen unter dem Prefix (default /chat):
 *   GET    /:id/stream   SSE - erst Verlauf, dann live, mit Keepalive-Pings
 *   POST   /:id/send     { text } - startet einen Lauf oder funkt dazwischen
 *   POST   /:id/start    { entry, input? } - startet einen Lauf über ein Run-Script, ohne Nachricht
 *   POST   /:id/stop     bricht den laufenden Turn ab
 *   GET    /sessions     persistierte Unterhaltungen
 *   DELETE /:id          loescht eine Unterhaltung
 * Rueckgabe true heisst: Anfrage wurde behandelt.
 */
export function createChatHandler({ manager, prefix = "/chat", cors = true }: ChatHandlerOptions) {
  return async (req: IncomingMessage, res: ServerResponse, access: AccessContext = unrestrictedAccess): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://intern");
    if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) {
      return false;
    }
    if (cors) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return true;
    }

    const teile = url.pathname.slice(prefix.length).split("/").filter(Boolean);
    try {
      if (req.method === "GET" && teile.length === 1 && teile[0] === "sessions") {
        antworteJson(res, 200, await manager.list());
        return true;
      }
      if (req.method === "DELETE" && teile.length === 1) {
        await manager.delete(teile[0]);
        antworteJson(res, 202, { ok: true });
        return true;
      }
      if (req.method === "GET" && teile.length === 3 && teile[1] === "attachments") {
        const session = await manager.get(teile[0]);
        if (!session.attachment) throw new DomainError("attachments-unavailable", "Anhänge sind nicht verfügbar", 404);
        const { attachment, content } = session.attachment(decodeURIComponent(teile[2]));
        const inline = !url.searchParams.has("download")
          && (attachment.mediaType.startsWith("image/") || attachment.mediaType.startsWith("video/"));
        res.writeHead(200, {
          "Content-Type": attachment.mediaType,
          "Content-Length": content.byteLength,
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.name).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cache-Control": "private, max-age=31536000, immutable",
        });
        res.end(Buffer.from(content));
        return true;
      }
      if (req.method === "GET" && teile.length === 3 && teile[1] === "actors" && teile[2] === "history") {
        const session = await manager.get(teile[0]);
        if (!session.actorConversations) throw new DomainError("actor-history-unavailable", "Actor-Verläufe sind nicht verfügbar", 404);
        res.setHeader("Cache-Control", "no-store");
        antworteJson(res, 200, accessibleActorConversations(session.actorConversations(), access));
        return true;
      }
      if (req.method === "POST" && teile.length === 4 && teile[1] === "actors" && teile[3] === "send") {
        if (!access.can("runs.create") && !manager.hasRun?.(teile[0])) throw new DomainError("access-denied", "Freie Runs sind für diesen Zugang nicht freigegeben.", 403);
        const session = await manager.get(teile[0]);
        if (!session.sendToActor) throw new DomainError("actor-send-unavailable", "Actor-Nachrichten sind nicht verfügbar", 404);
        const { text, attachments } = messageFrom(await leseJson(req));
        await session.sendToActor(decodeURIComponent(teile[2]), text, attachments);
        antworteJson(res, 202, { ok: true });
        return true;
      }
      if (teile.length !== 2) {
        antworteJson(res, 404, { error: "Unbekannte Route" });
        return true;
      }
      const [id, aktion] = teile;
      if (req.method === "POST" && aktion === "send" && !access.can("runs.create") && !manager.hasRun?.(id)) {
        throw new DomainError("access-denied", "Freie Runs sind für diesen Zugang nicht freigegeben.", 403);
      }
      if (req.method === "POST" && aktion === "start") {
        const body = await leseJson(req);
        const entry = typeof body?.entry === "string" ? body.entry.trim() : "";
        if (!entry) {
          antworteJson(res, 400, { error: "entry fehlt" });
          return true;
        }
        if (!canStartEntry(access, entry)) throw new DomainError("access-denied", "Dieses Setup ist für diesen Zugang nicht freigegeben.", 403);
        const session = await manager.get(id);
        session.start(entry, body?.input === undefined ? null : body.input, access.user ? { id: access.user.id, label: access.user.label } : undefined);
        antworteJson(res, 202, { ok: true });
        return true;
      }
      const session = await manager.get(id);

      if (req.method === "GET" && aktion === "capabilities") {
        if (!session.capabilities) throw new DomainError("capabilities-unavailable", "Modellfähigkeiten sind nicht verfügbar", 404);
        const capabilities = await session.capabilities(url.searchParams.get("actor") ?? "primary");
        antworteJson(res, 200, access.can("runs.inspect") ? capabilities : { ...capabilities, model: "" });
        return true;
      }

      if (req.method === "POST" && aktion === "send") {
        const body = await leseJson(req);
        const { text, attachments } = messageFrom(body);
        await session.send(text, attachments, body?.userLocation, access.user ? { id: access.user.id, label: access.user.label } : undefined);
        antworteJson(res, 202, { ok: true });
        return true;
      }
      if (req.method === "POST" && aktion === "stop") {
        await session.stop();
        antworteJson(res, 200, { ok: true });
        return true;
      }
      antworteJson(res, 404, { error: "Unbekannte Route" });
    } catch (error) {
      const technicalError = error instanceof DomainError
        && ["attachment-model-unsupported", "attachment-tools-required", "attachments-unsupported"].includes(error.code);
      const message = !access.can("runs.inspect") && (technicalError || !(error instanceof DomainError) || error.status >= 500)
        ? technicalError ? "Dieser Agent kann die angehängte Datei nicht verarbeiten." : "Die Anfrage konnte nicht verarbeitet werden."
        : error instanceof Error ? error.message : String(error);
      antworteJson(res, error instanceof DomainError ? error.status : 500, {
        error: message,
        ...(error instanceof DomainError ? { code: error.code } : {}),
      });
    }
    return true;
  };
}

function antworteJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function leseJson(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const stuecke = await new Promise<Buffer[]>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const data = (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_CHAT_REQUEST_BYTES) {
        req.removeListener("data", data);
        req.removeListener("end", end);
        req.resume();
        reject(new DomainError("request-too-large", "Die Nachricht ist größer als 29 MiB", 413));
        return;
      }
      chunks.push(chunk);
    };
    const end = () => resolve(chunks);
    req.on("data", data);
    req.once("end", end);
    req.once("error", reject);
  });
  const text = Buffer.concat(stuecke).toString("utf8");
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function messageFrom(body: Record<string, unknown> | undefined): { text: string; attachments: ChatAttachmentInput[] } {
  try {
    if (body?.text !== undefined && typeof body.text !== "string") throw new Error("text muss eine Zeichenfolge sein");
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const attachments = parseChatAttachments(body?.attachments);
    if (!text && attachments.length === 0) throw new Error("Text oder Anhänge fehlen");
    return { text, attachments };
  } catch (error) {
    throw new DomainError("invalid-message", error instanceof Error ? error.message : String(error), 400);
  }
}
