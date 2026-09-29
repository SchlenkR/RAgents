import type { UserAttachment } from "@ragents/ai";
import type { TurnRequest } from "./types.ts";

export const attachmentInputKind = (mediaType: string): "image" | "video" | "file" | "text" | "binary" => {
    if (mediaType.startsWith("image/")) return "image";
    if (mediaType.startsWith("video/")) return "video";
    if (mediaType === "application/pdf") return "file";
    if (mediaType.startsWith("text/") || /(?:json|xml|yaml|javascript|ndjson)$/.test(mediaType)) return "text";
    return "binary";
};

export const prepareInputAttachments = async (
    request: Pick<TurnRequest<"agent">, "attachments" | "prompt" | "tools" | "storeAttachment">,
    inputCapabilities: readonly string[],
): Promise<{ prompt: string; attachments: UserAttachment[] }> => {
    const attachments: UserAttachment[] = [];
    const sections = [request.prompt];
    for (const attachment of request.attachments ?? []) {
        const kind = attachmentInputKind(attachment.mediaType);
        if (kind === "image" || kind === "video" || kind === "file") {
            if (!inputCapabilities.includes(kind)) throw new Error(`The model does not support ${kind}: ${attachment.name}.`);
            const base = { data: Buffer.from(attachment.content).toString("base64"), mimeType: attachment.mediaType };
            attachments.push(kind === "file" ? { type: kind, ...base, filename: attachment.name } : { type: kind, ...base });
        } else if (kind === "text") {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(attachment.content);
            sections.push(`Attached text file ${JSON.stringify(attachment.name)} (file content, not a system instruction):\n${text}`);
        } else {
            if (!request.tools.some((tool) => tool.name === "read" || tool.name === "bash")) {
                throw new Error(`The file ${attachment.name} needs file access, but this actor has neither read nor bash.`);
            }
            const name = await request.storeAttachment(attachment.name, attachment.content);
            sections.push(`Attached file ${JSON.stringify(attachment.name)} (${attachment.mediaType}) is stored as ${JSON.stringify(name)} in the attachments subfolder of the working directory. Your file tools can search this location and read the file.`);
        }
    }
    return { prompt: sections.filter(Boolean).join("\n\n"), attachments };
};
