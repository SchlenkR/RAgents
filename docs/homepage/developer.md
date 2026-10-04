# RAgents: developer reference

> Extension points, examples, and current contract surfaces from the code.

[Tool contracts](reference.md) | [Run script packages and API](run-setup.md) | [JSON-RPC-API](rpc-api.md) | [LLM index](llms.txt)

The examples are excerpts for the place of use named in each case. Run-local scripts are native TypeScript modules with an explicit context; plugin server code and web modules are built with the application.

## Plugin and profile

### Create a plugin

A plugin bundles an additional RAgents capability, such as tools and the matching interface. It lives in its own folder with a server entry point and, if needed, a web half. At startup it tells the application which functions it provides.

Place of use: plugins/ragents.example/server/index.ts

```typescript
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
};
```

Dependencies are declared as requires on the exported PluginModule. The composer checks their order and copies them into the manifest.

The composer also sets web in the manifest: true if the plugin folder contains a web half web/index.tsx. The interface then requires the bundle to contain it.

A plugin imports host building blocks through the packages @ragents/host, @ragents/web, and @ragents/engine, and other plugins through @ragents/plugins/<id>. This lets the plugin folder live anywhere; the profile names it by identifier or path.

create receives the entire PluginHost. register, on the other hand, receives the PluginRegistration bound to this plugin. The two host parameters are different contracts.

client.config in the manifest and host.clientConfig carry public browser configuration. Secret values do not belong there.

The plugin folder alone activates nothing. The instance must include the plugin ID or the folder path in its profile configuration; required product and workspace services remain mandatory.

Contract fields: module.create, module.requires, plugin.manifest, plugin.register, manifest.id, manifest.requires, manifest.client, manifest.web.

### Compose a profile

A profile determines which plugins and settings a RAgents installation uses. It thereby assembles the available capabilities. The example adds a custom plugin to the core base set.

Place of use: ragents.config.example.ts; extends the locally configured neutral base.

```typescript
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
} as const satisfies RAgentsConfig;
```

The base configuration provides the existing mandatory plugins and model values. The entry point scripts/start.sh example selects the new file; required credentials are configured locally.

Without a valid profile selection, the server does not start. Plugins can register as long as the host is not yet sealed; duplicate identifiers and missing mandatory services are errors.

Contract fields: .

### Grant reading and prepared setups

A profile can determine who may sign in and which functions they may use. For this, its users export names the users and their permissions. The example gives one person read permissions and a second one the prepared word game including chat and mini-app.

Place of use: Next to the config export of a custom profile file with ragents.reference; the named password variables are set locally.

```typescript
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
] satisfies readonly ProfileUser[];
```

Without a users export there is no sign-in. An optional anonymousUser can still restrict access. An empty users list is a startup error. Passwords may be plain text or env references and are never published in the browser. A personal token (only as an env reference) counts as a bearer without expiry for clients without a sign-in dialog, such as pnpm connect and the model relay.

Permissions are exact strings. Only the single value * means all permissions; there are no partial patterns and no inheritance. A run belongs to the user who created it; operator access reaches only its own runs, runs.read.all shows those of all users. A run that a start option with ownerOnly reserves for its owner, for example through the binding to a workspace, can only be read in the journal and stopped with runs.read.all; only the owner sees its workspace (files, processes, language servers). A run without an owner, for example from a profile without sign-in, remains reserved for runs.read.all. runs.write allows chat and app actions in existing own runs. runs.create adds free runs and start options. Without this permission, startEntries limits the shared run scripts; runs.inspect protects technical views. These permissions do not replace a sandbox for native code.

The list of built-in permissions below is generated from builtinPermissions. Plugins choose their own names and check them on the server and in the interface.

Contract fields: profileUser.id, profileUser.label, profileUser.password, profileUser.token, profileUser.rights, profileUser.startEntries, environmentReference.kind, environmentReference.name.

### Offer a prepared setup without sign-in

Restricted access can also apply without sign-in. The anonymousUser export determines its permissions and shared setups. In this example, every visitor can start the prepared word game and use its mini-app.

Place of use: Next to the config export of a custom profile file with ragents.reference; this profile exports no users list.

```typescript
import type { ProfileAnonymousUser } from "@ragents/host/config-definition.js";

export const anonymousUser = {
  id: "visitor",
  label: "Guest",
  rights: ["runs.read", "runs.write"],
  startEntries: ["ragents.reference.word-game"],
} satisfies ProfileAnonymousUser;
```

users and anonymousUser exclude each other. Without both exports, the profile is unrestricted. anonymousUser contains no password; enabled stays false in the AccessSnapshot and user describes the restricted access.

canStartEntry requires runs.write and either runs.create or the explicitly shared entry in startEntries. Without runs.create, only registered run scripts are allowed. Free tasks and skills with preparation are blocked; existing runs remain accessible according to their normal read permissions.

runs.inspect and settings.read are missing here: model names, technical details, and settings are not offered. The server also checks the permissions for direct HTTP calls.

Contract fields: profileAnonymousUser.id, profileAnonymousUser.label, profileAnonymousUser.rights, profileAnonymousUser.startEntries, accessUser.startEntries.

## Server contributions

### A plugin route with its own permissions

An HTTP route makes a plugin function reachable for the browser or other clients. It can require different permissions for reading and changing. The server checks these permissions before it executes the function.

Place of use: Inside register(host); the payload processing here is deliberately only a small confirmed echo.

```typescript
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
});
```

requiredRights replaces the default requirement of the route. Without an explicit list, GET/HEAD/OPTIONS require runs.read, other methods runs.read and runs.write. Further domain checks still belong in the operation.

access contains the signed-in user without a password, and can checks the same permission contract as the interface. Hiding something in the UI alone does not protect an HTTP route.

Contract fields: httpRoute.requiredRights, httpContext.access, accessContext.can, accessContext.enabled, accessContext.user.

### An address with its own short-lived credential

Some requests cannot carry the sign-in, such as the images of an HTML document in a frame that has neither the sign-in cookie nor the access token. A route can then accept a short-lived credential in its own path: it names the access the credential stands for, and the server checks the run and the permissions against that access as usual.

Place of use: Inside register(host); grants is the plugin's own store of short-lived credentials that returns the access it issued each one for.

```typescript
const grantedPath = /^\/api\/plugins\/ragents\.example\/runs\/([A-Za-z0-9_-]+)\/grant\/([A-Za-z0-9_-]{43})\/(.+)$/;
host.http({
  id: "ragents.example.granted",
  isApiPath: (value) => grantedPath.test(value),
  matches: (request, url) => request.method === "GET" && grantedPath.test(url.pathname),
  accessFromAddress: (_request, url) => {
    const [, runId, grant] = grantedPath.exec(url.pathname) ?? [];
    return runId && grant ? grants.accessFor(runId, grant) : undefined;
  },
  handle: ({ response, access }) => {
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end(access.user?.label ?? "without sign-in");
  },
});
```

The server asks accessFromAddress before its sign-in: undefined leaves the request to the sign-in, a thrown DomainError answers it with its status. With an access, the server checks the run named in the path and requiredRights against it, as for a signed-in request.

Keep such a credential short-lived, bound to the access that asked for it, read-only, and limited to what the route serves; ragents.documents grants one root of a run for ten minutes. The long-lived access token never belongs in a path.

Contract fields: httpRoute.accessFromAddress.

### Plugin identity and file storage

Plugins can store data for the entire application or for a single run. The application provides each plugin with its own storage paths for this and assigns them to its identifier.

Place of use: Inside register(host); no files are created here yet.

```typescript
const pluginId = host.manifest.id;
const globalFile = host.storage.root("settings.json");
const runFile = host.storage.session(runId, "notes.json");
const directoryModes = host.storage.modes;
const sessionsRoot = host.storage.sessionsRoot;
```

runId comes from the respective host call, not from a hard-coded example value. Path segments are single names; no absolute paths, slashes, or parent directories.

Plugin files do not replace journaled domain state. Cleanup belongs in the plugin lifecycle.

Contract fields: host.manifest, host.storage, storage.sessionsRoot, storage.modes, storage.root, storage.session.

### Configuration and browser values

Plugins can have their own settings. A configuration description names their meaning and default values. Through clientConfig, the plugin publishes the values its interface needs in the browser.

Place of use: Inside register(host).

```typescript
host.config(
  { key: "EXAMPLE_LABEL", source: "environment" },
  { key: "EXAMPLE_API_KEY", source: "environment", secret: true },
);
host.clientConfig({ label: "Example", routePrefix: "/api/plugins/ragents.example" });
```

config reads no environment variable and creates no value. The implementation must check required values itself; the host helpers for declared configuration support this.

A secret descriptor does not make a value that is later published through clientConfig secret.

Contract fields: host.config, host.clientConfig.

### Share services between plugins

A service is a function or an object that several plugins can use together. One plugin provides the service under a typed name, others obtain it through this name. That way, the shared function stays implemented in one place.

Place of use: Shared contract plus registration; serviceToken comes from @ragents/engine.

```typescript
const formatterToken = serviceToken<(text: string) => string>("ragents.example.formatter");
host.provide(formatterToken, (text) => text.trim());
const format = host.service(formatterToken);
const optionalFormat = host.optionalService(formatterToken);
const result = format(" Example ");
```

The token belongs in a server-side shared service contract so that provider and consumer use the same contract. The provider must register before the consumer.

optionalService is only intended for a deliberately optional capability. A required integration uses service and fails if it is missing.

Contract fields: host.provide, host.service, host.optionalService.

### Provide HTTP routes

An HTTP route connects a URL path with a server function. Plugins can register such routes themselves and handle the matching requests. The central server takes care of integrating them.

Place of use: Inside register(host); example of a stateless GET route.

```typescript
const pathname = "/api/plugins/ragents.example/status";
host.http({
  id: "ragents.example.status",
  isApiPath: (value) => value === pathname,
  matches: (request, url) => request.method === "GET" && url.pathname === pathname,
  handle: ({ response }) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ready: true }));
  },
});
```

Run-related routes check the run through the existing host services. Write operations remain bound to their domain checks and the journal.

isApiPath and matches are different checks: recognizing an API also includes a path with an HTTP method that is currently not allowed.

