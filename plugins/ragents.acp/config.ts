export interface AcpAgentDefinition {
  readonly title?: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export type AcpAgents = Readonly<Record<string, AcpAgentDefinition>>;

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim() !== "" && !value.includes("\0");

export const parseAcpAgents = (value: unknown): AcpAgents => {
  if (value === undefined) return {};
  if (!record(value)) throw new Error("ACP_AGENTS must be a map of agent server definitions");
  return Object.fromEntries(Object.entries(value).map(([name, entry]) => {
    const fail = (cause: string): never => { throw new Error(`ACP_AGENTS.${name}: ${cause}`); };
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name)) fail("names need 1 to 40 letters, digits, underscores or hyphens");
    if (!record(entry)) return fail("needs an agent server definition");
    const unknown = Object.keys(entry).filter((key) => !["title", "command", "args", "env"].includes(key));
    if (unknown.length) fail(`unknown fields: ${unknown.join(", ")}`);
    if (!text(entry.command)) fail("command needs non-empty text");
    if (entry.title !== undefined && !text(entry.title)) fail("title needs non-empty text");
    if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some((arg) => typeof arg !== "string" || arg.includes("\0")))) fail("args needs a list of strings");
    if (entry.env !== undefined && (!record(entry.env) || Object.entries(entry.env).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0")))) fail("env needs a map of environment names to strings");
    return [name, Object.freeze({ command: entry.command as string,
      ...(entry.title === undefined ? {} : { title: entry.title as string }),
      ...(entry.args === undefined ? {} : { args: Object.freeze([...(entry.args as string[])]) }),
      ...(entry.env === undefined ? {} : { env: Object.freeze({ ...entry.env as Record<string, string> }) }),
    })];
  }));
};
