import { unavailableActorPrograms } from "./actor-programs-fixture.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DirectoryArtifactContents, DomainError, Journal, LiveBus, Orchestration, StartOptionContributionRegistry, StaticModelCatalog,
} from "@aicontainer/ragents";
import { testServices } from "../../../packages/ragents/tests/support.ts";
import { attachmentContentPath, coreContracts } from "../src/api/contracts.ts";
import { coreMethods } from "../src/api/core-methods.ts";
import { attachmentContentRoute } from "../src/api/delivery.ts";
import { coreSources, startRpcServer } from "./rpc-fixture.ts";
import { MAX_CHAT_ATTACHMENT_BYTES, MAX_CHAT_REQUEST_BYTES, parseChatAttachments } from "../src/chat-attachments.ts";
import type { ChatAttachmentInput, ChatEvent } from "../src/chat-events.ts";
import type { Engine } from "../src/ragents/engine.ts";
import { RunChatSession } from "../src/ragents/session.ts";
import { modelStartOption } from "../src/plugin-support/product-start-options.ts";

const attachment = (name = "photo.png", mediaType = "image/png", content = Buffer.from([0, 255, 7, 19])): ChatAttachmentInput =>
  ({ name, mediaType, data: content.toString("base64") });

const fixture = async (input: readonly string[]) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-chat-attachments-"));
  const services = testServices();
  const journal = new Journal(path.join(directory, "runs"), services);
  const runtime = new Orchestration(journal, services, new DirectoryArtifactContents(path.join(directory, "artifacts")));
  const models = ["example", "image-capable"].map((model) => ({ driver: "agent" as const, provider: "test", model, label: model, thinking: ["off" as const] }));
  const startOptions = new StartOptionContributionRegistry();
  startOptions.register("test", [modelStartOption({
    options: ["example", "image-capable"], defaultModel: "example", provider: "test", selectable: true, thinkingOptionsFor: () => ["off"],
  }, "off")]);
  const engine = {
    journal, runtime, live: new LiveBus(), catalogModels: models,
    catalog: new StaticModelCatalog(models, [{ name: "coordinator", description: "Test", driver: "agent", provider: "test", model: "example", turnTimeoutMs: null, isolateWorkspace: false }]),
    scheduler: { isRunning: () => false },
    startOptions,
    inputCapabilities: async (_provider: string, model: string) => model === "image-capable" ? ["text", "image"] : input,
  } as unknown as Engine;
  const create = () => new RunChatSession({
    id: "attachment-run", engine,
    coordinator: { handle: "coordinator", displayName: "Coordinator", profile: "coordinator", runTitle: "Attachments", ownerHandle: "owner", ownerDisplayName: "Owner" },
    prompt: () => "Test", assertUsable: () => undefined, prepare: async () => undefined,
    prepareWorkspace: async () => undefined, scriptEntryFor: () => undefined,
    actorPrograms: unavailableActorPrograms,
  });
  const session = create();
  return { directory, journal, runtime, session, create, close: async () => { session.dispose(); journal.close(); await rm(directory, { recursive: true, force: true }); } };
};

test("attachment validation accepts the 20 MiB boundary without a recursive base64 regex and rejects malformed payloads", () => {
  const largest = attachment("large.bin", "application/octet-stream", Buffer.alloc(MAX_CHAT_ATTACHMENT_BYTES));
  assert.equal(parseChatAttachments([largest])[0].data.length, largest.data.length);
  assert.throws(() => parseChatAttachments([largest, attachment()]), /20 MiB/);
  assert.throws(() => parseChatAttachments(Array.from({ length: 9 }, () => attachment())), /höchstens 8/);
  for (const data of ["AA=", "%%%A", "AB==", "AAB=", "data:image/png;base64,AAAA"]) {
    assert.throws(() => parseChatAttachments([{ ...attachment(), data }]), /Base64/);
  }
  for (const name of ["../secret", "a\\b", "bad\nname", "", "."]) {
    assert.throws(() => parseChatAttachments([{ ...attachment(), name }]), /Dateinamen/);
  }
  assert.throws(() => parseChatAttachments([{ ...attachment(), mediaType: "not-a-mime" }]), /MIME/);
  assert.equal(parseChatAttachments([attachment("movie.MOV", "")])[0].mediaType, "video/mov");
  assert.equal(parseChatAttachments([attachment("notes.md", "")])[0].mediaType, "text/markdown");
});

