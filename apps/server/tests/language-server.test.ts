import assert from "node:assert/strict";
import { EventEmitter, on } from "node:events";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import test, { type TestContext } from "node:test";
import { pathToFileURL } from "node:url";
import { StreamMessageReader, type Message, type RequestMessage } from "vscode-jsonrpc/node";

import type { LanguageServerSnapshot } from "../src/plugin-support/language-server/contract.ts";
import { diagnosticEntries, formatDiagnostics } from "../src/plugin-support/language-server/diagnostics.ts";
import type { LanguageServerHost } from "../src/plugin-support/language-server/host.ts";
import { createLanguageServerRoutes } from "../src/plugin-support/language-server/snapshot-route.ts";
import {
  JsonRpcConnection,
  JsonRpcError,
} from "../src/plugin-support/language-server/json-rpc.ts";
import { LanguageServerSession } from "../src/plugin-support/language-server/session.ts";
import { solutionProjects } from "../src/plugin-support/language-server/solution.ts";
import { createSandboxTools, withAnnotation } from "../src/plugin-support/sandbox-tools.ts";
import { capturedJson } from "./runtime-fixture.ts";

const frame = (message: object): Buffer => {
  const body = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
};

const rpcFixture = (t: TestContext, onRequest: (method: string, params: unknown) => Promise<unknown> = async () => null) => {
  const input = new PassThrough();
  const output = new PassThrough();
  const events = new EventEmitter();
  const received = on(events, "message");
  const reader = new StreamMessageReader(output);
  reader.partialMessageTimeout = 0;
  reader.listen((message) => events.emit("message", message));
  const notifications: Array<{ method: string; params: unknown }> = [];
  const failures: Error[] = [];
  const connection = new JsonRpcConnection({
    label: "Test",
    input,
    output,
    onRequest,
    onNotification: (method, params) => notifications.push({ method, params }),
    onError: (error) => failures.push(error),
  });
  t.after(() => {
    connection.close(new Error("Test beendet"));
    void received.return();
    reader.dispose();
    input.destroy();
    output.destroy();
  });
  return {
    connection,
    input,
    output,
    notifications,
    failures,
    send: (message: object) => {
      input.write(frame(message));
    },
    next: async <T extends Message = RequestMessage>() => (await received.next()).value![0] as T,
  };
};

test("JSON-RPC reassembles Unicode frames across byte boundaries and forwards notifications", { timeout: 2_000 }, async (t) => {
  const { connection, input, send, next, notifications } = rpcFixture(t);
  const data = Buffer.concat([
    frame({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: { text: "äöü" } }),
    frame({ jsonrpc: "2.0", method: "$/progress", params: { token: "load", value: { kind: "end" } } }),
  ]);
  for (const byte of data) input.write(Buffer.from([byte]));
  const pending = connection.request("barrier", {});
  const request = await next();
  send({ jsonrpc: "2.0", id: request.id, result: null });
  await pending;
  assert.deepEqual(notifications, [
    { method: "textDocument/publishDiagnostics", params: { text: "äöü" } },
    { method: "$/progress", params: { token: "load", value: { kind: "end" } } },
  ]);
});

test("JSON-RPC correlates out-of-order replies and preserves server error details", { timeout: 2_000 }, async (t) => {
  const { connection, send, next } = rpcFixture(t);
  const first = connection.request("initialize", { a: 1 });
  const second = connection.request("textDocument/diagnostic", {});
  const firstRequest = await next();
  const secondRequest = await next();
  assert.deepEqual(firstRequest.params, { a: 1 });
  const rejected = assert.rejects(second, (error: unknown) => {
    assert.ok(error instanceof JsonRpcError);
    assert.equal(error.code, -32801);
    assert.equal(error.message, "Test: textDocument/diagnostic fehlgeschlagen: busy");
    assert.deepEqual(error.data, { retry: true });
    return true;
  });
  send({ jsonrpc: "2.0", id: secondRequest.id, error: { code: -32801, message: "busy", data: { retry: true } } });
  send({ jsonrpc: "2.0", id: firstRequest.id, result: { capabilities: {} } });
  await rejected;
  assert.deepEqual(await first, { capabilities: {} });
});

