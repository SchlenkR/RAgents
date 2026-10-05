# Profiles and configuration

## Profiles

The repository ships three neutral profiles: `core` is the workshop with all neutral plugins and
without examples, `showcase` is the same profile plus the example plugin `ragents.reference`, and
`developer` is the programming profile for working on your own machine (workspace, documents,
browser, orchestration, Roslyn with the solution loaded at run start, FSAC, and TypeScript,
without sign-in through `anonymousUser`, models through OpenRouter with `OPENROUTER_API_KEY`). Templates for your own profiles are `core` (real
profile) and `developer` (ad-hoc profile); there is no separate example file.

| Profile | Port | Sign-in | Examples from `ragents.reference` |
| --- | --- | --- | --- |
| `core` | 4710 | off without a user list, `ACCESS_TOKEN` possible | no |
| `showcase` | 4713 | like `core` | yes, 27 skills and 8 run scripts |
| `developer` | 4715 | `anonymousUser` with all permissions | no |

The server port is under `host.PORT` in the profile file: `core` uses 4710, `showcase` 4713,
`developer` 4715. An explicitly set environment variable `PORT` overrides this default. Integers
from 1 to 65535 are allowed; `PORT=0` is not a start mode. `scripts/start.sh` checks the fixed port
before the start. The server checks it again after loading the configuration, before it
initializes plugins. A port in use is a clear start error; neither is another address chosen nor
is a running instance terminated. The start message names the fixed URL and storage location.

With `--dev`, the backend port stays the same. Vite always uses the backend port plus 1000, so
5710 for `core`, with `strictPort`; `API_TARGET` points to the configured backend. Both ports are
checked beforehand and must differ. A standalone `pnpm dev:web` uses port 5710 and
`http://localhost:4710` as proxy target, also with `strictPort`.

Plugins are found at RUNTIME, not wired in at compile time, and only as finished bundles. An
identifier in the profile is a built-in bundle under `bundles/<id>/` (built with
`pnpm build:plugins` from `plugins/<id>/`), a path is a bundle folder anywhere; the folder name IS
the plugin ID, the entry point is `ragents-bundle.json` (`profile/plugin-discovery.ts`, manifest in
`profile/bundle-manifest.ts`, roots from `plugin-support/plugins-root.ts`). Only what the profile
names is loaded, namely through `await import()` of `server/index.js`. A source folder instead of a
bundle, a missing bundle, and a bundle with a different format or a different host API are hard
errors that name the command to build; details in the section Bundle, build tool, and host API in
[plugins.md](plugins.md).

`PRODUCT_PROFILE` (`core`, `showcase`, `developer`; no default, missing or unknown is a hard start
error) selects the profile file `ragents.config.<profile>.ts` (product descriptor + plugin list of
plain string IDs); the optional variable `PLUGINS` (comma-separated plugin IDs) overrides the plugin
list of the profile file; the product descriptor stays that of the profile file. An unknown plugin
ID, a missing `requires`, and a violated order abort the start hard - checked BEFORE any plugin is
built (`profile/compose.ts`).

In the web there is no plugin list at build time: the host's web is the same for every profile,
`ragents.plugins.bootstrap` names the addresses of its web half for each active plugin, and the web
loads them through `import(url)` from the server (`apps/web/src/PluginActivation.ts`,
`plugin-bootstrap.ts`). A web half that does not load or reports a different identifier stays a
hard error.

The values themselves come from ONE TypeScript configuration PER PROFILE
(`ragents.config.<profile>.ts`, sections per plugin ID plus `host`; loaded by
`apps/server/src/config-file.ts`, selected solely through `PRODUCT_PROFILE`): it is loaded before
any other module and materialized in `process.env` only for keys that are not yet set - set
environment variables therefore win per key, and every existing consumer (`declaredEnvironment`,
`config.ts`, child environments) keeps reading from the environment unchanged. Service secrets are
in the file as `env("ENV_NAME")` references. The separate `users` export also allows passwords in
plain text on explicit request.

Besides `config`, `users`, and `anonymousUser`, a profile file can have a fourth export
`defaultStartEntry`: the identifier of the template that a new run takes without a selection.

```ts
export const defaultStartEntry = "ragents.reference.word-game";
```

The value is a string in the form of a template identifier (`config-file.ts`,
`resolveDefaultStartEntry`); it is not materialized in the environment. When sealing the
`PluginHost` (`profile/compose.ts` passes it on as `defaultStartEntry`), the start checks that a
plugin of the profile has registered exactly this template; otherwise it aborts with the list of
registered templates. `ragents.plugins.bootstrap` delivers it as `defaultStartEntry` only to users
for whom the template is allowed (`publicProfile`); without that, the field is missing and the
other templates remain. The default is the first tile on the server's Start page in both hosts
and the first row of the selected environment's `RAgents: New run` picker in VS Code
([usage.md](../usage.md), section Run panel and VS Code extension). `core`, `showcase`, and
`developer` set no default.

Validation is against the ONE truth of the declared descriptors, now in two stages. The COMPILER
already checks: `apps/server/src/config-definition.ts` derives the type `RAgentsConfig` from
`hostConfigDescriptors` and the descriptors of the plugins (pure type imports, not present at
runtime), so that an unknown section, an unknown key, and a secret in plain text break the build.
What remains at START: a missing reference, a duplicate key with a differing value, and the check
of every plugin section after composition against the configuration declarations registered in the
`PluginHost`; sections of known but inactive plugins are ignored with a notice. Lists are real
arrays in the file and travel through the environment as JSON - `process.env` is a string map
and remains the transport to sandbox bash, language servers, and the agent runtime.
Plugin sections accept structured JSON: primitives, null, objects, and arrays of objects.
Nested `env("NAME")` references are resolved while loading the profile; missing variables and
plain-text keys ending in `_KEY`, `_TOKEN`, `_SECRET`, `_PASSWORD`, or `_PAT` fail at any depth.
The plugin validates the shape of its own structured value at startup, including unknown fields.
`MODEL_ALIASES` and `MODEL_PROVIDERS` retain their dedicated host validation and also travel as JSON.

The section is documentation and a validation frame, NOT a namespace: every key is materialized in
`process.env` under its bare name. Two products with keys of the same name (`AGENT_MODEL`,
`SYSTEM_PROMPTS_DIR`, ...) therefore cannot be told apart in ONE file - hence a separate file per
variant.