Contract fields: host.http, httpRoute.id, httpRoute.isApiPath, httpRoute.matches, httpRoute.handle, httpContext.request, httpContext.response, httpContext.url.

### Take over a connection with an upgrade

A route can also take HTTP upgrade requests, such as a WebSocket. The server hands over the raw connection, and the route answers it or keeps it. Because no sign-in reaches such a connection, the route checks it itself, for example with a one-time secret in the address.

Place of use: Inside register(host); WebSocketServer comes from the ws package, which the plugin bundles, and secrets is the plugin's own set of one-time secrets.

```typescript
const pathname = "/api/plugins/ragents.example/live";
const sockets = new WebSocketServer({ noServer: true });
host.http({
  id: "ragents.example.live",
  isApiPath: (value) => value === pathname,
  matches: (_request, url) => url.pathname === pathname,
  requiredRights: [],
  handle: ({ response }) => { response.writeHead(426).end(); },
  upgrade: ({ request, socket, head, url }) => {
    if (!secrets.delete(url.searchParams.get("secret") ?? "")) {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(request, socket, head, (live) => live.send("ready"));
  },
});
```

Only a route with upgrade receives upgrade requests that its matches accepts; an upgrade nobody takes is answered with 404. Of the host's checks only the switch for external access applies: no sign-in, no access token, and no requiredRights.

head holds bytes that already arrived after the request headers; a WebSocket library takes them along. The process plugin's tunnel uses the same contribution for its WebSocket legs.

Contract fields: httpRoute.upgrade, httpUpgrade.request, httpUpgrade.socket, httpUpgrade.head, httpUpgrade.url.

### API methods and channels

A plugin adds its own methods and event channels to the JSON-RPC API. The contract describes identifier, description, permissions, input, and result; server and interface use the same contract.

Place of use: Contracts in the plugin's contract.ts, implementation inside register(host).

```typescript
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
host.channels(implementChannel(heartbeat, (_params, emit) => service.onBeat((at) => emit({ at }))));
```

Before execution, the dispatcher checks the permissions and the input, and afterwards the result against the contract. A DomainError carries code and status into the response.

The web half calls the same contract with rpc.call and subscribes to channels with rpc.subscribe; when opened, a channel returns its unsubscribe function.

context names access, signal, progress, the calling connection, and whether the request is local. The connected client executes an operation with implementedBy client; the server calls it through context.connection.call.

Contract fields: host.methods, host.channels.

### Startup, run end, and shutdown

A plugin can run its own functions at application startup, when a run is stopped or deleted, and at shutdown. This lets its background services and resources start and clean up at the right time.

Place of use: register(host); service is a previously created service with the methods shown here.

```typescript
host.lifecycle({
  id: "ragents.example.lifecycle",
  initialize: () => service.initialize(),
  prepareSession: ({ runId }) => service.prepare(runId),
  sessionStarted: ({ runId, startEntry }) => service.started(runId, startEntry),
  stopSession: ({ runId, signal }) => service.stop(runId, signal),
  afterStopSession: ({ runId, signal }) => service.stop(runId, signal),
  deleteSession: ({ runId }) => service.remove(runId),
  shutdown: () => service.shutdown(),
});
```

The return values may be void or Promise<void>. A stop handler respects its AbortSignal and waits for its work to end.

afterStopSession runs after execution has come to a standstill and also cleans up resources created late. The run stays locked during this time-limited follow-up; both stop phases must be repeatable.

Initialization and preparation follow the plugin order. Teardown respects the reverse order; stopping and deleting are different operations.

sessionStarted arrives when a start has provided the workspace and built the first actor, before an actor receives input. startEntry names the template with id and action (skill or script) or is null; after a host restart, the hook does not arrive again.

Contract fields: host.lifecycle, lifecycle.id, lifecycle.initialize, lifecycle.prepareSession, lifecycle.sessionStarted, lifecycle.stopSession, lifecycle.afterStopSession, lifecycle.deleteSession, lifecycle.shutdown.

### A typed run function

A plugin provides a function once with description, input, result, and implementation. An LLM uses it in a TypeScript snippet; a persistent actor calls the same function with the same API.

Place of use: register(host); Type from typebox, helpers from @ragents/engine.

```typescript
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
host.functions(trim);
```

description is the short description in the automatic function overview, label the readable name. longDescription optionally adds detailed notes and examples, which typescript_api returns on request together with the type contracts.

Snippets and actor programs call context.functions.example_trim({ text }); input and result types come from the same registration.

Every registered function is also a native model tool; snippets combine calls, filter results, and pass values onward. nativeTool: false keeps a function snippet-only, for low-level interfaces whose raw results belong in code, such as journal event queries and subscriptions.

host.functions also accepts contributions with functions and descriptors resolved at runtime. Static descriptors match the inventory; dynamic: true marks a variable function list with empty static descriptors.

availability limits the usage. executionMode: parallel is only intended for effects that are suitable for it. Model-facing input schemas have an object root.

Contract fields: host.functions.

### A domain operation as a capability

An operation is a server function that actor programs and views can use. It is offered to them as a named capability with defined inputs and outputs. Its operator rule determines whether a call is allowed directly, after confirmation, or not at all.

Place of use: Inside register(host); Type comes from typebox.

```typescript
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
});
```

direct allows the operator action immediately. confirm requires a confirmed question. unavailable blocks the capability for the operator path.

This does not automatically turn an operation into an agent tool. If both kinds of access are needed, they register the same domain function through separate contributions.

The runtime checks input and result again; the type assertion in the example does not replace this check.

Contract fields: host.operations.

### Call registered operations

Plugins can use an operation that is already registered, that is, a shared server function with defined inputs and outputs. They look up its contract and call it through the same check that applies to other callers.

Place of use: An asynchronous plugin function receives operationContext from the host call.

```typescript
const descriptor = host.operation("example_trim");
if (!descriptor) throw new Error("The text operation is missing.");
const result = await host.invokeOperation(
  descriptor.id,
  operationContext,
  { text: " Example " },
);
```

operationContext carries runId, invocationId, signal, and an agent or operator principal. The implementation must not take over a foreign identity from browser input.

The confirmation of an operator call must come from the intended confirmation path; a self-invented proof is no substitute.

Contract fields: host.operation, host.invokeOperation.

### Intervene in an agent's model calls

Every AI agent calls its model several times within a turn, and its tools run in between. An agent contribution hooks in between with two hooks: before every model call it can give the model a hidden note, after every tool call it can replace the tool's result. The plugin never sees the agent runtime behind it.

Place of use: register(host); the note does not appear in the chat.

```typescript
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
});
```

Both hooks run per agent; the first parameter names run, agent, audience, and working directory. call.kept and call.keep hold a JSON value in the agent's conversation history, even across a restart; the model never sees it.

afterToolCall receives ToolCallOutcome with toolName, isError, and optional toolCallId. A tool can keep image results by run and call ID; the hook takes and removes the result for outcome.toolCallId. This binds each image to its own result even when tools run in parallel. Without an ID, return no replacement rather than guessing by tool name.

A contribution registers no tools; tools come through host.functions. A returned note applies only to the next model call and does not end up in the journal.

Contract fields: host.agentRuntime, toolOutcome.toolName, toolOutcome.isError, toolOutcome.toolCallId.

### Models and roles

The model catalog names the AI models that can be selected for agents. A role combines a model with settings such as thinking depth and execution limits. Such roles describe individual agents; the profile assembles the entire installation.

Place of use: register(host); modelId is a previously checked, configured OpenRouter model identifier.

```typescript
host.profiles({
  id: "ragents.example.models",
  models: () => [{ driver: "agent", provider: "openrouter", model: modelId,
    label: "Configured model", thinking: ["off", "low", "high"] }],
  profiles: () => [{ name: "example-reviewer", description: "Reviews a task.",
    driver: "agent", provider: "openrouter", model: modelId, thinking: "low",
    turnTimeoutMs: null, isolateWorkspace: false }],
});
```

The thinking levels must be supported by the selected model. Catalog entries provide no new provider implementation; the current product integration uses OpenRouter.

The agent model is chosen from the offered catalog at spawn. Documentation should not pin down concrete model identifiers that change over time.

Contract fields: host.profiles.

### Prompt parts and skills

A prompt gives an agent instructions for its work. Plugins can contribute text parts that the application combines in a defined order. A skill is a more detailed set of working instructions that is provided for specific agents or tasks.

Place of use: Inside register(host); skillDirectory is the absolute path of the bundled skill folder.

```typescript
host.prompts({
  id: "ragents.example.prompt", order: 200,
  requiresTools: ["example_trim"],
  render: () => "Use example_trim for outer whitespace.",
});
host.skills({
  id: "ragents.example.skills", audiences: ["coordinator", "agent"],
  paths: () => [skillDirectory],
});
```

requiresTools binds a prompt part to the functions that are actually available. A skill is not an executable actor and not a plugin.

Alternatively, skills/<name>/SKILL.md is read from the plugin folder. start: true with title and category adds a template; prompt can specify its own start task, otherwise the body is used. Explicit contributions and automatically loaded folder assets must not duplicate each other unintentionally.

renderForRun(runId) replaces the text of a prompt part for one run, an empty text omits it there, undefined keeps it; this also applies to the product's selected system prompts and to chapters that only come on request.

Contract fields: host.prompts, host.skills.

### Contributions only in certain runs

A plugin can attach its prompts, functions, skills, and agent hooks to a condition per run, for example because they only apply to runs in a specific project. In all other runs they are missing as if the plugin did not exist there; services, methods, start options, and web contributions remain.

Place of use: Inside register(host); the plugin fills the set itself, for example from the journal.

```typescript
const domainRuns = new Set<string>();
host.runCondition((runId) => domainRuns.has(runId));
```

The condition is synchronous and runs on every prompt composition and every tool, skill, and hook resolution of a run. It reads a decision stored in the journal instead of determining it again.

If it throws, the run's turn fails with this cause; that way a run whose decision could not be determined stays blocked. At most one condition per plugin.

Contract fields: host.runCondition.

### Skills and run scripts as templates

The Start page offers templates for a new run. A skill combines an editable start task with working instructions and optional files. A run script provides a programmed setup. Plugins register both kinds through the same contract.

Place of use: Inside register(host); text-review is a registered skill.

