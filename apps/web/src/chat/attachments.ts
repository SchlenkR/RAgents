import type { ChatAttachmentInput } from "../../../server/src/chat-events";

import { chatAttachmentMediaType, MAX_CHAT_ATTACHMENTS, MAX_CHAT_ATTACHMENT_BYTES } from "../../../server/src/chat-attachments";

export { MAX_CHAT_ATTACHMENTS, MAX_CHAT_ATTACHMENT_BYTES };

export function attachmentMediaType(file: { name: string; type: string }): string {
  return chatAttachmentMediaType(file.name, file.type);
}

export function attachmentCapabilityError(
  files: readonly { name: string; mediaType: string }[],
  capabilities: { input: readonly string[]; model: string },
): string | undefined {
  for (const file of files) {
    const required = file.mediaType.startsWith("image/") ? "image"
      : file.mediaType.startsWith("video/") ? "video" : file.mediaType === "application/pdf" ? "file" : undefined;
    if (required && !capabilities.input.includes(required)) {
      if (!capabilities.model) return `Dieser Chat unterstützt ${file.name} nicht als ${required === "image" ? "Bild" : required === "video" ? "Video" : "PDF"}. Entferne den Anhang.`;
      return `Das Modell ${capabilities.model} unterstützt ${file.name} nicht als ${required === "image" ? "Bild" : required === "video" ? "Video" : "PDF"}. Wähle ein passendes Modell oder entferne den Anhang.`;
    }
  }
}

export function validateAttachmentSelection(existing: readonly { size: number }[], incoming: readonly { size: number }[]): void {
  if (existing.length + incoming.length > MAX_CHAT_ATTACHMENTS) {
    throw new Error(`Höchstens ${MAX_CHAT_ATTACHMENTS} Anhänge pro Nachricht. Entferne zuerst einen Anhang.`);
  }
  if ([...existing, ...incoming].reduce((total, file) => total + file.size, 0) > MAX_CHAT_ATTACHMENT_BYTES) {
    throw new Error("Anhänge dürfen zusammen höchstens 20 MiB groß sein. Wähle kleinere Dateien.");
  }
}

export async function encodeAttachment(file: File): Promise<ChatAttachmentInput> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return { name: file.name, mediaType: attachmentMediaType(file), data: btoa(chunks.join("")) };
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function attachmentDownloadUrl(url: string): string {
  if (/^(data|blob):/i.test(url)) return url;
  const [resource, fragment] = url.split(/#(.*)/s);
  return `${resource}${resource.includes("?") ? "&" : "?"}download=1${fragment === undefined ? "" : `#${fragment}`}`;
}
