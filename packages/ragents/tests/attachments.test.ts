import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { defineRunFunction } from "../src/agents/tools.ts";
import { prepareInputAttachments } from "../src/drivers/attachments.ts";

const read = defineRunFunction({
    name: "read", label: "read", description: "Read a file.", nativeTool: true,
    schema: Type.Object({}), resultSchema: Type.Null(), available: () => true, run: () => null,
});

test("driver passes native images, videos and PDFs, includes UTF-8 text and hands other files to the workspace", async () => {
    const content = new Uint8Array([0, 255, 13, 4]);
    const stored: Array<{ name: string; content: Uint8Array }> = [];
    const request = {
        prompt: "Bearbeite die Dateien", tools: [read],
        storeAttachment: async (name: string, bytes: Uint8Array) => {
            stored.push({ name, content: bytes });
            return stored.length === 1 ? name : `${stored.length}-${name}`;
        },
        attachments: [
            { name: "image.png", mediaType: "image/png", content },
            { name: "clip.mp4", mediaType: "video/mp4", content },
            { name: "paper.pdf", mediaType: "application/pdf", content },
            { name: "notes.txt", mediaType: "text/plain", content: new TextEncoder().encode("Text mit Umlauten: Größe") },
            { name: "data.bin", mediaType: "application/octet-stream", content },
        ],
    };
    const prepared = await prepareInputAttachments(request, ["text", "image", "video", "file"]);
    assert.deepEqual(prepared.attachments.map((entry) => entry.type), ["image", "video", "file"]);
    assert.ok(prepared.attachments.every((entry) => entry.data === Buffer.from(content).toString("base64")));
    const pdf = prepared.attachments[2];
    assert.ok(pdf?.type === "file");
    assert.equal(pdf.filename, "paper.pdf");
    assert.match(prepared.prompt, /Text mit Umlauten: Größe/);
    assert.match(prepared.prompt, /data.bin.*Unterordner attachments/);
    assert.equal(/[a-f0-9]{64}/.test(prepared.prompt), false);
    assert.deepEqual(stored, [{ name: "data.bin", content }]);
    const again = await prepareInputAttachments({ ...request, attachments: [request.attachments[4]!] }, ["text"]);
    assert.match(again.prompt, /liegt als "2-data.bin"/);
    await assert.rejects(prepareInputAttachments(request, ["text"]), /image nicht/);
    await assert.rejects(prepareInputAttachments({ ...request, tools: [], attachments: [request.attachments[4]!] }, ["text"]), /weder read noch bash/);
    assert.equal(stored.length, 2);
});
