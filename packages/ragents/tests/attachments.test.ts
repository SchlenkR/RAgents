import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareInputAttachments } from "../src/drivers/attachments.ts";

test("driver passes native images, videos and PDFs, includes UTF-8 text and materializes other files without overwriting", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ragents-driver-attachments-"));
    const content = new Uint8Array([0, 255, 13, 4]);
    const request = {
        workspace, prompt: "Bearbeite die Dateien", tools: [], workspaceTools: ["read"],
        attachments: [
            { name: "image.png", mediaType: "image/png", content },
            { name: "clip.mp4", mediaType: "video/mp4", content },
            { name: "paper.pdf", mediaType: "application/pdf", content },
            { name: "notes.txt", mediaType: "text/plain", content: new TextEncoder().encode("Text mit Umlauten: Größe") },
            { name: "data.bin", mediaType: "application/octet-stream", content },
        ],
    };
    try {
        const prepared = await prepareInputAttachments(request, ["text", "image", "video", "file"]);
        assert.deepEqual(prepared.attachments.map((entry) => entry.type), ["image", "video", "file"]);
        assert.ok(prepared.attachments.every((entry) => entry.data === Buffer.from(content).toString("base64")));
        const pdf = prepared.attachments[2];
        assert.ok(pdf?.type === "file");
        assert.equal(pdf.filename, "paper.pdf");
        assert.match(prepared.prompt, /Text mit Umlauten: Größe/);
        assert.match(prepared.prompt, /data.bin.*Unterordner attachments/);
        assert.equal(/[a-f0-9]{64}/.test(prepared.prompt), false);
        assert.deepEqual(await readFile(join(workspace, "attachments", "data.bin")), Buffer.from(content));
        await prepareInputAttachments({ ...request, attachments: [request.attachments[4]!] }, ["text"]);
        assert.deepEqual(await readFile(join(workspace, "attachments", "2-data.bin")), Buffer.from(content));
        await assert.rejects(prepareInputAttachments(request, ["text"]), /image nicht/);
        await assert.rejects(prepareInputAttachments({ ...request, workspaceTools: [], attachments: [request.attachments[4]!] }, ["text"]), /weder read noch bash/);
    } finally { await rm(workspace, { recursive: true, force: true }); }
});

test("attachment materialization refuses a symlinked directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "ragents-attachment-link-"));
    try {
        await symlink(tmpdir(), join(workspace, "attachments"));
        await assert.rejects(prepareInputAttachments({
            workspace, prompt: "Datei", tools: [], workspaceTools: ["bash"],
            attachments: [{ name: "data.bin", mediaType: "application/octet-stream", content: new Uint8Array([0]) }],
        }, ["text"]), /kein normales Verzeichnis/);
    } finally { await rm(workspace, { recursive: true, force: true }); }
});