test("unsupported media is rejected before creating a run; UTF-8 is validated before accepting text files", async () => {
  const data = await fixture(["text"]);
  const events: ChatEvent[] = [];
  const unsubscribe = data.session.subscribe((event) => events.push(event));
  try {
    await assert.rejects(data.session.send("", [attachment()]), /test\/example unterstützt image nicht/);
    await assert.rejects(data.session.send("", [attachment("video.mp4", "video/mp4")]), /video nicht/);
    await assert.rejects(data.session.send("", [attachment("report.pdf", "application/pdf")]), /file nicht/);
    await assert.rejects(data.session.send("", [attachment("bad.txt", "text/plain", Buffer.from([255]))]), /Ungültiger Anhang/);
    assert.equal(data.journal.stateOf("attachment-run"), null);
    assert.deepEqual(await data.session.capabilities(), { model: "test/example", input: ["text"] });
    assert.deepEqual(events.filter((event) => event.kind === "system" || event.kind === "user"), []);
    assert.equal(data.session.startLocked, false);
    data.session.selectStartOption("ragents.model", { model: "image-capable", thinking: "off" });
    await data.session.send("", [attachment()]);
    assert.equal(data.runtime.view("attachment-run").inputs.length, 1);
    assert.deepEqual(await data.session.capabilities(), { model: "test/image-capable", input: ["text", "image"] });
  } finally { unsubscribe(); await data.close(); }
});

test("attachment-only inputs preserve bytes and replay metadata while journals contain references only", async () => {
  const data = await fixture(["text", "image", "video", "file"]);
  try {
    const sent = attachment();
    await data.session.send("", [sent]);
    const view = data.runtime.view("attachment-run");
    assert.equal(view.inputs[0].content, "");
    assert.equal(view.inputs[0].artifactIds.length, 1);
    const artifactId = view.inputs[0].artifactIds[0];
    const loaded = data.session.attachment(artifactId);
    assert.deepEqual(Buffer.from(loaded.content), Buffer.from(sent.data, "base64"));
    assert.deepEqual(loaded.attachment, { name: "photo.png", mediaType: "image/png", size: 4, url: attachmentContentPath("attachment-run", artifactId) });
    const source = await readFile(path.join(data.directory, "runs", "attachment-run", "journal.jsonl"), "utf8");
    assert.equal(source.includes(sent.data), false);
    const restored = data.create();
    restored.attach();
    const events: ChatEvent[] = [];
    const unsubscribe = restored.subscribe((event) => events.push(event));
    unsubscribe(); restored.dispose();
    const user = events.find((event) => event.kind === "user");
    assert.ok(user && user.kind === "user");
    assert.deepEqual(user.attachments, [loaded.attachment]);
    await data.session.sendToActor(view.primaryActorId!, "Weiter", [attachment("report.pdf", "application/pdf")]);
    assert.equal(data.runtime.view("attachment-run").inputs.length, 2);
    const other = data.runtime.createRun({ commandId: "other-run" }, { runId: "other-run", title: "Other", ownerHandle: "owner", ownerDisplayName: "Owner" });
    assert.throws(() => data.runtime.artifactContent(other.id, artifactId, other.ownerId), /does not exist/);
    data.session.dispose();
    data.journal.close();
    const replay = new Journal(path.join(data.directory, "runs"), testServices());
    try {
      const runtime = new Orchestration(replay, testServices(), new DirectoryArtifactContents(path.join(data.directory, "artifacts")));
      const restoredView = runtime.view("attachment-run");
      assert.equal(restoredView.inputs[0].content, "");
      assert.deepEqual(runtime.artifactContent(restoredView.id, artifactId, restoredView.ownerId).content, Buffer.from(sent.data, "base64"));
    } finally { replay.close(); }
  } finally { await data.close(); }
});

