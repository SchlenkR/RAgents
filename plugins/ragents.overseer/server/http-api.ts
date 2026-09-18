import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import path from "node:path";
import { defaultHttpRights, DomainError, type HttpRouteContribution, type JsonValue, type PluginHost } from "@aicontainer/ragents";
import { eventTypeMap } from "../../../packages/ragents/src/domain/events.ts";
import type { SessionManagement } from "@aicontainer/server/ragents/global-chat.js";
import { readJsonBody, writeJson } from "@aicontainer/server/plugin-support/http.js";
import { OVERSEER_RUN_ID } from "../contract.js";
import type { RunDirectory } from "./run-directory.js";

export const MANAGEMENT_API_PREFIX = "/api/plugins/ragents.overseer";
const object = <P extends Record<string, TSchema>>(properties: P) => Type.Object(properties, { additionalProperties: false });
const text = () => Type.String({ minLength: 1, pattern: "\\S" });
const empty = object({});
const jsonObject = Type.Record(Type.String(), Type.Any());
const eventType = Type.Union(Object.keys(eventTypeMap).map((name) => Type.Literal(name)));
const errorSchema = object({ error: Type.String(), code: Type.String() });
const runParams = object({ run: Type.String({ minLength: 1, maxLength: 512, description: "Run-ID, eindeutiger Titel oder stabile Referenz wie Lauf 1; im Pfad URL-kodieren." }) });
const identityFields = { runId: Type.String(), title: Type.String(), reference: Type.String() };
const runSummary = object({ ...identityFields, createdAt: Type.Optional(Type.Number()), updatedAt: Type.Number(), running: Type.Optional(Type.Boolean()), metadata: Type.Optional(jsonObject) });
const accepted = object({ ...identityFields, accepted: Type.Literal(true) });
const commonStart = { title: text(), options: Type.Optional(jsonObject) };
const createBody = Type.Union([
  object({ ...commonStart, message: text() }),
  object({ ...commonStart, script: text(), input: Type.Optional(Type.Any()) }),
  object({ ...commonStart, packageDirectory: Type.String({ minLength: 1, description: "Absoluter Pfad eines RUN.md/setup.ts/tests.json-Pakets auf dem Server. Ein lokaler Shellclient setzt seinen tatsächlich vorhandenen Paketpfad ein; dies ist kein Upload." }), input: Type.Optional(Type.Any()) }),
]);
const domainObject = (name: string, source = "packages/ragents/src/domain/model.ts") => Type.Object({}, {
  additionalProperties: true, "x-typescript-type": name, "x-source": source,
  description: `Ungekürzter Domänenwert ${name}; verschachtelte Felder sind hier bewusst ein offenes JSON-Schema.`,
});
const eventSchema = object({
  eventId: Type.String(), runId: Type.String(), sequence: Type.Integer({ minimum: 1 }), schemaVersion: Type.Literal(3),
  occurredAt: Type.String(), actorId: Type.String(), commandId: Type.String(),
  correlationId: Type.Union([Type.String(), Type.Null()]), causationId: Type.Union([Type.String(), Type.Null()]),
  type: eventType, payload: domainObject("EventPayloads[EventType]", "packages/ragents/src/domain/events.ts"),
});
const viewSchema = object({
  id: Type.String(), revision: Type.Integer(), title: Type.String(), ownerId: Type.String(),
  primaryActorId: Type.Union([Type.String(), Type.Null()]), createdAt: Type.String(),
  forkedFrom: Type.Union([object({ runId: Type.String(), sequence: Type.Integer() }), Type.Null()]),
  actors: Type.Array(domainObject("Actor")), inputs: Type.Array(domainObject("ActorInput")), turns: Type.Array(domainObject("Turn")),
  subscriptions: Type.Array(domainObject("EventSubscription")), pluginStates: Type.Array(domainObject("PluginState")),
  actions: Type.Array(domainObject("Action")), artifacts: Type.Array(domainObject("Artifact")),
});
const eventQuery = object({
  after: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  type: Type.Optional(eventType),
});
export type ManagementAuthentication = { kind: "open" } | { kind: "token" } | { kind: "users"; cookieName: string };
interface ManagementContext { root: PluginHost; management: () => SessionManagement; directory: RunDirectory; authentication: ManagementAuthentication }
interface RouteInput { params: Record<string, unknown>; query: Record<string, unknown>; body: unknown }
interface ManagementRoute {
  rights?: readonly string[];
  id: string; method: "GET" | "POST"; path: string; description: string;
  params: TSchema; query: TSchema; body?: TSchema; result: TSchema; status: number;
  contentType?: "text/markdown; charset=utf-8";
  example?: { body?: unknown; query?: Record<string, string | number> };
  execute: (context: ManagementContext, input: RouteInput) => unknown | Promise<unknown>;
}
const resolve = async (context: ManagementContext, input: RouteInput) => {
  const runs = await context.management().list();
  const reference = input.params.run as string;
  const exact = runs.find((run) => run.id === reference);
  if (exact) return (await context.directory.describe(runs)).find((run) => run.id === exact.id)!;
  return context.directory.resolve(reference, runs);
};
const identity = (run: { id: string; title: string; reference: string }) => ({ runId: run.id, title: run.title, reference: run.reference });
const create = async (context: ManagementContext, input: RouteInput) => {
  const body = input.body as Static<typeof createBody>;
  const common = { title: body.title.trim(), ...(body.options ? { options: body.options as Record<string, JsonValue> } : {}) };
  let runId: string;
  if ("packageDirectory" in body) {
    if (!path.isAbsolute(body.packageDirectory)) throw new DomainError("invalid-package-directory", "packageDirectory muss ein absoluter Serverpfad sein", 400);
    runId = await context.management().create({ ...common, kind: "package", directory: body.packageDirectory, input: (body.input ?? null) as JsonValue });
  } else if ("script" in body) {
    const entries = context.root.startEntries.describe().filter((entry) => entry.action === "script");
    const wanted = body.script.trim().toLocaleLowerCase("de");
    const direct = entries.find((entry) => entry.id === body.script.trim());
    const matching = direct ? [direct] : entries.filter((entry) => entry.title.toLocaleLowerCase("de") === wanted);
    if (matching.length !== 1) throw new DomainError("invalid-script", `Das Run-Script ist unbekannt oder mehrdeutig. Gültige Titel und Kennungen: ${entries.map((entry) => `${entry.title} (${entry.id})`).join(", ") || "keine"}`, 400);
    runId = await context.management().create({ ...common, kind: "script", entryId: matching[0].id, input: (body.input ?? null) as JsonValue });
  } else {
    runId = await context.management().create({ ...common, kind: "message", message: body.message.trim() });
  }
  const found = (await context.directory.describe(await context.management().list())).find((run) => run.id === runId);
  if (!found) throw new DomainError("run-unavailable", "Der erstellte Lauf ist nicht mehr verfügbar", 409);
  return { ...identity(found), accepted: true };
};