```typescript
host.startEntries({
  id: "ragents.example.start", title: "Review text",
  description: "Starts with a review task.", order: 100,
  tags: ["Use case", "Text review"],
  action: "skill", skill: "text-review", category: "Collaboration",
  prompt: "Please check my text for contradictions.",
});
```

For skill templates, category is exactly one free, non-empty text and determines their group on the Start page. Independently of that, tags is an optional list of keywords for search, filters, and the reference. Only the tags are given comma-separated in SKILL.md and RUN.md frontmatter. The reference plugin provides demos and possible high-level test cases. Their description explains the demonstration purpose; Use case, Concept demo, and product concepts are in tags. The public generation checks at least two different examples per product concept. UI controls have no example quota and do not have to appear completely in the demos. Pure operating concepts use separate walkthroughs from the reference plugin's walkthroughs.ts. These create no templates and do not extend the StartEntry contract.

action: skill uses the registered skill name. action: script contains a RunScriptPackage. guide refers to a web guide with the same name.

fixedStartOptions sets start options for every run from the template, for example { "ragents.workspace.binding": { machine: "server", folder: "fresh" } }; in RUN.md the header line is called fixed-start-options. A different choice made beforehand is an error at start, and the Start page shows the option as fixed.

Use as task opens the preparation chat with the editable start task for every skill, even after a guide. Only Create run sends the task with the skill reference; for a script, the start value is passed to the prepared actor.

Contract fields: host.startEntries, start.id, start.title, start.description, start.order, start.guide, start.tags, start.fixedStartOptions.

### Share an actor package between run scripts

A program that several run scripts use belongs to the plugin, not to each script. The run then has one actor for it, whichever script comes first.

Place of use: Usually the folder actors/<name>/ next to run-scripts/; explicitly inside register(host) with the complete package files.

```typescript
host.actorPackages({
  name: "notebook",
  files: [
    { path: "package.json", content: JSON.stringify({ name: "notebook", private: true, type: "module", ragents: { title: "Notebook", backend: "src/server.ts" } }) },
    { path: "src/server.ts", content: "export { default } from \"./notebook.js\";\n" },
    { path: "src/notebook.ts", content: "..." },
  ],
});
```

A run script names the package in RUN.md with shared-programs: notebook; the host copies it into the run and keeps one with the same sources. Scripts call actor_program_ensure({ name: "notebook" }), which activates it only once.

Names are one namespace per run: startup refuses a name two plugins share, a name that equals a run script's handle or bundled program, and a script that needs a package no plugin provides.

The actor programs service answers programOf(runId, actorId) with the package's origin; a service authorizes by it, never by handle, and a package changed in the run counts as created there.

Contract fields: host.actorPackages.

### Check and freeze start values

Start options are values chosen before a new run, such as the model. The plugin defines allowed values, a default value, and the check of the selection. At start, the chosen value is stored for the run and fixed.

Place of use: Inside register(host); Type comes from typebox.

```typescript
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
});
```

The choice presentation works with the existing selection menu. A custom control can be registered on the web side under the same option ID; describe contains no validation rules.

A preset value must also be valid; a missing prerequisite is not silently replaced.

Besides runId, defaultValue, accept, and describe receive the acting user as userId, or null without sign-in. The optional ownerOnly(value) reserves operating a run with this value for its owner; reading and stopping remain open to everyone who sees it. The optional rights names permissions beyond runs.create, for example runs.inspect for an option with a technical presentation such as the model selection; without them the option is missing from the list, and choosing it fails with access-denied. With changeable, the option stays selectable after the start: every new choice ends up in the journal, and whoever reads the option follows the stored value; the model selection works this way and applies from the next turn.

Contract fields: host.startOptions.

### States for restricted access

Access without runs.inspect sees the plugin states of a run and their chat events the way the plugin they belong to determines. The plugin reports for each state what remains visible of it. Without a projection, a state stays unchanged.

Place of use: Inside register(host); ragents.example.board is a state of this plugin.

```typescript
host.accessProjections({
  id: "ragents.example.board",
  private: false,
  state: (entry) => ({ title: (entry.state as { title?: string }).title ?? null }),
  chatEvent: () => undefined,
});
```

state receives the state including updatedAt and returns the visible value or undefined; the host keeps identifier, scope, and timestamp. chatEvent receives type and payload of a chat event with this identifier and returns the visible part or undefined. Each identifier has at most one projection.

Only those who have these permissions see the stored value of a start option with rights, in the run view as well as in the chat; this applies before any projection.

private: true suppresses internal state and its chat events for every access, including runs.inspect; the value remains in the journal for restoration.

Contract fields: host.accessProjections.

### Provide run metadata

A plugin can provide short additional details about a run, such as a processing status. Such metadata is available to the interface for display, and a short line of it appears in the run list of every host. The underlying domain data stays with the plugin.

Place of use: Inside register(host); example without its own data storage.

```typescript
host.sessionMetadata({
  id: "ragents.example.metadata",
  describe: ({ runId }) => ({ run: runId, branch: "main" }),
  listDetail: (value) => ({ label: "Branch", text: (value as { branch: string }).branch, icon: "branch" }),
});
```

listDetail turns the value into the line below the run title in the run list of the browser and of VS Code; undefined shows none. The lines follow the registration order, and the icon is folder, branch, or none.

The run header shows the value through a sessionMetadata contribution in the web half.

Contract fields: host.sessionMetadata.

### Integrate the TypeScript runtime

The TypeScript runtime executes the programmed workflows of a run. The server integrates it through the script contribution. This provides the execution and the available programming functions.

Place of use: Wiring example; createRuntime satisfies ScriptContribution['create'].

```typescript
function registerRuntime(host: PluginRegistration, createRuntime: ScriptContribution["create"]) {
  host.script({ id: "ragents.example.script", create: createRuntime });
}
```

The host accepts at most one ScriptRuntime contribution. Actor inputs and actor functions share this platform.

Regular domain plugins do not need this slot; they add tools or operations with typed contracts.

Contract fields: host.script.

## Web contributions

### Hide a plugin view or show it read-only

A plugin view can take the same permissions into account as the matching server function. Without read permission it is hidden; without write permission the change button stays disabled. Both sides use the same permission names for this.

Place of use: React component of a plugin; useAccess comes from the web host and accessMode from the shared permission contract.

```tsx
function BoardAccess() {
  const access = useAccess();
  const mode = accessMode(access, "ragents.example.read", "ragents.example.write");
  if (mode === "hidden") return null;
  return <section>
    <p>Shared overview</p>
    <button disabled={mode === "readonly"}>Change entry</button>
  </section>;
}
```

useAccess returns enabled, user, can, and logout. With active sign-in and no session, AccessSnapshot contains user: null; without sign-in mode, enabled is false. The snapshot never contains a password or session token.

accessMode yields hidden, readonly, or write. hasRight and AccessContext.can treat the optional sign-in mode identically. The real send action must call the protected server route; the button here is only the state example.

Contract fields: accessUser.id, accessUser.label, accessUser.rights, accessSnapshot.enabled, accessSnapshot.user.

### Activate the web half

The web half of a plugin provides its interface contributions, such as tabs or settings. The webPlugin export describes how these contributions arise from the public configuration. It can also explicitly deactivate them for a certain configuration.

Place of use: plugins/ragents.example/web/index.tsx; WebPlugin is imported from the neutral web host contract.

```tsx
export const webPlugin = {
  id: "ragents.example",
  activate: (config) => {
    if (typeof config.label !== "string") throw new Error("The label is missing.");
    return { id: "ragents.example", enabled: () => true };
  },
} satisfies WebPlugin;
```

activate must not change the plugin ID. Deactivation removes all contributions of this web half from the active registry.

The plugin folder is built as its own chunk. Foreign web bundles are not installed later at runtime.

Contract fields: webIdentity.id, web.id, web.activate, web.enabled.

### Branding and chat display

A product contribution defines the name and appearance of the application. It also determines how the agents' intermediate steps are displayed in the chat, including thinking output and tool calls.

Place of use: Properties of a WebPlugin; exactly one active branding contribution.

```tsx
const productUi = {
  id: "ragents.example",
  brand: { title: "Example workshop", Logo: () => <span>E</span> },
  chatDisplayPolicy: {
    modes: { coordinator: "chips", agents: "compact" },
    stepsVisible: true, stepsExpandable: true, selectable: true,
  },
} satisfies WebPlugin;
```

Several branding contributions or several chat display policies are errors. A domain plugin next to an existing product normally provides neither.

Contract fields: web.brand, web.chatDisplayPolicy.

### Addresses in the Markdown of a run

Inside a run, chat answers and documents name files with relative paths. A plugin can map such an address to one the page can load, for example to its content route; the host applies the mapping to every Markdown display below the run.

Place of use: Properties of a WebPlugin; at most one active contribution.

```tsx
const urls = {
  id: "ragents.example",
  resolveRunUrl: (runId, url) => url.startsWith("@files/")
    ? `/api/plugins/ragents.example/runs/${encodeURIComponent(runId)}/raw/${url}`
    : url,
} satisfies WebPlugin;
```

Return every address the plugin does not resolve unchanged, and never rewrite an absolute one. Several active resolvers are an error.

A display that knows a better base, such as the Documents view for a file, sets its own resolver through quassel's QuasselProvider with resolveUrl; the inner one wins.

quassel resolves an address once, when its Markdown mounts; whatever the resolution needs, such as a grant, must be there before.

Contract fields: web.resolveRunUrl.

### Fixed and dynamic tabs

A plugin can add its own tab with an icon, content, and optionally a status badge. Fixed tabs are always part of its offering. Dynamic tabs arise to match the state of the open run.

Place of use: Properties of a WebPlugin; exampleTabs(session) is a custom, validating projection.

```tsx
const tabs = {
  id: "ragents.example",
  workspaceTabs: [{
    id: "ragents.example.overview", label: "Overview", order: 100,
    Icon: () => <span>E</span>,
    Panel: ({ active }) => <p>{active ? "Active tab" : "Inactive"}</p>,
    Badge: () => <span>1</span>,
  }],
  workspaceTabsFor: (session) => exampleTabs(session),
} satisfies WebPlugin;
```

available(session) filters availability, keepMounted keeps an inactive view. Polling is still controlled based on active.

Dynamic tab IDs must also be unique. In the run panel, the same tabs are in the toolbar on the right edge.