The `core` profile (product ID `ragents`) is the neutral RAgents variant. It boots without any
product-specific plugin with one workspace per run, chosen as a start option (machine: server or
connected workstation; folder: new per run or existing), and is thus at the same time the living
removal test: chat, coordinator, surface, TypeScript actors, documents, and questions work without
a domain plugin. The neutral counterparts `ragents.product` (coordinator, models, preamble) and
`ragents.workspace` (working directory per run + sandbox tools from `plugin-support`) provide the
mandatory contracts `ProductRuntime` and `WorkspaceRuntime`. A profile with its own kind of
workspace does not replace `ragents.workspace` but contributes it through `workspaceResolverToken`
(section Ownership per facet in `plugins.md`); the workspace thus still has exactly one owner.

Plugin list of `core` in order: `ragents.orchestration`, `ragents.workspace`, `ragents.product`,
`ragents.overseer`, `ragents.activity`, `ragents.processes`, `ragents.documents`,
`ragents.browser`, `ragents.ask`, `ragents.todo`, `ragents.watch`,
`ragents.actor-programs`, `ragents.lsp-roslyn`, `ragents.lsp-fsharp`, `ragents.lsp-typescript`,
`ragents.model-relay`, `ragents.profile-distribution`.

The `showcase` profile (product ID `ragents-showcase`, port 4713) is the same setup plus
`ragents.reference` after `ragents.actor-programs`; sign-in, models, and language servers match
`core`. This keeps `core` the template for a real profile, while the bundled examples stay in the
repository as teaching material and are available with `./start.sh showcase`. The internally
generated reference and the built-in help are generated from `showcase`
(`scripts/homepage/homepage-catalog.ts` reads its plugin list), so that they keep showing the
examples.

The `developer` profile (product ID `ragents-developer`, port 4715) is the smaller selection for
working on a project: `ragents.orchestration`, `ragents.workspace`, `ragents.product`,
`ragents.documents`, `ragents.browser`, `ragents.ask`, `ragents.todo`, `ragents.watch`,
`ragents.activity`, `ragents.processes`, `ragents.lsp-roslyn`, `ragents.lsp-fsharp`,
`ragents.lsp-typescript`. `ROSLYN_SOLUTION_ON_START` is `on`, so C# diagnostics start with the run
(one solution loads directly, several are offered as a question). It has no `users` but an
`anonymousUser` with all permissions, because it runs on your own machine, and gets its models
through OpenRouter from `OPENROUTER_API_KEY`. It is the default profile of the agent subcommands
(`ragents run`, section Control RAgents as an agent in [usage.md](../usage.md)) and the template
for an ad-hoc profile: copy the file, rename it, change port, product descriptor, plugins, and
models.

`ragents.overseer` adds the global coordinator in the header of the interface. The plugin is also
included in the example profile. Its run and the run references stay in the respective profile
data directory; access does not span separately started profiles. A local profile file must list
the plugin explicitly.

The global coordinator has its own model and reasoning selection, stored in the respective profile
data directory. The `coordinator` role serves as the initial default. The product default for the
run coordinator uses `high`. Model selections that are already stored remain explicit defaults. As
its initial default, the `relay` role uses the same configured model and the same thinking level as
the `coordinator` role. A regression test checks both roles against the real model catalog. After
that, settings and coordinator chat use the same plugin setting. Changes apply from the next turn
without a restart and change neither the start options nor the models of other runs. The allowed
selection comes from the configured model catalog and is checked against the model capabilities.

The model provider is `AGENT_PROVIDER` in the product plugin, default `openrouter` with
`OPENROUTER_API_KEY`. With `AGENT_PROVIDER: "relay"`, catalog and model access come from another
RAgents server: `RELAY_URL` names its address, `RELAY_TOKEN` (secret, `env(...)`) the personal
token of a user there. At start, the product plugin fetches `GET /relay/v1/models` and registers
the provider `relay` through a profile contribution (`providers` in `ProfileContribution`) in the
server's one model runtime, before the title model, preparation, or engine look up a model.
`AGENT_MODEL`, `AGENT_COORDINATOR_MODEL`, `AGENT_MODELS`, `COMPACTION_MODEL` (with
`COMPACTION_PROVIDER: "relay"`), and the title model then name aliases of the relay; the model
selection shows them as `relay/<alias>`. Each alias comes with the thinking levels it offers on the
server, including what goes to the target for each level, and with its compaction values; the
client offers the same levels, sends the same as the server for a chosen level, and compacts with
the same values. The relay does not pass on the default thinking level of an alias. An unreachable
relay, a rejected sign-in, an empty catalog, or an alias without valid compaction values are start
errors with address and cause. A model call rejected at runtime also names the relay address before
the status and text of the response.

A profile can offer its models under its own names: `MODEL_ALIASES` in the `host` section is a list
of objects (`plugin-support/model-aliases.ts`, type `ProfileModelAlias` in
`config-definition.ts`):

```typescript
MODEL_ALIASES: [
  { alias: "team-standard", model: "openrouter/qwen/qwen3.8-27b", thinking: "medium",
    compaction: { threshold: 160_000, keepRecentTokens: 24_000, summaryTokens: 16_000 } },
  { alias: "team-strong", model: "openrouter/z-ai/glm-5.3", thinking: "medium",
    thinkingLevels: { off: "low", low: "low", medium: "high", high: "high" },
    compaction: { threshold: 400_000, keepRecentTokens: 32_000, summaryTokens: 16_000 } },
],
```