test("JSON-RPC answers server requests, reports handler errors and sends notifications", { timeout: 2_000 }, async (t) => {
  const { connection, send, next } = rpcFixture(t, async (method, params) => {
    if (method === "fail") throw new Error("kaputt");
    if (method === "empty") return undefined;
    return (params as { items: unknown[] }).items.map(() => null);
  });
  send({ jsonrpc: "2.0", id: "config", method: "workspace/configuration", params: { items: [{}, {}] } });
  assert.deepEqual(await next(), { jsonrpc: "2.0", id: "config", result: [null, null] });
  send({ jsonrpc: "2.0", id: 7, method: "empty", params: {} });
  assert.deepEqual(await next(), { jsonrpc: "2.0", id: 7, result: null });
  send({ jsonrpc: "2.0", id: 8, method: "fail", params: {} });
  assert.deepEqual(await next(), {
    jsonrpc: "2.0", id: 8, error: { code: -32603, message: "Request fail failed with message: kaputt" },
  });
  connection.notify("initialized", {});
  assert.deepEqual(await next(), { jsonrpc: "2.0", method: "initialized", params: {} });
});

test("JSON-RPC omits parameters for shutdown and exit", { timeout: 2_000 }, async (t) => {
  const { connection, send, next } = rpcFixture(t);
  const pending = connection.request("shutdown", null);
  const request = await next();
  assert.equal(request.method, "shutdown");
  assert.equal(Object.hasOwn(request, "params"), false);
  send({ jsonrpc: "2.0", id: request.id, result: null });
  await pending;
  connection.notify("exit", null);
  assert.deepEqual(await next(), { jsonrpc: "2.0", method: "exit" });
});

test("JSON-RPC aborts locally without a server reply and sends the matching cancellation", { timeout: 2_000 }, async (t) => {
  const { connection, send, next } = rpcFixture(t);
  const controller = new AbortController();
  const reason = new Error("Benutzerabbruch");
  const pending = connection.request("slow", {}, controller.signal);
  const request = await next();
  const rejected = assert.rejects(pending, (error) => error === reason);
  controller.abort(reason);
  await rejected;
  assert.deepEqual(await next(), { jsonrpc: "2.0", method: "$/cancelRequest", params: { id: request.id } });
  send({ jsonrpc: "2.0", id: request.id, result: "late" });
  const subsequent = connection.request("next", {});
  const nextRequest = await next();
  send({ jsonrpc: "2.0", id: nextRequest.id, result: "ok" });
  assert.equal(await subsequent, "ok");
});

test("JSON-RPC does not send requests whose signal was already aborted", { timeout: 2_000 }, async (t) => {
  const { connection, send, next } = rpcFixture(t);
  await assert.rejects(connection.request("cancelled", {}, AbortSignal.abort("stop")), /cancelled wurde abgebrochen/);
  const pending = connection.request("active", {});
  const request = await next();
  assert.equal(request.method, "active");
  send({ jsonrpc: "2.0", id: request.id, result: null });
  await pending;
});

test("closing JSON-RPC rejects every outstanding request and later operations with the cause", async (t) => {
  const { connection } = rpcFixture(t);
  const reason = new Error("Server wurde beendet");
  const first = assert.rejects(connection.request("first", {}), (error) => error === reason);
  const second = assert.rejects(connection.request("second", {}), (error) => error === reason);
  connection.close(reason);
  connection.close(new Error("ignored"));
  await Promise.all([first, second]);
  await assert.rejects(connection.request("late", {}), (error) => error === reason);
  assert.throws(() => connection.notify("late", {}), (error) => error === reason);
});

for (const invalid of [Buffer.from("Other: 1\r\n\r\n"), Buffer.from("Content-Length: 1\r\n\r\n{")]) {
  test("JSON-RPC reports malformed input and rejects pending requests", { timeout: 2_000 }, async (t) => {
    const { connection, input, failures } = rpcFixture(t);
    const pending = assert.rejects(connection.request("waiting", {}), /Test: JSON-RPC-Verbindung fehlgeschlagen:/);
    input.write(invalid);
    await pending;
    assert.equal(failures.length, 1);
  });
}

test("JSON-RPC rejects pending requests when its transport closes", { timeout: 2_000 }, async (t) => {
  const { connection, input, failures } = rpcFixture(t);
  const pending = assert.rejects(connection.request("waiting", {}), /Verbindung geschlossen/);
  input.destroy();
  await pending;
  assert.equal(failures.length, 1);
});

test("JSON-RPC reports failed writes without unhandled rejections and handles errors after disposal", { timeout: 2_000 }, async () => {
  const input = new PassThrough();
  const output = new Writable({
    write: (_chunk, _encoding, callback) => callback(new Error("broken pipe")),
  });
  const failures: Error[] = [];
  const connection = new JsonRpcConnection({
    label: "Test",
    input,
    output,
    onRequest: async () => null,
    onNotification: () => undefined,
    onError: (error) => failures.push(error),
  });
  try {
    await assert.rejects(connection.request("initialize", {}), /broken pipe/);
    assert.equal(failures.length, 1);
    assert.doesNotThrow(() => output.emit("error", new Error("late EPIPE")));
    assert.equal(failures.length, 1);
  } finally {
    connection.close(new Error("Test beendet"));
    input.destroy();
    output.destroy();
  }
});

