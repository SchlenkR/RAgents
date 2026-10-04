import { createHash } from "node:crypto";

export const mcpToolName = (server: string, tool: string): string => {
  const raw = `mcp__${server}__${tool}`;
  const clean = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  if (raw === clean && clean.length <= 64 && !server.includes("__") && !tool.includes("__") && !/_[0-9a-f]{12}$/.test(raw)) return clean;
  const suffix = createHash("sha256").update(JSON.stringify([server, tool])).digest("hex").slice(0, 12);
  return `${clean.slice(0, 51)}_${suffix}`;
};
