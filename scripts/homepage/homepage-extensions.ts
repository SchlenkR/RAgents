import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { builtinPermissions } from "../../packages/ragents/src/access.js";
import { overseerPermissions } from "../../plugins/ragents.overseer/contract.js";
import { coreContracts, runContracts } from "../../apps/server/src/api/contracts.js";

const permissions = [...builtinPermissions, ...overseerPermissions];

const declaredContracts = (value: object): Array<{ kind: string; id: string; rights: readonly string[] }> => Object.values(value)
  .flatMap((entry: object) => "kind" in entry ? [entry as { kind: string; id: string; rights: readonly string[] }] : declaredContracts(entry));

/** The permissions of the core methods; the host decides methods without fixed permissions per run. */
const methodRights = [coreContracts, runContracts].flatMap((group) => declaredContracts(group))
  .filter((contract) => contract.kind === "operation")
  .map((contract) => ({ id: contract.id, rights: [...contract.rights] }))
  .sort((left, right) => left.id.localeCompare(right.id, "en"));

export interface HomepageExtension {
  id: string;
  category: string;
  title: string;
  description: string;
  environment: string;
  example: string;
  language: "typescript" | "tsx" | "json" | "markdown";
  notes: string[];
  covers: string[];
  sources?: { title: string; file: string }[];
}

export interface HomepageExtensionsResult {
  html: string;
  extensions: HomepageExtension[];
  contracts: { name: string; text: string; file: string }[];
  permissions: readonly { id: string; description: string }[];
  methodRights: typeof methodRights;
}

type Contract = { id: string; file: string; name: string; kind?: "schema" | "embedded" };
const contracts: Contract[] = [
  { id: "settings", file: "apps/web/src/PluginRegistry.tsx", name: "SettingsContribution" },
  { id: "profileUser", file: "apps/server/src/config-definition.ts", name: "ProfileUser" },
  { id: "profileAnonymousUser", file: "apps/server/src/config-definition.ts", name: "ProfileAnonymousUser" },
  { id: "environmentReference", file: "apps/server/src/config-definition.ts", name: "EnvironmentReference" },
  { id: "accessUser", file: "packages/ragents/src/access.ts", name: "AccessUser" },
  { id: "accessSnapshot", file: "packages/ragents/src/access.ts", name: "AccessSnapshot" },
  { id: "accessContext", file: "packages/ragents/src/access.ts", name: "AccessContext" },
  { id: "httpRoute", file: "packages/ragents/src/plugin-types.ts", name: "HttpRouteContribution" },
  { id: "httpContext", file: "packages/ragents/src/plugin-types.ts", name: "HttpRouteContext" },
  { id: "module", file: "apps/server/src/plugin-support/plugin-module.ts", name: "PluginModule" },
  { id: "manifest", file: "packages/ragents/src/plugin-types.ts", name: "PluginManifest" },
  { id: "plugin", file: "packages/ragents/src/plugin-types.ts", name: "RAgentsPlugin" },
  { id: "host", file: "packages/ragents/src/plugin-types.ts", name: "PluginRegistration" },
  { id: "storage", file: "packages/ragents/src/plugin-types.ts", name: "PluginStorage" },
  { id: "lifecycle", file: "packages/ragents/src/plugin-types.ts", name: "SessionLifecycleContribution" },
  { id: "runScript", file: "packages/ragents/src/plugin-types.ts", name: "RunScriptPackage" },
  { id: "start", file: "packages/ragents/src/plugin-types.ts", name: "StartEntryBase" },
  { id: "web", file: "apps/web/src/PluginRegistry.tsx", name: "WebPlugin" },
  { id: "webIdentity", file: "apps/web/src/PluginRegistry.tsx", name: "WebPluginDescriptor" },
  { id: "surfaceElement", file: "apps/web/src/PluginRegistry.tsx", name: "SurfaceElementDefinition" },
  { id: "run", file: "apps/server/src/plugin-support/actor-programs/app-project.ts", name: "RunContext", kind: "embedded" },
  { id: "app", file: "apps/server/src/plugin-support/actor-programs/client-compiler.ts", name: "AppContext", kind: "embedded" },
  { id: "appState", file: "apps/server/src/plugin-support/actor-programs/client-compiler.ts", name: "AppStateView", kind: "embedded" },
  { id: "appCapabilities", file: "apps/server/src/plugin-support/actor-programs/client-compiler.ts", name: "AppCapabilities", kind: "embedded" },
  { id: "chat", file: "apps/web/src/actor-programs/client-ui/contracts.d.ts", name: "ChatConnection" },
  { id: "appPackage", file: "apps/server/src/plugin-support/actor-programs/app-project.ts", name: "appPackageSchema", kind: "schema" },
  { id: "appContract", file: "apps/server/src/plugin-support/actor-programs/app-project.ts", name: "appContractSchema", kind: "schema" },
  { id: "appAction", file: "apps/server/src/plugin-support/actor-programs/app-project.ts", name: "actionSchema", kind: "schema" },
  { id: "product", file: "apps/server/src/ragents/product-runtime.ts", name: "ProductRuntimePolicy" },
  { id: "workspace", file: "apps/server/src/ragents/workspace-runtime.ts", name: "WorkspaceRuntime" },
  { id: "resolver", file: "apps/server/src/ragents/workspace-runtime.ts", name: "WorkspaceResolver" },
  { id: "documents", file: "apps/server/src/ragents/document-store.ts", name: "DocumentStore" },
  { id: "gitView", file: "apps/server/src/ragents/workspace-runtime.ts", name: "GitWorkspaceView" },
  { id: "driver", file: "packages/ragents/src/drivers/types.ts", name: "AgentDriver" },
  { id: "lsp", file: "packages/workspace-executor/src/language-server/host.ts", name: "LanguageServerAdapter" },
  { id: "executorParts", file: "packages/workspace-executor/src/contributions.ts", name: "WorkspaceExecutorParts" },
  { id: "executorMachine", file: "packages/workspace-executor/src/contributions.ts", name: "WorkspaceExecutorMachine" },
];

const entry = (id: string, category: string, title: string, description: string, environment: string,
  example: string, covers: string[], notes: string[] = [], language: HomepageExtension["language"] = "typescript", sources?: HomepageExtension["sources"]): HomepageExtension =>
  ({ id, category, title, description, environment, example: example.trim(), covers, notes, language, sources });