`model` names the target as `provider/model`, a model of a provider from `MODEL_PROVIDERS` (below) or
from the provider's built-in catalog;
`thinking` is optionally the default thinking level, one of the levels the alias offers.
`thinkingLevels` optionally maps the offered levels to levels of the target: the alias offers
exactly its keys, in the selection, in the catalog, and through the relay, and a chosen level goes
out as the target level it points to. In the example, GLM 5.3 cannot turn reasoning off and has no
`medium`; `off` therefore sends `effort: "low"`, `medium` sends `high`. This way a profile can give
all aliases the same levels, whatever model is behind them; if the target lacks a level, it usually
points to the next higher one it has. The profile defines the mapping; the host only checks that
the target has every level named. Only `off` may point to `off`, because a target without its own
value for `off` gets `enabled: false` instead of a level for it. Without `thinkingLevels`, the
alias offers the levels of its target. `compaction` is mandatory and applies to the model under
this alias: `threshold` is the absolute token count from which compaction happens,
`keepRecentTokens` the rest kept verbatim, `summaryTokens` the budget of the summary (procedure in
[core.md](core.md), section Retries and compaction). The values live on the alias because the
catalog names as context window the largest across all providers of a model; whoever compacts only
shortly before that silently ends up, with a long context, at one of the few providers with such a
large window. The start aborts with alias and cause if `compaction` is missing, a value is not a
positive integer, `keepRecentTokens + summaryTokens` is not below `threshold`,
`threshold + summaryTokens` is not below the target's context window, or `summaryTokens` is above
its output limit; likewise for an unknown key, a duplicate alias, a target outside the catalog, for
`thinkingLevels` without a level, with an unknown level, with a level other than `off` pointing to
`off`, or with a target level the target does not have, and for a default thinking level the alias
does not offer (`thinkingLevelsProblem` in `packages/agent`, `validatedAliasModel`). In the
environment, the list is stored as JSON. The same list applies to the server's own runs and to
`ragents.model-relay`. For its own runs, the server registers the aliases under the provider
`alias` in the one model runtime (`ModelRuntime.registerAliases`): an alias carries the catalog
data of its target, the levels it offers, and its own compaction values under its own name
(`aliasedModel`); a request goes with the real model and the mapped level to its provider, and
every response, every intermediate state, and every error message comes back with the alias and
provider `alias`; earlier responses of the alias count as the target's own, so that reasoning
signatures are preserved across turns. With `AGENT_PROVIDER: "alias"`, `AGENT_MODEL`,
`AGENT_COORDINATOR_MODEL`, and `AGENT_MODELS` name aliases; without `AGENT_MODELS`, all aliases are
available. The interface and model catalog show an alias without provider (`modelLabel`), the
journal stores the alias and `alias`. A role thinking level (`AGENT_THINKING`,
`AGENT_COORDINATOR_THINKING`) without a value takes the thinking level of the alias, otherwise
`high` (`roleThinkingLevel`); if someone switches to another alias in the chat, that alias's
thinking level applies, and back on the coordinator model, the coordinator's. If the target of an
alias changes, existing runs continue under the same name with the new target.

An alias can also point to an OpenAI-compatible server of the profile's own, for instance a
self-hosted one: `MODEL_PROVIDERS` in the `host` section is a list of providers
(`plugin-support/model-providers.ts`, type `ProfileModelProvider` in `config-definition.ts`):

```typescript
MODEL_PROVIDERS: [
  { id: "local", baseUrl: "http://localhost:8000/v1", apiKey: env("EXAMPLE_API_KEY"),
    compat: { thinkingFormat: "qwen-chat-template" },
    models: [{ id: "example-model", contextWindow: 131_072, maxTokens: 16_384, reasoning: true,
      input: ["text"], thinkingLevelMap: { xhigh: "xhigh" } }] },
],
MODEL_ALIASES: [
  { alias: "team-local", model: "local/example-model", thinking: "medium",
    thinkingLevels: { off: "off", low: "low", medium: "medium", xhigh: "xhigh" },
    compaction: { threshold: 100_000, keepRecentTokens: 16_000, summaryTokens: 8_000 } },
],
```

`id` is the provider name in `provider/model` and must not be a built-in provider or `relay`;
`baseUrl` is the address up to `/v1` without a trailing slash; `apiKey` is only allowed as
`env("NAME")`, and the start aborts if the variable is not set. A model names `id` as the server
knows it, `contextWindow`, `maxTokens`, `reasoning`, `input` (with `text`) and optionally
`thinkingLevelMap`, what the server receives per level: `null` removes a level, and `xhigh` or `max`
exist only when named. `compat` optionally knows `requiresReasoningContentOnAssistantMessages` and
`thinkingFormat: "qwen-chat-template"`: then the request carries no `reasoning` field, thinking is
switched with `chat_template_kwargs.enable_thinking` (false for `off`) plus `preserve_thinking`,
the level goes out verbatim as `reasoning_effort` after the alias's mapping and the model's
`thinkingLevelMap`, and earlier thinking goes back as `reasoning_content` on the assistant messages
(`applyQwenChatTemplate` in `packages/ai`). Without `thinkingFormat` the request is shaped as for
OpenRouter. An unknown key, a missing or invalid value, and a duplicate provider or model are start
errors. The server registers the providers in the one model runtime before the aliases, all with the
OpenAI-compatible transport and cost 0; the relay offers aliases on them like any other.

Custom endpoints support OpenAI-compatible responses that send `null` for optional message and
delta fields: `content`, `reasoning`, `reasoning_content`, `reasoning_text`, `reasoning_details`,
`tool_calls`, `refusal`, `audio`, `function_call`, `images`, and `annotations`, plus `role` in a delta
and `arguments` in a tool's `function` object.
The transport treats these nulls as absent in SSE events and JSON responses before SDK validation.
Tool calls in deltas and JSON messages may omit `type` or send it as null; a present `function`
object identifies the type. Tool arguments remain intact across chunks. Incoming `reasoning_content`
remains thinking, including with `qwen-chat-template`; JSON messages map it to reasoning when that
field is absent. Other required fields, non-null invalid values, and malformed JSON still fail
validation or parsing.
Responses from the real OpenRouter endpoint are unchanged.

The preparation chat, product model catalog, and coordinator settings take the thinking levels
from the capabilities of the respective provider model in the built-in runtime catalog, for an
alias from the levels it offers, or, for the relay, from its alias catalog. There is no blanket
list per product. `AGENT_MODEL_REASONING` can explicitly restrict this selection; unknown models as
well as invalid or duplicate levels are configuration errors. The server additionally checks the
entire offered catalog against the model runtime actually loaded and validates all profile
defaults before use. When the model changes in the preparation chat, the configured preferred
thinking level is used if it is available, otherwise the first offered level; the selection is
visible before sending. Explicitly passed invalid values are rejected.

On a start through chat or setup, the human run participant receives the display name of the user
signed in on the server, and the run remembers the same user as its owner. Without sign-in, the
product defaults use "User", and the run stays without an owner. An existing run keeps its
original participant and owner; a login change does not rewrite the journal. The run owner does
not imply the owner of the machine or repository. The general permissions and a template list
limit an operator's access; neutral components contain no product or user queries. If
`MODEL_SELECTABLE` is active, free starts and technical selection still stay bound to the
respective user permissions. Without any source - neither plugin folder nor `SYSTEM_PROMPTS_DIR` -
the catalog stays empty, without an error; the keys act process-wide and must not break another
product plugin on import. The checkbox "Also pass on to the agents" decides whether the chosen
text is only in the coordinator prompt or additionally in the system prompt of created agents.
Plain LLMs with `tools: []` stay excluded and receive exclusively their own prompt. Selection and
scope freeze with the first message into the journal state `ragents.system-prompt`.

The start menu offers the profile files of the repository. `./start.sh core` uses port 4710 and
`~/.local/share/ragents/core` by default, `./start.sh showcase` port 4713 and
`~/.local/share/ragents/showcase`, `./start.sh developer` port 4715 and
`~/.local/share/ragents/developer`. All three profiles are also in the `@schlenkr/ragents` package;
`ragents start <profile|path>` takes a profile name of the host, the path of your own
`ragents.config.<profile>.ts` anywhere, or, if neither applies, a version of fetched profiles from
the cache.