export const managementRouteContracts: readonly ManagementRoute[] = [
  {
    id: "listRuns", method: "GET", path: "/runs", description: "Vorhandene Unterhaltungen des Profils mit stabilen Referenzen auflisten; der globale Chat gehört nicht zu dieser Liste.",
    params: empty, query: empty, result: Type.Array(runSummary), status: 200,
    execute: async (context) => (await context.directory.describe(await context.management().list())).map(({ id, ...run }) => ({ runId: id, ...run })),
  },
  {
    id: "createRun", rights: ["runs.read", "runs.write", "runs.create"], method: "POST", path: "/runs", description: "Einen Run mit serverseitiger ID und Titel anlegen. Genau eine Startform: message, installiertes script (Kennung oder eindeutiger Titel), oder packageDirectory (vorhandenes lokales Run-Script-Paket). input ist nur bei script/packageDirectory erlaubt. Die Antwort wartet auf Vorbereitung, Check, Test und Installation; accepted bestätigt noch kein fertiges Modellergebnis.",
    params: empty, query: empty, body: createBody, result: accepted, status: 201, example: { body: { title: "HTTP-Beispiel", message: "Antworte kurz mit Bereit." } }, execute: create,
  },
  {
    id: "readRun", rights: ["runs.read", "runs.inspect"], method: "GET", path: "/runs/{run}", description: "Die aktuelle ungekürzte RunView lesen; verschachtelte Domänenwerte sind als offene JSON-Objekte dokumentiert.",
    params: runParams, query: empty, result: viewSchema, status: 200,
    execute: async (context, input) => context.management().view((await resolve(context, input)).id),
  },
  {
    id: "readEvents", rights: ["runs.read", "runs.inspect"], method: "GET", path: "/runs/{run}/events", description: "Das vollständige Journal seitenweise in Sequenzreihenfolge lesen. Solange hasMore wahr ist, nextAfter als after der nächsten Anfrage verwenden. type filtert einen exakten Ereignistyp.",
    params: runParams, query: eventQuery, example: { query: { limit: 2 } }, result: object({ ...identityFields, events: Type.Array(eventSchema), nextAfter: Type.Integer({ minimum: 0 }), hasMore: Type.Boolean() }), status: 200,
    execute: async (context, input) => {
      const found = await resolve(context, input);
      const query = input.query as Static<typeof eventQuery>;
      const events = context.management().events(found.id).filter((event) => event.sequence > (query.after ?? 0) && (!query.type || event.type === query.type));
      const selected = events.slice(0, query.limit ?? 50);
      return { ...identity(found), events: selected, nextAfter: selected.at(-1)?.sequence ?? query.after ?? 0, hasMore: events.length > selected.length };
    },
  },
  {
    id: "sendMessage", method: "POST", path: "/runs/{run}/messages", description: "Eine Chatnachricht an den primären LLM-Actor einreihen; TypeScript als Primary wird mit actor-chat-unsupported abgewiesen. Die Antwort bestätigt nur das Einreihen, weder Verarbeitung noch Abschluss. Ein laufender Turn wird dadurch nicht ersetzt.",
    params: runParams, query: empty, body: object({ message: text() }), result: accepted, status: 202, example: { body: { message: "Nenne den nächsten sinnvollen Schritt." } },
    execute: async (context, input) => {
      const found = await resolve(context, input);
      await context.management().send(found.id, (input.body as { message: string }).message.trim());
      return { ...identity(found), accepted: true };
    },
  },
  {
    id: "stopRun", method: "POST", path: "/runs/{run}/stop", description: "Den Run über seine normale Stoppgrenze stoppen und die Bereinigung abwarten; die Unterhaltung bleibt erhalten.",
    params: runParams, query: empty, body: empty, example: { body: {} }, result: object({ ...identityFields, stopped: Type.Literal(true) }), status: 200,
    execute: async (context, input) => {
      const found = await resolve(context, input);
      await context.management().stop(found.id);
      return { ...identity(found), stopped: true };
    },
  },
  {
    id: "readCatalog", rights: ["runs.read", "runs.inspect"], method: "GET", path: "/catalog", description: "Installierte Start-Einstiege und Startoptionen mit Eingabeschemata, Standardwerten und Wählbarkeit lesen. POST /runs startet Nachrichten, installierte Scripts oder lokale Pakete via packageDirectory. Skills liefern bearbeitbare Aufträge für message; dabei den Skillnamen als Arbeitsanleitung nennen.",
    params: empty, query: empty,
    result: object({ entries: Type.Array(Type.Object({ id: Type.String(), title: Type.String(), description: Type.String(), action: Type.Union([Type.Literal("skill"), Type.Literal("script")]) }, { additionalProperties: true, "x-typescript-type": "PublicStartEntry" })), options: Type.Array(object({ id: Type.String(), schema: jsonObject, value: Type.Any(), selectable: Type.Boolean(), presentation: Type.Any() })) }), status: 200,
    execute: (context) => ({ entries: context.root.startEntries.describe(), options: context.root.startOptions.entries().map(({ option }) => {
      const scope = { runId: OVERSEER_RUN_ID };
      const value = context.root.startOptions.defaultValue(option.id, scope);
      return { id: option.id, schema: option.schema, value, selectable: option.selectable(), presentation: option.describe(value, scope) };
    }) }),
  },
  {
    id: "readOpenApi", rights: ["runs.read", "runs.inspect"], method: "GET", path: "/openapi.json", description: "OpenAPI 3.1 direkt aus den ausführbaren Routenverträgen lesen.",
    params: empty, query: empty, result: jsonObject, status: 200, execute: (context) => managementOpenApi(context.authentication),
  },
  {
    id: "readHttpReference", rights: ["runs.read", "runs.inspect"], method: "GET", path: "/reference.md", description: "Lesbare HTTP-Referenz direkt aus denselben Routenverträgen lesen.",
    params: empty, query: empty, result: Type.String(), status: 200, contentType: "text/markdown; charset=utf-8", execute: (context) => managementHttpReference(context.authentication),
  },
];
const schemaJson = (schema: TSchema): Record<string, unknown> => JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
const authenticationDescription = (authentication: ManagementAuthentication): string => authentication.kind === "users"
  ? "Benutzeranmeldung: POST /api/access/login mit id und password. Das erhaltene Sitzungscookie bei weiteren Anfragen mitsenden. ACCESS_TOKEN ersetzt keine Benutzeranmeldung."
  : authentication.kind === "token" ? "Dieses Profil verlangt den konfigurierten ACCESS_TOKEN als Bearer-Token oder das bestehende Zugangscookie."
    : "Dieses Profil verlangt keine Anmeldung. Profile mit users verwenden Sitzungscookies; ohne users kann ACCESS_TOKEN den bisherigen Zugang schützen.";