const startFakeSession = (script: string, command = process.execPath) => LanguageServerSession.start({
  label: "Test LSP",
  command,
  args: ["--input-type=module", "-e", script],
  cwd: process.cwd(),
  env: process.env,
  rootUri: pathToFileURL(process.cwd()).href,
  languages: {},
}, 2_000);

test("language-server sessions initialize and shut down over managed process streams", { timeout: 5_000 }, async () => {
  const session = await startFakeSession(`
    import { createMessageConnection } from "vscode-jsonrpc/node";
    const connection = createMessageConnection(process.stdin, process.stdout);
    connection.onRequest("initialize", () => ({ capabilities: { diagnosticProvider: {} } }));
    connection.onRequest("shutdown", () => null);
    connection.onNotification("exit", () => process.exit(0));
    connection.listen();
  `);
  try {
    assert.equal(session.usesPullDiagnostics, true);
    assert.equal(session.exited, false);
  } finally {
    await session.shutdown();
  }
  assert.equal(session.exited, true);
});

test("language-server sessions terminate a process that sends malformed protocol output", { timeout: 5_000 }, async () => {
  await assert.rejects(startFakeSession(`
    process.stdout.write("Other: 1\\r\\n\\r\\n");
    setInterval(() => {}, 1000);
  `), /Test LSP: JSON-RPC-Verbindung fehlgeschlagen:/);
});

test("language-server sessions report a missing executable", { timeout: 5_000 }, async () => {
  await assert.rejects(startFakeSession("", "/missing/ragents-test-language-server"), /ENOENT/);
});

test("diagnostics are listed errors first, warnings only counted unless requested", () => {
  const diagnostics = [
    { range: { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } }, severity: 2, code: "CS8602", message: "Dereference" },
    { range: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } }, severity: 1, code: "CS1002", message: "; expected\nmore" },
    { range: { start: { line: 1, character: 8 }, end: { line: 1, character: 9 } }, severity: 1, code: "CS0103", message: "The name 'x' does not exist" },
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 4, message: "hint" },
  ];
  assert.equal(formatDiagnostics("Roslyn", "src/Foo.cs", diagnostics, false), [
    "Diagnostik (Roslyn) src/Foo.cs: 2 Fehler, 1 Warnung",
    "src/Foo.cs:2:9 error CS0103: The name 'x' does not exist",
    "src/Foo.cs:10:1 error CS1002: ; expected",
  ].join("\n"));
  assert.equal(formatDiagnostics("Roslyn", "src/Foo.cs", diagnostics, true).split("\n").at(-1),
    "src/Foo.cs:5:3 warning CS8602: Dereference");
  assert.equal(formatDiagnostics("Roslyn", "src/Foo.cs", [], false), "Diagnostik (Roslyn) src/Foo.cs: keine Fehler");
});

test("diagnostic entries carry one-based places, named severities and the first message line", () => {
  assert.deepEqual(diagnosticEntries([
    { range: { start: { line: 4, character: 2 }, end: { line: 4, character: 5 } }, severity: 2, code: "CS8602", message: "Dereference" },
    { range: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } }, severity: 1, code: 1002, message: "; expected\nmore" },
    { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: "no severity" },
  ]), [
    { line: 1, character: 1, severity: "error", message: "no severity" },
    { line: 10, character: 1, severity: "error", code: "1002", message: "; expected" },
    { line: 5, character: 3, severity: "warning", code: "CS8602", message: "Dereference" },
  ]);
});

const snapshotRoute = (servers: Partial<LanguageServerHost>, ensureSession: (runId: string) => void) =>
  createLanguageServerRoutes({
    pluginId: "ragents.lsp-roslyn",
    servers: servers as LanguageServerHost,
    ensureSession,
  })[0];