With placement: window, the browser lists the tab among the run's windows in the header instead of the toolbar, like a mini-app; VS Code keeps it in the toolbar.

Contract fields: web.workspaceTabs, web.workspaceTabsFor.

### The shared run panel

A plugin can provide the run panel shared by browser and VS Code. It receives chat rendering, navigation, card sections, and app contributions.

Place of use: Properties of a WebPlugin.

```tsx
const surfaceUi = {
  id: "ragents.example",
  surface: {
    RunPanel: ({ renderChat }) => <div>{renderChat()}<p>Custom surface</p></div>,
  },
} satisfies WebPlugin;
```

There is at most one surface contribution. The example replaces the central surface; it does not automatically extend the orchestration's existing surface. Without a surface contribution, the host shows the standard chat.

toolbarLeft is part of the renderChat contract for the owner of the surface. There is no general composer toolbar registry slot.

Contract fields: web.surface.

### Mini-apps in the shared panel

A plugin supplies app definitions and rendering to the shared catalog. The browser shows apps as tabs beside Chat; VS Code opens them in editor tabs.

Place of use: Properties of a WebPlugin.

```tsx
const elements = {
  id: "ragents.example",
  surfaceElements: [{
    id: "ragents.example.note", order: 100,
    select: () => [{ id: "example-note", title: "Note", visible: true }],
    Element: ({ definition }) => <p>{definition.title}</p>,
  }],
} satisfies WebPlugin;
```

Definitions require an id; title is optional. visible: false removes an entry from the catalog. The host determines its size. anchorActorId, entity, and custom data are optional. New apps do not steal focus. Visited browser views stay mounted while hidden; unavailable selections return to Chat.

Contract fields: web.surfaceElements, surfaceElement.id, surfaceElement.visible, surfaceElement.title, surfaceElement.anchorActorId, surfaceElement.entity, surfaceElement.data.

### Sections on actor cards

A plugin can add sections above the selected actor chat, for example for documents or a status.

Place of use: Properties of a WebPlugin; a neutral section without access to actor fields.

```tsx
const cards = {
  id: "ragents.example",
  cardSections: [{ id: "ragents.example.note", order: 100,
    Section: () => <p>Additional card content</p> }],
} satisfies WebPlugin;
```

actor is unknown at this boundary. Anyone using actor fields must check them with the contract of the responsible plugin. An empty contribution can render null.

Contract fields: web.cardSections.

### Run data and React context

Several interface contributions of a plugin can need shared data about the open run. A SessionProvider passes this data on through React context. With needsRunView, the plugin additionally requests the run state provided by the server.

Place of use: Properties of a WebPlugin; the provider can use its own Context.Provider here.

```tsx
const sessionUi = {
  id: "ragents.example",
  needsRunView: true,
  SessionProvider: ({ children, session }) => <section aria-label={session.session.title}>{children}</section>,
} satisfies WebPlugin;
```

session.runView is unknown and must be validated before domain access. A provider owns session and navigation and is only included for active plugins.

Contract fields: web.needsRunView, web.SessionProvider.

### Overview, global toolbar, and run bars

A plugin can show information for the entire application or for the run that is currently open. Contributions for the entire application appear in the overview or in the global header; contributions for the run follow the current selection. For this there are overviewPanels with a placement choice and sessionHeaders for run details in the shared title bar.

Place of use: Properties of a WebPlugin.

```tsx
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
  sessionHeaders: [
    { id: "ragents.example.run-header", order: 100,
      Header: ({ session }) => <span>{session.running ? "Working" : "Ready"}</span> },
    { id: "ragents.example.run-bar", order: 110, placement: "bar",
      Header: ({ session }) => session.connected ? <button>Overview</button> : null },
  ],
  sessionStatus: [{ id: "ragents.example.run-status", order: 100,
    Status: ({ session }) => <span>{session.connected ? "Connected" : "Disconnected"}</span> }],
} satisfies WebPlugin;
```

The context provides registry, open, onOpen, onClose, and onBusy. Without placement, the contribution appears in the overview and is mounted when first opened. Toolbar contributions are mounted from application startup; they activate their own connections only when used. The host coordinates open toolbar contributions. sessionHeaders appear in the run details popover, with the placement bar in the run's title bar next to Share; a bar contribution without content returns null. Run header and lower status groups receive SessionContext and navigation and follow the active run.

Contract fields: web.overviewPanels, web.sessionHeaders, web.sessionStatus.

### Editable plugin settings

A plugin can offer its own interface for editing its settings. With category, it appears under Models or Appearance, and additionally on the plugin's settings page. The application assigns it to the active plugin.

Place of use: Properties of a WebPlugin; ExampleSettings is the plugin's own React component.

```tsx
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
} satisfies WebPlugin;
```

category: models shows the contribution under Models, appearance under Appearance. Without category, it stays with its plugin. The form areas load independently of the technical contribution catalog.

readRight hides the contribution without the named permission; without it, settings.read applies. The component checks its write permission with useAccess, and the server route additionally with requiredRights.

The example keeps the value only locally. Settings receives no props; the plugin connects its component itself to configuration, shared state, and its own server routes. Identifiers are globally unique; order is optional and 0 by default. Without an active plugin, no settings area is included.

Contract fields: web.settings, settings.id, settings.label, settings.category, settings.readRight, settings.order, settings.Settings.

### Operate start options and guides

Before a new run, start options can be chosen directly or collected in a setup dialog. The plugin provides the interface for this and connects its values to the respective server contract. A guide is such a dialog for a prepared workflow.

Place of use: Properties of a WebPlugin; the option is additionally registered on the server side.

```tsx
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
} satisfies WebPlugin;
```

placement puts the option in the input bar (composer) or below the input (page, default). The host shows it only at the chosen place; model and thinking level use composer and are therefore also in the chat input of every run.

The object in the example is a script start value. A skill guide instead returns the text of the first message. The StartEntry refers to this identifier with guide.

The reference plugin provides two complete guides: ConversationGuide collects topic and number of rounds for a conversation circle; SharedBoardGuide collects title and first entry for a shared collection board. Both begin with the run only after completion. The scripts check the input before the setup.

[Both React guides](../../plugins/ragents.reference/web/StartGuides.tsx)

[Registration of the guides](../../plugins/ragents.reference/web/index.tsx)

[Setup of the conversation circle](../../plugins/ragents.reference/run-scripts/conversation-circle/src/server.ts)

[Setup of the collection board](../../plugins/ragents.reference/run-scripts/shared-actor-list/src/server.ts)

Contract fields: web.startOptions, web.guides.

### Display tools and entities

Plugins can determine how their tool calls are displayed in the chat and where references to their data lead. A tool presenter provides the display of the call. An entity presenter translates the data reference into a navigation target.

Place of use: Properties of a WebPlugin; example.overview is a tab registered by the plugin.

```tsx
const presenters = {
  id: "ragents.example",
  toolPresenters: [{ toolName: "example_trim",
    Inline: () => <span>Text review</span>,
    reveal: () => ({ tabId: "ragents.example.overview" }) }],
  entityPresenters: [{ reveal: (entity) => entity.type === "example-note"
    ? { tabId: "ragents.example.overview", selection: entity.id } : undefined }],
} satisfies WebPlugin;
```

navigation.openTab opens a registered tab; revealEntity uses the presenters. selection is a separate checked contract between caller and target panel.

Contract fields: web.toolPresenters, web.entityPresenters.

### Metadata in the run header

Additional details about a run appear in the details of its header. The plugin receives the run's data, including the values of its server-side metadata contribution, and shows them as it likes.

Place of use: Properties of a WebPlugin.

```tsx
const branchOf = (value: unknown) => (value as { branch?: string } | undefined)?.branch ?? "";
const metadata = {
  id: "ragents.example",
  sessionMetadata: [{ id: "ragents.example.metadata", order: 100,
    Metadata: ({ session }) => <span>{branchOf(session.metadata?.["ragents.example.metadata"])}</span> }],
} satisfies WebPlugin;
```

Domain values are provided through the server-side sessionMetadata contribution. The run list does not use this component; its line comes from listDetail on the server, so it looks the same in the browser and in VS Code.

Contract fields: web.sessionMetadata.

### Attention and waiting actions

A plugin can mark that a run needs attention. If an action of the plugin is waiting for input, its own actionViews contribution displays it and answers it through its contract; the core does not know its form. Marking and display are separate contributions.

Place of use: Properties of a WebPlugin; answerQuestion is the plugin's own checked HTTP client.

```tsx
const interaction = {
  id: "ragents.example",
  attention: [{ id: "ragents.example.attention",
    assess: (session) => session.running ? { active: true, label: "Working" } : undefined }],
  actionViews: [{ owner: "ragents.example",
    View: ({ action, session }) => <button onClick={() =>
      void answerQuestion(session.session.id, action.actionId, "ok")}>{String(action.payload)}</button> }],
} satisfies WebPlugin;
```

There is exactly one display per owner. Without a display, the chat shows the action generically with a title, waiting for input, and discard. Attention itself creates no action or background work.

Contract fields: web.attention, web.actionViews.

## Actor programs

### Run a small TypeScript snippet

One-off calculations, queries, and setup steps need no actor of their own. The model discovers the current API and combines its functions directly in TypeScript.

Place of use: code for typescript_eval, or the same source text in a file for path.

```typescript
const actors = await context.functions.actor_list({});
return actors;
```

The source text is the body of an asynchronous function with context. await and return are allowed directly; modules are loaded with await import(...). The type check runs before execution.

context.log collects output, return delivers a JSON result; without return it is null. Local variables and context.state apply only to this execution.

Registered functions and their input and result types are the same in snippets and actor programs. A snippet acts as the caller. Function calls that have already completed stay in effect after a later error.

For later messages, events, persistent state, or views, an actor program is available. The domain task does not have to prescribe this technical choice.

Contract fields: .

### A TypeScript actor with state

A TypeScript actor processes delivered messages in code. Functions and optional views use the same stored state. The return value of a function is a result; state changes are made explicitly.

Place of use: src/server.ts of a regular actor package.

```typescript
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
});
```

defineActor derives state and function signatures from TypeBox. Relative imports and Node libraries are regularly available.

An LLM actor can own functions and views; its regular input stays with the model driver. A program with onInput is rejected on it.