test("script actors reject chat before publishing attachments or inputs while program inputs remain available", async () => {
  const data = await fixture(["text", "image"]);
  try {
    await data.session.send("Start");
    const view = data.runtime.view("attachment-run");
    const scriptView = data.runtime.createScriptActor({ actorId: view.ownerId, commandId: "script" }, view.id, {
      handle: "program", displayName: "Program", grants: [], toolNames: [],
    });
    const script = scriptView.actors.find((actor) => actor.kind === "script")!;
    for (const primary of [false, true]) {
      if (primary) data.runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "primary-script" }, view.id, script.id);
      const before = structuredClone(data.runtime.events(view.id));
      const sends = [
        (text: string, files?: ChatAttachmentInput[]) => data.session.sendToActor(script.id, text, files),
        (text: string, files?: ChatAttachmentInput[]) => data.session.sendToActor(`@${script.handle}`, text, files),
        ...(primary ? [(text: string, files?: ChatAttachmentInput[]) => data.session.send(text, files)] : []),
      ];
      for (const send of sends) {
        for (const files of [undefined, [attachment()]]) {
          await assert.rejects(send(files ? "" : "Starte erneut", files), (error: unknown) => {
            assert.ok(error instanceof DomainError);
            assert.equal(error.code, "actor-chat-unsupported");
            assert.equal(error.status, 400);
            return true;
          });
          assert.deepEqual(data.runtime.events(view.id), before);
          assert.deepEqual(data.runtime.view(view.id).artifacts, []);
        }
      }
      assert.deepEqual(await data.session.capabilities(script.id), { input: [], model: "TypeScript" });
      if (primary) assert.deepEqual(await data.session.capabilities(), { input: [], model: "TypeScript" });
    }
    data.runtime.enqueueInput({ actorId: view.ownerId, commandId: "program-input" }, view.id, {
      actorId: script.id, content: "START", artifactIds: [],
    });
    assert.equal(data.runtime.view(view.id).inputs.at(-1)?.content, "START");
  } finally { await data.close(); }
});

test("chat methods await enqueue, attachments are delivered as files and oversized requests are refused", async (t) => {
  const data = await fixture(["text", "image"]);
  t.after(() => data.close());
  const provider = { get: async () => data.session, list: async () => [], delete: async () => undefined };
  const server = await startRpcServer(t, {
    methods: coreMethods(coreSources(provider)),
    routes: [attachmentContentRoute(provider, undefined)],
    maxBodyBytes: MAX_CHAT_REQUEST_BYTES,
  });
  const runId = "attachment-run";
  const sent = attachment();
  assert.equal((await server.call(coreContracts.chat.send.id, { runId, text: "", attachments: [sent] })).result, null);
  const view = data.runtime.view(runId);
  assert.equal(view.inputs.length, 1, "the input exists before the answer");
  const file = await fetch(`${server.url}${attachmentContentPath(runId, view.inputs[0].artifactIds[0])}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from(sent.data, "base64"));
  const download = await fetch(`${server.url}${attachmentContentPath(runId, view.inputs[0].artifactIds[0])}?download=1`);
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment;/);
  await download.arrayBuffer();
  assert.deepEqual((await server.call(coreContracts.chat.capabilities.id, { runId, actor: "primary" })).result, { input: ["text", "image"], model: "test/example" });
  assert.equal((await server.call(coreContracts.chat.sendToActor.id, { runId, actorId: view.primaryActorId, text: "Direkt", attachments: [sent] })).result, null);
  assert.equal(data.runtime.view(runId).inputs.length, 2);
  const unsupported = await server.call(coreContracts.chat.send.id, { runId, attachments: [attachment("clip.mp4", "video/mp4")] });
  assert.equal((unsupported.error?.data as { status: number }).status, 400);
  const oversized = await fetch(`${server.url}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: " ".repeat(MAX_CHAT_REQUEST_BYTES + 1) });
  assert.equal(oversized.status, 413);
  const scriptView = data.runtime.createScriptActor({ actorId: view.ownerId, commandId: "script" }, view.id, {
    handle: "program", displayName: "Program", grants: [], toolNames: [],
  });
  const script = scriptView.actors.find((actor) => actor.kind === "script")!;
  data.runtime.selectPrimaryActor({ actorId: view.ownerId, commandId: "primary-script" }, view.id, script.id);
  const before = structuredClone(data.runtime.events(view.id));
  const attempts = [
    server.call(coreContracts.chat.send.id, { runId, text: "Starte erneut", attachments: [sent] }),
    server.call(coreContracts.chat.sendToActor.id, { runId, actorId: script.id, text: "Starte erneut", attachments: [sent] }),
    server.call(coreContracts.chat.sendToActor.id, { runId, actorId: `@${script.handle}`, text: "Starte erneut", attachments: [sent] }),
  ];
  for (const rejected of await Promise.all(attempts)) {
    assert.equal((rejected.error?.data as { code: string; status: number }).code, "actor-chat-unsupported");
    assert.equal((rejected.error?.data as { status: number }).status, 400);
    assert.deepEqual(data.runtime.events(view.id), before);
  }
});
