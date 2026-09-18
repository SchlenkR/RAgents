import type { ChatAttachmentInput } from "../../../server/src/chat-events";
import type { ChatUserLocation } from "../../../server/src/chat-context";
import { errorFrom } from "../lib/http";

export async function postChatRequest(baseUrl: string, action: "send" | "start" | "stop", body: unknown, headers: Record<string, string> = {}, request: typeof fetch = fetch): Promise<void> {
  const response = await request(`${baseUrl}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await errorFrom(response, `Der Server hat die Anfrage abgelehnt (${response.status})`);
}

export function sendChatMessage(baseUrl: string, text: string, attachments?: ChatAttachmentInput[], userLocation?: ChatUserLocation, headers: Record<string, string> = {}, request: typeof fetch = fetch): Promise<void> {
  return postChatRequest(baseUrl, "send", { text, attachments, userLocation }, headers, request);
}