Contract fields: run.state, run.log, run.throwIfAborted, run.signal.

### Run functions and execution identity

A run function is available with an identical contract for snippets and actor programs. Each checked program version, the build, names its complete list of these functions including input and output types. The execution identity determines on whose behalf the program acts and which permissions apply.

Place of use: Excerpt in an asynchronous actor handler; actor_input must be declared and allowed in the build.

```typescript
context.log({ run: context.run.id, actor: context.actor.handle, invocation: context.invocation.id,
  kind: context.invocation.kind, principal: context.principal.kind });
await context.functions.actor_input({
  to: "@reviewer", message: "Review the new result.",
});
```

Snippets act as the caller, onInput as the receiving actor. A called actor function owns its state, but executes run calls as its caller. A subscription applies to the acting identity.

@reviewer must already exist in the run. Runtime and test resolve the reference; the guide requires no copied actor IDs.

Call names use underscores, such as actor_input. Dotted names such as actor.input are grants. Additional permissions of the actor do not automatically extend an installed build.

invocation.kind knows input, snippet, tool, and app-action. event and schedule are already declared as type values, but currently have no trigger of their own.

Contract fields: run.run, run.actor, run.std, run.invocation, run.principal, run.functions.

### Subscribe to events and pass messages on

Events report what happened in a run, for example that an agent has completed a contribution. A subscription delivers matching new events to a participant as a message. A programmed mediator can then pass the result on or trigger the next work step.

Place of use: Excerpt in an actor handler; the listed capability calls must be allowed.

```typescript
await context.functions.event_subscribe({
  sourceActorIds: ["@reviewer"],
  eventTypes: ["model.output.completed"],
});
```

For a subscription, an actor handler receives the source event through input.event, otherwise null. input.content, artifactIds, sourceEventIds, and subscriptionId describe the delivery.

The subscriber needs a new turn; a subscription does not secretly change a running turn. Per actor, inputs are processed in journal order.

event_unsubscribe removes the subscription. Events that are already stored are not delivered again after a server restart.

context.std.mediators.route returns an input function for fixed forwarding rules and stores its state explicitly. context.std.now and context.std.id refer to the current actor turn.

Contract fields: .

### A run script as a prepared setup

A run script is a complete actor program for starting a run. The host activates it with the same compiler and the same domain tests as a program written during the run.