test("the snapshot route answers with the state and the diagnostics of the run", async () => {
  const snapshot: LanguageServerSnapshot = {
    state: "ready",
    root: "/work/Sample.sln",
    summary: "Sample.sln geladen",
    files: [{ path: "src/Foo.cs", diagnostics: [{ line: 3, character: 1, severity: "error", message: "kaputt" }] }],
  };
  const guarded: string[] = [];
  const route = snapshotRoute({ snapshot: (runId) => Promise.resolve({ ...snapshot, summary: runId }) }, (runId) => {
    guarded.push(runId);
  });
  const url = new URL("http://host/api/plugins/ragents.lsp-roslyn/runs/run-1/language-server");
  const request = { method: "GET" } as IncomingMessage;
  const { captured, response } = capturedJson();

  assert.ok(route.isApiPath(url.pathname));
  assert.ok(route.matches(request, url));
  assert.ok(!route.matches({ method: "POST" } as IncomingMessage, url));
  assert.ok(!route.isApiPath("/api/plugins/ragents.lsp-fsharp/runs/run-1/language-server"));

  await route.handle({ request, response, url });

  assert.deepEqual(guarded, ["run-1"]);
  assert.equal(captured.status, 200);
  assert.deepEqual(captured.body, { ...snapshot, summary: "run-1" });
});

test("the snapshot route reports an unknown session instead of asking the host", async () => {
  const route = snapshotRoute({ snapshot: () => Promise.reject(new Error("nicht gefragt")) }, () => {
    throw new Error("Unterhaltung run-9 ist unbekannt");
  });
  const url = new URL("http://host/api/plugins/ragents.lsp-roslyn/runs/run-9/language-server");
  const { captured, response } = capturedJson();

  await route.handle({ request: { method: "GET" } as IncomingMessage, response, url });

  assert.equal(captured.status, 400);
  assert.deepEqual(captured.body, { error: "Unterhaltung run-9 ist unbekannt" });
});

test("solution projects are resolved next to the .sln with forward slashes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ragents-sln-"));
  try {
    const solution = path.join(directory, "Sample.sln");
    await writeFile(solution, [
      "Project(\"{9A19103F-16F7-4668-BE54-9A1E7A4F7556}\") = \"CSharpLib\", \"CSharpLib\\CSharpLib.csproj\", \"{1}\"",
      "Project(\"{2150E333-8FDC-42A3-9474-1A3956D46DE8}\") = \"Ordner\", \"Ordner\", \"{2}\"",
      "Project(\"{6EC3EE1D-3C4E-46DD-8F32-0CC8E7565705}\") = \"FSharpLib\", \"FSharpLib/FSharpLib.fsproj\", \"{3}\"",
    ].join("\n"));
    assert.deepEqual(await solutionProjects(solution), [
      path.join(directory, "CSharpLib", "CSharpLib.csproj"),
      path.join(directory, "FSharpLib", "FSharpLib.fsproj"),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("mitAnmerkung appends a text part and leaves results without content alone", () => {
  assert.deepEqual(withAnnotation({ content: [{ type: "text", text: "ok" }], details: 1 }, "Hinweis"),
    { content: [{ type: "text", text: "ok" }, { type: "text", text: "Hinweis" }], details: 1 });
  const untouched = { content: [{ type: "text", text: "ok" }] };
  assert.equal(withAnnotation(untouched, undefined), untouched);
  assert.equal(withAnnotation("text", "Hinweis"), "text");
});

test("edit and write results carry the annotation of the written file", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "ragents-sandbox-")));
  const home = path.join(directory, "home");
  const annotated: string[] = [];
  const tools = await createSandboxTools(
    "run-sandbox",
    {
      cwd: directory,
      currentRoot: () => Promise.resolve(directory),
      ensureWritable: () => Promise.resolve(directory),
      runOperation: (operation) => operation(),
    },
    [],
    undefined,
    { home },
    undefined,
    async (absolutePath) => {
      annotated.push(absolutePath);
      return absolutePath.endsWith(".cs") ? "Diagnostik (Roslyn) Foo.cs: keine Fehler" : undefined;
    },
  );
  try {
    const byName = (name: string) => tools.find((tool) => (tool as { name: string }).name === name) as {
      execute: (id: string, params: unknown, signal?: AbortSignal) => Promise<{ content: Array<{ text?: string }> }>;
    };
    const written = await byName("write").execute("1", { path: "Foo.cs", content: "class Foo {}" });
    assert.equal(written.content.at(-1)?.text, "Diagnostik (Roslyn) Foo.cs: keine Fehler");
    const edited = await byName("edit").execute("2", { path: "Foo.cs", edits: [{ oldText: "Foo", newText: "Bar" }] });
    assert.equal(edited.content.at(-1)?.text, "Diagnostik (Roslyn) Foo.cs: keine Fehler");
    const plain = await byName("write").execute("3", { path: "notes.md", content: "x" });
    assert.equal(plain.content.length, 1);
    assert.deepEqual(annotated, [
      path.join(directory, "Foo.cs"),
      path.join(directory, "Foo.cs"),
      path.join(directory, "notes.md"),
    ]);
  } finally {
    await tools.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});
