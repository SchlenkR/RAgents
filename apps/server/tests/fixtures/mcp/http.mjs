import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { Server as ModernServer, createMcpHandler, inputRequired } from "@modelcontextprotocol/server";
import { Server as LegacyServer } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, InitializeRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fixtureInstructions, mcpScenario } from "./scenario.mjs";

const readJson = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
};

export const httpFixture = async (kind, { rejectStatus, rejectPost = 405, authorization, protocolVersion = "2025-03-26", stallTermination = false } = {}) => {
  const log = [];
  const record = (entry) => log.push(entry);
  const scenario = mcpScenario(record);
  const sessions = new Map();
  const servers = new Set();
  const streams = new Set();
  const modern = createMcpHandler(() => {
    const server = new ModernServer({ name: "modern-http-fixture", version: "1" }, { capabilities: { tools: { listChanged: true } }, instructions: fixtureInstructions });
    server.setRequestHandler("tools/list", () => ({ tools: scenario.definitions() }));
    server.setRequestHandler("tools/call", (request, context) => scenario.call(request.params.name, request.params.arguments ?? {}, {
      signal: context.mcpReq.signal,
      changed: () => modern.notify.toolsChanged(),
      progress: (progress, total) => context.mcpReq.notify({ method: "notifications/progress", params: { progressToken: context.mcpReq._meta?.progressToken, progress, total } }),
      roots: () => context.mcpReq.inputResponses?.roots
        ? { content: [{ type: "text", text: JSON.stringify(context.mcpReq.inputResponses.roots) }] }
        : inputRequired({ inputRequests: { roots: inputRequired.listRoots() } }),
    }));
    return server;
  }, { legacy: "reject", keepAliveMs: 0, onerror: (error) => record({ type: "server.error", message: error.message }) });
  const legacyServer = (version) => {
    const server = new LegacyServer({ name: "legacy-http-fixture", version: "1" }, { capabilities: { tools: { listChanged: true } }, instructions: fixtureInstructions });
    server.setRequestHandler(InitializeRequestSchema, (request) => ({ protocolVersion: version, capabilities: { tools: { listChanged: true } }, serverInfo: { name: "legacy-http-fixture", version: "1" }, instructions: fixtureInstructions }));
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: scenario.definitions() }));
    server.setRequestHandler(CallToolRequestSchema, (request, context) => scenario.call(request.params.name, request.params.arguments ?? {}, {
      signal: context.signal,
      changed: () => server.sendToolListChanged(),
      progress: (progress, total) => context.sendNotification({ method: "notifications/progress", params: { progressToken: context._meta?.progressToken, progress, total } }),
      roots: async () => ({ content: [{ type: "text", text: JSON.stringify(await server.listRoots()) }] }),
    }));
    servers.add(server);
    return server;
  };
  const listener = createServer((request, response) => {
    const abort = new AbortController();
    response.on("close", () => abort.abort());
    void (async () => {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const body = request.method === "POST" ? await readJson(request) : undefined;
      record({ type: "http.received", method: request.method, pathname, ...(body?.method ? { rpc: body.method } : {}) });
      if (request.method === "GET" && pathname === "/mcp") {
        streams.add(response);
        response.on("close", () => streams.delete(response));
      }
      if (request.method === "DELETE" && stallTermination) return;
      if (authorization !== undefined && request.headers.authorization !== authorization) {
        response.writeHead(401).end("Fixture requires its static authorization header");
        return;
      }
      if (rejectStatus !== undefined) {
        response.writeHead(rejectStatus).end("Intentional HTTP connection rejection");
        return;
      }
      if (kind === "sse-hang") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
        response.flushHeaders();
        return;
      }
      if (kind === "http-hang") return;
      if (kind === "sse") {
        if (request.method === "GET" && pathname === "/mcp") {
          const transport = new SSEServerTransport("/messages", response);
          const server = legacyServer("2024-11-05");
          sessions.set(transport.sessionId, transport);
          response.on("close", () => { sessions.delete(transport.sessionId); record({ type: "session.closed" }); });
          await server.connect(transport);
          return;
        }
        if (request.method === "POST" && pathname === "/messages") {
          const sessionId = new URL(request.url, "http://localhost").searchParams.get("sessionId");
          const transport = sessions.get(sessionId);
          if (!transport) { response.writeHead(404).end("No fixture session"); return; }
          await transport.handlePostMessage(request, response, body);
          return;
        }
        response.writeHead(rejectPost).end("Legacy SSE endpoint accepts GET only");
        return;
      }
      if (kind === "streamable-legacy") {
        if (body?.method === "server/discover") {
          response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } }));
          return;
        }
        const sessionId = request.headers["mcp-session-id"];
        const known = sessions.get(sessionId);
        if (known) { await known.handleRequest(request, response, body); return; }
        if (body?.method !== "initialize") { response.writeHead(404).end("No fixture session"); return; }
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (id) => sessions.set(id, transport) });
        transport.onclose = () => { sessions.delete(transport.sessionId); record({ type: "session.closed" }); };
        await legacyServer(protocolVersion).connect(transport);
        await transport.handleRequest(request, response, body);
        return;
      }
      const headers = Object.fromEntries(Object.entries(request.headers).filter((entry) => typeof entry[1] === "string"));
      const outgoing = await modern.fetch(new Request(`http://${request.headers.host}${request.url}`, {
        method: request.method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: abort.signal,
      }));
      response.writeHead(outgoing.status, Object.fromEntries(outgoing.headers));
      response.flushHeaders();
      if (!outgoing.body) { response.end(); return; }
      const reader = outgoing.body.getReader();
      try {
        while (!abort.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          response.write(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        response.end();
      }
    })().catch((error) => {
      record({ type: "http.error", message: error.message });
      if (!response.headersSent) response.writeHead(500);
      response.end(error.message);
    });
  });
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  return {
    url: `http://127.0.0.1:${listener.address().port}/mcp`,
    log,
    subscriptions: () => modern.bus.listenerCount,
    sessionCount: () => sessions.size,
    openStreams: () => streams.size,
    disconnect: async () => { await Promise.all([...sessions.values()].map((transport) => transport.close())); },
    close: async () => {
      await modern.close();
      await Promise.all([...servers].map((server) => server.close()));
      listener.closeAllConnections();
      await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    },
  };
};