Place of use: RUN.md; next to it are package.json, src/server.ts, and tests/*.test.ts.

```markdown
---
title: Prepare example
description: Counts the first start task.
order: 100
coordinator: true
---

The setup uses the actor program from this chapter.
```

The package folder determines the handle. package.json.ragents.backend names the entry point with defineActor and onInput. The capabilities appear only in the TypeScript contract.

Further prepared programs live under actors/<name>/. The host copies them into @actors; the setup activates them with actor_program_activate and an optional actor handle.

coordinator: false omits the usual coordinator. The setup must then designate another actor as the primary chat partner.

embeddable: true also lets the script start inside a running run without changing its primary actor; every start opens a room of its own with its own setup actor. onStart receives each start with embedded, startedBy, count, and room.

Contract fields: runScript.handle, runScript.coordinator, runScript.embeddable, runScript.sharedPrograms, runScript.files, runScript.programs.

### End a start with a result

A run script can be started again and inside a running run. It receives each start in onStart and ends it with a result that the host delivers once to whoever started it.

Place of use: src/server.ts of a run script whose RUN.md sets embeddable: true.

```typescript
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
    context.finish({ checked, embedded: start.embedded }, { summary: `Checked ${checked} times.` });
  },
  onResult: (result, context) => {
    context.log({ from: result.handle, start: result.count, summary: result.summary });
  },
});
```

start carries input, options, embedded, startedBy, count, the number of this start of the package in the run, and room, the room this start opened. Without onStart, the start arrives in onInput as the JSON { input, options }.

context.finish works in onStart, onInput, and onResult; outside onStart it names the start with { start: count }. A second finish of the same start fails the turn.

The owner reads the summary in the chat, an LLM gets summary and result as a message, a TypeScript actor that started the script gets them in onResult.

An embedded start adds its visible views to the app catalog without changing the selected view.

shared-programs: notebook in RUN.md copies the plugin's shared package actors/notebook/ into the run; actor_program_ensure({ name: "notebook" }) makes it active once, whichever script comes first.

Contract fields: run.finish.

### Check input processing in a domain test

Regular TypeScript tests check the input handler and its explicit state changes. The host runs the same tests before activation.

Place of use: tests/program.test.ts for the previous counter program.

```typescript
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
});
```

actor_program_activate checks, builds, tests, and activates the program. There is no second check/test/install contract and no test evidence as a model argument.

A pure view package needs neither an input handler nor an invented server function.

Contract fields: .

### A program with optional views

A private TypeScript package can provide functions, input processing, and several React views. It binds to an existing actor or, for a new backend, creates a TypeScript actor.

Place of use: package.json; for each view, the host provides the HTML root element root.

```json
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
}
```

At least a backend or a view must be present. Without a backend, a new view binds to the calling actor; a dummy installation is not needed.

actor_program_create creates the package with fixed local dependencies and returns its directory: @actors/<name>/, in a room @actors/<room>.<name>/. File tools and language servers use this directory, Bash uses it as cwd.

Changed project errors appear as short deltas before model requests. actor_program_diagnostics returns the complete state, actor_program_activate checks and activates.

Contract fields: appPackage.title, appPackage.description, appPackage.backend, appPackage.views.

### A contract for actor state and functions

The TypeBox contract describes an actor's data and the inputs and outputs of its functions. A function can be called in the view and can additionally be offered in the shared TypeScript API with the same implementation. The SDK types are generated from it automatically.

Place of use: src/contract.ts; shared contract for the following backend function.

```typescript
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
} as const;
```

The state schema accepts {} as the initial value. input and output determine the types of the matching handler; capabilities names the run capabilities it needs.

Without targets, the function is available to active executable actors. self means the owner of the program, @handle a specific target. card: true generates the form from the same input contract. An optional confirmation requires a confirmation before the action.

After activation, the function is already available in context.functions in the running model turn. typescript_api returns its current contract. Activating again updates the schema; removing withdraws the function.

One actor program is active per actor; further functions and views are added to it. A pure view needs no backend contract. Optional input in the contract requires onInput in the implementation and is only available for TypeScript actors.

Contract fields: appContract.state, appContract.functions, appContract.input, appAction.label, appAction.description, appAction.input, appAction.output, appAction.capabilities, appAction.confirmation, appAction.tool.

### A function for view and tool

The function processes a typed input and changes the state of its actor. Calls from that actor's React view and through the TypeScript API use exactly this implementation, without an additional model turn.

Place of use: src/server.ts; package.json.ragents.backend names this entry point.

```typescript
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
});
```

A return value is always the domain result. Only context.state.replace records new actor state.

context.actor names the owner of the function. Run functions use the caller's identity and the declared capabilities. onInput acts as its actor.

Contract fields: .

### Domain tests as TypeScript files

The backend function is checked with regular tests and explicit dependencies. Activation runs the existing test files; failures prevent the new version from being taken over.

Place of use: tests/program.test.ts; runs with node --import tsx --test.

```typescript
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
});
```

createTestContext provides state, abort signal, and explicitly specified typed functions under functions. The mocks are TypeScript functions in the test and not a tool argument of the model.

A domain test checks the shared function. A real browser check must additionally prove the visible operation.

Contract fields: .

### Views as app tabs

An activated visible view enters the shared app catalog and belongs to its actor. Several views can show the same actor state.

Place of use: An entry in package.json.ragents.views.

```json
{ "id": "main", "title": "List", "client": "src/client.tsx" }
```

actor_view_set_visibility uses package name/view name or a unique title. The view identifier is unique within the package. A view has no host size of its own; the browser content area or VS Code editor determines it.

actor_view_set_visibility makes a view visible or invisible. Functions and actor state are preserved.

Views have no dialog or window control API.

Contract fields: .

### React view with actor state

The view reads the intrinsic state of its actor. New successful changes appear even while the chat is idle; local React input is preserved.

Place of use: src/client.tsx for the shared list.

```tsx
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
createRoot(document.getElementById("root")!).render(<App />);
```

context.actor describes the owner of the view. ready confirms the bridge, run and principal the bound run and the operator identity.

useAppState reads actor state reactively. Alternatively, state.read and subscribe provide a snapshot and change notifications.

context.capabilities.call calls a declared actor function. Local drafts belong in React state; a function call starts no model turn.

Contract fields: app.ready, app.run, app.actor, app.principal, app.state, app.chat, app.capabilities, appState.read, appState.subscribe, appCapabilities.list, appCapabilities.call.

### Chats and reusable UI

A mini-app can show and operate its actor's conversation or display its own controlled history. Message view, input, and further UI building blocks are also available individually.

Place of use: src/client.tsx; alternative for an actor of this run that already exists.

```tsx
import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";
import { context } from "@ragents/client";

function App() {
  return <UI.Chat actor={"@" + context.actor.handle} title="Review" />;
}
createRoot(document.getElementById("root")!).render(<App />);
```

actor and messages/onSend are different chat variants. primary binds the primary actor; @handle a named actor of the run.

The imported context offers context.chat.read(actor), subscribe(actor, listener), and send(actor, text, attachments?). A subscription is unsubscribed at teardown.

UI.MessageList shows controlled messages with named senders. The app provides order and content; the building block creates no answers.

The building block reference shows current props and local demos of the components.

Contract fields: chat.read, chat.subscribe, chat.send.

## Product and runtime contracts

### Provide a product policy

The coordinator is the central AI contact of a run and can distribute tasks to further agents. The product policy defines its start, the roles of the participants, and their instructions. A custom application provides these rules as a service.

Place of use: register(host); policy satisfies ProductRuntimePolicy, productRuntimeToken comes from the neutral server host.

```typescript
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
host.provide(productRuntimeToken, policy);
```

coordinator describes handle, display name, profile, run title, and owner. roleFor determines primary or worker, contract returns the role prompt, promptComposition the composition, and systemPrompts the catalog.

A new domain plugin does not register a second product service next to an existing product. The configuration must provide a complete model catalog for the profile in use.

Contract fields: product.coordinator, product.roleFor, product.contract, product.promptComposition, product.systemPrompts.

### Resolve workspaces

A workspace determines in which directories the agents of a run work with files and processes. The WorkspaceRuntime service resolves this area and describes it. An optional WorkspaceResolver can adjust the assignment without replacing the entire service.

Place of use: register(host); workspaceResolverToken comes from the neutral server host.

```typescript
host.provide(workspaceResolverToken, {
  resolve: async ({ directory }) => ({ cwd: directory }),
});
```

resolve of the complete WorkspaceRuntime returns a SessionWorkspace with cwd, currentRoot, and runOperation; optionally gitEnv, gitConfig, and extraEnv are added. describe returns mode and directory pattern; placementOf states separately whether a run works on the server or on a workstation, the latter with its ID and current label, and whether in a new or existing folder, plus the kind of a contributed folder, and toolNaming can name the existing file tools.

A resolver receives runId, directory, choice, and emitSystem. optionId connects the selection with a registered start option. kind describes identifier, label, server folder, and display pattern of the contributed workspace on the server. workstation provides the new folder on a workstation: label and steps from operations of the executor there, which run after creation (prepare) and before removal (release); without workstation, a resolver offers no new folder there. The resolver shown keeps the run directory prepared by the host.

stopSession and deleteSession optionally add the lifecycle boundaries of the contributed workspace. On stop, the resolver also receives the teardown of the host sandbox; deletion follows only afterwards.

transfer handles moving a run to another server: boundDirectory names an existing folder on this machine that the run is bound to, assertDirectory checks a replacement folder, rebind binds the run there.

File and process work happens through the existing workspace boundary. A plugin does not change the server's global working directory on its own.

Contract fields: workspace.resolve, workspace.describe, workspace.placementOf, workspace.toolNaming, workspace.transfer, resolver.optionId, resolver.kind, resolver.workstation, resolver.resolve, resolver.stopSession, resolver.deleteSession.

### Document storage and Git views

The document storage assigns each run a directory for its files. An additional Git view can provide the branch, changes, and file contents of a workspace. Plugins provide these services so that other contributions can use the same data.

Place of use: register(host); store and gitView satisfy DocumentStore and GitWorkspaceView respectively.

```typescript
host.provide(documentStoreToken, store);
host.provide(gitWorkspaceViewToken, gitView);
```

DocumentStore resolves the document directory with directoryFor(runId) and describes its directory pattern.

GitWorkspaceView returns branch(runId), changes(runId), and file(runId, filePath, view), where view is diff or current. The interface receives a checked projection, not a free Git process.

Contract fields: documents.directoryFor, documents.describe, gitView.branch, gitView.changes, gitView.file.

### Replace the model runtime

An AgentDriver connects the model runtime with RAgents. It processes a delivered message in one step, the turn, connecting model, tools, cancellation, and emitted events. The scheduler, the workflow control of RAgents, assigns these steps to it.

Place of use: A simple test driver without a model call; AgentDriver comes from @ragents/engine.

```typescript
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
};
```

kind determines the driver kind. supportsPlainLlm declares operation without RAgents tools. disposeAgent, reviveAgent, haltRun, waitForRunSettlement, disposeRun, and shutdown are optional for the matching lifecycle boundaries.

request provides, among other things, the delivered input, prompt, model selection, tool list, invoke, and recordContext; a model step in the model context is also the visible answer. The return value contains failure and usage.

The fixed engine kinds are agent, script and external. Plugins register named external runtimes through host.actorRuntimes; profiles alone do not add a driver kind.

Contract fields: driver.kind, driver.supportsPlainLlm, driver.runTurn, driver.disposeAgent, driver.reviveAgent, driver.haltRun, driver.waitForRunSettlement, driver.disposeRun, driver.shutdown.

### Provide an external actor runtime

A plugin provides a named runtime for actors whose conversation and tools belong to another agent process. The engine schedules its turns and records its visible output.

Place of use: server/index.ts of a plugin; the protocol belongs to its driver.

```typescript
const driver: AgentDriver<"external"> = {
  kind: "external",
  async runTurn(request, signal) {
    signal.throwIfAborted();
    request.publish({ kind: "text", delta: "Completed." });
    request.emit({ kind: "assistant-completed", text: "Completed." });
    return { failure: null, usage: emptyUsage() };
  },
};
export const plugin: PluginModule = {
  create: () => ({
    manifest: { id: "acme.runtime" },
    register(host) {
      host.actorRuntimes({ id: "acme.coder", title: "Example coder", driver });
    },
  }),
};
```

Runtime ids are unique across the profile. agent_spawn selects runtime and tools: null; the external runtime owns its coding tools.

request.runtime names the selected runtime; request.instructions carries delegated working rules. Text and reasoning emit observation events without creating a model step. Inputs arriving during a turn wait for the next one.

Contract fields: host.actorRuntimes.

### Connect a language server

A language server analyzes source code and provides language features such as error messages and symbol search. An adapter describes how RAgents recognizes the matching project and starts the server. The plugin brings it as a contribution to the executor, which runs on every machine that holds a workspace; the existing integration makes its functions available as tools and server access.

Place of use: executor.ts and server/index.ts of a simple TypeScript LSP, here in one file. The contribution imports only types from the host.

```typescript
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
};
```

languages maps file extensions to language identifiers. resolveRoot checks the project target, rootDirectory names the folder that a file of this target is assigned to (the project directory itself for TypeScript, the folder of the project file for Roslyn and FSAC), launch returns the process start contract for the sandbox context, and open adds server-specific opening steps if needed.

solutionExtensions is optional and names the extensions of the solutions, such as .sln and .slnx; with it, the plugin gets the tool <id>_solutions, the solution list, and switching in the tab. A directory adapter like this one omits it.

executor is a function of the machine and returns languageServers and modules; modules are further modules with their own operations, such as the browser of ragents.browser. The machine provides the plugin's tool folder (toolsDirectory), files from the host's packages (hostPackageFile), the checked root resolution (resolveRootFile, resolveRootDirectory), domain errors (operationError), and the environment of its own processes (processEnvironment).

The build tool turns executor.ts into a self-contained file executor/index.mjs; importing a host module or another plugin there is a build error. Server and workstations load the same file, a workstation from the bundles of its own host. The server half imports the description relatively from executor.ts.

The required server programs come through the plugin's provisioning or from the host's packages. A missing program is reported as an error; no substitute process is started silently.

Required imports: path from node:path, pathToFileURL from node:url, the types LanguageServerDescription and WorkspaceExecutorContribution from @ragents/workspace-executor, and in the server half createLanguageServerPlugin as well as PluginModule. The host handles the LSP initialization; open afterwards adds only server-specific steps.

Contract fields: lsp.id, lsp.label, lsp.languages, lsp.rootDescription, lsp.solutionExtensions, lsp.resolveRoot, lsp.rootDirectory, lsp.launch, lsp.open, executorParts.languageServers, executorParts.modules, executorMachine.toolsDirectory, executorMachine.hostPackageFile, executorMachine.resolveRootFile, executorMachine.resolveRootDirectory, executorMachine.resolveRootPath, executorMachine.operationError, executorMachine.processEnvironment.

### Run a managed service

An executor contribution can keep a child process for a run, such as a stdio protocol server. The machine supplies the managed process helper; the contribution applies the run's sandbox and owns cleanup.

Place of use: executor.ts; WorkspaceExecutorContribution is a type-only import from @ragents/workspace-executor.

```typescript
export const executor: WorkspaceExecutorContribution = (machine) => ({
  modules: [(host) => {
    const processes = new Map<string, Promise<ReturnType<typeof machine.startManagedService>>>();
    const start = async (runId: string) => {
      const context = await host.contextFor(runId);
      const launch = { command: "example-server", args: ["--stdio"] };
      const wrapped = context.sandbox ? await context.sandbox.wrap(launch) : launch;
      return machine.startManagedService({
        ...wrapped,
        args: [...wrapped.args],
        cwd: context.cwd,
        env: { ...machine.processEnvironment(runId), ...context.env },
        uid: context.uid,
        gid: context.gid,
        label: "Example server",
        stdin: "pipe",
      });
    };
    const stopRun = async (runId: string) => {
      const pending = processes.get(runId);
      if (!pending) return;
      processes.delete(runId);
      const child = await pending;
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 1000);
      try { await child.finished; } finally { clearTimeout(timer); }
    };
    return {
      operations: {
        "example.start": async ({ runId }) => {
          const pending = processes.get(runId) ?? start(runId);
          processes.set(runId, pending);
          await pending;
          return "Process started.";
        },
      },
      stopRun,
      shutdown: async () => { await Promise.all([...processes.keys()].map(stopRun)); },
    };
  }],
});
```

startManagedService accepts ManagedServiceOptions with stdin and output callbacks, and returns ManagedService with kill and finished. Add protocol framing through onStdout and bounded diagnostics through onStderr; successful spawn alone does not prove protocol readiness.

The contribution first wraps command and args through context.sandbox.wrap when a sandbox exists. machine.processEnvironment(runId) supplies this machine's safe environment and the run marker; context.env adds the run's environment. The helper does not apply the sandbox itself.

The module shares startup per run, ends its own process through kill, and awaits finished in stopRun and shutdown. Managed cleanup also ends the process group. Do not import the host's process implementation into a self-contained executor bundle.

Contract fields: executorMachine.startManagedService.

## Built-in permissions

The list comes from the permission contracts of the host and the coordinator plugin; plugins can use additional exact names.

- runs.read: View runs, chats, journals and workspaces.

- runs.read.all: See and operate the runs of all users, not only your own; a run that only its owner operates can only be read in the journal and stopped, without its workspace.

- runs.write: Control existing runs, send messages, start released setups and execute app actions.

- runs.create: Create free runs, choose start options and prepare tasks.

- runs.inspect: View models, technical run details, journals and program sources.

- runs.trace: See thinking and tool steps in the chat with their content and choose their level of detail.

- runs.delete: Delete runs and their stored data.

- settings.read: View profile, configuration and plugins.

- settings.write: Change settings and external access.

- models.use: Call models through the model relay of this server.

- profile.fetch: Describe and download the client profile of this server.

- ragents.overseer.read: View the global coordinator and its model selection.

- ragents.overseer.write: Give tasks to the global coordinator and reset its conversation.



### Core methods



Generated automatically from the registered contracts; the host checks methods without fixed permissions per run. The global coordinator adds its own rule.



| Method | Permissions |

| --- | --- |

| ragents.chat.actorHistory | per run |

| ragents.chat.capabilities | per run |

| ragents.chat.send | per run |

| ragents.chat.sendToActor | per run |

| ragents.chat.start | per run |

| ragents.chat.stop | per run |

| ragents.external.set | settings.write |

| ragents.plugins.bootstrap | per run |

| ragents.runs.delete | runs.read, runs.delete |

| ragents.runs.enqueueInput | per run |

| ragents.runs.events | per run |

| ragents.runs.export | runs.read, runs.inspect |

| ragents.runs.import | runs.read, runs.write, runs.create |

| ragents.runs.interruptTurn | per run |

| ragents.runs.list | runs.read |

| ragents.runs.markViewed | runs.read |

| ragents.runs.pause | per run |

| ragents.runs.prepare | runs.read, runs.write, runs.create |

| ragents.runs.resolveAction | per run |

| ragents.runs.restartActor | per run |

| ragents.runs.resume | per run |

| ragents.runs.scripts | per run |

| ragents.runs.share | per run |

| ragents.runs.sharing | per run |

| ragents.runs.startScript | per run |

| ragents.runs.stopActor | per run |

| ragents.runs.stopAll | per run |

| ragents.runs.view | per run |

| ragents.settings.read | settings.read |

| ragents.settings.skill | settings.read |

| ragents.settings.titles.read | settings.read |

| ragents.settings.titles.save | settings.write |

| ragents.startOptions.list | runs.read, runs.create |

| ragents.startOptions.select | runs.read, runs.write, runs.create |

## Current contract surfaces

### SettingsContribution

Source in the repository: apps/web/src/PluginRegistry.tsx

```typescript
export interface SettingsContribution {
  category?: "models" | "appearance";
  readRight?: string;
  id: string;
  label: string;
  order?: number;
  Settings: ComponentType;
}
```

### ProfileUser

Source in the repository: apps/server/src/config-definition.ts

```typescript
export interface ProfileAnonymousUser {
  readonly id: string;
  readonly label?: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}

export interface ProfileUser extends ProfileAnonymousUser {
  readonly password: string | EnvironmentReference;
  /** Permanent bearer token for clients without a sign-in dialog; only as env(...), never in plain text. */
  readonly token?: EnvironmentReference;
}
```

### ProfileAnonymousUser

Source in the repository: apps/server/src/config-definition.ts

```typescript
export interface ProfileAnonymousUser {
  readonly id: string;
  readonly label?: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}