const definitions = (): HomepageExtension[] => [
  entry("plugin-module", "Plugin and profile", "Create a plugin", "A plugin bundles an additional RAgents capability, such as tools and the matching interface. It lives in its own folder with a server entry point and, if needed, a web half. At startup it tells the application which functions it provides.", "plugins/ragents.example/server/index.ts", `
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";

export const plugin: PluginModule = {
  create: () => ({
    manifest: { id: "ragents.example" },
    register: (host) => {
      host.prompts({
        id: "ragents.example.instructions",
        order: 100,
        render: () => "Briefly describe what your result is based on.",
      });
    },
  }),
};`, ["module.create", "module.requires", "plugin.manifest", "plugin.register", "manifest.id", "manifest.requires", "manifest.client", "manifest.web"], [
    "Dependencies are declared as requires on the exported PluginModule. The composer checks their order and copies them into the manifest.",
    "The composer also sets web in the manifest: true if the plugin folder contains a web half web/index.tsx. The interface then requires the bundle to contain it.",
    "A plugin imports host building blocks through the packages @ragents/host, @ragents/web, and @ragents/engine, and other plugins through @ragents/plugins/<id>. This lets the plugin folder live anywhere; the profile names it by identifier or path.",
    "create receives the entire PluginHost. register, on the other hand, receives the PluginRegistration bound to this plugin. The two host parameters are different contracts.",
    "client.config in the manifest and host.clientConfig carry public browser configuration. Secret values do not belong there.",
    "The plugin folder alone activates nothing. The instance must include the plugin ID or the folder path in its profile configuration; required product and workspace services remain mandatory.",
  ]),
  entry("profile", "Plugin and profile", "Compose a profile", "A profile determines which plugins and settings a RAgents installation uses. It thereby assembles the available capabilities. The example adds a custom plugin to the core base set.", "ragents.config.example.ts; extends the locally configured neutral base.", `
import { config as core } from "./ragents.config.core.js";
import type { RAgentsConfig } from "@ragents/host/config-definition.js";

export const config = {
  ...core,
  host: {
    ...core.host,
    PRODUCT_PROFILE: "example",
    PRODUCT_ID: "example",
    PRODUCT_TITLE: "Example workshop",
    PLUGINS: [...core.host.PLUGINS, "ragents.example"],
  },
} as const satisfies RAgentsConfig;`, [], [
    "The base configuration provides the existing mandatory plugins and model values. The entry point scripts/start.sh example selects the new file; required credentials are configured locally.",
    "Without a valid profile selection, the server does not start. Plugins can register as long as the host is not yet sealed; duplicate identifiers and missing mandatory services are errors.",
  ]),
  entry("profile-access", "Plugin and profile", "Grant reading and prepared setups", "A profile can determine who may sign in and which functions they may use. For this, its users export names the users and their permissions. The example gives one person read permissions and a second one the prepared word game including chat and mini-app.", "Next to the config export of a custom profile file with ragents.reference; the named password variables are set locally.", `
import { env, type ProfileUser } from "@ragents/host/config-definition.js";

export const users = [
  { id: "reader", label: "Read", password: env("EXAMPLE_READER_PASSWORD"),
    rights: ["runs.read"] },
  { id: "operator", label: "Edit", password: env("EXAMPLE_OPERATOR_PASSWORD"),
    rights: ["runs.read", "runs.write"],
    startEntries: ["ragents.reference.word-game"] },
  { id: "developer", label: "Local host", password: env("EXAMPLE_DEVELOPER_PASSWORD"),
    token: env("EXAMPLE_DEVELOPER_TOKEN"),
    rights: ["models.use", "profile.fetch"] },
] satisfies readonly ProfileUser[];`, ["profileUser.id", "profileUser.label", "profileUser.password", "profileUser.token", "profileUser.rights", "profileUser.startEntries", "environmentReference.kind", "environmentReference.name"], [
    "Without a users export there is no sign-in. An optional anonymousUser can still restrict access. An empty users list is a startup error. Passwords may be plain text or env references and are never published in the browser. A personal token (only as an env reference) counts as a bearer without expiry for clients without a sign-in dialog, such as pnpm connect and the model relay.",
    "Permissions are exact strings. Only the single value * means all permissions; there are no partial patterns and no inheritance. A run belongs to the user who created it; operator access reaches only its own runs, runs.read.all shows those of all users. A run that a start option with ownerOnly reserves for its owner, for example through the binding to a workspace, can only be read in the journal and stopped with runs.read.all; only the owner sees its workspace (files, processes, language servers). A run without an owner, for example from a profile without sign-in, remains reserved for runs.read.all. runs.write allows chat and app actions in existing own runs. runs.create adds free runs and start options. Without this permission, startEntries limits the shared run scripts; runs.inspect protects technical views. These permissions do not replace a sandbox for native code.",
    "The list of built-in permissions below is generated from builtinPermissions. Plugins choose their own names and check them on the server and in the interface.",
  ]),
  entry("profile-anonymous", "Plugin and profile", "Offer a prepared setup without sign-in", "Restricted access can also apply without sign-in. The anonymousUser export determines its permissions and shared setups. In this example, every visitor can start the prepared word game and use its mini-app.", "Next to the config export of a custom profile file with ragents.reference; this profile exports no users list.", `
import type { ProfileAnonymousUser } from "@ragents/host/config-definition.js";

export const anonymousUser = {
  id: "visitor",
  label: "Guest",
  rights: ["runs.read", "runs.write"],
  startEntries: ["ragents.reference.word-game"],
} satisfies ProfileAnonymousUser;`, ["profileAnonymousUser.id", "profileAnonymousUser.label", "profileAnonymousUser.rights", "profileAnonymousUser.startEntries", "accessUser.startEntries"], [
    "users and anonymousUser exclude each other. Without both exports, the profile is unrestricted. anonymousUser contains no password; enabled stays false in the AccessSnapshot and user describes the restricted access.",
    "canStartEntry requires runs.write and either runs.create or the explicitly shared entry in startEntries. Without runs.create, only registered run scripts are allowed. Free tasks and skills with preparation are blocked; existing runs remain accessible according to their normal read permissions.",
    "runs.inspect and settings.read are missing here: model names, technical details, and settings are not offered. The server also checks the permissions for direct HTTP calls.",
  ]),
  entry("access-route", "Server contributions", "A plugin route with its own permissions", "An HTTP route makes a plugin function reachable for the browser or other clients. It can require different permissions for reading and changing. The server checks these permissions before it executes the function.", "Inside register(host); the payload processing here is deliberately only a small confirmed echo.", `
const pathname = "/api/plugins/ragents.example/board";
host.http({
  id: "ragents.example.board",
  isApiPath: (value) => value === pathname,
  matches: (request, url) => ["GET", "POST"].includes(request.method ?? "") && url.pathname === pathname,
  requiredRights: (request) => request.method === "GET"
    ? ["ragents.example.read"] : ["ragents.example.read", "ragents.example.write"],
  handle: ({ response, access }) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ editable: access.can("ragents.example.write") }));
  },
});`, ["httpRoute.requiredRights", "httpContext.access", "accessContext.can", "accessContext.enabled", "accessContext.user"], [
    "requiredRights replaces the default requirement of the route. Without an explicit list, GET/HEAD/OPTIONS require runs.read, other methods runs.read and runs.write. Further domain checks still belong in the operation.",
    "access contains the signed-in user without a password, and can checks the same permission contract as the interface. Hiding something in the UI alone does not protect an HTTP route.",
  ]),
  entry("access-view", "Web contributions", "Hide a plugin view or show it read-only", "A plugin view can take the same permissions into account as the matching server function. Without read permission it is hidden; without write permission the change button stays disabled. Both sides use the same permission names for this.", "React component of a plugin; useAccess comes from the web host and accessMode from the shared permission contract.", `
function BoardAccess() {
  const access = useAccess();
  const mode = accessMode(access, "ragents.example.read", "ragents.example.write");
  if (mode === "hidden") return null;
  return <section>
    <p>Shared overview</p>
    <button disabled={mode === "readonly"}>Change entry</button>
  </section>;
}`, ["accessUser.id", "accessUser.label", "accessUser.rights", "accessSnapshot.enabled", "accessSnapshot.user"], [
    "useAccess returns enabled, user, can, and logout. With active sign-in and no session, AccessSnapshot contains user: null; without sign-in mode, enabled is false. The snapshot never contains a password or session token.",
    "accessMode yields hidden, readonly, or write. hasRight and AccessContext.can treat the optional sign-in mode identically. The real send action must call the protected server route; the button here is only the state example.",
  ], "tsx"),
  entry("storage", "Server contributions", "Plugin identity and file storage", "Plugins can store data for the entire application or for a single run. The application provides each plugin with its own storage paths for this and assigns them to its identifier.", "Inside register(host); no files are created here yet.", `
const pluginId = host.manifest.id;
const globalFile = host.storage.root("settings.json");
const runFile = host.storage.session(runId, "notes.json");
const directoryModes = host.storage.modes;
const sessionsRoot = host.storage.sessionsRoot;`, ["host.manifest", "host.storage", "storage.sessionsRoot", "storage.modes", "storage.root", "storage.session"], [
    "runId comes from the respective host call, not from a hard-coded example value. Path segments are single names; no absolute paths, slashes, or parent directories.",
    "Plugin files do not replace journaled domain state. Cleanup belongs in the plugin lifecycle.",
  ]),
  entry("config", "Server contributions", "Configuration and browser values", "Plugins can have their own settings. A configuration description names their meaning and default values. Through clientConfig, the plugin publishes the values its interface needs in the browser.", "Inside register(host).", `
host.config(
  { key: "EXAMPLE_LABEL", source: "environment" },
  { key: "EXAMPLE_API_KEY", source: "environment", secret: true },
);
host.clientConfig({ label: "Example", routePrefix: "/api/plugins/ragents.example" });`, ["host.config", "host.clientConfig"], [
    "config reads no environment variable and creates no value. The implementation must check required values itself; the host helpers for declared configuration support this.",
    "A secret descriptor does not make a value that is later published through clientConfig secret.",
  ]),
  entry("services", "Server contributions", "Share services between plugins", "A service is a function or an object that several plugins can use together. One plugin provides the service under a typed name, others obtain it through this name. That way, the shared function stays implemented in one place.", "Shared contract plus registration; serviceToken comes from @ragents/engine.", `
const formatterToken = serviceToken<(text: string) => string>("ragents.example.formatter");
host.provide(formatterToken, (text) => text.trim());
const format = host.service(formatterToken);
const optionalFormat = host.optionalService(formatterToken);
const result = format(" Example ");`, ["host.provide", "host.service", "host.optionalService"], [
    "The token belongs in a server-side shared service contract so that provider and consumer use the same contract. The provider must register before the consumer.",
    "optionalService is only intended for a deliberately optional capability. A required integration uses service and fails if it is missing.",
  ]),
  entry("http", "Server contributions", "Provide HTTP routes", "An HTTP route connects a URL path with a server function. Plugins can register such routes themselves and handle the matching requests. The central server takes care of integrating them.", "Inside register(host); example of a stateless GET route.", `
const pathname = "/api/plugins/ragents.example/status";
host.http({
  id: "ragents.example.status",
  isApiPath: (value) => value === pathname,
  matches: (request, url) => request.method === "GET" && url.pathname === pathname,
  handle: ({ response }) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ready: true }));
  },
});`, ["host.http", "httpRoute.id", "httpRoute.isApiPath", "httpRoute.matches", "httpRoute.handle", "httpContext.request", "httpContext.response", "httpContext.url"], [
    "Run-related routes check the run through the existing host services. Write operations remain bound to their domain checks and the journal.",
    "isApiPath and matches are different checks: recognizing an API also includes a path with an HTTP method that is currently not allowed.",
  ]),
  entry("methods", "Server contributions", "API methods and channels", "A plugin adds its own methods and event channels to the JSON-RPC API. The contract describes identifier, description, permissions, input, and result; server and interface use the same contract.", "Contracts in the plugin's contract.ts, implementation inside register(host).", `
const status = defineOperation({
  id: "ragents.example.status",
  description: "Reports whether the service is ready.",
  rights: ["runs.read"],
  input: Type.Object({}, { additionalProperties: false }),
  result: Type.Object({ ready: Type.Boolean() }),
});
const heartbeat = defineChannel({
  id: "ragents.example.heartbeat",
  description: "Reports every heartbeat of the service.",
  rights: ["runs.read"],
  params: Type.Object({}, { additionalProperties: false }),
  message: Type.Object({ at: Type.String() }),
});

host.methods(implement(status, () => ({ ready: service.ready() })));
host.channels(implementChannel(heartbeat, (_params, emit) => service.onBeat((at) => emit({ at }))));`, ["host.methods", "host.channels"], [
    "Before execution, the dispatcher checks the permissions and the input, and afterwards the result against the contract. A DomainError carries code and status into the response.",
    "The web half calls the same contract with rpc.call and subscribes to channels with rpc.subscribe; when opened, a channel returns its unsubscribe function.",
    "context names access, signal, progress, the calling connection, and whether the request is local. The connected client executes an operation with implementedBy client; the server calls it through context.connection.call.",
  ]),
  entry("lifecycle", "Server contributions", "Startup, run end, and shutdown", "A plugin can run its own functions at application startup, when a run is stopped or deleted, and at shutdown. This lets its background services and resources start and clean up at the right time.", "register(host); service is a previously created service with the methods shown here.", `
host.lifecycle({
  id: "ragents.example.lifecycle",
  initialize: () => service.initialize(),
  prepareSession: ({ runId }) => service.prepare(runId),
  sessionStarted: ({ runId, startEntry }) => service.started(runId, startEntry),
  stopSession: ({ runId, signal }) => service.stop(runId, signal),
  afterStopSession: ({ runId, signal }) => service.stop(runId, signal),
  deleteSession: ({ runId }) => service.remove(runId),
  shutdown: () => service.shutdown(),
});`, ["host.lifecycle", "lifecycle.id", "lifecycle.initialize", "lifecycle.prepareSession", "lifecycle.sessionStarted", "lifecycle.stopSession", "lifecycle.afterStopSession", "lifecycle.deleteSession", "lifecycle.shutdown"], [
    "The return values may be void or Promise<void>. A stop handler respects its AbortSignal and waits for its work to end.",
    "afterStopSession runs after execution has come to a standstill and also cleans up resources created late. The run stays locked during this time-limited follow-up; both stop phases must be repeatable.",
    "Initialization and preparation follow the plugin order. Teardown respects the reverse order; stopping and deleting are different operations.",
    "sessionStarted arrives when a start has provided the workspace and built the first actor, before an actor receives input. startEntry names the template with id and action (skill or script) or is null; after a host restart, the hook does not arrive again.",
  ]),
  entry("tools", "Server contributions", "A typed run function", "A plugin provides a function once with description, input, result, and implementation. An LLM uses it in a TypeScript snippet; a persistent actor calls the same function with the same API.", "register(host); Type from typebox, helpers from @ragents/engine.", `
const available = defineToolAvailability({
  availability: "always", availabilityDetail: "Available in every turn.",
}, () => true);
const trim = defineRunFunction({
  name: "example_trim",
  label: "Trim text",
  description: "Removes outer whitespace.",
  longDescription: "Whitespace inside the text is preserved. Text consisting only of whitespace results in an empty string.",
  schema: Type.Object({ text: Type.String() }),
  resultSchema: Type.Object({ text: Type.String() }),
  available,
  run: (_scope, _callId, input) => ({ text: input.text.trim() }),
});
host.functions(trim);`, ["host.functions"], [
    "description is the short description in the automatic function overview, label the readable name. longDescription optionally adds detailed notes and examples, which typescript_api returns on request together with the type contracts.",
    "Snippets and actor programs call context.functions.example_trim({ text }); input and result types come from the same registration.",
    "nativeTool: true additionally offers the same function as a native model tool. That remains the exception: by default the shared TypeScript API is enough, and the option is only justified for calls the model reads and acts on by itself, without combining, filtering, or passing the result onward (file tools, browser interactions, domain reports and status, language diagnostics, native image input).",
    "host.functions also accepts contributions with functions and descriptors resolved at runtime. Static descriptors match the inventory; dynamic: true marks a variable function list with empty static descriptors.",
    "availability limits the usage. executionMode: parallel is only intended for effects that are suitable for it. Model-facing input schemas have an object root.",
  ]),
  entry("operations", "Server contributions", "A domain operation as a capability", "An operation is a server function that actor programs and views can use. It is offered to them as a named capability with defined inputs and outputs. Its operator rule determines whether a call is allowed directly, after confirmation, or not at all.", "Inside register(host); Type comes from typebox.", `
host.operations({
  id: "example_trim", label: "Trim text",
  description: "Removes outer whitespace.",
  schema: Type.Object({ text: Type.String() }),
  resultSchema: Type.Object({ text: Type.String() }),
  operator: "direct",
  execute: (context, input) => {
    context.signal.throwIfAborted();
    return { text: (input as { text: string }).text.trim() };
  },
});`, ["host.operations"], [
    "direct allows the operator action immediately. confirm requires a confirmed question. unavailable blocks the capability for the operator path.",
    "This does not automatically turn an operation into an agent tool. If both kinds of access are needed, they register the same domain function through separate contributions.",
    "The runtime checks input and result again; the type assertion in the example does not replace this check.",
  ]),
  entry("invoke-operation", "Server contributions", "Call registered operations", "Plugins can use an operation that is already registered, that is, a shared server function with defined inputs and outputs. They look up its contract and call it through the same check that applies to other callers.", "An asynchronous plugin function receives operationContext from the host call.", `
const descriptor = host.operation("example_trim");
if (!descriptor) throw new Error("The text operation is missing.");
const result = await host.invokeOperation(
  descriptor.id,
  operationContext,
  { text: " Example " },
);`, ["host.operation", "host.invokeOperation"], [
    "operationContext carries runId, invocationId, signal, and an agent or operator principal. The implementation must not take over a foreign identity from browser input.",
    "The confirmation of an operator call must come from the intended confirmation path; a self-invented proof is no substitute.",
  ]),
  entry("agent-runtime", "Server contributions", "Intervene in an agent's model calls", "Every AI agent calls its model several times within a turn, and its tools run in between. An agent contribution hooks in between with two hooks: before every model call it can give the model a hidden note, after every tool call it can replace the tool's result. The plugin never sees the agent runtime behind it.", "register(host); the note does not appear in the chat.", `
host.agentRuntime({
  id: "ragents.example.reminder",
  beforeModelCall: (agent, call) => {
    const count = typeof call.kept === "number" ? call.kept + 1 : 1;
    call.keep(count);
    return agent.audience === "agent" && count % 10 === 0
      ? "Briefly report your status to the coordinator before you continue working."
      : undefined;
  },
  afterToolCall: (_agent, outcome) => outcome.toolName === "example_probe" && outcome.isError
    ? { content: [{ type: "text", text: "The probe failed; do not retry." }], isError: true }
    : undefined,
});`, ["host.agentRuntime"], [
    "Both hooks run per agent; the first parameter names run, agent, audience, and working directory. call.kept and call.keep hold a JSON value in the agent's conversation history, even across a restart; the model never sees it.",
    "A contribution registers no tools; tools come through host.functions. A returned note applies only to the next model call and does not end up in the journal.",
  ]),
  entry("models", "Server contributions", "Models and roles", "The model catalog names the AI models that can be selected for agents. A role combines a model with settings such as thinking depth and execution limits. Such roles describe individual agents; the profile assembles the entire installation.", "register(host); modelId is a previously checked, configured OpenRouter model identifier.", `
host.profiles({
  id: "ragents.example.models",
  models: () => [{ driver: "agent", provider: "openrouter", model: modelId,
    label: "Configured model", thinking: ["off", "low", "high"] }],
  profiles: () => [{ name: "example-reviewer", description: "Reviews a task.",
    driver: "agent", provider: "openrouter", model: modelId, thinking: "low",
    turnTimeoutMs: null, isolateWorkspace: false }],
});`, ["host.profiles"], [
    "The thinking levels must be supported by the selected model. Catalog entries provide no new provider implementation; the current product integration uses OpenRouter.",
    "The agent model is chosen from the offered catalog at spawn. Documentation should not pin down concrete model identifiers that change over time.",
  ]),
  entry("prompts", "Server contributions", "Prompt parts and skills", "A prompt gives an agent instructions for its work. Plugins can contribute text parts that the application combines in a defined order. A skill is a more detailed set of working instructions that is provided for specific agents or tasks.", "Inside register(host); skillDirectory is the absolute path of the bundled skill folder.", `
host.prompts({
  id: "ragents.example.prompt", order: 200,
  requiresTools: ["example_trim"],
  render: () => "Use example_trim for outer whitespace.",
});
host.skills({
  id: "ragents.example.skills", audiences: ["coordinator", "agent"],
  paths: () => [skillDirectory],
});`, ["host.prompts", "host.skills"], [
    "requiresTools binds a prompt part to the functions that are actually available. A skill is not an executable actor and not a plugin.",
    "Alternatively, skills/<name>/SKILL.md is read from the plugin folder. start: true with title and category adds a template; prompt can specify its own start task, otherwise the body is used. Explicit contributions and automatically loaded folder assets must not duplicate each other unintentionally.",
    "renderForRun(runId) replaces the text of a prompt part for one run, an empty text omits it there, undefined keeps it; this also applies to the product's selected system prompts and to chapters that only come on request.",
  ]),
  entry("run-condition", "Server contributions", "Contributions only in certain runs", "A plugin can attach its prompts, functions, skills, and agent hooks to a condition per run, for example because they only apply to runs in a specific project. In all other runs they are missing as if the plugin did not exist there; services, methods, start options, and web contributions remain.", "Inside register(host); the plugin fills the set itself, for example from the journal.", `
const domainRuns = new Set<string>();
host.runCondition((runId) => domainRuns.has(runId));`, ["host.runCondition"], [
    "The condition is synchronous and runs on every prompt composition and every tool, skill, and hook resolution of a run. It reads a decision stored in the journal instead of determining it again.",
    "If it throws, the run's turn fails with this cause; that way a run whose decision could not be determined stays blocked. At most one condition per plugin.",
  ]),
  entry("start-entries", "Server contributions", "Skills and run scripts as templates", "The Start page offers templates for a new run. A skill combines an editable start task with working instructions and optional files. A run script provides a programmed setup. Plugins register both kinds through the same contract.", "Inside register(host); text-review is a registered skill.", `
host.startEntries({
  id: "ragents.example.start", title: "Review text",
  description: "Starts with a review task.", order: 100,
  tags: ["Use case", "Text review"],
  action: "skill", skill: "text-review", category: "Collaboration",
  prompt: "Please check my text for contradictions.",
});`, ["host.startEntries", "start.id", "start.title", "start.description", "start.order", "start.guide", "start.tags", "start.fixedStartOptions"], [
    "For skill templates, category is exactly one free, non-empty text and determines their group on the Start page. Independently of that, tags is an optional list of keywords for search, filters, and the reference. Only the tags are given comma-separated in SKILL.md and RUN.md frontmatter. The reference plugin provides demos and possible high-level test cases. Their description explains the demonstration purpose; Use case, Concept demo, and product concepts are in tags. The public generation checks at least two different examples per product concept. UI controls have no example quota and do not have to appear completely in the demos. Pure operating concepts use separate walkthroughs from the reference plugin's walkthroughs.ts. These create no templates and do not extend the StartEntry contract.",
    "action: skill uses the registered skill name. action: script contains a RunScriptPackage. guide refers to a web guide with the same name.",
    "fixedStartOptions sets start options for every run from the template, for example { \"ragents.workspace.binding\": { machine: \"server\", folder: \"fresh\" } }; in RUN.md the header line is called fixed-start-options. A different choice made beforehand is an error at start, and the Start page shows the option as fixed.",
    "Use as task opens the preparation chat with the editable start task for every skill, even after a guide. Only Create run sends the task with the skill reference; for a script, the start value is passed to the prepared actor.",
  ]),
  entry("actor-packages", "Server contributions", "Share an actor package between run scripts", "A program that several run scripts use belongs to the plugin, not to each script. The run then has one actor for it, whichever script comes first.", "Usually the folder actors/<name>/ next to run-scripts/; explicitly inside register(host) with the complete package files.", `
host.actorPackages({
  name: "notebook",
  files: [
    { path: "package.json", content: JSON.stringify({ name: "notebook", private: true, type: "module", ragents: { title: "Notebook", backend: "src/server.ts" } }) },
    { path: "src/server.ts", content: "export { default } from \\"./notebook.js\\";\\n" },
    { path: "src/notebook.ts", content: "..." },
  ],
});`, ["host.actorPackages"], [
    "A run script names the package in RUN.md with shared-programs: notebook; the host copies it into the run and keeps one with the same sources. Scripts call actor_program_ensure({ name: \"notebook\" }), which activates it only once.",
    "Names are one namespace per run: startup refuses a name two plugins share, a name that equals a run script's handle or bundled program, and a script that needs a package no plugin provides.",
    "The actor programs service answers programOf(runId, actorId) with the package's origin; a service authorizes by it, never by handle, and a package changed in the run counts as created there.",
  ]),
  entry("start-options", "Server contributions", "Check and freeze start values", "Start options are values chosen before a new run, such as the model. The plugin defines allowed values, a default value, and the check of the selection. At start, the chosen value is stored for the run and fixed.", "Inside register(host); Type comes from typebox.", `
host.startOptions({
  id: "ragents.example.mode",
  schema: Type.String({ enum: ["brief", "detailed"] }),
  selectable: () => true,
  defaultValue: () => "brief",
  accept: (value) => {
    if (value !== "brief" && value !== "detailed") throw new Error("Invalid mode.");
    return value;
  },
  describe: () => ({
    kind: "choice", label: "Level of detail",
    options: [{ value: "brief", label: "Brief" }, { value: "detailed", label: "Detailed" }],
  }),
});`, ["host.startOptions"], [
    "The choice presentation works with the existing selection menu. A custom control can be registered on the web side under the same option ID; describe contains no validation rules.",
    "A preset value must also be valid; a missing prerequisite is not silently replaced.",
    "Besides runId, defaultValue, accept, and describe receive the acting user as userId, or null without sign-in. The optional ownerOnly(value) reserves operating a run with this value for its owner; reading and stopping remain open to everyone who sees it. The optional rights names permissions beyond runs.create, for example runs.inspect for an option with a technical presentation such as the model selection; without them the option is missing from the list, and choosing it fails with access-denied. With changeable, the option stays selectable after the start: every new choice ends up in the journal, and whoever reads the option follows the stored value; the model selection works this way and applies from the next turn.",
  ]),
  entry("access-projections", "Server contributions", "States for restricted access", "Access without runs.inspect sees the plugin states of a run and their chat events the way the plugin they belong to determines. The plugin reports for each state what remains visible of it. Without a projection, a state stays unchanged.", "Inside register(host); ragents.example.board is a state of this plugin.", `
host.accessProjections({
  id: "ragents.example.board",
  state: (entry) => ({ title: (entry.state as { title?: string }).title ?? null }),
  chatEvent: () => undefined,
});`, ["host.accessProjections"], [
    "state receives the state including updatedAt and returns the visible value or undefined; the host keeps identifier, scope, and timestamp. chatEvent receives type and payload of a chat event with this identifier and returns the visible part or undefined. Each identifier has at most one projection.",
    "Only those who have these permissions see the stored value of a start option with rights, in the run view as well as in the chat; this applies before any projection.",
  ]),
  entry("session-metadata", "Server contributions", "Provide run metadata", "A plugin can provide short additional details about a run, such as a processing status. Such metadata is available to the interface for display. The underlying domain data stays with the plugin.", "Inside register(host); example without its own data storage.", `
host.sessionMetadata({
  id: "ragents.example.metadata",
  describe: ({ runId }) => ({ run: runId, label: "Example" }),
});`, ["host.sessionMetadata"], ["The matching display is registered separately as a sessionMetadata or header contribution in the web half."]),
  entry("script-runtime", "Server contributions", "Integrate the TypeScript runtime", "The TypeScript runtime executes the programmed workflows of a run. The server integrates it through the script contribution. This provides the execution and the available programming functions.", "Wiring example; createRuntime satisfies ScriptContribution['create'].", `
function registerRuntime(host: PluginRegistration, createRuntime: ScriptContribution["create"]) {
  host.script({ id: "ragents.example.script", create: createRuntime });
}`, ["host.script"], [
    "The host accepts at most one ScriptRuntime contribution. Actor inputs and actor functions share this platform.",
    "Regular domain plugins do not need this slot; they add tools or operations with typed contracts.",
  ]),
  entry("web-activation", "Web contributions", "Activate the web half", "The web half of a plugin provides its interface contributions, such as tabs or settings. The webPlugin export describes how these contributions arise from the public configuration. It can also explicitly deactivate them for a certain configuration.", "plugins/ragents.example/web/index.tsx; WebPlugin is imported from the neutral web host contract.", `
export const webPlugin = {
  id: "ragents.example",
  activate: (config) => {
    if (typeof config.label !== "string") throw new Error("The label is missing.");
    return { id: "ragents.example", enabled: () => true };
  },
} satisfies WebPlugin;`, ["webIdentity.id", "web.id", "web.activate", "web.enabled"], [
    "activate must not change the plugin ID. Deactivation removes all contributions of this web half from the active registry.",
    "The plugin folder is built as its own chunk. Foreign web bundles are not installed later at runtime.",
  ], "tsx"),
  entry("web-brand", "Web contributions", "Branding and chat display", "A product contribution defines the name and appearance of the application. It also determines how the agents' intermediate steps are displayed in the chat, including thinking output and tool calls.", "Properties of a WebPlugin; exactly one active branding contribution.", `
const productUi = {
  id: "ragents.example",
  brand: { title: "Example workshop", Logo: () => <span>E</span> },
  chatDisplayPolicy: {
    modes: { coordinator: "chips", agents: "compact" },
    stepsVisible: true, stepsExpandable: true, selectable: true,
  },
} satisfies WebPlugin;`, ["web.brand", "web.chatDisplayPolicy"], ["Several branding contributions or several chat display policies are errors. A domain plugin next to an existing product normally provides neither."], "tsx"),
  entry("web-tabs", "Web contributions", "Fixed and dynamic tabs", "A plugin can add its own tab with an icon, content, and optionally a status badge. Fixed tabs are always part of its offering. Dynamic tabs arise to match the state of the open run.", "Properties of a WebPlugin; exampleTabs(session) is a custom, validating projection.", `
const tabs = {
  id: "ragents.example",
  workspaceTabs: [{
    id: "ragents.example.overview", label: "Overview", order: 100,
    Icon: () => <span>E</span>,
    Panel: ({ active }) => <p>{active ? "Active tab" : "Inactive"}</p>,
    Badge: () => <span>1</span>,
  }],
  workspaceTabsFor: (session) => exampleTabs(session),
} satisfies WebPlugin;`, ["web.workspaceTabs", "web.workspaceTabsFor"], [
    "available(session) filters availability, keepMounted keeps an inactive view. Polling is still controlled based on active.",
    "Dynamic tab IDs must also be unique. In the run panel, the same tabs are in the toolbar on the right edge.",
  ], "tsx"),
  entry("web-surface", "Web contributions", "The shared run panel", "A plugin can provide the run panel shared by browser and VS Code. It receives chat rendering, navigation, card sections, and app contributions.", "Properties of a WebPlugin.", `
const surfaceUi = {
  id: "ragents.example",
  surface: {
    RunPanel: ({ renderChat }) => <div>{renderChat()}<p>Custom surface</p></div>,
  },
} satisfies WebPlugin;`, ["web.surface"], [
    "There is at most one surface contribution. The example replaces the central surface; it does not automatically extend the orchestration's existing surface. Without a surface contribution, the host shows the standard chat.",
    "toolbarLeft is part of the renderChat contract for the owner of the surface. There is no general composer toolbar registry slot.",
  ], "tsx"),
  entry("web-surface-elements", "Web contributions", "Mini-apps in the shared panel", "A plugin supplies app definitions and rendering to the shared catalog. The browser shows apps as tabs beside Chat; VS Code opens them in editor tabs.", "Properties of a WebPlugin.", `
const elements = {
  id: "ragents.example",
  surfaceElements: [{
    id: "ragents.example.note", order: 100,
    select: () => [{ id: "example-note", title: "Note", visible: true }],
    Element: ({ definition }) => <p>{definition.title}</p>,
  }],
} satisfies WebPlugin;`, ["web.surfaceElements", "surfaceElement.id", "surfaceElement.visible", "surfaceElement.title", "surfaceElement.anchorActorId", "surfaceElement.entity", "surfaceElement.data"], ["Definitions require an id; title is optional. visible: false removes an entry from the catalog. The host determines its size. anchorActorId, entity, and custom data are optional. New apps do not steal focus. Visited browser views stay mounted while hidden; unavailable selections return to Chat."], "tsx"),
  entry("web-card-sections", "Web contributions", "Sections on actor cards", "A plugin can add sections above the selected actor chat, for example for documents or a status.", "Properties of a WebPlugin; a neutral section without access to actor fields.", `
const cards = {
  id: "ragents.example",
  cardSections: [{ id: "ragents.example.note", order: 100,
    Section: () => <p>Additional card content</p> }],
} satisfies WebPlugin;`, ["web.cardSections"], ["actor is unknown at this boundary. Anyone using actor fields must check them with the contract of the responsible plugin. An empty contribution can render null."], "tsx"),
  entry("web-context", "Web contributions", "Run data and React context", "Several interface contributions of a plugin can need shared data about the open run. A SessionProvider passes this data on through React context. With needsRunView, the plugin additionally requests the run state provided by the server.", "Properties of a WebPlugin; the provider can use its own Context.Provider here.", `
const sessionUi = {
  id: "ragents.example",
  needsRunView: true,
  SessionProvider: ({ children, session }) => <section aria-label={session.session.title}>{children}</section>,
} satisfies WebPlugin;`, ["web.needsRunView", "web.SessionProvider"], ["session.runView is unknown and must be validated before domain access. A provider owns session and navigation and is only included for active plugins."], "tsx"),
  entry("web-headers", "Web contributions", "Overview, global toolbar, and run bars", "A plugin can show information for the entire application or for the run that is currently open. Contributions for the entire application appear in the overview or in the global header; contributions for the run follow the current selection. For this there are overviewPanels with a placement choice and sessionHeaders for run details in the shared title bar.", "Properties of a WebPlugin.", `
const headers = {
  id: "ragents.example",
  overviewPanels: [
    { id: "ragents.example.panel", order: 100, readRight: "ragents.example.read",
      Panel: ({ open }) => <section>{open ? "Overview open" : "Overview hidden"}</section> },
    { id: "ragents.example.toolbar", order: 110, readRight: "ragents.example.read", placement: "toolbar",
      Panel: ({ open, onOpen, onClose }) => <button onClick={open ? onClose : onOpen}>
        {open ? "Close contribution" : "Open contribution"}
      </button> },
  ],
  sessionHeaders: [{ id: "ragents.example.run-header", order: 100,
    Header: ({ session }) => <span>{session.running ? "Working" : "Ready"}</span> }],
  sessionStatus: [{ id: "ragents.example.run-status", order: 100,
    Status: ({ session }) => <span>{session.connected ? "Connected" : "Disconnected"}</span> }],
} satisfies WebPlugin;`, ["web.overviewPanels", "web.sessionHeaders", "web.sessionStatus"], ["The context provides registry, open, onOpen, onClose, and onBusy. Without placement, the contribution appears in the overview and is mounted when first opened. Toolbar contributions are mounted from application startup; they activate their own connections only when used. The host coordinates open toolbar contributions. sessionHeaders appear in the run details popover. Run header and lower status groups receive SessionContext and navigation and follow the active run."], "tsx"),
  entry("web-settings", "Web contributions", "Editable plugin settings", "A plugin can offer its own interface for editing its settings. With category, it appears under Models or Appearance, and additionally on the plugin's settings page. The application assigns it to the active plugin.", "Properties of a WebPlugin; ExampleSettings is the plugin's own React component.", `
import { useState } from "react";
function ExampleSettings() {
  const [compact, setCompact] = useState(false);
  return <label>
    <input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} />
    Compact display
  </label>;
}
const settingsUi = {
  id: "ragents.example",
  settings: [{
    id: "ragents.example.preferences",
    label: "Appearance",
    category: "appearance",
    readRight: "ragents.example.read",
    order: 100,
    Settings: ExampleSettings,
  }],
} satisfies WebPlugin;`, ["web.settings", "settings.id", "settings.label", "settings.category", "settings.readRight", "settings.order", "settings.Settings"], ["category: models shows the contribution under Models, appearance under Appearance. Without category, it stays with its plugin. The form areas load independently of the technical contribution catalog.", "readRight hides the contribution without the named permission; without it, settings.read applies. The component checks its write permission with useAccess, and the server route additionally with requiredRights.", "The example keeps the value only locally. Settings receives no props; the plugin connects its component itself to configuration, shared state, and its own server routes. Identifiers are globally unique; order is optional and 0 by default. Without an active plugin, no settings area is included."], "tsx"),
  entry("web-start", "Web contributions", "Operate start options and guides", "Before a new run, start options can be chosen directly or collected in a setup dialog. The plugin provides the interface for this and connects its values to the respective server contract. A guide is such a dialog for a prepared workflow.", "Properties of a WebPlugin; the option is additionally registered on the server side.", `
const starters = {
  id: "ragents.example",
  startOptions: [{ id: "ragents.example.mode", placement: "composer",
    Control: ({ disabled, setValue }) => <button disabled={disabled} onClick={() => void setValue("brief")}>Brief</button>,
    Badge: () => <span>Mode</span> }],
  guides: [{ id: "ragents.example.guide",
    Guide: ({ onComplete, onCancel }) => <div>
      <button onClick={() => onComplete({ topic: "Example" })}>Start</button>
      <button onClick={onCancel}>Cancel</button>
    </div> }],
} satisfies WebPlugin;`, ["web.startOptions", "web.guides"], [
    "placement puts the option in the input bar (composer) or below the input (page, default). The host shows it only at the chosen place; model and thinking level use composer and are therefore also in the chat input of every run.",
    "The object in the example is a script start value. A skill guide instead returns the text of the first message. The StartEntry refers to this identifier with guide.",
    "The reference plugin provides two complete guides: ConversationGuide collects topic and number of rounds for a conversation circle; SharedBoardGuide collects title and first entry for a shared collection board. Both begin with the run only after completion. The scripts check the input before the setup.",
  ], "tsx", [
    { title: "Both React guides", file: "plugins/ragents.reference/web/StartGuides.tsx" },
    { title: "Registration of the guides", file: "plugins/ragents.reference/web/index.tsx" },
    { title: "Setup of the conversation circle", file: "plugins/ragents.reference/run-scripts/conversation-circle/src/server.ts" },
    { title: "Setup of the collection board", file: "plugins/ragents.reference/run-scripts/shared-actor-list/src/server.ts" },
  ]),
  entry("web-presenters", "Web contributions", "Display tools and entities", "Plugins can determine how their tool calls are displayed in the chat and where references to their data lead. A tool presenter provides the display of the call. An entity presenter translates the data reference into a navigation target.", "Properties of a WebPlugin; example.overview is a tab registered by the plugin.", `
const presenters = {
  id: "ragents.example",
  toolPresenters: [{ toolName: "example_trim",
    Inline: () => <span>Text review</span>,
    reveal: () => ({ tabId: "ragents.example.overview" }) }],
  entityPresenters: [{ reveal: (entity) => entity.type === "example-note"
    ? { tabId: "ragents.example.overview", selection: entity.id } : undefined }],
} satisfies WebPlugin;`, ["web.toolPresenters", "web.entityPresenters"], ["navigation.openTab opens a registered tab; revealEntity uses the presenters. selection is a separate checked contract between caller and target panel."], "tsx"),
  entry("web-metadata", "Web contributions", "Metadata in list and header", "Additional details about a run can appear in the run list and in its header. The plugin receives the run's data and the display location. That way, it can show the same status briefly or in more detail depending on the space.", "Properties of a WebPlugin.", `
const metadata = {
  id: "ragents.example",
  sessionMetadata: [{ id: "ragents.example.metadata", order: 100,
    Metadata: ({ placement }) => <span>{placement === "list" ? "E" : "Example"}</span> }],
} satisfies WebPlugin;`, ["web.sessionMetadata"], ["Domain values are provided through the server-side sessionMetadata contribution. The web half displays the values."], "tsx"),
  entry("web-attention", "Web contributions", "Attention and waiting actions", "A plugin can mark that a run needs attention. If an action of the plugin is waiting for input, its own actionViews contribution displays it and answers it through its contract; the core does not know its form. Marking and display are separate contributions.", "Properties of a WebPlugin; answerQuestion is the plugin's own checked HTTP client.", `
const interaction = {
  id: "ragents.example",
  attention: [{ id: "ragents.example.attention",
    assess: (session) => session.running ? { active: true, label: "Working" } : undefined }],
  actionViews: [{ owner: "ragents.example",
    View: ({ action, session }) => <button onClick={() =>
      void answerQuestion(session.session.id, action.actionId, "ok")}>{String(action.payload)}</button> }],
} satisfies WebPlugin;`, ["web.attention", "web.actionViews"], ["There is exactly one display per owner. Without a display, the chat shows the action generically with a title, waiting for input, and discard. Attention itself creates no action or background work."], "tsx"),
  entry("run-snippet", "Actor programs", "Run a small TypeScript snippet", "One-off calculations, queries, and setup steps need no actor of their own. The model discovers the current API and combines its functions directly in TypeScript.", "code for typescript_eval, or the same source text in a file for path.", `
const actors = await context.functions.actor_list({});
return actors;`, [], [
    "The source text is the body of an asynchronous function with context. await and return are allowed directly; modules are loaded with await import(...). The type check runs before execution.",
    "context.log collects output, return delivers a JSON result; without return it is null. Local variables and context.state apply only to this execution.",
    "Registered functions and their input and result types are the same in snippets and actor programs. A snippet acts as the caller. Function calls that have already completed stay in effect after a later error.",
    "For later messages, events, persistent state, or views, an actor program is available. The domain task does not have to prescribe this technical choice.",
  ]),
  entry("actor-state", "Actor programs", "A TypeScript actor with state", "A TypeScript actor processes delivered messages in code. Functions and optional views use the same stored state. The return value of a function is a result; state changes are made explicitly.", "src/server.ts of a regular actor package.", `
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ processed: Type.Optional(Type.Integer()) }),
  functions: {},
  input: { capabilities: [] },
}, {
  functions: {},
  onInput: (input, context) => {
    context.throwIfAborted();
    const processed = (context.state.read().processed ?? 0) + 1;
    context.state.replace({ processed });
    context.log({ text: input.content, processed });
  },
});`, ["run.state", "run.log", "run.throwIfAborted", "run.signal"], [
    "defineActor derives state and function signatures from TypeBox. Relative imports and Node libraries are regularly available.",
    "An LLM actor can own functions and views; its regular input stays with the model driver. A program with onInput is rejected on it.",
  ]),
  entry("run-capabilities", "Actor programs", "Run functions and execution identity", "A run function is available with an identical contract for snippets and actor programs. Each checked program version, the build, names its complete list of these functions including input and output types. The execution identity determines on whose behalf the program acts and which permissions apply.", "Excerpt in an asynchronous actor handler; actor_input must be declared and allowed in the build.", `
context.log({ run: context.run.id, actor: context.actor.handle, invocation: context.invocation.id,
  kind: context.invocation.kind, principal: context.principal.kind });
await context.functions.actor_input({
  actor: "@reviewer", content: "Review the new result.",
});`, ["run.run", "run.actor", "run.std", "run.invocation", "run.principal", "run.functions"], [
    "Snippets act as the caller, onInput as the receiving actor. A called actor function owns its state, but executes run calls as its caller. A subscription applies to the acting identity.",
    "@reviewer must already exist in the run. Runtime and test resolve the reference; the guide requires no copied actor IDs.",
    "Call names use underscores, such as actor_input. Dotted names such as actor.input are grants. Additional permissions of the actor do not automatically extend an installed build.",
    "invocation.kind knows input, snippet, tool, and app-action. event and schedule are already declared as type values, but currently have no trigger of their own.",
  ]),
  entry("subscriptions", "Actor programs", "Subscribe to events and pass messages on", "Events report what happened in a run, for example that an agent has completed a contribution. A subscription delivers matching new events to a participant as a message. A programmed mediator can then pass the result on or trigger the next work step.", "Excerpt in an actor handler; the listed capability calls must be allowed.", `
await context.functions.event_subscribe({
  sourceActorIds: ["@reviewer"],
  eventTypes: ["model.output.completed"],
});`, [], [
    "For a subscription, an actor handler receives the source event through input.event, otherwise null. input.content, artifactIds, sourceEventIds, and subscriptionId describe the delivery.",
    "The subscriber needs a new turn; a subscription does not secretly change a running turn. Per actor, inputs are processed in journal order.",
    "event_unsubscribe removes the subscription. Events that are already stored are not delivered again after a server restart.",
    "context.std.mediators.route returns an input function for fixed forwarding rules and stores its state explicitly. context.std.now and context.std.id refer to the current actor turn.",
  ]),
  entry("run-scripts", "Actor programs", "A run script as a prepared setup", "A run script is a complete actor program for starting a run. The host activates it with the same compiler and the same domain tests as a program written during the run.", "RUN.md; next to it are package.json, src/server.ts, and tests/*.test.ts.", `
---
title: Prepare example
description: Counts the first start task.
order: 100
coordinator: true
---

The setup uses the actor program from this chapter.`, ["runScript.handle", "runScript.coordinator", "runScript.embeddable", "runScript.sharedPrograms", "runScript.files", "runScript.programs"], [
    "The package folder determines the handle. package.json.ragents.backend names the entry point with defineActor and onInput. The capabilities appear only in the TypeScript contract.",
    "Further prepared programs live under actors/<name>/. The host copies them into @actors; the setup activates them with actor_program_activate and an optional actor handle.",
    "coordinator: false omits the usual coordinator. The setup must then designate another actor as the primary chat partner.",
    "embeddable: true also lets the script start inside a running run without changing its primary actor; a repeated start reuses the setup actor. onStart receives each start with embedded, startedBy, and count.",
  ], "markdown"),
  entry("run-script-results", "Actor programs", "End a start with a result", "A run script can be started again and inside a running run. It receives each start in onStart and ends it with a result that the host delivers once to whoever started it.", "src/server.ts of a run script whose RUN.md sets embeddable: true.", `
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ checked: Type.Optional(Type.Integer()) }),
  functions: {},
  input: { capabilities: [] },
}, {
  functions: {},
  onInput: () => {},
  onStart: (start, context) => {
    const checked = (context.state.read().checked ?? 0) + 1;
    context.state.replace({ checked });
    context.finish({ checked, embedded: start.embedded }, { summary: \`Checked \${checked} times.\` });
  },
  onResult: (result, context) => {
    context.log({ from: result.handle, start: result.count, summary: result.summary });
  },
});`, ["run.finish"], [
    "start carries input, options, embedded, startedBy, and count, the number of this start of the package in the run. Without onStart, the start arrives in onInput as the JSON { input, options }.",
    "context.finish works in onStart, onInput, and onResult; outside onStart it names the start with { start: count }. A second finish of the same start fails the turn.",
    "The owner reads the summary in the chat, an LLM gets summary and result as a message, a TypeScript actor that started the script gets them in onResult.",
    "An embedded start adds its visible views to the app catalog without changing the selected view.",
    "shared-programs: notebook in RUN.md copies the plugin's shared package actors/notebook/ into the run; actor_program_ensure({ name: \"notebook\" }) makes it active once, whichever script comes first.",
  ]),
  entry("program-tests", "Actor programs", "Check input processing in a domain test", "Regular TypeScript tests check the input handler and its explicit state changes. The host runs the same tests before activation.", "tests/program.test.ts for the previous counter program.", `
import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";

test("remembers separate inputs", async () => {
  const context = createTestContext<{ processed?: number }>({ state: {} });
  for (const content of ["one", "two"]) {
    await program.onInput({ id: content, content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null }, context);
  }
  assert.deepEqual(context.state.read(), { processed: 2 });
});`, [], [
    "actor_program_activate checks, builds, tests, and activates the program. There is no second check/test/install contract and no test evidence as a model argument.",
    "A pure view package needs neither an input handler nor an invented server function.",
  ]),
  entry("app-package", "Actor programs", "A program with optional views", "A private TypeScript package can provide functions, input processing, and several React views. It binds to an existing actor or, for a new backend, creates a TypeScript actor.", "package.json; for each view, the host provides the HTML root element root.", `
{
  "name": "shared-list",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Shared list",
    "description": "One state for function and interface.",
    "backend": "src/server.ts",
    "views": [{ "id": "main", "client": "src/client.tsx", "styles": "src/styles.css" }]
  }
}`, ["appPackage.title", "appPackage.description", "appPackage.backend", "appPackage.views"], [
    "At least a backend or a view must be present. Without a backend, a new view binds to the calling actor; a dummy installation is not needed.",
    "actor_program_create creates the package with fixed local dependencies. File tools and language servers use @actors/<name>/, Bash uses the same alias as cwd.",
    "Changed project errors appear as short deltas before model requests. actor_program_diagnostics returns the complete state, actor_program_activate checks and activates.",
  ], "json"),
  entry("app-contract", "Actor programs", "A contract for actor state and functions", "The TypeBox contract describes an actor's data and the inputs and outputs of its functions. A function can be called in the view and can additionally be offered in the shared TypeScript API with the same implementation. The SDK types are generated from it automatically.", "src/contract.ts; shared contract for the following backend function.", `
import { Type } from "typebox";

export const contract = {
  state: Type.Object({ entries: Type.Optional(Type.Array(Type.String())) }),
  functions: {
    append: {
      label: "Add entry",
      description: "Adds to the shared list.",
      input: Type.Object({ text: Type.String() }),
      output: Type.Object({ entries: Type.Array(Type.String()) }),
      capabilities: [],
      tool: { name: "append_to_list", targets: ["self"], card: true },
    },
  },
} as const;`, ["appContract.state", "appContract.functions", "appContract.input", "appAction.label", "appAction.description", "appAction.input", "appAction.output", "appAction.capabilities", "appAction.confirmation", "appAction.tool"], [
    "The state schema accepts {} as the initial value. input and output determine the types of the matching handler; capabilities names the run capabilities it needs.",
    "Without targets, the function is available to active executable actors. self means the owner of the program, @handle a specific target. card: true generates the form from the same input contract. An optional confirmation requires a confirmation before the action.",
    "After activation, the function is already available in context.functions in the running model turn. typescript_api returns its current contract. Activating again updates the schema; removing withdraws the function.",
    "One actor program is active per actor; further functions and views are added to it. A pure view needs no backend contract. Optional input in the contract requires onInput in the implementation and is only available for TypeScript actors.",
  ]),
  entry("app-handler", "Actor programs", "A function for view and tool", "The function processes a typed input and changes the state of its actor. Calls from that actor's React view and through the TypeScript API use exactly this implementation, without an additional model turn.", "src/server.ts; package.json.ragents.backend names this entry point.", `
import { defineActor } from "@ragents/server";
import { contract } from "./contract.ts";

export default defineActor(contract, {
  functions: {
    append: (input, context) => {
      const entries = [...(context.state.read().entries ?? []), input.text];
      context.state.replace({ entries });
      return { entries };
    },
  },
});`, [], [
    "A return value is always the domain result. Only context.state.replace records new actor state.",
    "context.actor names the owner of the function. Run functions use the caller's identity and the declared capabilities. onInput acts as its actor.",
  ]),
  entry("app-tests", "Actor programs", "Domain tests as TypeScript files", "The backend function is checked with regular tests and explicit dependencies. Activation runs the existing test files; failures prevent the new version from being taken over.", "tests/program.test.ts; runs with node --import tsx --test.", `
import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("keeps existing entries", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: { entries: ["First"] } });
  assert.deepEqual(await program.functions.append({ text: "Second" }, context), {
    entries: ["First", "Second"],
  });
  assert.deepEqual(context.state.read(), { entries: ["First", "Second"] });
});`, [], [
    "createTestContext provides state, abort signal, and explicitly specified typed functions under functions. The mocks are TypeScript functions in the test and not a tool argument of the model.",
    "A domain test checks the shared function. A real browser check must additionally prove the visible operation.",
  ]),
  entry("app-tabs", "Actor programs", "Views as app tabs", "An activated visible view enters the shared app catalog and belongs to its actor. Several views can show the same actor state.", "An entry in package.json.ragents.views.", `
{ "id": "main", "title": "List", "client": "src/client.tsx" }`, [], [
    "actor_view_set_visibility uses package name/view name or a unique title. The view identifier is unique within the package. A view has no host size of its own; the browser content area or VS Code editor determines it.",
    "actor_view_set_visibility makes a view visible or invisible. Functions and actor state are preserved.",
    "Views have no dialog or window control API.",
  ], "json"),
  entry("app-client", "Actor programs", "React view with actor state", "The view reads the intrinsic state of its actor. New successful changes appear even while the chat is idle; local React input is preserved.", "src/client.tsx for the shared list.", `
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import * as UI from "@ragents/client/ui";

function App() {
  const state = useAppState();
  return <>
    <p>List of {context.actor.handle}</p>
    <ul>{(state.entries ?? []).map((entry, index) => <li key={index}>{entry}</li>)}</ul>
    <UI.Button onClick={async () => { await context.capabilities.call("append", { text: "Example" }); }}>Add</UI.Button>
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);`, ["app.ready", "app.run", "app.actor", "app.principal", "app.state", "app.chat", "app.capabilities", "appState.read", "appState.subscribe", "appCapabilities.list", "appCapabilities.call"], [
    "context.actor describes the owner of the view. ready confirms the bridge, run and principal the bound run and the operator identity.",
    "useAppState reads actor state reactively. Alternatively, state.read and subscribe provide a snapshot and change notifications.",
    "context.capabilities.call calls a declared actor function. Local drafts belong in React state; a function call starts no model turn.",
  ], "tsx"),
  entry("app-chat", "Actor programs", "Chats and reusable UI", "A mini-app can show and operate its actor's conversation or display its own controlled history. Message view, input, and further UI building blocks are also available individually.", "src/client.tsx; alternative for an actor of this run that already exists.", `
import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";
import { context } from "@ragents/client";

function App() {
  return <UI.Chat actor={"@" + context.actor.handle} title="Review" />;
}
createRoot(document.getElementById("root")!).render(<App />);`, ["chat.read", "chat.subscribe", "chat.send"], [
    "actor and messages/onSend are different chat variants. primary binds the primary actor; @handle a named actor of the run.",
    "The imported context offers context.chat.read(actor), subscribe(actor, listener), and send(actor, text, attachments?). A subscription is unsubscribed at teardown.",
    "UI.MessageList shows controlled messages with named senders. The app provides order and content; the building block creates no answers.",
    "The building block reference shows current props and local demos of the components.",
  ], "tsx"),
  entry("product-policy", "Product and runtime contracts", "Provide a product policy", "The coordinator is the central AI contact of a run and can distribute tasks to further agents. The product policy defines its start, the roles of the participants, and their instructions. A custom application provides these rules as a service.", "register(host); policy satisfies ProductRuntimePolicy, productRuntimeToken comes from the neutral server host.", `
const policy: ProductRuntimePolicy = {
  coordinator: {
    handle: "coordinator", displayName: "Coordinator", profile: "example-reviewer",
    runTitle: "New task", ownerHandle: "owner", ownerDisplayName: "User",
  },
  roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
  contract: (role) => role === "primary" ? "Coordinate the task." : "Work on your subtask.",
  promptComposition: "Product prompt and role contract are used together.",
  systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
};
host.provide(productRuntimeToken, policy);`, ["product.coordinator", "product.roleFor", "product.contract", "product.promptComposition", "product.systemPrompts"], [
    "coordinator describes handle, display name, profile, run title, and owner. roleFor determines primary or worker, contract returns the role prompt, promptComposition the composition, and systemPrompts the catalog.",
    "A new domain plugin does not register a second product service next to an existing product. The configuration must provide a complete model catalog for the profile in use.",
  ]),
  entry("workspace-policy", "Product and runtime contracts", "Resolve workspaces", "A workspace determines in which directories the agents of a run work with files and processes. The WorkspaceRuntime service resolves this area and describes it. An optional WorkspaceResolver can adjust the assignment without replacing the entire service.", "register(host); workspaceResolverToken comes from the neutral server host.", `
host.provide(workspaceResolverToken, {
  resolve: async ({ directory }) => ({ cwd: directory }),
});`, ["workspace.resolve", "workspace.describe", "workspace.placementOf", "workspace.toolNaming", "workspace.transfer", "resolver.optionId", "resolver.kind", "resolver.workstation", "resolver.resolve", "resolver.stopSession", "resolver.deleteSession"], [
    "resolve of the complete WorkspaceRuntime returns a SessionWorkspace with cwd, currentRoot, and runOperation; optionally gitEnv, gitConfig, and extraEnv are added. describe returns mode and directory pattern; placementOf states separately whether a run works on the server or on a workstation and whether in a new or existing folder, plus the kind of a contributed folder, and toolNaming can name the existing file tools.",
    "A resolver receives runId, directory, choice, and emitSystem. optionId connects the selection with a registered start option. kind describes identifier, label, server folder, and display pattern of the contributed workspace on the server. workstation provides the new folder on a workstation: label and steps from operations of the executor there, which run after creation (prepare) and before removal (release); without workstation, a resolver offers no new folder there. The resolver shown keeps the run directory prepared by the host.",
    "stopSession and deleteSession optionally add the lifecycle boundaries of the contributed workspace. On stop, the resolver also receives the teardown of the host sandbox; deletion follows only afterwards.",
    "transfer handles moving a run to another server: boundDirectory names an existing folder on this machine that the run is bound to, assertDirectory checks a replacement folder, rebind binds the run there.",
    "File and process work happens through the existing workspace boundary. A plugin does not change the server's global working directory on its own.",
  ]),
  entry("document-store", "Product and runtime contracts", "Document storage and Git views", "The document storage assigns each run a directory for its files. An additional Git view can provide the branch, changes, and file contents of a workspace. Plugins provide these services so that other contributions can use the same data.", "register(host); store and gitView satisfy DocumentStore and GitWorkspaceView respectively.", `
host.provide(documentStoreToken, store);
host.provide(gitWorkspaceViewToken, gitView);`, ["documents.directoryFor", "documents.describe", "gitView.branch", "gitView.changes", "gitView.file"], [
    "DocumentStore resolves the document directory with directoryFor(runId) and describes its directory pattern.",
    "GitWorkspaceView returns branch(runId), changes(runId), and file(runId, filePath, view), where view is diff or current. The interface receives a checked projection, not a free Git process.",
  ]),
  entry("driver", "Product and runtime contracts", "Replace the model runtime", "An AgentDriver connects the model runtime with RAgents. It processes a delivered message in one step, the turn, connecting model, tools, cancellation, and emitted events. The scheduler, the workflow control of RAgents, assigns these steps to it.", "A simple test driver without a model call; AgentDriver comes from @ragents/engine.", `
const testDriver: AgentDriver<"agent"> = {
  kind: "agent",
  supportsPlainLlm: true,
  async runTurn(request, signal) {
    signal.throwIfAborted();
    request.recordContext({ kind: "step", step: {
      api: "test", provider: "test", model: "echo", stopReason: "stop", timestamp: Date.now(),
      content: [{ type: "text", text: request.input.content }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    } });
    return { failure: null, usage: {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0,
    } };
  },
};`, ["driver.kind", "driver.supportsPlainLlm", "driver.runTurn", "driver.disposeAgent", "driver.reviveAgent", "driver.haltRun", "driver.waitForRunSettlement", "driver.disposeRun", "driver.shutdown"], [
    "kind determines the driver kind. supportsPlainLlm declares operation without RAgents tools. disposeAgent, reviveAgent, haltRun, waitForRunSettlement, disposeRun, and shutdown are optional for the matching lifecycle boundaries.",
    "request provides, among other things, the delivered input, prompt, model selection, tool list, invoke, and recordContext; a model step in the model context is also the visible answer. The return value contains failure and usage.",
    "There is no host.drivers registry. The current DriverRegistry knows the fixed kinds agent and script; a new kind requires a deliberate engine integration. profiles alone does not extend this boundary.",
  ]),
  entry("language-server", "Product and runtime contracts", "Connect a language server", "A language server analyzes source code and provides language features such as error messages and symbol search. An adapter describes how RAgents recognizes the matching project and starts the server. The plugin brings it as a contribution to the executor, which runs on every machine that holds a workspace; the existing integration makes its functions available as tools and server access.", "executor.ts and server/index.ts of a simple TypeScript LSP, here in one file. The contribution imports only types from the host.", `
const languages = { ".ts": "typescript" };
export const exampleLanguageServer: LanguageServerDescription = {
  id: "example", label: "TypeScript", languages, rootDescription: "Project directory",
};
export const executor: WorkspaceExecutorContribution = (machine) => ({ languageServers: [{
  ...exampleLanguageServer,
  resolveRoot: machine.resolveRootDirectory,
  rootDirectory: (root) => root,
  launch: async (context, root) => ({
    label: "TypeScript", command: process.execPath,
    args: [machine.hostPackageFile(context.hostRoot, "typescript-language-server/lib/cli.mjs"), "--stdio"],
    cwd: root, env: context.env, uid: context.uid, gid: context.gid,
    rootUri: pathToFileURL(root).href, languages,
    initializationOptions: { tsserver: { path: path.dirname(machine.hostPackageFile(context.hostRoot, "typescript")) } },
  }),
  open: async () => "TypeScript server ready.",
}] });
export const plugin: PluginModule = {
  requires: ["ragents.workspace"],
  create: () => createLanguageServerPlugin({ id: "ragents.lsp-example", languageServer: exampleLanguageServer }),
};`, ["lsp.id", "lsp.label", "lsp.languages", "lsp.rootDescription", "lsp.solutionExtensions", "lsp.resolveRoot", "lsp.rootDirectory", "lsp.launch", "lsp.open",
    "executorParts.languageServers", "executorParts.modules", "executorMachine.toolsDirectory", "executorMachine.hostPackageFile", "executorMachine.resolveRootFile",
    "executorMachine.resolveRootDirectory", "executorMachine.operationError", "executorMachine.processEnvironment"], [
    "languages maps file extensions to language identifiers. resolveRoot checks the project target, rootDirectory names the folder that a file of this target is assigned to (the project directory itself for TypeScript, the folder of the project file for Roslyn and FSAC), launch returns the process start contract for the sandbox context, and open adds server-specific opening steps if needed.",
    "solutionExtensions is optional and names the extensions of the solutions, such as .sln and .slnx; with it, the plugin gets the tool <id>_solutions, the solution list, and switching in the tab. A directory adapter like this one omits it.",
    "executor is a function of the machine and returns languageServers and modules; modules are further modules with their own operations, such as the browser of ragents.browser. The machine provides the plugin's tool folder (toolsDirectory), files from the host's packages (hostPackageFile), the checked root resolution (resolveRootFile, resolveRootDirectory), domain errors (operationError), and the environment of its own processes (processEnvironment).",
    "The build tool turns executor.ts into a self-contained file executor/index.mjs; importing a host module or another plugin there is a build error. Server and workstations load the same file, a workstation from the bundles of its own host. The server half imports the description relatively from executor.ts.",
    "The required server programs come through the plugin's provisioning or from the host's packages. A missing program is reported as an error; no substitute process is started silently.",
    "Required imports: path from node:path, pathToFileURL from node:url, the types LanguageServerDescription and WorkspaceExecutorContribution from @ragents/workspace-executor, and in the server half createLanguageServerPlugin as well as PluginModule. The host handles the LSP initialization; open afterwards adds only server-specific steps.",
  ]),
];

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