export const managementOpenApi = (authentication: ManagementAuthentication = { kind: "open" }) => ({
  openapi: "3.1.0", info: { title: "RAgents Run Management", version: "1", description: authenticationDescription(authentication) },
  components: { securitySchemes: authentication.kind === "users"
    ? { userSession: { type: "apiKey", in: "cookie", name: authentication.cookieName } }
    : { bearerAuth: { type: "http", scheme: "bearer" } } },
  security: authentication.kind === "users" ? [{ userSession: [] }] : authentication.kind === "token" ? [{ bearerAuth: [] }] : [],
  servers: [{ url: MANAGEMENT_API_PREFIX }],
  paths: Object.fromEntries([...new Set(managementRouteContracts.map((route) => route.path))].map((routePath) => [routePath,
    Object.fromEntries(managementRouteContracts.filter((route) => route.path === routePath).map((route) => [route.method.toLowerCase(), {
      operationId: route.id, description: route.description,
      "x-required-rights": route.rights ?? defaultHttpRights(route.method),
      parameters: (["params", "query"] as const).flatMap((kind) => {
        const schema = schemaJson(route[kind]);
        return Object.entries(schema.properties as Record<string, unknown>).map(([name, property]) => ({ name, in: kind === "params" ? "path" : "query", required: (schema.required as string[] | undefined)?.includes(name) ?? false, schema: property }));
      }),
      ...(route.body ? { requestBody: { required: true, content: { "application/json": { schema: schemaJson(route.body), ...(route.example?.body !== undefined ? { example: route.example.body } : {}) } } } } : {}),
      responses: { [route.status]: { description: "Erfolg", content: { [route.contentType?.split(";")[0] ?? "application/json"]: { schema: schemaJson(route.result) } } }, default: { description: "Benannter Fehler; die Operation wurde nicht als erfolgreich bestätigt.", content: { "application/json": { schema: schemaJson(errorSchema) } } } },
    }]))])),
});
export function managementHttpReference(authentication: ManagementAuthentication = { kind: "open" }): string {
  const lines = ["# RAgents HTTP-Management-API", "", "[OpenAPI 3.1](openapi.json)", "", "Diese Referenz entsteht aus den registrierten Routenverträgen. Interne und externe Agenten verwenden dieselbe HTTP-API.", "", `Basis: ${MANAGEMENT_API_PREFIX}`, "", "Die Shellvariable RAGENTS_API_BASE_URL enthält die Serveradresse, nicht den API-Pfad. Falls RAGENTS_API_TOKEN gesetzt ist, bei Anfragen den Header Authorization: Bearer <Token> senden. Der Token gehört nicht in Ausgaben oder Dokumente.", "", "Run-Pfade akzeptieren eine Run-ID, einen eindeutigen Titel oder eine stabile Referenz wie Lauf 1. Titel und Referenzen im URL-Pfad kodieren; IDs aus Antworten per Programm weiterverwenden, nicht vom Modell abschreiben lassen.", "", "Verschachtelte RunView-Domänenwerte und Ereignis-Payloads sind offene JSON-Objekte mit Verweis auf ihre TypeScript-Domänentypen. Diese HTTP-Referenz behauptet dafür kein vollständiges JSON-Schema. Die getrennte run-api.d.ts beschreibt die eingebettete TypeScript-Laufzeit und ist kein HTTP-SDK.", ""];
  lines.push(authenticationDescription(authentication), "", "Lesen braucht runs.read, Änderungen zusätzlich runs.write. Freie Starts benötigen runs.create, technische Ansichten runs.inspect. Die Rechte gelten auch für eingeschränkten anonymen Zugang. Anmeldefehler liefern 401, fehlende Rechte 403. Der interne Koordinator besitzt eine getrennte lokale Dienstidentität.", "", "## Routenübersicht", "", "| Methode | Pfad | Operation | Rechte bei Benutzeranmeldung |", "| --- | --- | --- | --- |", ...managementRouteContracts.map((route) => `| ${route.method} | ${MANAGEMENT_API_PREFIX}${route.path} | ${route.id} | ${(route.rights ?? defaultHttpRights(route.method)).join(", ")} |`), "", ...managementHttpExamples());
  for (const route of managementRouteContracts) {
    lines.push(`## ${route.method} ${MANAGEMENT_API_PREFIX}${route.path}`, "", route.description, "");
    for (const [name, schema] of [["Pfadparameter", route.params], ["Query", route.query], ["JSON-Body", route.body], [`Antwort ${route.status}`, route.result]] as const) {
      if (schema && !(schema === empty && (name === "Pfadparameter" || name === "Query"))) lines.push(`### ${name}`, "", "```json", JSON.stringify(schemaJson(schema), null, 2), "```", "");
    }
  }
  return lines.join("\n");
}
function managementHttpExamples(): string[] {
  const requestSource = (id: string, runExpression?: string): string => {
    const route = managementRouteContracts.find((candidate) => candidate.id === id);
    if (!route) throw new Error(`HTTP-Beispiel nennt unbekannte Route ${id}`);
    const segments = `${MANAGEMENT_API_PREFIX}${route.path}`.split("{run}");
    const query = new URLSearchParams(Object.entries(route.example?.query ?? {}).map(([name, value]): [string, string] => [name, String(value)])).toString();
    const pathname = segments.length === 1 ? JSON.stringify(segments[0] + (query ? `?${query}` : ""))
      : `${JSON.stringify(segments[0])} + encodeURIComponent(${runExpression}) + ${JSON.stringify(segments[1] + (query ? `?${query}` : ""))}`;
    return `request({ method: ${JSON.stringify(route.method)}, path: ${pathname}${route.example?.body !== undefined ? `, body: ${JSON.stringify(route.example.body)}` : ""} })`;
  };
  const bootstrap = [
    "const base = process.env.RAGENTS_API_BASE_URL;",
    'if (!base) throw new Error("RAGENTS_API_BASE_URL fehlt");',
    "let cookie;",
    "if (process.env.RAGENTS_USER || process.env.RAGENTS_PASSWORD) {",
    '  if (!process.env.RAGENTS_USER || !process.env.RAGENTS_PASSWORD) throw new Error("RAGENTS_USER und RAGENTS_PASSWORD gemeinsam setzen");',
    '  const login = await fetch(new URL("/api/access/login", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: process.env.RAGENTS_USER, password: process.env.RAGENTS_PASSWORD }) });',
    '  if (!login.ok) throw new Error("Anmeldung fehlgeschlagen");',
    '  cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");',
    "}",
    "const request = async ({ method, path, body }) => {",
    '  const headers = { "Content-Type": "application/json" };',
    "  if (process.env.RAGENTS_API_TOKEN) headers.Authorization = `Bearer ${process.env.RAGENTS_API_TOKEN}`;",
    "  if (cookie) headers.Cookie = cookie;",
    "  const response = await fetch(new URL(path, base), { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });",
    "  const result = await response.json();",
    "  if (!response.ok) throw new Error(result.error);",
    "  return result;",
    "};",
  ];
  return [
    "## Beispiel: Runs finden und Journal lesen", "",
    "In einer Shell mit Node.js und gesetzter RAGENTS_API_BASE_URL ausführen. Kennungen werden direkt aus der Antwort weiterverwendet.", "",
    "```sh", "node --input-type=module <<'JS'", ...bootstrap,
    `const runs = await ${requestSource("listRuns")};`,
    'if (runs.length === 0) console.log("Keine Runs vorhanden");',
    `else console.log(await ${requestSource("readEvents", "runs[0].runId")});`, "JS", "```", "",
    "## Beispiel: Run erstellen, beauftragen und stoppen", "",
    "Dieser Ablauf erzeugt einen neuen Run und stoppt ausschließlich diesen. Die Startannahme ist kein Nachweis eines abgeschlossenen Modellauftrags.", "",
    "```sh", "node --input-type=module <<'JS'", ...bootstrap,
    `const created = await ${requestSource("createRun")};`,
    `console.log(await ${requestSource("sendMessage", "created.runId")});`,
    `console.log(await ${requestSource("stopRun", "created.runId")});`, "JS", "```", "",
  ];
}
const validate = (schema: TSchema, value: unknown, label: string, status = 400): void => {
  if (Value.Check(schema, value)) return;
  const failure = [...Value.Errors(schema, value)].at(0);
  throw new DomainError(status === 500 ? "invalid-response" : "invalid-request", `${label}: ${failure?.message ?? "Ungültiger Wert"}`, status);
};
const matchPath = (route: ManagementRoute, pathname: string): Record<string, string> | undefined => {
  const expected = `${MANAGEMENT_API_PREFIX}${route.path}`.split("/");
  const actual = pathname.split("/");
  if (expected.length !== actual.length) return;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index += 1) {
    const name = /^\{(.+)\}$/.exec(expected[index]);
    if (name) {
      try { params[name[1]] = decodeURIComponent(actual[index]); }
      catch { throw new DomainError("invalid-path", "Der Pfad enthält eine ungültige URL-Kodierung", 400); }
    }
    else if (expected[index] !== actual[index]) return;
  }
  return params;
};
export function createManagementApi(root: PluginHost, management: () => SessionManagement, directory: RunDirectory, authentication: ManagementAuthentication = { kind: "open" }): HttpRouteContribution {
  const context = { root, management, directory, authentication };
  const owns = (pathname: string) => managementRouteContracts.some((route) => {
    try { return matchPath(route, pathname) !== undefined; } catch { return pathname.startsWith(MANAGEMENT_API_PREFIX + "/runs/"); }
  });
  return {
    id: "management-api", isApiPath: owns, matches: (_request, url) => owns(url.pathname),
    handle: async ({ request, response, url, access }) => {
      try {
        const matching = managementRouteContracts.filter((route) => matchPath(route, url.pathname) !== undefined);
        const route = matching.find((entry) => entry.method === request.method);
        if (!route) {
          response.setHeader("Allow", [...new Set(matching.map((entry) => entry.method))].join(", "));
          throw new DomainError("method-not-allowed", "Methode nicht erlaubt", 405);
        }
        const missing = (route.rights ?? defaultHttpRights(route.method)).find((right) => !access.can(right));
        if (missing) throw new DomainError("access-denied", `Das Recht ${missing} fehlt.`, 403);
        const params = matchPath(route, url.pathname)!;
        validate(route.params, params, "Pfadparameter");
        const query: Record<string, unknown> = Object.create(null);
        const properties = schemaJson(route.query).properties as Record<string, { type?: string }>;
        for (const [name, value] of url.searchParams) {
          if (Object.hasOwn(query, name)) throw new DomainError("invalid-request", `Query ${name} ist mehrfach angegeben`, 400);
          query[name] = Object.hasOwn(properties, name) && properties[name]?.type === "integer" && /^\d+$/.test(value) ? Number(value) : value;
        }
        validate(route.query, query, "Query");
        const body = route.body ? await readJsonBody(request, (value) => value).catch((error: unknown) => {
          if (error instanceof DomainError) throw error;
          throw new DomainError("invalid-json", error instanceof Error ? error.message : String(error), 400);
        }) : undefined;
        if (route.body) validate(route.body, body, "JSON-Body");
        const result = JSON.parse(JSON.stringify(await route.execute(context, { params, query, body }))) as unknown;
        validate(route.result, result, "HTTP-Antwort", 500);
        if (route.contentType) {
          response.writeHead(route.status, { "Cache-Control": "no-store", "Content-Type": route.contentType });
          response.end(result as string);
        } else writeJson(response, route.status, result);
      } catch (error) {
        writeJson(response, error instanceof DomainError ? error.status : 500, { error: error instanceof Error ? error.message : String(error), code: error instanceof DomainError ? error.code : "internal-error" });
      }
    },
  };
}