```

### EnvironmentReference

Source in the repository: apps/server/src/config-definition.ts

```typescript
export interface EnvironmentReference {
  readonly kind: "environment";
  readonly name: string;
}
```

### AccessUser

Source in the repository: packages/ragents/src/access.ts

```typescript
export interface AccessUser {
  readonly id: string;
  readonly label: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}
```

### AccessSnapshot

Source in the repository: packages/ragents/src/access.ts

```typescript
export interface AccessSnapshot {
  readonly enabled: boolean;
  readonly user: AccessUser | null;
}
```

### AccessContext

Source in the repository: packages/ragents/src/access.ts

```typescript
export interface AccessSnapshot {
  readonly enabled: boolean;
  readonly user: AccessUser | null;
}

export interface AccessContext extends AccessSnapshot {
  can(right: string): boolean;
}
```

### HttpRouteContribution

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface HttpRouteContribution {
  id: string;
  isApiPath: (pathname: string) => boolean;
  matches: (request: IncomingMessage, url: URL) => boolean;
  /** Overrides the default runs.read/runs.write check before the handler executes. */
  requiredRights?: readonly string[] | ((request: IncomingMessage, url: URL) => readonly string[]);
  /** For an address that carries its own credential, such as a short-lived grant in the path: the access it stands for in place of the sign-in, undefined for every other address; an invalid credential throws its error. */
  accessFromAddress?: (request: IncomingMessage, url: URL) => AccessContext | undefined;
  handle: (context: HttpRouteContext) => void | Promise<void>;
  /** Takes the upgrade requests the route matches, such as a WebSocket; it authenticates them itself, the host checks no rights and no sign-in. */
  upgrade?: (context: HttpUpgradeContext) => void | Promise<void>;
}
```

### HttpRouteContext

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface HttpRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  access: AccessContext;
}
```

### HttpUpgradeContext

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface HttpUpgradeContext {
  request: IncomingMessage;
  socket: Duplex;
  /** The first bytes after the request headers that already arrived. */
  head: Buffer;
  url: URL;
}
```

### PluginModule

Source in the repository: apps/server/src/plugin-support/plugin-module.ts

```typescript
export interface PluginModule {
  readonly requires?: readonly string[];
  readonly create: (host: PluginHost) => RAgentsPlugin;
}
```

### PluginManifest

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface PluginManifest {
  id: string;
  requires?: readonly string[];
  web?: PluginWebAddresses;
  client?: {
    config?: Readonly<Record<string, unknown>>;
  };
}
```

### ToolCallOutcome

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface ToolCallOutcome {
  readonly toolName: string;
  readonly isError: boolean;
  readonly toolCallId?: string;
}
```

### RAgentsPlugin

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface RAgentsPlugin {
  manifest: PluginManifest;
  register: (host: PluginRegistration) => void;
}
```

### PluginRegistration

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface PluginRegistration {
  readonly manifest: PluginManifest;
  readonly storage: PluginStorage;
  clientConfig: (values: Readonly<Record<string, unknown>>) => void;
  config: (...descriptors: readonly PluginConfigDescriptor[]) => void;
  channels: (...contributions: readonly ChannelContribution[]) => void;
  methods: (...contributions: readonly MethodContribution[]) => void;
  http: (...routes: readonly HttpRouteContribution[]) => void;
  lifecycle: (...contributions: readonly SessionLifecycleContribution[]) => void;
  operation: (id: string) => RegisteredOperationDescriptor | undefined;
  operations: (...contributions: readonly OperationContribution[]) => void;
  invokeOperation: (id: string, context: OperationContext, input: unknown) => Promise<JsonValue>;
  agentRuntime: (...contributions: readonly AgentContribution[]) => void;
  profiles: (...contributions: readonly ProfileContribution[]) => void;
  prompts: (...contributions: readonly PromptContribution[]) => void;
  /** Prompts, functions, skills and agent hooks of this plugin apply only in runs for which the condition holds; at most one per plugin. */
  runCondition: (condition: RunCondition) => void;
  provide: <T>(token: ServiceToken<T>, service: T) => void;
  service: <T>(token: ServiceToken<T>) => T;
  optionalService: <T>(token: ServiceToken<T>) => T | undefined;
  sessionMetadata: (...contributions: readonly SessionMetadataContribution[]) => void;
  skills: (...contributions: readonly SkillContribution[]) => void;
  startEntries: (...contributions: readonly StartEntryContribution[]) => void;
  actorPackages: (...contributions: readonly ActorPackageContribution[]) => void;
  startOptions: (...contributions: readonly StartOptionContribution[]) => void;
  /** How accesses without runs.inspect see the states of this plugin and their chat events, per state id. */
  accessProjections: (...contributions: readonly AccessProjectionContribution[]) => void;
  functions: (...functions: readonly (RunFunction | ToolContributor)[]) => void;
  script: (...contributions: readonly ScriptContribution[]) => void;
  actorRuntimes: (...contributions: readonly ActorRuntimeContribution[]) => void;
}
```

### PluginStorage

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface PluginStorage {
  readonly sessionsRoot: string;
  readonly modes: PluginStorageModes;
  root: (...segments: string[]) => string;
  session: (runId: string, ...segments: string[]) => string;
}
```

### SessionLifecycleContribution

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface SessionLifecycleContribution {
  id: string;
  initialize?: () => void | Promise<void>;
  prepareSession?: (context: SessionLifecycleContext) => void | Promise<void>;
  /** After a start has prepared the workspace and set up the run's first actor, before any actor got input; never after a restart of the host. */
  sessionStarted?: (context: SessionStartedContext) => void | Promise<void>;
  stopSession?: (context: SessionStopContext) => void | Promise<void>;
  afterStopSession?: (context: SessionStopContext) => void | Promise<void>;
  deleteSession?: (context: SessionLifecycleContext) => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
}
```

### RunScriptPackage

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface RunScriptPackage {
  handle: string;
  coordinator: boolean;
  /** Whether the script may also start inside a run that is already running; without it, only a new run. */
  embeddable?: boolean;
  /** Shared actor packages of the profile that the host copies into the run before the setup, by name. */
  sharedPrograms?: readonly string[];
  files: readonly ActorProgramFile[];
  programs: readonly BundledActorProgram[];
}
```

### StartEntryBase

Source in the repository: packages/ragents/src/plugin-types.ts

```typescript
export interface StartEntryBase {
  id: string;
  title: string;
  description: string;
  order?: number;
  guide?: string;
  /** Searchable labels supplied by the plugin, independent of the entry action. */
  tags?: readonly string[];
  /** Start options this entry fixes, option id to value; a run started through it takes exactly these values. */
  fixedStartOptions?: Readonly<Record<string, JsonValue>>;
}
```

### WebPlugin

Source in the repository: apps/web/src/PluginRegistry.tsx

```typescript
export interface WebPluginDescriptor {
  id: string;
}

