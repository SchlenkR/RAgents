import { Type } from "typebox";
import { defineChannel, defineOperation } from "@ragents/engine/src/rpc/contract";
import type { McpServers } from "./config.js";

export const MCP_PLUGIN_ID = "ragents.mcp";

export const mcpContracts = {
  closeConnections: defineOperation({
    id: "ragents.mcp.connections.close",
    description: "Close a run's MCP connections while preserving its private server definitions for the next connection.",
    rights: ["runs.read", "runs.write"],
    input: Type.Object({ runId: Type.String({ minLength: 1, maxLength: 64 }) }, { additionalProperties: false }),
    result: Type.Null(),
  }),
  setServers: defineOperation({
    id: "ragents.mcp.servers.set",
    description: "Replace a run's external MCP servers before its next turn. Definitions stay in private plugin storage, outside the journal and model context. Refused while an actor is running or input is queued.",
    rights: ["runs.read", "runs.write", "runs.create"],
    input: Type.Object({
      runId: Type.String({ minLength: 1, maxLength: 64 }),
      servers: Type.Unsafe<McpServers>({ type: "object", additionalProperties: true, "x-typescript-type": "McpServers" }),
    }, { additionalProperties: false }),
    result: Type.Null(),
  }),
  status: defineChannel({
    id: "ragents.mcp.status",
    description: "Connection state of a run's MCP servers, without their definitions or credentials.",
    rights: ["runs.read", "ragents.mcp.read"],
    params: Type.Object({ runId: Type.String({ minLength: 1 }) }, { additionalProperties: false }),
    message: Type.Object({ servers: Type.Array(Type.Object({
      name: Type.String(),
      transport: Type.Union([Type.Literal("stdio"), Type.Literal("http"), Type.Literal("sse")]),
      protocolVersion: Type.Optional(Type.String()),
      state: Type.Union([Type.Literal("connecting"), Type.Literal("connected"), Type.Literal("failed"), Type.Literal("closed")]),
      error: Type.Optional(Type.String()),
      toolCount: Type.Integer({ minimum: 0 }),
    }, { additionalProperties: false })) }, { additionalProperties: false }),
  }),
};
