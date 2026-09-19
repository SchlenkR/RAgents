import type { TSchema } from "typebox";
import { RPC_METHODS, type ChannelDescriptor, type MethodDescriptor, type PluginHost } from "@aicontainer/ragents";

export type ApiAuthentication = { kind: "open" } | { kind: "token" } | { kind: "users"; cookieName: string };

export const RPC_API_TITLE = "RAgents JSON-RPC-API";

const schemaJson = (schema: TSchema): Record<string, unknown> => JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;

const byId = <T extends { id: string }>(entries: readonly T[]): T[] =>
  [...entries].sort((left, right) => left.id.localeCompare(right.id, "en"));

const rights = (entry: { rights: readonly string[] }): string => entry.rights.length > 0 ? entry.rights.join(", ") : "keine festen Rechte";

export const authenticationDescription = (authentication: ApiAuthentication): string => authentication.kind === "users"
  ? "Benutzeranmeldung: POST /api/access/login mit id und password. Das erhaltene Sitzungscookie bei weiteren Anfragen mitsenden. ACCESS_TOKEN ersetzt keine Benutzeranmeldung."
  : authentication.kind === "token" ? "Dieses Profil verlangt den konfigurierten ACCESS_TOKEN als Bearer-Token oder das bestehende Zugangscookie."
    : "Dieses Profil verlangt keine Anmeldung. Profile mit users verwenden Sitzungscookies; ohne users kann ACCESS_TOKEN den bisherigen Zugang schützen.";

const transportLines = (authentication: ApiAuthentication, example: string): string[] => [
  "Die API ist JSON-RPC 2.0. Eine Anfrage ist ein Objekt mit jsonrpc, id, method und params; params ist immer das Eingabeobjekt der Methode. Die Antwort enthält result oder error; error.data nennt code und status des Fehlers.",
  "",
  "Transporte:",
  "",
  "- HTTP: `POST /rpc` mit genau einer Nachricht je Anfrage. `GET /rpc/stream` liefert als Server-Sent-Events die Benachrichtigungen und Anfragen des Servers; das erste Ereignis `hello` nennt die Verbindungskennung, die weitere Anfragen im Header `x-ragents-connection` mitsenden.",
  "- stdio: der Server startet mit `--stdio` und tauscht eine JSON-Nachricht je Zeile über stdin und stdout aus.",
  "",
  `Feste Methoden der Nachrichtenschicht: ${RPC_METHODS.subscribe}, ${RPC_METHODS.unsubscribe}, ${RPC_METHODS.event}, ${RPC_METHODS.cancel} und ${RPC_METHODS.progress}. Ein Abonnement nennt channel und params und erhält eine Abonnementkennung; jede Nachricht des Kanals kommt als ${RPC_METHODS.event}.`,
  "",
  authenticationDescription(authentication),
  "",
  "Die Shellvariable RAGENTS_API_BASE_URL enthält die Serveradresse. Falls RAGENTS_API_TOKEN gesetzt ist, bei Anfragen den Header Authorization: Bearer <Token> senden. Der Token gehört nicht in Ausgaben oder Dokumente.",
  "",
  "```sh",
  `curl -s "$RAGENTS_API_BASE_URL/rpc" -H 'content-type: application/json' \\`,
  `  -d '{"jsonrpc":"2.0","id":1,"method":"${example}","params":{}}'`,
  "```",
  "",
  "Kennungen aus Ergebnissen werden programmgesteuert weiterverwendet, nicht abgeschrieben.",
];

const methodSection = (method: MethodDescriptor): string[] => [
  `## ${method.id}`,
  "",
  method.description,
  "",
  `Eigentümer: ${method.owner}. Rechte: ${rights(method)}. Ausführung: ${method.implementedBy === "client" ? "der verbundene Client" : "der Server"}.`,
  "",
  "### Eingabe",
  "",
  "```json",
  JSON.stringify(schemaJson(method.input), null, 2),
  "```",
  "",
  "### Ergebnis",
  "",
  "```json",
  JSON.stringify(schemaJson(method.result), null, 2),
  "```",
  "",
];

const channelSection = (channel: ChannelDescriptor): string[] => [
  `## Kanal ${channel.id}`,
  "",
  channel.description,
  "",
  `Eigentümer: ${channel.owner}. Rechte: ${rights(channel)}.`,
  "",
  "### Parameter",
  "",
  "```json",
  JSON.stringify(schemaJson(channel.params), null, 2),
  "```",
  "",
  "### Nachricht",
  "",
  "```json",
  JSON.stringify(schemaJson(channel.message), null, 2),
  "```",
  "",
];

/** Für das Beispiel eine Methode ohne Pflichtfelder, damit der gezeigte Aufruf tatsächlich funktioniert. */
const exampleMethod = (methods: readonly MethodDescriptor[]): string => {
  const empty = methods.find((method) => {
    const schema = schemaJson(method.input);
    return schema.type === "object" && schema.required === undefined && method.implementedBy === "server";
  });
  return empty?.id ?? methods[0]?.id ?? "<methoden-id>";
};

/** Lesbare Referenz aller registrierten Methoden und Kanäle, direkt aus ihren Verträgen. */
export function methodReference(host: PluginHost, authentication: ApiAuthentication = { kind: "open" }): string {
  const methods = byId(host.methods.describe());
  const channels = byId(host.channels.describe());
  return [
    `# ${RPC_API_TITLE}`,
    "",
    "Diese Referenz entsteht aus den registrierten Verträgen. Interne und externe Clients verwenden dieselben Methoden.",
    "",
    ...transportLines(authentication, exampleMethod(methods)),
    "",
    "## Methodenübersicht",
    "",
    "| Methode | Eigentümer | Rechte |",
    "| --- | --- | --- |",
    ...methods.map((method) => `| ${method.id} | ${method.owner} | ${rights(method)} |`),
    "",
    "## Kanalübersicht",
    "",
    "| Kanal | Eigentümer | Rechte |",
    "| --- | --- | --- |",
    ...channels.map((channel) => `| ${channel.id} | ${channel.owner} | ${rights(channel)} |`),
    "",
    ...methods.flatMap(methodSection),
    ...channels.flatMap(channelSection),
  ].join("\n");
}

/** OpenRPC 1.3 aus denselben Verträgen; Kanäle stehen als x-channels daneben. */
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
