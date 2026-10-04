import { randomUUID } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";

const log = async (event) => {
  if (process.env.ACP_FIXTURE_LOG) await appendFile(process.env.ACP_FIXTURE_LOG, JSON.stringify(event) + "\n");
};
const sessionsFile = path.join(process.cwd(), ".fixture-acp-sessions.json");
const sessions = new Map(JSON.parse(await readFile(sessionsFile, "utf8").catch((cause) => { if (cause.code === "ENOENT") return "[]"; throw cause; })));
const turns = new Map();
const totals = new Map();
await log({ type: "start", pid: process.pid, marker: process.env.RAGENTS_RUN_ID, cwd: process.cwd(), extra: process.env.ACP_FIXTURE_EXTRA });

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const connection = new AgentSideConnection((client) => ({
  async initialize(request) {
    await log({ type: "initialize", request });
    return { protocolVersion: PROTOCOL_VERSION, agentInfo: { name: "Fixture agent", version: "1" },
      agentCapabilities: { loadSession: process.env.ACP_FIXTURE_LOAD !== "off", promptCapabilities: { image: process.env.ACP_FIXTURE_IMAGE !== "off", embeddedContext: process.env.ACP_FIXTURE_RESOURCES !== "off" }, mcpCapabilities: { http: true, sse: process.env.ACP_FIXTURE_SSE !== "off" } },
      authMethods: [{ id: "fixture-login", name: "Fixture login" }],
    };
  },
  async newSession(request) {
    if (process.env.ACP_FIXTURE_AUTH === "required") throw RequestError.authRequired();
    const sessionId = randomUUID();
    sessions.set(sessionId, request.cwd);
    await writeFile(sessionsFile, JSON.stringify([...sessions]));
    await log({ type: "new", sessionId, request });
    return { sessionId };
  },
  async loadSession(request) {
    if (!sessions.has(request.sessionId)) throw RequestError.resourceNotFound("session");
    await log({ type: "load", sessionId: request.sessionId, request });
    await client.sessionUpdate({ sessionId: request.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Replayed response" } } });
    await client.sessionUpdate({ sessionId: request.sessionId, update: { sessionUpdate: "plan", entries: [{ content: "Replayed plan", status: "completed", priority: "medium" }] } });
    return {};
  },
  async prompt({ sessionId, prompt }) {
    const text = prompt.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    await log({ type: "prompt", sessionId, prompt });
    const update = (value) => client.sessionUpdate({ sessionId, update: value });
    const chunk = (kind, text, messageId = "message-one") => update({ sessionUpdate: kind, messageId, content: { type: "text", text } });
    if (text.includes("fail with details")) {
      throw RequestError.internalError({ details: "Claude Code process exited with code 1. stderr: EPERM: operation not permitted, open '/tmp/claude-1000'" });
    }
    if (text.includes("stream tool input") || text.includes("leave tool pending") || text.includes("leave tool running")) {
      await update({ sessionUpdate: "tool_call", toolCallId: "streamed-tool", title: "Terminal", name: "Bash", kind: "execute", status: "pending", rawInput: {} });
      await update({ sessionUpdate: "tool_call_update", toolCallId: "streamed-tool", title: "Run printf", rawInput: { command: "printf 'ready\\n'" } });
      await chunk("agent_thought_chunk", "Preparing the command.");
      await update({ sessionUpdate: "tool_call_update", toolCallId: "streamed-tool", title: "Print readiness", kind: "execute", locations: [],
        rawInput: { command: "printf 'ready\\n'", description: "Print readiness", timeout: 1000 } });
      if (!text.includes("leave tool pending")) await update({ sessionUpdate: "tool_call_update", toolCallId: "streamed-tool", status: "in_progress" });
      if (text.includes("stream tool input")) {
        await update({ sessionUpdate: "tool_call_update", toolCallId: "streamed-tool", status: "completed", rawOutput: "ready" });
        await update({ sessionUpdate: "tool_call_update", toolCallId: "streamed-tool", status: "completed", rawOutput: "ready" });
      }
      await chunk("agent_message_chunk", "Command reported.");
      return { stopReason: "end_turn" };
    }
    if (text.includes("wait for cancellation") || text.includes("ignore cancellation")) {
      await chunk("agent_message_chunk", "Partial response");
      await log({ type: "partial-sent" });
      const stopReason = await new Promise((resolve) => turns.set(sessionId, { resolve, ignore: text.includes("ignore cancellation") }));
      return { stopReason };
    }
    if (text.includes("deny outside workspace")) {
      for (const operation of [
        () => client.readTextFile({ sessionId, path: path.resolve(process.cwd(), "../outside.txt") }),
        () => client.writeTextFile({ sessionId, path: path.resolve(process.cwd(), "../outside.txt"), content: "bad" }),
        () => client.writeTextFile({ sessionId, path: path.join(process.cwd(), "escape", "outside.txt"), content: "bad" }),
        () => client.createTerminal({ sessionId, command: process.execPath, args: ["-e", "process.exit(0)"], cwd: path.resolve(process.cwd(), "..") }),
      ]) {
        try { await operation(); await log({ type: "escape-accepted" }); }
        catch (cause) { await log({ type: "escape-refused", cause: String(cause) }); }
      }
      await chunk("agent_message_chunk", "Outside paths refused.");
      return { stopReason: "end_turn" };
    }
    if (text.includes("keep terminal")) {
      const terminal = await client.createTerminal({ sessionId, command: process.execPath, args: ["-e", "console.log(process.pid); setInterval(() => {}, 1000)"] });
      const deadline = Date.now() + 5000;
      const readPid = async () => {
        const output = await terminal.currentOutput();
        if (/^\d+\s*$/.test(output.output)) return output;
        if (Date.now() >= deadline) throw new Error("Fixture terminal did not report its process");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return readPid();
      };
      const output = await readPid();
      await log({ type: "terminal", terminalId: terminal.id, pid: Number(output.output.trim()) });
      await chunk("agent_message_chunk", "Terminal running.");
      return { stopReason: "end_turn" };
    }
    if (text.includes("second task")) {
      await chunk("agent_message_chunk", "Second response");
      return { stopReason: "end_turn" };
    }
    await chunk("agent_thought_chunk", "Inspecting ");
    await chunk("agent_thought_chunk", "the workspace.");
    await chunk("agent_message_chunk", "First ");
    await chunk("agent_message_chunk", "response.");
    await update({ sessionUpdate: "tool_call", toolCallId: "opaque-tool-call", title: "Update a file", name: "fixture_write", kind: "edit", status: "pending", rawInput: { path: "result.txt" } });
    const outcome = await client.requestPermission({ sessionId, toolCall: { toolCallId: "opaque-tool-call", title: "May the external agent update the file?", rawInput: { path: "result.txt", content: "first\nsecond\nthird\n" } },
      options: [{ optionId: "opaque-allow-option", name: "Allow once", kind: "allow_once" }, { optionId: "opaque-reject-option", name: "Reject once", kind: "reject_once" }],
    });
    await log({ type: "permission", outcome });
    if (outcome.outcome.outcome === "cancelled" || outcome.outcome.optionId !== "opaque-allow-option") {
      await update({ sessionUpdate: "tool_call_update", toolCallId: "opaque-tool-call", status: "failed", rawOutput: "Permission was not granted." });
      return { stopReason: "end_turn" };
    }
    await update({ sessionUpdate: "tool_call_update", toolCallId: "opaque-tool-call", status: "in_progress" });
    await client.writeTextFile({ sessionId, path: path.join(process.cwd(), "result.txt"), content: "first\nsecond\nthird\n" });
    const read = await client.readTextFile({ sessionId, path: path.join(process.cwd(), "result.txt"), line: 2, limit: 1 });
    await log({ type: "read", content: read.content });
    const terminal = await client.createTerminal({ sessionId, command: process.execPath, args: ["-e", "process.stdout.write(process.env.ACP_TERMINAL_VALUE)"], env: [{ name: "ACP_TERMINAL_VALUE", value: "Terminal output" }], outputByteLimit: 1024 });
    await terminal.waitForExit();
    const output = await terminal.currentOutput();
    await terminal.release();
    await log({ type: "terminal-output", output });
    await update({ sessionUpdate: "tool_call_update", toolCallId: "opaque-tool-call", status: "completed", content: [{ type: "content", content: { type: "text", text: "File updated. " + "x".repeat(12000) } }] });
    await update({ sessionUpdate: "plan", entries: [{ content: "Inspect the workspace", status: "completed", priority: "medium" }, { content: "Report the change", status: "in_progress", priority: "high" }] });
    await chunk("agent_message_chunk", "Final response", "message-two");
    const count = (totals.get(sessionId) ?? 0) + 1;
    totals.set(sessionId, count);
    await update({ sessionUpdate: "usage_update", used: 700, size: 10000, cost: { amount: 0.05 * count, currency: "USD" } });
    return { stopReason: "end_turn", usage: { totalTokens: 15 * count, inputTokens: 10 * count, outputTokens: 5 * count, cachedReadTokens: 2 * count, cachedWriteTokens: count } };
  },
  async cancel({ sessionId }) {
    await log({ type: "cancel", sessionId });
    const pending = turns.get(sessionId);
    if (pending && !pending.ignore) { turns.delete(sessionId); pending.resolve("cancelled"); }
  },
}), stream);
await connection.closed;
