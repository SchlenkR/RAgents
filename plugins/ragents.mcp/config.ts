export type McpServerDefinition =
  | { readonly type?: "stdio"; readonly command: string; readonly args?: readonly string[]; readonly env?: Readonly<Record<string, string>>; readonly cwd?: string }
  | { readonly type?: "http" | "sse"; readonly url: string; readonly headers?: Readonly<Record<string, string>> };

export type McpServers = Readonly<Record<string, McpServerDefinition>>;

const serverName = /^[A-Za-z0-9_-]{1,40}$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

export const parseMcpServers = (value: unknown): McpServers => {
  if (value === undefined) return {};
  if (!record(value)) throw new Error("MCP_SERVERS must be a map of server names to definitions");
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => {
    const at = `MCP_SERVERS.${name}`;
    const fail = (cause: string): never => { throw new Error(`${at}: ${cause}`); };
    if (!serverName.test(name)) fail("server names need 1 to 40 letters, digits, underscores or hyphens");
    if (!record(entry)) return fail("needs a server definition");
    const stdio = entry.command !== undefined || entry.type === "stdio";
    const allowed = stdio ? ["type", "command", "args", "env", "cwd"] : ["type", "url", "headers"];
    const unknown = Object.keys(entry).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) fail(`unknown fields: ${unknown.join(", ")}; allowed: ${allowed.join(", ")}`);
    const strings = (field: "env" | "headers"): Readonly<Record<string, string>> | undefined => {
      const input = entry[field];
      if (input === undefined) return undefined;
      if (!record(input) || Object.values(input).some((text) => typeof text !== "string")) return fail(`${field} needs a map of strings`);
      if (Object.keys(input).some((key) => field === "env" ? !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) : !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key))) fail(`${field} contains an invalid name`);
      if (field === "headers" && Object.values(input).some((text) => /[\r\n]/.test(text as string))) fail("headers cannot contain line breaks");
      return Object.freeze({ ...input }) as Readonly<Record<string, string>>;
    };
    if (stdio) {
      if (entry.type !== undefined && entry.type !== "stdio") fail("command requires type stdio or no type");
      if (!nonempty(entry.command)) fail("command needs non-empty text");
      if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== "string"))) fail("args needs a list of strings");
      if (entry.cwd !== undefined && (!nonempty(entry.cwd) || /^(?:[/\\]|[A-Za-z]:)/.test(entry.cwd) || entry.cwd.split(/[/\\]/).includes(".."))) fail("cwd must be relative to and within the workspace");
      const env = strings("env");
      return [name, Object.freeze({ command: entry.command as string, ...(entry.type ? { type: "stdio" as const } : {}), ...(entry.args ? { args: Object.freeze([...(entry.args as string[])]) } : {}), ...(env ? { env } : {}), ...(entry.cwd ? { cwd: entry.cwd as string } : {}) })];
    }
    if (entry.type !== undefined && entry.type !== "http" && entry.type !== "sse") fail("type must be stdio, http or sse");
    const url = typeof entry.url === "string" && URL.canParse(entry.url) ? new URL(entry.url) : undefined;
    if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) fail("url needs an HTTP(S) address without credentials or a fragment");
    const headers = strings("headers");
    return [name, Object.freeze({ url: entry.url as string, ...(entry.type ? { type: entry.type as "http" | "sse" } : {}), ...(headers ? { headers } : {}) })];
  }));
};
