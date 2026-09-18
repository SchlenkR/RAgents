import type { ChatAttachmentInput } from "./chat-events.js";

export const MAX_CHAT_ATTACHMENTS = 8;
export const MAX_CHAT_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_CHAT_REQUEST_BYTES = 29 * 1024 * 1024;

export const chatAttachmentMediaType = (name: string, mediaType: string): string => {
  const explicit = mediaType.trim().toLowerCase();
  if (explicit) return explicit === "video/quicktime" ? "video/mov" : explicit;
  const types: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    avif: "image/avif", svg: "image/svg+xml", pdf: "application/pdf",
    mp4: "video/mp4", webm: "video/webm", mov: "video/mov", mpeg: "video/mpeg", mpg: "video/mpeg",
    txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values",
    json: "application/json", jsonl: "application/x-ndjson", xml: "application/xml",
    yaml: "application/yaml", yml: "application/yaml", ts: "text/plain", tsx: "text/plain",
    js: "application/javascript", py: "text/plain", cs: "text/plain", fs: "text/plain",
    html: "text/html", css: "text/css", log: "text/plain",
  };
  return types[name.split(".").at(-1)?.toLowerCase() ?? ""] ?? "application/octet-stream";
};

export const parseChatAttachments = (value: unknown): ChatAttachmentInput[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`Anhänge müssen eine Liste mit höchstens ${MAX_CHAT_ATTACHMENTS} Dateien sein.`);
  }
  let total = 0;
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`Anhang ${index + 1} ist ungültig.`);
    const { name, mediaType, data } = entry as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || name.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(name)
      || name === "." || name === "..") throw new Error(`Anhang ${index + 1} benötigt einen gültigen Dateinamen ohne Pfad.`);
    const normalizedType = typeof mediaType === "string" ? chatAttachmentMediaType(name, mediaType) : "";
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(normalizedType)) {
      throw new Error(`Anhang ${name} benötigt einen gültigen MIME-Typ.`);
    }
    if (typeof data === "string" && data.length > Math.ceil(MAX_CHAT_ATTACHMENT_BYTES / 3) * 4)
      throw new Error("Anhänge dürfen zusammen höchstens 20 MiB groß sein.");
    if (typeof data !== "string" || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new Error(`Anhang ${name} enthält ungültiges Base64.`);
    }
    const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    if (padding && (alphabet.indexOf(data[data.length - padding - 1]) & (padding === 2 ? 15 : 3)) !== 0) {
      throw new Error(`Anhang ${name} enthält nichtkanonisches Base64.`);
    }
    total += data.length / 4 * 3 - padding;
    if (total > MAX_CHAT_ATTACHMENT_BYTES) throw new Error("Anhänge dürfen zusammen höchstens 20 MiB groß sein.");
    return { name, mediaType: normalizedType, data };
  });
};
