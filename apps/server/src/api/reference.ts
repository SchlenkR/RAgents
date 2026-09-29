import type { TSchema } from "typebox";
import { RPC_METHODS, type ChannelDescriptor, type MethodDescriptor, type PluginHost } from "@ragents/engine";

export type ApiAuthentication = { kind: "open" } | { kind: "token" } | { kind: "users"; cookieName: string };

export const RPC_API_TITLE = "RAgents JSON-RPC API";

const schemaJson = (schema: TSchema): Record<string, unknown> => JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

const byId = <T extends { id: string }>(entries: readonly T[]): T[] =>
  [...entries].sort((left, right) => left.id.localeCompare(right.id, "en"));

const rights = (entry: { rights: readonly string[] }): string => entry.rights.length > 0 ? entry.rights.join(", ") : "no fixed rights";

export const authenticationDescription = (authentication: ApiAuthentication): string => authentication.kind === "users"
  ? "User sign-in: POST /api/access/login with id and password. Send the received session cookie with further requests. ACCESS_TOKEN does not replace user sign-in."
  : authentication.kind === "token" ? "This profile requires the configured ACCESS_TOKEN as a bearer token or the existing access cookie."
    : "This profile requires no sign-in. Profiles with users use session cookies; without users, ACCESS_TOKEN can protect the existing access.";

const transportLines = (authentication: ApiAuthentication, example: string): string[] => [
  "The API is JSON-RPC 2.0. A request is an object with jsonrpc, id, method and params; params is always the method's input object. The response contains result or error; error.data names the error's code and status.",
  "",
  "Transports:",
  "",
  "- HTTP: `POST /rpc` with exactly one message per request. `GET /rpc/stream` delivers the server's notifications and requests as server-sent events; the first event `hello` names the connection id, which further requests send in the header `x-ragents-connection`.",
  "- stdio: the server starts with `--stdio` and exchanges one JSON message per line over stdin and stdout.",
  "",
  `Fixed methods of the message layer: ${RPC_METHODS.subscribe}, ${RPC_METHODS.unsubscribe}, ${RPC_METHODS.event}, ${RPC_METHODS.cancel} and ${RPC_METHODS.progress}. A subscription names channel and params and receives a subscription id; every message of the channel arrives as ${RPC_METHODS.event}.`,
  "",
  authenticationDescription(authentication),
  "",
  "The shell variable RAGENTS_API_BASE_URL contains the server address. If RAGENTS_API_TOKEN is set, send the header Authorization: Bearer <token> with requests. The token does not belong in output or documents.",
  "",
  "```sh",
  `curl -s "$RAGENTS_API_BASE_URL/rpc" -H 'content-type: application/json' \\`,
  `  -d '{"jsonrpc":"2.0","id":1,"method":"${example}","params":{}}'`,
  "```",
  "",
  "Ids from results are reused programmatically, not copied by hand.",
];

const methodSection = (method: MethodDescriptor): string[] => [
  `## ${method.id}`,
  "",
  method.description,
  "",
  `Owner: ${method.owner}. Rights: ${rights(method)}. Execution: ${method.implementedBy === "client" ? "the connected client" : "the server"}.`,
  "",
  "### Input",
  "",
  "```json",
  JSON.stringify(schemaJson(method.input), null, 2),
  "```",
  "",
  "### Result",
  "",
  "```json",
  JSON.stringify(schemaJson(method.result), null, 2),
  "```",
  "",
];

const channelSection = (channel: ChannelDescriptor): string[] => [
  `## Channel ${channel.id}`,
  "",
  channel.description,
  "",
  `Owner: ${channel.owner}. Rights: ${rights(channel)}.`,
  "",
  "### Parameter",
  "",
  "```json",
  JSON.stringify(schemaJson(channel.params), null, 2),
  "```",
  "",
  "### Message",
  "",
  "```json",
  JSON.stringify(schemaJson(channel.message), null, 2),
  "```",
  "",
];

/** For the example, a method without required fields, so that the call shown actually works. */
const exampleMethod = (methods: readonly MethodDescriptor[]): string => {
  const empty = methods.find((method) => {
    const schema = schemaJson(method.input);
    return schema.type === "object" && schema.required === undefined && method.implementedBy === "server";
  });
  return empty?.id ?? methods[0]?.id ?? "<method-id>";
};

/** Readable reference of all registered methods and channels, directly from their contracts. */
export function methodReference(host: PluginHost, authentication: ApiAuthentication = { kind: "open" }): string {
  const methods = byId(host.methods.describe());
  const channels = byId(host.channels.describe());
  return [
    `# ${RPC_API_TITLE}`,
    "",
    "This reference is generated from the registered contracts. Internal and external clients use the same methods.",
    "",
    ...transportLines(authentication, exampleMethod(methods)),
    "",
    "## Method overview",
    "",
    "| Method | Owner | Rights |",
    "| --- | --- | --- |",
    ...methods.map((method) => `| ${method.id} | ${method.owner} | ${rights(method)} |`),
    "",
    "## Channel overview",
    "",
    "| Channel | Owner | Rights |",
    "| --- | --- | --- |",
    ...channels.map((channel) => `| ${channel.id} | ${channel.owner} | ${rights(channel)} |`),
    "",
    ...methods.flatMap(methodSection),
    ...channels.flatMap(channelSection),
  ].join("\n");
}

/** OpenRPC 1.3 from the same contracts; channels sit alongside as x-channels. */
export function openRpcDocument(host: PluginHost, authentication: ApiAuthentication = { kind: "open" }): Record<string, unknown> {
  return {
    openrpc: "1.3.0",
    info: { title: RPC_API_TITLE, version: "1", description: authenticationDescription(authentication) },
    servers: [{ name: "http", url: "/rpc" }, { name: "stdio", url: "stdio:" }],
    methods: byId(host.methods.describe()).map((method) => ({
      name: method.id,
      description: method.description,
      params: [{ name: "input", required: true, schema: schemaJson(method.input) }],
      paramStructure: "by-name",
      result: { name: "result", schema: schemaJson(method.result) },
      "x-owner": method.owner,
      "x-rights": [...method.rights],
      "x-implemented-by": method.implementedBy,
    })),
    "x-channels": byId(host.channels.describe()).map((channel) => ({
      name: channel.id,
      description: channel.description,
      params: schemaJson(channel.params),
      message: schemaJson(channel.message),
      "x-owner": channel.owner,
      "x-rights": [...channel.rights],
    })),
  };
}
