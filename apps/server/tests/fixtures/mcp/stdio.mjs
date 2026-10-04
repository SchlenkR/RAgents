import { appendFileSync } from "node:fs";
import { Server as ModernServer, inputRequired } from "@modelcontextprotocol/server";
import { StdioServerTransport as ModernTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { Server as LegacyServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport as LegacyTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { fixtureInstructions, mcpScenario } from "./scenario.mjs";

const mode = process.argv[2];
const logFile = process.argv[3];
const protocolVersion = process.argv[4] ?? "2024-11-05";
const record = (entry) => appendFileSync(logFile, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
record({ type: "process.started" });
process.on("exit", (code) => record({ type: "process.exited", code }));

const observe = (Base) => class extends Base {
  async start() {
    const receive = this.onmessage;
    this.onmessage = (message) => {
      if (message.method) record({ type: "message.received", method: message.method, ...(message.method === "initialize" ? { capabilities: message.params.capabilities } : {}) });
      if (mode === "legacy-strict" && message.method === "server/discover") {
        process.stderr.write("Legacy server refuses pre-initialize requests\n");
        process.exit(67);
      }
      receive?.(message);
    };
    await super.start();
  }
  async send(message) {
    const outgoing = mode === "legacy-strict" && message.result?.protocolVersion
      ? { ...message, result: { ...message.result, protocolVersion } }
      : message;
    await super.send(outgoing);
  }
};

if (mode === "hang") {
  process.stderr.write("Fixture never answers initialization\n");
  process.stdin.resume();
} else if (mode === "stderr-failure") {
  process.stderr.write(`${"diagnostic ".repeat(4_000)}\nFinal fixture cause: ${process.env.MCP_TEST_VALUE}\n`, () => process.exit(68));
} else if (mode === "legacy-strict") {
  const server = new LegacyServer({ name: "legacy-fixture", version: "1" }, { capabilities: { tools: { listChanged: true } }, instructions: fixtureInstructions });
  const scenario = mcpScenario(record);
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: scenario.definitions() }));
  server.setRequestHandler(CallToolRequestSchema, (request, context) => scenario.call(request.params.name, request.params.arguments ?? {}, {
    signal: context.signal,
    changed: () => server.sendToolListChanged(),
    progress: (progress, total) => context.sendNotification({ method: "notifications/progress", params: { progressToken: context._meta?.progressToken, progress, total } }),
    roots: async () => ({ content: [{ type: "text", text: JSON.stringify(await server.listRoots()) }] }),
  }));
  await server.connect(new (observe(LegacyTransport))());
} else if (mode === "modern") {
  const scenario = mcpScenario(record);
  serveStdio(() => {
    const server = new ModernServer({ name: "modern-fixture", version: "1" }, { capabilities: { tools: { listChanged: true } }, instructions: fixtureInstructions });
    server.setRequestHandler("tools/list", () => ({ tools: scenario.definitions() }));
    server.setRequestHandler("tools/call", (request, context) => scenario.call(request.params.name, request.params.arguments ?? {}, {
      signal: context.mcpReq.signal,
      changed: () => server.sendToolListChanged(),
      progress: (progress, total) => context.mcpReq.notify({ method: "notifications/progress", params: { progressToken: context.mcpReq._meta?.progressToken, progress, total } }),
      roots: () => context.mcpReq.inputResponses?.roots
        ? { content: [{ type: "text", text: JSON.stringify(context.mcpReq.inputResponses.roots) }] }
        : inputRequired({ inputRequests: { roots: inputRequired.listRoots() } }),
    }));
    return server;
  }, { legacy: "reject", transport: new (observe(ModernTransport))(), onerror: (error) => record({ type: "server.error", message: error.message }) });
} else {
  throw new Error(`Unknown fixture mode ${mode}`);
}