Before every start, `scripts/start.sh` rebuilds the outdated built-in plugins (`pnpm
build:plugins`, current ones stay untouched), with `--dev` additionally continuously with `pnpm
build:plugins --watch`; `tsx watch` restarts the server as soon as a server file of a bundle
changes. Plugins outside the host are built by their own repo. The web exists once for all
profiles under `apps/web/dist/`, built with the host (`pnpm build:web`); `scripts/start.sh` builds
it only if it is missing or no longer matches its sources, and with `--dev` not at all, because
the Vite dev server then delivers the interface. The package ships it ready-made. The server itself
builds nothing: in a checkout, its start aborts if a built-in bundle of the profile or the web does
not match the sources, and names `pnpm build:plugins` or `pnpm build:web` (section Bundle, build
tool, and host API in [plugins.md](plugins.md)). This also applies to `pnpm start`, `ragents run`,
`ragents start`, and the VS Code extension with a checkout as host. A server-delivered profile also
takes the web of its host (section Server-delivered profiles).

The server knows three start modes (`pnpm start -- <arguments>`, `apps/server/src/main.ts`):
`--port N` listens as before on the port of the profile or the environment and aborts if the port
is in use; `--port 0` listens on a free port only on `127.0.0.1`, generates an access token per
process without configured users and without `ACCESS_TOKEN`, and writes the announcement
`{"ragents":{"url","token","pid"}}` for the caller as the only line on stdout; `--stdio` speaks
JSON-RPC over stdin and stdout, without `--port` without HTTP, and ends the server when the input
ends. With `--stdio` and `--port 0`, the console goes to stderr so that stdout belongs to the
protocol. The server binds its port before it builds its plugins and runs, and answers requests
only afterwards; so every address it assigns during setup, such as `RAGENTS_API_BASE_URL` of the
global coordinator, names the port actually bound, even with `--port 0`. Without HTTP (only
`--stdio`), it does not set this variable. If the caller names itself in `RAGENTS_PARENT_PID`, the
host watches this process every five seconds (`apps/server/src/parent-watch.ts`) and shuts down in
an orderly way as soon as it no longer exists; the writer lock of the journal is released regularly
as with SIGTERM. A set value that is not a positive integer aborts the start; without the variable
there is no watcher. A second process on the same profile folder is the caller's business. Existing
data of other profiles stays untouched and is not migrated.

The shared data path resolution applies to the start script and to a direct server start:
`DATA_DIR` from the environment overrides `host.DATA_DIR` of the profile; without both,
`~/.local/share/ragents/<profile>` applies. Before build and server initialization, the start
checks the physically resolved, already existing directories up to the file system root. A data
directory inside a Git or package project (`.git`, `pnpm-workspace.yaml`, or `package.json`) is
rejected with a cause. Symlinks do not bypass this check. Explicit external paths remain allowed.
Below the data folder is `tools/<plugin-id>/`: the tools that `pnpm provision` fetches for the
plugins of this profile (section Provisioning per plugin in [plugins.md](plugins.md)).

Changing the storage location is a deliberate operation with the server stopped. It covers the
entire profile data. The server moves no data and does not rewrite frozen journal paths.

Instead of a text, a configuration value can be `provisioned("<plugin-id>", "<path>")`: when the
profile file is loaded, it becomes `<data folder>/tools/<plugin-id>/<path>`. This is how `core`,
`showcase`, and `developer` name their language servers without hard-coding a machine path.
Explicit environment variables override these values too.

`host.PLUGINS` names plugins by identifier or by path to a bundle; relative paths are relative to
the profile file and become absolute when loaded. The profile file lives in the repo root or
anywhere: `PRODUCT_PROFILE_FILE` then names the path, `PRODUCT_PROFILE` stays the name, and the
file name must be `ragents.config.<profile>.ts`; data directory, messages, and sections keep using
the name. `scripts/start.sh <profile>` or `scripts/start.sh <path>` sets both, in the package
`ragents start <profile>` or `ragents start <path>`; without an argument, the script lists the
profiles in the repo and also accepts a path. The dev mode uses the backend port plus 1000 for
Vite. An external profile file imports `@ragents/host/config-definition.js`.

### Server-delivered profiles

A profile can also come from another RAgents server. Its plugin `ragents.profile-distribution`
packs the client profile file and the bundles it names by path into an archive at start (section
Profile distribution in [plugins.md](plugins.md)). `ragents connect <server-url>` fetches it with
the personal token from `RAGENTS_TOKEN` (`scripts/remote/connect.ts`, plain Node, no Bash, in the
checkout `pnpm connect`): description through `ragents.profile.describe`, reconciliation with the
host, archive under `GET /profile/<version>.tar.gz`, check of SHA-256 and size, storage under
`~/.local/share/ragents/remote/<host>/<profile>/profiles/<version>/` with a `package.json`
(`type: "module"`), because the profile file is ESM. Then `connect` starts the server with
`PRODUCT_PROFILE_FILE` pointing to the file in the cache and `DATA_DIR` to
`~/.local/share/ragents/remote/<host>/<profile>/data/`. From there on, it is an ordinary local
start by path: engine, journal, tools, language servers, browser, and Git run on the developer's
machine, the web comes ready-made from its host, nothing is built or installed, and nothing is
loaded later at runtime.

The reconciliation before fetching requires two things of the local host (checkout or package
`@schlenkr/ragents`; the extension checks the host it will start). First, the same host API as the
server (`hostApi` of the description against `host-api.json` of the local host,
`readHostApiVersion`): the bundles in the archive are built against it, and the web of the local
host loads their web halves only through the registry of the same host API. Second, a built-in
bundle for every plugin that the client profile names by identifier, because these come from the
local host. The same commit as on the server is not required: bundles and web fit together through
the host API, not through a shared build, and a developer needs no new package for a newer server
version without a new host API. If something differs, `connect` aborts before downloading and does
not switch by itself: in the package with `npm install -g @schlenkr/ragents@<packageVersion>`, in
the checkout with `git checkout <hostVersion>` together with `pnpm build:plugins` and
`pnpm build:web`, for a missing bundle in the checkout first with `pnpm build:plugins`. After
unpacking, `connect` checks the `revision` of every bundle in the archive before it takes the version
into the cache. The start performs the remaining checks as for every profile: manifest, `format`
and `api` of every bundle, the used names of the host API (`hostNames`) against `host-api.json` of
the local host, `uses` against plugin list and `requires`, the keys per plugin against its
declarations. The client profile file names bundled bundles relative to itself; the server rejects
an absolute or `~/` path already when packing.

