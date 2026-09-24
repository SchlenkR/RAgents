import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMessages } from "../src/chat/ChatMessages";
import { attachmentDownloadUrl, attachmentCapabilityError, attachmentMediaType, encodeAttachment, MAX_CHAT_ATTACHMENT_BYTES, validateAttachmentSelection } from "../src/chat/attachments";

test("attachment budgets include existing selections and permit exact boundaries", () => {
  assert.doesNotThrow(() => validateAttachmentSelection([{ size: 1 }], [{ size: MAX_CHAT_ATTACHMENT_BYTES - 1 }]));
  assert.throws(() => validateAttachmentSelection([{ size: 1 }], [{ size: MAX_CHAT_ATTACHMENT_BYTES }]), /20 MiB/);
  assert.doesNotThrow(() => validateAttachmentSelection(Array.from({ length: 7 }, () => ({ size: 0 })), [{ size: 0 }]));
  assert.throws(() => validateAttachmentSelection(Array.from({ length: 8 }, () => ({ size: 0 })), [{ size: 0 }]), /8 Anhänge/);
});

test("file encoding preserves binary bytes across chunks and infers missing media types", async () => {
  const bytes = Uint8Array.from({ length: 17000 }, (_, index) => index % 256);
  const encoded = await encodeAttachment(new File([bytes], "Screenshot.PNG"));
  assert.equal(encoded.name, "Screenshot.PNG");
  assert.equal(encoded.mediaType, "image/png");
  assert.equal(encoded.data, Buffer.from(bytes).toString("base64"));
  assert.equal(attachmentMediaType({ name: "unknown.bin", type: "" }), "application/octet-stream");
  assert.equal(attachmentMediaType({ name: "sample.pdf", type: "text/plain" }), "text/plain");
});

test("model compatibility checks images, videos and PDF while workspace files stay usable", () => {
  for (const [mediaType, modality] of [["image/png", "image"], ["video/mp4", "video"], ["application/pdf", "file"]]) {
    const files = [{ name: "Anhang", mediaType }];
    assert.match(attachmentCapabilityError(files, { model: "text-model", input: ["text"] })!, /text-model.*Anhang/);
    assert.equal(attachmentCapabilityError(files, { model: "media-model", input: [modality] }), undefined);
  }
  assert.equal(attachmentCapabilityError([{ name: "notes.txt", mediaType: "text/plain" }], { model: "text-model", input: ["text"] }), undefined);
});

test("attachment-only history remains visible with downloads and controlled video playback", () => {
  const markup = renderToStaticMarkup(createElement(ChatMessages, { messages: [
    { key: "user", role: "user", text: "", attachments: [{ name: "report.pdf", mediaType: "application/pdf", size: 1024, url: "/files/report.pdf" }] },
    { key: "assistant", role: "assistant", text: "", attachments: [{ name: "image.png", mediaType: "image/png", size: 100, url: "/files/image.png" }, { name: "clip.mp4", mediaType: "video/mp4", size: 100, url: "/files/clip.mp4" }] },
  ] }));
  assert.match(markup, /download="report.pdf"/);
  assert.match(markup, /alt="image.png"/);
  assert.match(markup, /<video[^>]+controls=""/);
  assert.doesNotMatch(markup, /autoplay/i);
});

test("download links request a download response for opaque frames without modifying local data", () => {
  assert.equal(attachmentDownloadUrl("/chat/run/attachments/image"), "/chat/run/attachments/image?download=1");
  assert.equal(attachmentDownloadUrl("/files/image?version=2#preview"), "/files/image?version=2&download=1#preview");
  assert.equal(attachmentDownloadUrl("data:image/png;base64,AQ=="), "data:image/png;base64,AQ==");
  assert.equal(attachmentDownloadUrl("blob:https://ragents.local/image"), "blob:https://ragents.local/image");
});