export interface WebPlugin extends WebPluginDescriptor {
  activate?: (config: Readonly<Record<string, unknown>>) => WebPlugin;
  enabled?: (config: Readonly<Record<string, unknown>>) => boolean;
  brand?: ProductBrand;
  surface?: SurfaceContribution;
  surfaceElements?: SurfaceElementContribution[];
  cardSections?: CardSectionContribution[];
  chatDisplayPolicy?: ChatDisplayPolicy;
  resolveRunUrl?: RunUrlResolver;
  startOptions?: StartOptionContribution[];
  needsRunView?: boolean;
  SessionProvider?: ComponentType<SessionProviderProps>;
  sessionHeaders?: SessionHeaderContribution[];
  sessionStatus?: SessionStatusContribution[];
  overviewPanels?: OverviewPanelContribution[];
  settings?: SettingsContribution[];
  workspaceTabs?: WorkspaceTabContribution[];
  workspaceTabsFor?: (session: SessionContext) => readonly WorkspaceTabContribution[];
  toolPresenters?: ToolPresenterContribution[];
  entityPresenters?: EntityPresenterContribution[];
  guides?: EntryGuideContribution[];
  sessionMetadata?: SessionMetadataContribution[];
  actionViews?: ActionViewContribution[];
  attention?: AttentionContribution[];
}
```

### WebPluginDescriptor

Source in the repository: apps/web/src/PluginRegistry.tsx

```typescript
export interface WebPluginDescriptor {
  id: string;
}
```

### SurfaceElementDefinition

Source in the repository: apps/web/src/PluginRegistry.tsx

```typescript
export interface SurfaceElementDefinition {
  id: string;
  visible?: boolean;
  title?: string;
  anchorActorId?: string;
  entity?: EntityReference;
  data?: unknown;
}
```

### RunContext

Source in the repository: apps/server/src/plugin-support/actor-programs/app-project.ts

```typescript
interface RunContext<State> {
  readonly run: { readonly id: string };
  readonly actor: {readonly id: string; readonly handle: string};
  readonly std: RAgentsStd;
  readonly invocation: { readonly id: string; readonly kind: string };
  readonly principal: { readonly id: string; readonly kind: string };
  readonly signal: AbortSignal;
  readonly state: { read(): Readonly<State>; replace(value: State): void };
  readonly functions: {readonly [Name in keyof CapabilityContracts]: (...args: {} extends CapabilityContracts[Name]['input'] ? [input?: CapabilityContracts[Name]['input']] : [input: CapabilityContracts[Name]['input']]) => Promise<CapabilityContracts[Name]['output']>};
  log(value: unknown): void;
  throwIfAborted(): void;
  /** Ends a start of this run script with a JSON result; the host delivers it once to whoever started it. Only in onStart, onInput and onResult; outside onStart, name the start. */
  finish(result: unknown, options?: { readonly summary?: string; readonly start?: number }): void;
}
```

### AppContext

Source in the repository: apps/server/src/plugin-support/actor-programs/client-compiler.ts

```typescript
interface AppContext<State, Actions> {
  readonly ready: Promise<void>;
  readonly run: { readonly id: string };
  readonly actor: { readonly id: string; readonly handle: string };
  readonly principal: { readonly id: string; readonly kind: "operator" };
  readonly state: AppStateView<State>;
  readonly chat: ChatConnection;
  readonly capabilities: AppCapabilities<Actions>;
}
```

### AppStateView

Source in the repository: apps/server/src/plugin-support/actor-programs/client-compiler.ts

```typescript
interface AppStateView<State> {
  read(): Readonly<State>;
  subscribe(listener: (state: Readonly<State>) => void): () => void;
}
```

### AppCapabilities

Source in the repository: apps/server/src/plugin-support/actor-programs/client-compiler.ts

```typescript
interface AppCapabilities<Actions> {
  list(): ReadonlyArray<keyof Actions & string>;
  call<Name extends keyof Actions & string>(
    name: Name,
    input: Actions[Name] extends { readonly input: infer Input } ? Input : never,
  ): Promise<Actions[Name] extends { readonly output: infer Output } ? Output : never>;
}
```

### ChatConnection

Source in the repository: apps/web/src/actor-programs/client-ui/contracts.d.ts

```typescript
export interface ChatConnection {
  read(actor: string): ChatSnapshot | undefined;
  subscribe(actor: string, listener: () => void): () => void;
  send(actor: string, text: string, attachments?: ChatAttachmentInput[]): Promise<void>;
}
```

### appPackageSchema

Source in the repository: apps/server/src/plugin-support/actor-programs/app-project.ts

```typescript
{
  title: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()), backend: Type.Optional(Type.String({ minLength: 1 })),
  views: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }), title: Type.Optional(Type.String({ minLength: 1 })),
    client: Type.String({ minLength: 1 }), styles: Type.Optional(Type.String()),
  }, { additionalProperties: false }))),
}
```

### appContractSchema

Source in the repository: apps/server/src/plugin-support/actor-programs/app-project.ts

```typescript
{
  state: schema, functions: Type.Record(Type.String(), actionSchema),
  input: Type.Optional(Type.Object({ capabilities: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })) }, { additionalProperties: false })),
}
```

### actionSchema

Source in the repository: apps/server/src/plugin-support/actor-programs/app-project.ts

```typescript
{
  label: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()),
  input: schema, output: schema,
  capabilities: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
  confirmation: Type.Optional(Type.String()),
  tool: Type.Optional(Type.Object({ name: Type.String(), targets: Type.Optional(Type.Array(Type.String(), { minItems: 1 })), card: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
}
```

### ProductRuntimePolicy

Source in the repository: apps/server/src/ragents/product-runtime.ts

```typescript
export interface ProductRuntimePolicy {
  coordinator: CoordinatorDescriptor;
  roleFor: (view: ActorRoleView, actor: ProductActor) => ActorRole;
  contract: (role: ActorRole) => string;
  promptComposition: string;
  systemPrompts: () => SystemPromptCatalog;
}
```

### WorkspaceRuntime

Source in the repository: apps/server/src/ragents/workspace-runtime.ts

```typescript
export interface WorkspaceRuntime {
  resolve: (runId: string, emitSystem: (text: string) => void) => Promise<SessionWorkspace>;
  describe: () => WorkspaceRuntimeDescription;
  /** The one central place where a flow asks where and in which folder a run works. */
  placementOf: (runId: string) => WorkspacePlacement;
  toolNaming?: WorkspaceToolNaming;
  transfer?: WorkspaceTransfer;
}
```

### WorkspaceResolver

Source in the repository: apps/server/src/ragents/workspace-runtime.ts

```typescript
export interface WorkspaceResolver {
  optionId?: string;
  kind?: WorkspaceKind;
  /** With a contribution, the new folder per run exists on a workstation only if the contribution provides it there. */
  workstation?: WorkstationFolder;
  resolve: (context: WorkspaceResolverContext) => Promise<WorkspaceResolution>;
  /** Stopping a run in the contributed workspace on the server; `sandbox` stops the host's tools in the process. */
  stopSession?: (runId: string, sandbox: () => Promise<void>) => Promise<void>;
  /** Deleting a run in the contributed workspace on the server, after stopping. */
  deleteSession?: (runId: string) => Promise<void>;
}
```

### DocumentStore

Source in the repository: apps/server/src/ragents/document-store.ts

```typescript
export interface DocumentStore {
  directoryFor: (runId: string) => Promise<string>;
  describe: () => DocumentStoreDescription;
}
```

### GitWorkspaceView

Source in the repository: apps/server/src/ragents/workspace-runtime.ts

```typescript
export interface GitWorkspaceView {
  branch: (runId: string) => Promise<string | undefined>;
  changes: (runId: string) => Promise<unknown>;
  /** previousPath names the source of a rename from the change list; only this way does Git pair them without the whole list. */
  file: (runId: string, filePath: string, view: "diff" | "current", previousPath?: string) => Promise<unknown>;
}
```

### AgentDriver

Source in the repository: packages/ragents/src/drivers/types.ts

```typescript
export interface AgentDriver<Kind extends AutomatedDriverKind = AutomatedDriverKind> {
    readonly kind: Kind;
    readonly supportsPlainLlm?: boolean;
    runTurn(request: TurnRequest<Kind>, signal: AbortSignal): Promise<TurnResult>;
    disposeAgent?(runId: string, agentId: string): Promise<void>;
    reviveAgent?(runId: string, agentId: string): void;
    haltRun?(runId: string): Promise<void>;
    waitForRunSettlement?(runId: string): Promise<void> | undefined;
    disposeRun?(runId: string): Promise<void>;
    shutdown?(): Promise<void>;
}
```

### LanguageServerAdapter

Source in the repository: packages/workspace-executor/src/language-server/host.ts

```typescript
export interface LanguageServerAdapter {
  id: string;
  label: string;
  languages: Readonly<Record<string, string>>;
  rootDescription: string;
  /** The extensions of the solutions that `<id>_solutions` searches for in the workspace; without them there is neither search nor switching. */
  solutionExtensions?: readonly string[];
  resolveRoot: (workspaceRoot: string, root: string) => Promise<string>;
  rootDirectory: (root: string) => string;
  launch: (context: WorkspaceProcessContext, root: string) => Promise<LanguageServerLaunch>;
  open: (session: LanguageServerSession, root: string, timeoutMs: number) => Promise<string>;
}
```

### WorkspaceExecutorParts

Source in the repository: packages/workspace-executor/src/contributions.ts

```typescript
export interface WorkspaceExecutorParts {
  readonly languageServers?: readonly LanguageServerAdapter[];
  /** Modules with their own operations; every operation belongs to exactly one module. */
  readonly modules?: readonly WorkspaceModuleFactory[];
}
```

### WorkspaceExecutorMachine

Source in the repository: packages/workspace-executor/src/contributions.ts

```typescript
export interface WorkspaceExecutorMachine {
  /** The tools folder of the plugin on this machine, where its provisioning downloads to. */
  readonly toolsDirectory: string;
  /** A file from a package in the node_modules of the host of this machine; without a host or package the call fails with a cause. */
  readonly hostPackageFile: (hostRoot: string | undefined, specifier: string) => string;
  /** A file with one of the extensions in the workspace, resolved and checked. */
  readonly resolveRootFile: (workspaceRoot: string, requested: string, extensions: readonly string[]) => Promise<string>;
  /** A folder in the workspace, resolved and checked. */
  readonly resolveRootDirectory: (workspaceRoot: string, requested: string) => Promise<string>;
  readonly resolveRootPath: (workspaceRoot: string, requested: string) => Promise<string>;
  /** A domain error of an operation with code and status; it reaches the caller as the same error as one of the executor. */
  readonly operationError: (code: string, message: string, status: number) => Error;
  /** The environment of a process that a contribution starts itself: the safe selection of this machine, its HOME and the marker of the run for the process view. */
  readonly processEnvironment: (runId: string) => NodeJS.ProcessEnv;
  /** Starts a managed process group with pipes; the contribution applies the run's sandbox before launching. */
  readonly startManagedService: (options: ManagedServiceOptions) => ManagedService;
}
```