A new version lands in a new folder; old versions stay until `connect --clean` removes them;
`--no-start` ends after fetching, `--port <n>` passes the port through to the server. Between
fetching and starting, `connect` runs the provisioning for the fetched profile; a gap that cannot
be closed aborts the start with its instruction. Both steps run as `node --import tsx <script>` in
the host's `apps/server` folder, that is, without pnpm. `connect` records the most recently fetched
version as `current.json` next to the cache (server, profile, version, profile file, data folder);
`ragents start <profile>` starts exactly that again without asking the server. No entry and
several servers with the same profile name are errors with the respective list. Such a profile
usually gets its models through the server's relay (`AGENT_PROVIDER: "relay"`, above in the
section Profiles). The client profile names personal values such as the relay token as `env(...)`;
they come from the developer's environment.

## ACP editor agent

`ragents acp` implements stable Agent Client Protocol v1 with `AgentSideConnection` and
`ndJsonStream` from `@agentclientprotocol/sdk`. The checkout command is `pnpm ragents acp`, with
`--silent` before `ragents` when a stdio client launches pnpm to suppress its script banner;
the package includes the same entry point under `scripts/acp/`. stdin and stdout carry only
newline-delimited protocol messages; diagnostics go to stderr. This adapter calls the ordinary
HTTP messaging layer and introduces no separate engine runtime. Usage and an editor settings
example are in [usage.md](../usage.md#connect-an-editor-over-acp).

The shared host helper under `scripts/agent/host.ts` also serves `ragents run`: profile name or
path through `--profile`, otherwise `RAGENTS_PROFILE` or `developer`; data through `--data-dir`,
`DATA_DIR`, or the profile default; address through the profile's `host.json`, `RAGENTS_URL`, or
`host.PORT`. A local host is found or started with the existing startup path. An explicit server
on another machine is used as it is; missing hosts and rejected authentication are errors.
`RAGENTS_TOKEN` travels only as a bearer header. The adapter advertises no interactive sign-in
method; a host requiring a missing token reports how to provide it.
`initialize` validates the host before returning capabilities; a sign-in refusal becomes the
ACP `auth_required` error. A different protocol version receives the supported version 1 and
does not enable session methods.

`session/new` reserves a run identifier and selects its workspace start option for the absolute
`cwd`. On this machine the folder is bound on the server; for an explicit remote server the ACP
process registers a workstation offering that folder, with a stable machine-and-folder
identifier. Each folder has its own RPC stream and executor, so adding a session cannot replace
another folder's workstation registration. The first `session/prompt` creates the run through
`ragents.chat.send`, with the same ownership and permission checks as other clients. The ACP
session identifier is the run identifier and never enters model text. Editor-supplied MCP
definitions are stored before the first turn through the guarded `ragents.mcp.servers.set`
plugin method
([plugins.md](plugins.md#mcp-client)); `session/load` replaces them only while the run is idle.

Prompt text and resource links form the message text. Embedded text resources become fenced
blocks naming their URI, limited to 16,384 characters with a truncation note; aggregate prompt
text over 65,536 characters is rejected. Images and embedded binary resources use the existing
chat attachment validation and limits. The `ragents.chat` channel supplies the primary actor's
text, reasoning, tool starts and results, and plugin events. The
adapter sends message and thought chunks, tool calls and updates with status, kind, file
locations, edit/write diffs when their input text fits the 16,384-character limit, and result
text bounded to that same limit with a truncation note. `ragents.todo` state becomes an
ACP plan. An `ask_user` action uses stable form elicitation when declared by the client;
otherwise its questions and options are agent text, answered by the next prompt. A completed
turn returns `end_turn`; `session/cancel` interrupts only the primary actor and returns
`cancelled` from its pending prompt. Broken streams and failed turns return a protocol error.

`initialize` advertises loading, listing, image and embedded-context prompts, and HTTP/SSE MCP
servers when the profile includes `ragents.mcp`. `session/load` replays the channel's stored
history, including user message chunks and attachments downloaded with the host's authentication,
then ends at `replay-end`. `session/list` filters visible runs by their bound `cwd`.
The changeable `ragents.model` start option supplies the stable session configuration choices;
`session/set_config_option` applies a selection through the existing start-option method.
The adapter preserves the server's user access and exposes only its visible history and models.
Profiles with at most 20 skills send `available_commands_update` for those templates; command
names are their existing identifiers. A matching slash prompt expands the template prompt plus
optional task details after the command, activates its skill through `preparedRunInput`, and
passes `entry` to `ragents.chat.send`, matching web startup. Larger skill catalogs send no commands.
Closing the ACP connection cancels active prompts, closes each remote session's MCP connections
through `ragents.mcp.connections.close`, and unregisters its workstations. The host, runs, and
private MCP definitions remain available for a later connection.

## Editable model defaults

Under Settings, Models, the active product provides its actual LLM roles: in core `coordinator`,
`relay`, and `standard`. Per role, model and thinking level are editable. The manual role is not
among them. Provider, available models, and deliberately restricted thinking levels still come
from the profile file and the checked model catalog; the interface is not a configuration editor.

Each role has model and thinking level separately in the profile file: `AGENT_MODEL` and
`AGENT_THINKING` for `standard`, `AGENT_COORDINATOR_MODEL` and `AGENT_COORDINATOR_THINKING` for
`coordinator` and `relay`. A product plugin can register further roles with its own keys; stored
roles can be adjusted separately in the model settings. Model and thinking level defaults stay
separate; the run does not override the thinking level at start. The model catalog limits the
allowed levels per model.

The defaults are stored under `${DATA_DIR}/plugins/<product-plugin>/model-settings.json`. Each
product plugin owns its own store and its own methods `ragents.product.modelSettings.read` and
`.save`. Reading requires `settings.read`, saving additionally `settings.write`. A save transmits
all actual roles; missing, duplicate, or unknown roles, models not offered, and disallowed thinking
levels are rejected before writing. The file is replaced atomically.

If the file is missing, the validated configured defaults apply. Corrupted or invalid file contents
abort the start. New actors and the default selection of runs not yet started use the stored
defaults without a server restart. An explicit start or spawn selection remains authoritative;
existing actors keep their frozen execution.

The global coordinator still has its own immediately effective model selection and its own store.
Its initial selection is stored already at the first initialization. Changes to the product
defaults therefore do not switch it, even after a restart; conversely, its own selection changes no
defaults for new runs or agents.

## Model for automatic titles

Title generation is a host service with its own model selection under Settings, Models, Titles. It
uses the existing runtime catalog of the configured `COMPACTION_PROVIDER`, independent of
`AGENT_MODELS` and the roles. Models with text input that support reasoning turned off are
selectable. Title execution always sets reasoning to `off`; there is no additional thinking level
selection.

`COMPACTION_MODEL` is the default as long as `${DATA_DIR}/title-settings.json` is missing; an empty
default disables automatic generation. If the provider offers no suitable model, the selection
stays empty: without a default, the server starts with title generation turned off and says so in
the settings; a default without a matching model stays a start error. The bundled files for core
and showcase use `google/gemma-4-26b-a4b-it` (Gemma 4 A4B). Gemma 4 A4B, Qwen 3.8 Flash, and
GPT-5.4 nano are at the top of the suitable model selection; further matching models stay
selectable. Stored settings take precedence. The file contains `selection` with provider and model
or `null` to disable. Unknown models and invalid file or request contents are rejected; an invalid
stored state prevents the start. Saving replaces the file atomically and applies the selection only
after a successful write.

`ragents.settings.titles.read` returns selection and available catalog with `settings.read`.
`ragents.settings.titles.save` additionally requires `settings.write` and stores exclusively the
selection. Changes apply from the next title generation. Titles already generated or explicitly set
are preserved; models and thinking levels of agents or the global coordinator do not change.

<!-- guide:access -->
## Sign-in and permissions

User permissions control a person's access to the application. An actor's function selection
and technical grants control execution inside a run. Profiles provide plugins; user permissions
do not create additional plugins or functions.

A profile can export `users` as `readonly ProfileUser[]`. Each user has an ID, label, password,
and exact permission strings. Passwords can be non-empty values or `env(...)` references. When
the export is absent, the profile runs without sign-in. An empty list, duplicate IDs, invalid
permissions, or missing required password variables prevent startup.

```ts
import { env, type ProfileUser } from "./apps/server/src/config-definition.js";

export const users = [{
  id: "reader",
  label: "Read-only access",
  password: env("RAGENTS_READER_PASSWORD"),
  rights: ["runs.read", "ragents.overseer.read"],
}] as const satisfies readonly ProfileUser[];
```

A user can also have a personal token through `token: env("RAGENTS_TOKEN")`. It acts as a bearer
token with the same identity and permissions as that user, but has no session expiry. It is
intended for clients without a sign-in dialog. The server stores only its SHA-256 hash. Removing
the token from the profile and restarting the server revokes it.

Permission names are exact strings; `*` grants all permissions. Without `users` or
`anonymousUser`, access is unrestricted. An optional `anonymousUser` applies the same permissions
and allowed templates without a password. It cannot be combined with `users`. With sign-in
enabled and no valid session, all permissions are denied.
<!-- /guide:access -->

### Sign-in and tokens in detail

The `ProfileUser` contract is in `config-definition.ts`. An existing `users` export turns sign-in
on. The user list is loaded separately from the plugin configuration and does not appear in public
environment descriptors. If a password is in the file as `env(...)`, an existing `env` import line
is extended, not added a second time. The internal
[developer reference](../homepage/developer.md) names the current permissions for runs, settings,
and the global coordinator directly from the executable contracts.

A personal token is in the file only as a reference to the server environment, never in plain
text; it has 16 to 512 printable ASCII characters without `$` and `!`. It applies as
`Authorization: Bearer` and, for GET requests, as the query parameter `access`, without a cookie;
it is intended, for example, for a local RAgents server that gets models and profile from this
server. The server compares in constant time; the same token for two users is a start error. If
the named environment variable is not set or empty, the user has no personal token and keeps
signing in with their password; that is not a start error. Signing out does not revoke a personal
token.

The binding permission names and their meanings are in `packages/ragents/src/access.ts` and in the
contributing plugins. `AccessContext.can`, `hasRight`, and `accessMode` use the same check. An
`anonymousUser` limits access even without sign-in. The public snapshot contains only the sign-in
mode and users with identifier, display name, and permissions. The developer reference generates
names, host route mapping, and contracts from this code and contains checked examples for readers,
operators, and a custom plugin.

Sign-in uses user identifier and password. The server keeps an opaque sign-in session in memory
for twelve hours; the profile-specific cookie is HttpOnly and SameSite=Lax. Signing out, expiry,
and restart invalidate the session; associated open HTTP responses including event streams and
running requests are aborted on sign-out or expiry. Agent runs already started are not stopped
automatically by this. When the session is lost, the browser returns to sign-in as soon as a
request to a protected path (`/api`, `/rpc` including the event stream `/rpc/stream`, `/files`)
responds with 401 (`observeAccessExpiry`). User changes take effect with the next server start.
Sign-in applies per browser, not per tab: a new sign-in in a second tab replaces the cookie for all
tabs, and their requests from then on run under the new user. A tab therefore reloads the
signed-in user on every focus and applies a change immediately. Two users at the same time need
two browsers or a private window. Prompts, skills, and tests name no real user; the owner of a run
comes solely from the sign-in. Clients without cookie storage (the VS Code extension and its
iframes) read the session token from the `Set-Cookie` header of the sign-in response and send it
as `Authorization: Bearer`; for GET requests that cannot set a header (event stream, mini-app
frames), it also applies as the query parameter `access` (`ACCESS_TOKEN_QUERY` in
`packages/ragents/src/access.ts`). A bearer header takes precedence over cookie and query
parameter; signing out with a bearer revokes the session the same way. The addresses a document
names, its images, and its downloads can send none of these; for them a delivery route may accept a
short-lived grant in its path that stands for the access of whoever asked for it (`accessFromAddress`, `plugins.md`, Rights in
server and web contributions), which applies before sign-in and `ACCESS_TOKEN`; signing out does not
revoke such a grant.

The older `ACCESS_TOKEN` access applies only if the profile defines no users. With configured
users, sign-in replaces this access; the old token does not bypass it. It accepts the token as
bearer, cookie, or query parameter `access`; only a page navigation with the parameter is
redirected to the token-free address after the cookie is set, iframes and API requests continue
directly. The built web under `/assets/`, the files of the web halves under `/plugins/<id>/web/`
without their source maps, and the stylesheet `/ragents.css` are open, so that an iframe without a
cookie can load its scripts; every data route, every source map, and everything else under
`/plugins/` requires the token.

<!-- guide:access -->
## Run ownership

A run belongs to the user who created it. Users normally see and operate only their own runs and
the runs shared with them; `runs.read.all` adds visibility across owners. Ownership is recorded
once in the journal and is never rewritten. Runs created without authentication have no owner and
are visible only with `runs.read.all` when authentication is later enabled.

With sign-in, the owner can share a run with every user of the profile, with individual users, or
both, each share with its own access. `read` shows the run with its chat, apps, and journal as far
as the user's own permissions allow, and its workspace unless only its owner may reach it, but
operates nothing: no messages, app actions, answers, run scripts, restarts, or stops
(`run-read-only`, status 403). `write` lets the user see and operate the run as `runs.read.all`
would, still only within their own permissions. A user gets the higher of the share for everyone
and their own. Only the owner and users with `runs.read.all` change whom a run is shared with, and
a share never permits deleting the run. The browser and VS Code offer this as the "Share run"
dropdown from the run list and the run header, with the same sharing content in both contexts
([Share runs](../homepage/guide-clients.html#share-runs)).

The server enforces ownership on lists, methods, event channels, and file routes before opening a
run. An inaccessible run responds like a missing one. Each signed-in user has a global coordinator
of their own, reachable by nobody else, not even with `runs.read.all`; its tools act with that
user's access and rights, and runs it creates belong to that user. Without sign-in there is exactly
one coordinator. A start option can additionally mark a run
as `ownerOnly`, as the workspace binding does for tools running on the owner's machine. Other
users with visibility may still read its journal and, unless it is shared with them for reading,
stop it, but only its owner can send messages,
answer actions, restart actors, or invoke operations requiring `runs.write`. Its workspace is the
owner's alone even for reading: the workspace files in the Files tab, the process rail, and
language-server state are refused to everyone else, including `runs.read.all`
(`run-workspace-owner-only`). The run list asks nothing from such a
workspace on their behalf, and web and VS Code hide what needs it; the Files tab then shows only
the server's document store.

Only a signed-in user of a profile with `users` can register a workstation over the network. A
server without users (open, `ACCESS_TOKEN`, or `anonymousUser`) has one owner for every client, so it
accepts a workstation only over a loopback connection and otherwise refuses with
`workspace-client-login-required`. The VS Code extension then does not register and shows the reason
on the server.

`runs.write` permits messages and app actions in existing owned runs. Free-form runs,
preparation chats, and start options additionally require `runs.create`. Without it, a user can
start only explicitly allowed run scripts. `runs.inspect` protects models, journals, source code,
tools, and general technical views. Language-server views use their own plugin read permission.
`runs.trace` separately reveals reasoning and function-call content in chat. Without it, those
phases appear only as empty progress markers while arguments, source, results, and reasoning are
removed on the server.
<!-- /guide:access -->

### Ownership in detail

Ownership applies to every way of creating a run, including `ragents.overseer.createRun`: the
owner is the calling user, and for a call from the tools of a global coordinator, its user. The
role with `*` has `runs.read.all` automatically. `run.created` carries, besides the human
participant, its `owner.userId`; the server state of the run carries it as `ownerUserId`; the run
view for clients does not name it. A run from the time before this rule also has no owner; a run
without an owner falls to no operator.

This is enforced solely on the server, not in the interface, for the contributions of the plugins
just as for those of the host: the message layer checks every input with `runId` and every address
with the segment `runs/<id>`, the global coordinator resolves its run references only through the
caller's runs, and the interface context of a message must not name a foreign run either. A foreign
run responds with `run-not-found` (status 404); a guessed identifier therefore does not reveal that
the run exists. An identifier under which no run exists yet stays free: it belongs to whoever
creates the run under it. A profile without sign-in (`anonymousUser` or entirely without a user
list) has exactly one access and sees everything. Every user has their own global coordinator
(`core.md`, Global coordinator); its identifier is reachable only by that user, not with
`runs.read.all`, not even while no run exists under it yet, and the coordinator keeps the
permissions of its plugin. An imported run keeps the owner from its journal; if it comes from a
server without sign-in, it is a run without an owner after the import.

A plugin declares `ownerOnly` with a start option; in core, the binding to a workstation does so,
because the tools of such a run run on the owner's machine and with the owner's credentials.
Everyone who sees such a run may read and stop it, including with `runs.read.all`, except with a
share for reading. Operating it
includes messages, templates, inputs to individual actors, restarting an actor, answers to pending
actions, and every contribution of a plugin whose contract requires `runs.write`. Any other access
gets `run-owner-only` (status 403) for these; it sees the run, and disguising it as nonexistent
would be wrong here. Such a run without an owner can be operated only without sign-in, because
there is exactly one access there, to which the restriction does not apply. The core knows only
this state, no tool and no workstation. The tools of a global coordinator act as its user; they
therefore see and operate a foreign run of this kind just as little as that user does.

### Sharing in detail

`ragents.runs.share` replaces the whole sharing of a run: `everyone` (`read`, `write`, or `null`)
and `users`, each with `userId` and `access`. `ragents.runs.sharing` reads it. Both return
`{ sharing: { everyone, users: [{ userId, label, access }] }, users: [{ id, label }] }`, where
`users` lists the users of the profile the run can be shared with, without its owner. Both need
`runs.read` and `runs.write`, and the caller must own the run or have `runs.read.all`
(`run-sharing-denied`, status 403, for a user who sees the run through a share). A profile without
sign-in (no `users`, also with `anonymousUser`) has no sharing (`sharing-unavailable`, status
409), and neither a global coordinator nor a run without an owner can be shared
(`run-not-shareable`, status 409). A user the profile does not have (`share-user-unknown`, which
names the users to share with), the owner (`share-owner`), and a user named twice
(`share-user-duplicate`) are refused with status 400. A user the profile no longer has keeps their
entry until the next change and may stay in a replacement; their label is then their identifier.
Sharing a run that only its owner operates is allowed; it gives sharees no operating and no
workspace.

Before the start, an identifier without a run belongs to whoever creates the run, so every
signed-in caller may choose a sharing for it. The server keeps the choice per user in memory, like
the start options, and the run takes over only the choice of the user who creates it: it is
written as `run.sharing-changed` in the same record as `run.created`, and only if it shares with
anyone. After the start, a change is a `run.sharing-changed` of the run's human owner actor with
`changedBy` naming the signed-in user who made it, also an administrator; an unchanged sharing
writes nothing. The journal check requires a signed-in owner and refuses the owner as a user and a
user named twice; the users stand sorted by identifier. The server state of the run carries the
sharing as `sharing`, starting with nobody; the run view for clients does not name it, like the
owner. `ragents.overseer.createRun` takes `sharing` in the same shape and applies it before the
start; `ragents run --share` and `ragents share` use the same methods (`docs/usage.md`). An
imported run keeps its sharing from the journal.

A shared run is visible in lists, methods, channels, and file routes like an own one; an unshared
foreign run stays as unknown as before. Operating paths refuse a read share with `run-read-only`
before the run is touched: every message-layer contribution whose contract requires `runs.write`,
the run rights `write`, `write-inspect`, and `stop` (messages, inputs to actors, restarts, answers,
run scripts, emergency stop, interrupting a turn, stopping an actor or a process), stopping through
`ragents.overseer.stopRun`, and every request on a delivery route of the run with a method other
than GET, HEAD, or OPTIONS. A write share operates as far as the user's own permissions go; a run
that only its owner operates stays the owner's (`run-owner-only`, `run-workspace-owner-only`), but
a write share may still stop it like `runs.read.all`. `runs.read.all` is never lowered by a share.
Deleting refuses a user who sees the run only through a share with `run-delete-denied` (status
403), even with `runs.delete`.

`ragents.runs.list` tells each caller `operable` (false in a run shared with it for reading and in
someone else's run that only its owner operates), `canShare` and `shared` for whoever may change
the sharing, and `sharedAccess` for whoever sees the run only through a share. Every change of a
sharing reaches the listeners of `ragents.runs`, so a new sharee sees the run without reloading and
a former one loses it. The dispatcher also ends every channel of a run, of the host and of
plugins, as soon as its caller no longer sees the run after a sharing change; the client learns it
from the run list and from `run-not-found` on its next request.

### Permissions in detail

Without `runs.create`, `ragents.chat.start` and `ragents.runs.startScript` start only a run script
from `user.startEntries`;
arbitrary texts, other template identifiers, and technical start parameters are blocked. For these
users, the catalog contains only the allowed scripts. The selection applies to new starts; existing
own runs stay accessible. `runs.delete` allows deleting runs together with their stored data
(`ragents.runs.delete`).

`runs.inspect` protects models, journal, sources, tools, and general technical insight; tabs and
reading methods check the same permission. Without `runs.inspect`, technical tabs, inspectors, and
program sources are missing, the surface shows mini-apps and LLM conversations, and TypeScript
control actors stay hidden. The server then redacts models, prompts, grants, tool outputs, and
technical start states in the run and chat snapshots (`access-projection.ts`). It shows plugin
states and the chat events for them as the plugin defines with its access projection
([plugins.md](plugins.md), PluginHost registrations): the actor programs, for example, leave
only name, actor, and views of a program and only the time of the last change of its calls, and
their chat events are dropped. The stored value of a start option including its chat event is
visible only to whoever has its `rights`, so model and system prompt only with `runs.inspect`. All
other states stay unchanged. Start options require `runs.create` (choosing them `runs.write`); each
option additionally names its own permissions (`rights`). Model selection and system prompt
selection require `runs.inspect`, because their display shows models, providers, and prompt texts;
the folder binding `ragents.workspace.binding` requires nothing additional. Without such a
permission, the option is missing from `ragents.startOptions.list`, and choosing it fails with
`access-denied`; at start, its default value or the value of the template applies. The same
permissions apply to the model selection in the chat input of a running run, which is the same
call; without them, the selection is missing there. Domain states and mini-app actions stay
available, including the result query of running app actions. Language server views use their own
`<pluginId>.read`; this allows diagnostics to be shared independently of model and tool details.
Switching a solution in the tab additionally requires `runs.write` and `<pluginId>.write`, because
it stops and starts language servers of the run.

`runs.trace` reveals the reasoning and tool steps of the chat with their content without the rest
of the technical insight and lets the user choose their level of detail. Without this permission
(and without `runs.inspect`), the chat stream and actor history contain only empty status markers
with start and completion information for reasoning and tool phases; the server removes names,
arguments, source, results, and reasoning texts. This keeps the current working phase visible
without revealing technical details.

Settings and the global coordinator keep their own permissions. These permissions do not replace
an execution sandbox for self-written native code; on the server, the process sandbox takes care of
that ([plugins.md](plugins.md), Server process sandbox). The global coordinator has its own
read and write permissions; changes to its model selection additionally require the permission to
write settings. Its workspace receives a local token for its user's access, exclusively for the
message layer and help over loopback; the server resolves it on every call to the current state of
that user. It thus has exactly that user's permissions, no more, also for settings and its own
conversation reset; sign-in is not reachable through it, and the token does not go to the browser.
Without users but with `anonymousUser`, the token stands for the anonymous access.

<!-- guide:access -->
## Function selection and actor grants

An engine capability is a technical permission such as `workspace.use`. A grant assigns it to
an actor for the run or a workspace path and records whether the actor may use or delegate it.
User permissions such as `runs.write` instead control access to application routes.

The `tools` value on spawn selects the actor's function API: `[]` for a plain LLM, a list of
names for an exact selection, or `null` for the dynamic full set. The selection is not inherited
from the coordinator. Delegable engine capabilities are inherited as grants and can be reduced
with `withoutCapabilities`. Prompt instructions describe a role but grant no technical access.
Actor programs also declare required functions under `capabilities`; this limits calls but does
not supply missing grants. The [runtime guide](../homepage/guide-runtime.html#equipping-subagents)
shows selections for conversation and coding agents.
<!-- /guide:access -->

### Grants in detail

A workspace boundary covers the given path and its subdirectories. When delegable grants are
inherited, this scope is preserved; a new actor therefore does not automatically get its own
narrower directory. Selecting `read` does not replace a missing grant for `workspace.use`. Even a
successfully type-checked snippet stays bound to its call identity; overview, lookup, and execution
use the set allowed for this actor.

## Open limits

- Users are maintained in the profile file; there is neither OAuth nor user management or password
  change in the interface. Sign-in sessions do not survive a server restart.
- User permissions apply to the entire profile, not per run or agent tool. A share widens only
  which runs a user sees and operates, never their permissions.
- A share names user identifiers. A user removed from the profile keeps their entries in the
  journal until the next change, and a new user with the same identifier would get them. A channel
  ended by a taken-back share sends no message of its own.
- With users, the global coordinator has no host shell. Its TypeScript snippets run, like all
  processes of the server, in the process sandbox and read neither the data directory nor the
  journals of other users. If the profile file turns the sandbox off (`PROCESS_SANDBOX: "off"`),
  they run as a native Node process of the server without their own system identity and could read
  both. Through the server itself, the coordinator still reaches exactly the permissions of its
  user.
- When switching, the coordinators' model selection checks the attachments of all coordinator
  conversations, including those of a former shared user or a removed user.
- Provisioning fetches only what the bundles of a profile export as `provision`; prerequisites
  such as `dotnet` or a separate Chrome remain the developer's business and abort the start with
  their instruction. For Windows, see `plugins.md`, Open limits.
- Models of a relay carry cost 0, because the price would reveal the real model; token counts stay
  correct.
- Of the `thinkingFormat` values in `packages/ai`, a provider in `MODEL_PROVIDERS` supports only
  `qwen-chat-template`; the transport does not implement the others, `chat-template` included.