function embeddedDeclaration(source: string, name: string): string {
  const start = source.indexOf(`interface ${name}`);
  if (start < 0) throw new Error(`The generated contract ${name} is missing.`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`The generated contract ${name} is incomplete.`);
}

async function readContract(repoRoot: string, contract: Contract): Promise<{ keys: string[]; text: string }> {
  const source = await readFile(path.join(repoRoot, contract.file), "utf8");
  const text = contract.kind === "embedded" ? embeddedDeclaration(source, contract.name) : source;
  const file = ts.createSourceFile(contract.name + ".ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (contract.kind === "schema") {
    let found: ts.ObjectLiteralExpression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === contract.name && node.initializer && ts.isCallExpression(node.initializer)) {
        const object = node.initializer.arguments[0];
        if (object && ts.isObjectLiteralExpression(object)) found = object;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (!found) throw new Error(`The manifest contract ${contract.name} is missing.`);
    return { keys: found.properties.map((member) => `${contract.id}.${member.name!.getText(file)}`), text: found.getText(file) };
  }
  const declaration = file.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === contract.name);
  if (!declaration) throw new Error(`The contract ${contract.name} is missing.`);
  const inheritedDeclarations = (current: ts.InterfaceDeclaration, ancestors: readonly string[]): ts.InterfaceDeclaration[] => {
    if (ancestors.includes(current.name.text)) throw new Error(`Cyclic inheritance in the contract ${contract.name}.`);
    const parents = current.heritageClauses?.flatMap((clause) => clause.types.map((base) => {
      const parent = file.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === base.expression.getText(file));
      if (!parent) throw new Error(`The inherited contract ${base.expression.getText(file)} of ${current.name.text} is missing in ${contract.file}.`);
      return parent;
    })) ?? [];
    return [...parents.flatMap((parent) => inheritedDeclarations(parent, [...ancestors, current.name.text])), current];
  };
  const declarations = [...new Set(inheritedDeclarations(declaration, []))];
  return {
    keys: [...new Set(declarations.flatMap((entry) => entry.members.map((member) => `${contract.id}.${member.name!.getText(file)}`)))],
    text: declarations.map((entry) => entry.getText(file)).join("\n\n"),
  };
}

export async function buildHomepageExtensions(repoRoot: string): Promise<HomepageExtensionsResult> {
  const extensions = definitions();
  const loaded = await Promise.all(contracts.map(async (contract) => ({ contract, ...await readContract(repoRoot, contract) })));
  const actual = new Set(loaded.flatMap((contract) => contract.keys));
  const covered = new Set(extensions.flatMap((extension) => extension.covers));
  const missing = [...actual].filter((key) => !covered.has(key));
  const stale = [...covered].filter((key) => !actual.has(key));
  if (missing.length || stale.length) throw new Error(`The developer reference is incomplete. New: ${missing.join(", ") || "none"}; removed: ${stale.join(", ") || "none"}.`);
  for (const extension of extensions) {
    if (!extension.example || !extension.description) throw new Error(`The entry ${extension.id} has no example.`);
    if (extension.language === "json") JSON.parse(extension.example);
    if (extension.language === "typescript" || extension.language === "tsx") {
      const result = ts.transpileModule(extension.example, { fileName: `${extension.id}.${extension.language === "tsx" ? "tsx" : "ts"}`, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
      if (result.diagnostics?.length) throw new Error(`The example ${extension.id} is syntactically invalid.`);
    }
  }
  const groups = [...new Set(extensions.map((extension) => extension.category))];
  const html = `<header class="intro"><p class="eyebrow">For developers</p><h1>Extend RAgents</h1><p class="lead">RAgents can be extended with typed functions, interfaces, and programmed workflows. Snippets and actor programs use the same registered functions. A plugin bundles such extensions for the entire application. A single piece of work with its own journal is called a run; within a run, custom workflows and small user interfaces, the mini-apps, can be created.</p></header><p>The examples show where these extensions are integrated: server contributions execute functions, web contributions extend the application's interface. Programmed workflows and mini-apps belong to the respective run. The product and runtime contracts describe the integration into a custom application.</p>
<p>New to the project? The <a href="guide.html">guide</a> explains the runtime, model context, and execution forms. <a href="guide-plugins.html">Plugins, profiles, and skills</a> leads to the relevant extension points.</p><p class="note">The code blocks are excerpts, and each one names its intended location. Plugins are built with the host, while code for a single run is checked and tested before installation.</p><nav class="section-nav" aria-label="Extension points">${groups.map((group, index) => `<a href="#extensions-${index}">${escape(group)}</a>`).join("")}<a href="#access-rights">Built-in permissions</a><a href="#extension-contracts">Contracts</a></nav>
${groups.map((group, index) => `<section id="extensions-${index}"><h2>${escape(group)}</h2>${extensions.filter((extension) => extension.category === group).map((extension) => `<article id="extension-${extension.id}"><h3>${escape(extension.title)}</h3><p>${escape(extension.description)}</p><details><summary>Example (${extension.language})</summary><p class="example-context">${escape(extension.environment)}</p><pre><code class="language-${extension.language}">${escape(extension.example)}</code></pre></details>${extension.sources?.length ? `<p>${extension.sources.map((source) => `<a href="../../${escape(source.file)}">${escape(source.title)}</a>`).join(" / ")}</p>` : ""}${extension.notes.length ? `<ul>${extension.notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</section>`).join("\n")}
<section id="access-rights"><h2>Built-in permissions</h2><p>Permissions determine which data a user may read and which actions they may perform. The list shows the permission names built into RAgents and their meaning. Plugins can check additional permissions of their own.</p><table><thead><tr><th>Permission</th><th>Meaning</th></tr></thead><tbody>${permissions.map((permission) => `<tr><td><code>${escape(permission.id)}</code></td><td>${escape(permission.description)}</td></tr>`).join("")}</tbody></table><h3>Core methods</h3><p>The table maps the methods of the JSON-RPC API to the permissions they need. The host checks methods without fixed permissions per run; an additional rule of its own applies to the global coordinator, the AI contact across all runs.</p><table><thead><tr><th>Method</th><th>Permissions</th></tr></thead><tbody>${methodRights.map((method) => `<tr><td><code>${escape(method.id)}</code></td><td>${escape(method.rights.join(", ") || "per run")}</td></tr>`).join("")}</tbody></table></section>
<section id="extension-contracts"><h2>Current contract surfaces</h2><p>A contract defines the names, fields, and types that a plugin can provide or use. The following definitions come directly from the TypeScript interfaces and package descriptions in the code. They serve to look up the exact requirements for the examples above.</p>${loaded.map(({ contract, keys, text }) => `<details><summary>${escape(contract.name)} (${keys.length} fields)</summary><pre><code>${escape(text)}</code></pre></details>`).join("")}</section>`;
  return { html, extensions, permissions, methodRights, contracts: loaded.map(({ contract, text }) => ({ name: contract.name, file: contract.file, text })) };
}
