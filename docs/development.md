# RAgents: handbook for development and AI assistants

The short entry point for GitHub is `README.md`. This handbook is the long part: terms,
architecture, plugins, profiles, configuration, development, and the rules by which work and
documentation are done here. `AGENTS.md` and `CLAUDE.md` point here.

RAgents is a workshop for AI agents: in the browser, in VS Code, and in the console. You chat
with a coordinator; it can start further agents and equip actors with TypeScript functions and
mini-apps. Everything that happens is recorded in a journal; the state always comes from
replaying this journal, never from caches. What a user sees and can do is in `docs/usage.md` and
on the [homepage](https://schlenkr.github.io/RAgents/), how to install and operate it in
`docs/operations.md`; this file describes how the system is built.

## The five terms

That is all you need to understand the system:

- **Run** - a piece of work. Exactly one journal.
- **Actor** - who acts in the run. Four kinds: you (the human owner), model actors (agents),
  TypeScript actors (TypeScript), and external actors with a plugin-provided runtime.
- **ActorInput** - a message to an actor. Lands in its queue.
- **Turn** - the processing of an ActorInput. Ends as soon as the actor no longer calls a tool
  or a tool result ends it (such as a question to the user).
  Built-in agent tools do not wait for later inputs. Inputs to a built-in agent during its turn
  join before the next model request (steering); TypeScript and external actors process them in
  later turns. An external runtime can await a user permission within its current turn.
- **Event** - every state change in the journal. Actors can subscribe to them; every matching
  event becomes a new ActorInput at the subscriber.

The terms are described in more detail in `docs/spec/overview.md`.

### What a journal looks like

One line of JSON per command decision, append-only. The line contains the command, its time,
and an array of its events. `sequence` counts up over all events of the run without gaps.
The following example shows a line as it is stored in `journal.jsonl` on disk (file format 13),
indented for reading; IDs, hash, and usage numbers are shortened. It is a completed model step:
the text as an observable `model.output.completed`, followed by the step itself, which does not
repeat the text:

```json
{
  "formatVersion": 13,
  "runId": "example-run",
  "command": {
    "id": "scheduler:review-turn:context:step:4",
    "type": "model.step.complete",
    "actorId": "reviewer",
    "requestHash": "9f2c..."
  },
  "occurredAt": "2026-09-24T10:15:00.000Z",
  "events": [
    {
      "eventId": "event-12",
      "sequence": 12,
      "type": "model.output.completed",
      "correlationId": "review-turn",
      "causationId": null,
      "payload": {
        "turnId": "review-turn",
        "text": "The review is complete."
      }
    },
    {
      "eventId": "event-13",
      "sequence": 13,
      "type": "model.step.completed",
      "correlationId": "review-turn",
      "causationId": null,
      "payload": {
        "turnId": "review-turn",
        "content": [{ "type": "text" }],
        "api": "openai-completions",
        "provider": "openrouter",
        "model": "example/model",
        "usage": { "input": 1200, "output": 9, "cacheRead": 1100, "cacheWrite": 0, "totalTokens": 2309, "cost": { "total": 0.001 } },
        "stopReason": "stop",
        "timestamp": 1790244900000
      }
    }
  ]
}
```

In memory the same line looks different: on reading it becomes a `CommandRecord` with
`formatVersion` 3, and every event additionally carries `actorId`, `commandId`, `occurredAt`, and
`schemaVersion` 3. Large payload fields are stored on disk under `payloads/` and resolved on
reading. The binding types are in `packages/ragents/src/runtime/journal.ts`,
`packages/ragents/src/runtime/journal-storage.ts` (file format), and
`packages/ragents/src/domain/events.ts`. The run state is restored from the events without
running models or tools again; the model context of every agent is also a projection of them.
Working files additionally live outside the journal. The
[homepage](homepage/index.html#events) offers a step-by-step explanation; the limits are in
`docs/spec/core.md`.

## Architecture

```
Browser, VS Code, console  --JSON-RPC over HTTP or stdio-->  apps/server  -->  packages/ragents (engine)
                             |                   |
                        PluginHost          journal, actors, turns, events
                             |
                        bundles/<plugin-id>/server/
                             ^
                        bundles/<plugin-id>/web/  <--  apps/web (by URL under /plugins/<id>/web/)
```

The server is thin. It accepts JSON-RPC over HTTP or stdio, looks for the plugins on disk at
startup, and assembles a profile from them. Every external capability is a typed contract
(method or channel) from which server, web, and reference draw the same types; HTTP routes only
remain for serving files and frames. The engine knows no domain - everything domain-specific comes
from plugins.

## Which folder contains what

| Folder                | Contents                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| `plugins`             | one folder per plugin, with `server/`, `web/`, and its assets                                        |
| `packages/ragents`    | the engine: journal, actors, turns, events, scheduler, TypeScript platform                           |
| `packages/agent`      | the agent runtime: agent loop, compaction, tools (read, write, edit, bash)                           |
| `packages/workspace-executor` | the workstation executor made of modules: sandbox tools, language server client, files, processes, commands; plugins bring language servers and the browser as a contribution to the executor; with the same contributions in the server as on the workstation |
| `packages/ai`         | the LLM integration (openrouter)                                                                     |
| `apps/server`         | Node backend, plugin discovery, profile composition; `plugin-support/` are host building blocks, not plugins |
| `apps/web`            | Shared browser and VS Code panel; chat binding to quassel in `src/chat`, navigation in `src/panel`, run UI in `src/run-panel` |
| `apps/vscode`         | VS Code extension: environment selection and connection management, server interface and mini-apps as webviews, workstation for runs |
| `scripts`             | entry points `start.sh`, `start-vscode.sh`; tools in subfolders, `remote/` for `pnpm connect`, `provision/` for `pnpm provision`, `workspace-client/` for `pnpm workspace-client`, `remote-workspace/` for `pnpm check:remote-workspace`, `run-transfer/` for `pnpm run-transfer` |
| `selftest`            | catalog and log of the autonomous test rounds                                                        |
| `docs`                | spec, concepts, decisions, operations, product homepage, drafts                                      |

`apps/server`, `apps/web`, and the packages under `packages/` except `workspace-executor` each have
a short README. `packages/agent` and `ai` are a
forked agent runtime; origin and our own changes are in `docs/decisions.md`. Their
`dist/` is gitignored and provides the types, so run `pnpm build:agent` once after a fresh
clone.

## What is built in

The engine provides typed functions for actors, messages, events, artifacts, and
model selection. The binding inventory is in the code under
`packages/ragents/src/agents/tools.ts`. Plugins add further functions, for example for files,
programs, and mini-apps.

Every function is a native model tool. `typescript_api` returns exact types and detailed
guidance; with `typescript_eval` a model runs small TypeScript snippets that combine calls through
`context.functions.<name>(input)`. The same access is available to permanent actor programs. Both
belong to the server and remain available even without the optional actor program plugin.
A plugin registers a shared implementation with `defineRunFunction` and `host.functions`;
`nativeTool: false` keeps it snippet-only.

In addition there are the shared TypeScript compiler, native Node execution, verified
program builds, the journal including replay, and the turn scheduler. The actor's function
selection and its capabilities limit access. Prompt contributions bind to the actually
available functions through `requiresTools`; detailed guides are loaded together
with their contracts.

## Actors with functions and views

TypeScript and LLM actors can own programmed functions, their own state, and React views.
A TypeScript actor also processes its normal messages in code. An
LLM actor still answers them with its model; calling one of its programmed
functions requires no additional model response.

A simple backend counts inputs in its actor's state:

```ts
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ count: Type.Optional(Type.Integer()) }),
  functions: {},
  input: { capabilities: [] },
}, {
  functions: {},
  onInput: (_input, context) => {
    const state = context.state.read();
    context.state.replace({ count: (state.count ?? 0) + 1 });
  },
});
```

Functions are in the same contract under `functions` with typed input and output.
Their return value is a result; only `context.state.replace` changes the actor state.
A function can be available in the React view and as an agent tool at the same time.
Both work with the same implementation and the same data. Local input drafts
stay in the view; successful shared state appears even while the chat is idle.

`actor_program_create` creates a private TypeScript package. The normal file and
language server tools edit it under `@actors/<name>/`, Bash with `cwd: "@actors/<name>"`,
also in a run on a workstation. New or fixed project errors appear before model requests as a
short hint; `actor_program_diagnostics` provides the complete state when needed.
`actor_program_activate` checks types, builds the program, runs the domain tests, and activates it.

On activation, `actor: "self"` or `actor: "@handle"` binds the program to an
existing actor. Without a binding, a new backend creates a TypeScript actor; a pure
view belongs to the calling actor and needs no additional participant.
Programs use fixed local libraries, regular imports, and normal `node:test` files.
The host runs them in managed Node processes and applies successful
state changes to the journal. Package structure and examples are in
[Actor programs](spec/actor-programs.md) and [TypeScript platform](spec/typescript-platform.md).

## What plugins can do

A plugin is ONE source folder - both halves together; the built-in ones are under
`plugins/`. The folder name is the ID:

```
plugins/<plugin-id>/
  ragents-plugin.json  ID, declared exports for other plugins, additional assets
  server/index.ts    exports plugin: PluginModule = { requires?, create(host) }
  web/index.tsx      exports webPlugin: WebPlugin (only if there is a web part)
  contract.ts        what both halves share, import-free (only if there is such a thing)
  executor.ts        exports executor: its contribution to the executor of every machine (only if there is such a thing)
  prompt.hbs, prompts/, run-scripts/, actors/, skills/, provision.ts   as needed
```

The server does not load this folder itself: `pnpm build:plugins` builds every built-in plugin with
`ragents plugin build` into a bundle under `bundles/<id>/` (gitignored), and at runtime its
`server/index.js` is loaded with `await import()`. A plugin outside the repo is built by its own
repo, and the profile names the bundle by path. The host's web is the same for every profile;
the browser loads the web halves at runtime with `import(url)` from the profile's bundles,
which the server serves under `/plugins/<id>/web/`, and the Tailwind classes of all
bundles go into the one stylesheet that the server compiles at startup and after every changed
class list. There is no
compiled catalog and no loading from a foreign source: what exists as a bundle and is listed in
the profile can be composed, nothing more.

Plugins are NOT npm packages. Currently there are 20, 15 of them with a web part. The five packages under
`packages/` are libraries that plugins are built against - not plugins.

Even things that seem deeply embedded are plugins: the three language servers (`ragents.lsp-roslyn`,
`ragents.lsp-fsharp`, `ragents.lsp-typescript`) each sit in their own folder, together with their
adapter in `executor.ts`, which the build tool turns into a self-contained file and which the
executor of every machine loads, in the server as on a workstation; likewise the browser of
`ragents.browser`. The core knows no language and no language server; another language is
another plugin. `apps/server/tests/core-boundary.test.ts` enforces this: if the engine, the
server outside `plugin-support`, the executor, the extension, or the web name a plugin ID or a
language server, `pnpm check` fails; older places are listed there as a frozen list and in
`TODO.md`. `lsp-roslyn` and `lsp-fsharp` each also bring their own
configuration key and their own `provision.ts`; `lsp-typescript` needs neither,
because typescript-language-server is an npm dependency of the repository root. If you remove
`ragents.lsp-roslyn` from the profile, the C# diagnostics disappear together with their configuration, also on
the workstations.

### Extension points in the server

`create(host)` gets the whole `PluginHost` and returns the manifest and `register`. The plugin
registers its contributions in `register(registration)` through the `PluginRegistration` bound
to the plugin (`packages/ragents/src/plugin-types.ts`):

| Point               | For                                                 |
| ------------------- | --------------------------------------------------- |
| `functions`         | typed run functions, optionally as a tool           |
| `prompts`           | chapters in the system prompt                       |
| `skills`            | fixed workflows as skill files                      |
| `startEntries`      | start page templates: skills, run scripts           |
| `actorPackages`     | shared actor packages that run scripts name         |
| `profiles`          | roles (`model_list`)                                |
| `agentRuntime`      | hooks before model calls and after tool calls       |
| `actorRuntimes`     | named drivers for external actors                   |
| `script`            | capabilities for TypeScript actors                  |
| `operations`        | named operations, also across plugins               |
| `operation`         | handle to another plugin's named operation          |
| `invokeOperation`   | call a named operation                              |
| `provide`           | provide a service under a token                     |
| `service`           | obtain another plugin's service by its token        |
| `optionalService`   | obtain another plugin's service that may be missing |
| `startOptions`      | start options of the start page, frozen per run     |
| `accessProjections` | what an access without `runs.inspect` sees of state |
| `methods`           | messaging layer methods with a contract             |
| `channels`          | channels with notifications per subscription        |
| `http`              | serving: files, frames, uploads, upgrades           |
| `config`            | configuration keys, strictly checked                |
| `clientConfig`      | values the web plugin may see                       |
| `storage`           | storage under `plugins/<id>`, global and per run    |
| `lifecycle`         | hooks on creation, start, and deletion of a run     |
| `sessionMetadata`   | additional details about the run                    |

### Extension points in the web

A web plugin fills slots in the frontend (`WebPlugin` in `apps/web/src/PluginRegistry.tsx`):
`brand`, `surface` (one `RunPanel`), `surfaceElements`, `cardSections`, `chatDisplayPolicy`, `resolveRunUrl`, `startOptions`,
`needsRunView`, `SessionProvider`, `sessionHeaders`, `sessionStatus`, `overviewPanels`,
`settings`, `workspaceTabs`, `workspaceTabsFor`, `toolPresenters`, `entityPresenters`, `guides`,
`sessionMetadata`, `actionViews`, `attention`; plus `activate` and `enabled`. `actionViews`
render pending actions whose payload only the owning plugin knows. `workspaceTabs` are fixed tabs, `workspaceTabsFor` is a factory that derives
tabs per run from the running state. Visible mini-apps enter `apps/web/src/run-apps.ts` automatically.
Browser runs arrange Chat, apps, and inspection tools through `run-panel/DockWorkspace.tsx`;
`PluginChat` supplies `DockToolsContext`, and the surface contribution supplies its chat and apps.
`dock-state.ts` owns immutable tree operations, `dock-geometry.ts` rectangles and docking targets,
`dock-pointer.ts` pointer capture/cancellation, and `dock-storage.ts` per-origin/run persistence.
All panel containers stay at stable DOM positions during moves. The additive web host API module
`@ragents/web/run-panel/DockWorkspace` exposes `DockWorkspace` and `useDockActiveApp`; the latter
reports the focused app for the existing user-location contract. Workspace tabs optionally declare
`hosts` to expose the Journal and Processes tools only in the browser. Server layout contracts
stay unchanged. VS Code retains its app editor tabs and inspection popout.
Unit coverage is in `apps/web/tests/dock-state.test.ts`; `docking-browser.test.ts` checks gestures,
sidebar behavior, persistence, and iframe/draft identity with `RAGENTS_BROWSER_TESTS=1`.
`startOptions` provides, per server-side start option, its own control component and a badge
for the header of the running run; without a component, the host draws a selection menu from the
option's presentation.

A domain plugin owns its prompt parts, skills, server API, web components, CSS, configuration,
and storage itself. If you remove it from the profile, prompt,
tools, projection, API, tabs, CSS, configuration, and run data disappear together.

## The profiles

A profile is exactly ONE file: `ragents.config.<profile>.ts`. It names the product
(`PRODUCT_ID`, `PRODUCT_TITLE`), the plugin list (`PLUGINS`), and the configuration of all
participating plugins. `PRODUCT_PROFILE` selects the file. There is no default; if the
value or the file is missing, the server does not start.

The repo contains three neutral profiles:

|                         | `core`                    | `showcase`                           | `developer`                                     |
| ----------------------- | ------------------------- | ------------------------------------ | ----------------------------------------------- |
| Plugins                 | neutral `ragents.*`       | like `core` plus `ragents.reference` | workspace, documents, browser, language servers |
| Working directory       | selectable per run        | selectable per run                   | usually a project folder                        |
| File storage            | per run                   | per run                              | per run                                         |
| Sign-in and permissions | optional per profile file | like `core`                          | off, `anonymousUser` with all permissions       |
| Start                   | `./start.sh core` (4710)  | `./start.sh showcase` (4713)         | `./start.sh developer` (4715) or `ragents run`  |

`showcase` is `core` plus the bundled examples from `ragents.reference`: 27 skills and
8 run scripts, from the word game to balcony planning, and a shared actor package. They are teaching material, which is why `core` remains
the template for a real profile without them. The internally generated reference and the built-in help
are created from `showcase`.

`developer` is the programming profile: a server without sign-in on your own machine, with
C#, F#, and TypeScript diagnostics and browser checks; the C# solution loads at run start. The VS Code
extension starts it locally from a connection with `profileFile`. It is also the template for your own
ad hoc profile.

Your own profile is your own `ragents.config.<name>.ts`, which can also live outside the repo
and name its plugins by path; instead of the profile name, startup also accepts the
path to such a file.

`core` is also the living removal test: if it runs without any product-specific plugin,
the boundary between engine and product is intact. The "Workspace" start option selects a run's
workspace with two separate settings: the machine (the server or a
connected workstation) and the folder (a new one per run or an existing one). The VS Code extension offers
its open folders to every connected server as a workstation and presets the choice for "New run"; the
work tools always run where the folder is located, with the same executor in the server as on the
workstation. Without VS Code, `pnpm workspace-client <server-url> [folders ...]` registers the same
workstation from the command line. An AI agent on the same machine instead uses
`ragents run <folder> "<task>"` with an existing folder on the server; the short guide for this is in
`skills-for-agents/ragents/SKILL.md`, the commands in
[usage.md](usage.md) under "Control RAgents as an agent".

A profile file can additionally define users with passwords and permissions.
Then the interface requires sign-in and shows functions hidden,
read-only, or editable depending on the permission; the server checks the same permissions. Without a user list,
sign-in stays off; anonymous access can still be restricted. Free runs and
technical views have their own permissions. A template list limits new runs to
prepared setups. A run belongs to the user who created it; `runs.read.all` shows
the runs of all users. The [profile spec](spec/profiles.md) describes setup and limits;
verified neutral examples are in the internally generated
[developer reference](homepage/developer.md#grant-reading-and-prepared-setups).

## Configuration

One TypeScript file per profile (`ragents.config.<profile>.ts`), grouped by plugin ID plus a
`host` section. The compiler checks sections and keys against the plugins' declarations;
a service secret in plain text is a compiler error. Templates: `ragents.config.core.ts` for a
real profile, `ragents.config.developer.ts` for an ad hoc profile.

Roles, users, and passwords are in the same file; the role determines access to the
interface and API, the users of a profile share models and plugins; runs belong to the
user who created them.
Set environment variables override the file defaults. A profile's data is stored
under `~/.local/share/ragents/<profile>`; `DATA_DIR` overrides `host.DATA_DIR` and this
default. The data storage must be outside a Git or package project. A deliberate move
happens while the server is stopped; startup neither takes over nor deletes previous profile folders.

There is NO `.env`. Secrets come from the process environment, for example the shell's startup
file, and are referenced with `env("NAME")`.

## Developing

```sh
pnpm install
pnpm build:agent          # once after a fresh clone: generates the d.ts of the runtime packages
pnpm build:plugins        # the outdated built-in plugins as bundles into bundles/ (start.sh and the server tests do this themselves)
pnpm build:web            # the host's web into apps/web/dist, one for all profiles (start.sh does this when it is outdated)
scripts/start.sh core     # server on port 4710, data ~/.local/share/ragents/core
scripts/start.sh showcase # the same profile plus examples, port 4713
pnpm check                # build, typecheck, tests, web build
pnpm provision core       # fetch the tools of the profile's plugins (language servers, browser)
pnpm build:package        # build the host as the npm package @schlenkr/ragents (dist/ragents), including bundles and finished web
pnpm check:package        # install the built package, build a foreign plugin from it, and start it (needs npm)
pnpm release              # publish npm, Marketplace, and standalone archives together from this machine
RAGENTS_TOKEN=... pnpm connect https://<server>   # profile and models of another RAgents server
```

`pnpm provision <profile>` fetches the tools the profile's plugins need into
`<data-directory>/tools/<plugin-id>/` and reports `ready`, `installed`, or
`missing: <reason>` per plugin; `pnpm provision --workspace` does the same for a workstation without a profile,
with the built-in plugins that contribute to the executor.
What cannot be fetched (dotnet, a separate Chrome) is a named gap with instructions.

`pnpm connect` fetches a central server's client profile together with the bundles it names by path
into a cache under `~/.local/share/ragents/remote/`, requires the same host API as there
and a built-in bundle for every plugin named by ID, and starts the local server
with it, with this host's web; nothing is built or installed, and the models come through the
server's relay. Operations in `docs/operations.md` under "Connect to a server".

Anyone who only uses the host does not need this repository: `pnpm build:package` creates
the npm package `@schlenkr/ragents` from it with server, engine, plugins, and scripts, and `pnpm publish:package`
publishes it. Node 22 is then enough -
`npm install -g @schlenkr/ragents`, then `ragents connect <server-url>`, `ragents start
<profile|path>`, `ragents provision`, `ragents workspace-client`, and `ragents plugin build`.
`ragents start` also accepts your own `ragents.config.<profile>.ts` with your own plugins in
any location; their author builds their bundles with `ragents plugin build` from the package, including
type checking against the host API. The package brings everything needed for this, plus the finished web and all
built-in plugins as bundles; nothing is built on the user's machine, and Vite is not included. The package version is the
`version` of this root `package.json`. The npm package and the VS Code extension always carry the same
version, as do the standalone archives. `pnpm release` selects one version above all published
channels, waits for the shared native build, and publishes every channel locally. `publish:all`, `publish:package`, and
`publish:vscode` are aliases for that same release (see "Releasing all channels" below). Operations in `docs/operations.md` under "Work without a checkout", the guide
for plugin authors in the section "Build and ship a plugin" in `docs/spec/plugins.md`.

The address is fixed: `http://localhost:4710` for `core`. The port is in `host.PORT` of the
profile file. An explicitly set `PORT` overrides it; an occupied or invalid
port aborts startup. Running instances are not terminated and startup does not switch
to another address.

With `--dev` the backend port stays the same; Vite always uses the backend port plus 1000, for
`core` that is 5710, so an explicitly set `PORT` moves both. Both ports are checked before
startup, `start.sh` points `API_TARGET` at the backend, and with `strictPort` Vite does not
switch when its port is occupied. A standalone `pnpm dev:web` uses port 5710 and
`http://localhost:4710` as the proxy target. In development mode the stylesheet also comes from the server and
is recompiled per request; new classes in host code appear after reloading.

Browser checks need Chrome or Chromium on the machine where the run's workspace
is located; provisioning is described in `docs/operations.md` under "Provide a browser for browser
checks", the real browser test below.

The web is served statically from `apps/web/dist`, one for all profiles; after changes there run
`pnpm build:web`. The server runs from the sources through `tsx`; code changes take effect only after a
restart. It loads plugins only as bundles: a change to `plugins/` only takes effect after
`pnpm build:plugins` and a restart; `scripts/start.sh` rebuilds the outdated plugins before every start and the
web when it no longer matches its sources (`apps/web/dist/host-web.json`), with `--dev` the
plugins continuously (`pnpm build:plugins --watch`), while Vite serves the web from the sources; `tsx
watch` restarts the server after every new bundle, and a changed plugin interface takes effect
after reloading the page. In a checkout, the server refuses to start as long as a
built-in bundle of the profile or the web does not match the sources, and names the command; this
applies to `ragents run`, `ragents start`, a direct `pnpm start`, and the VS Code extension with
a checkout as host, none of which build anything themselves.

Individually instead of `pnpm check`: per package `pnpm exec tsc --noEmit` (the typecheck of `apps/server`
also covers the `server/` halves of the plugins, the one of `apps/web` the `web/` halves); the
browser test of the registry and the web bundles (`RAGENTS_BROWSER_TESTS=1`,
`apps/web/tests/host-modules.browser.test.ts`) runs against the built web and a real server;
engine tests `cd packages/ragents && pnpm test`; server tests
`cd apps/server && pnpm test` (builds the bundles first, because the composing tests load them); lint `pnpm lint` in the root (`apps/web/src`
and `plugins/*/web`). The language server live tests (real servers against `tests/fixtures/lsp`)
run only on request: `pnpm provision --workspace` once, then
`RAGENTS_LSP_TESTS=1 PRODUCT_PROFILE=core pnpm test`; the adapters from the plugins' contributions
find the servers in the tools folder, `ROSLYN_LANGUAGE_SERVER` and `FSHARP_LANGUAGE_SERVER`
override it.

Checking behavior live: send a message by `POST http://localhost:<port>/rpc` with
`{"jsonrpc":"2.0","id":1,"method":"ragents.chat.send","params":{"runId":"<uuid>","text":"..."}}`
and read the journal under `${DATA_DIR}/runs/<uuid>/`. Server startup modes:
`pnpm start -- --stdio` (JSON-RPC over stdin and stdout, no port) and `pnpm start -- --port 0`
(free port announced on stdout), details in `docs/spec/profiles.md`. Creating, controlling, and
analyzing whole runs from outside: `pnpm driver` (`scripts/driver/run-driver.ts`), usage in
`docs/usage.md` under "Drive runs from external clients".

`scripts/` contains only the entry points `start.sh` and `start-vscode.sh` (VS Code test instance
with the extension against a running server); the
other tools are grouped by topic in `scripts/homepage/` (generator, type checking, and tests of the
homepage), `scripts/driver/` (`pnpm driver`), `scripts/remote/` (`pnpm connect`),
`scripts/provision/` (`pnpm provision`), `scripts/package/` (`pnpm build:package`, `pnpm publish:package`, and the
package's `ragents` command),
`scripts/release/` (shared release workflow, standalone archives, and their checks), `scripts/install/` (release
installation scripts and update checks),
`scripts/run-transfer/` (`pnpm run-transfer`: move a run to another server),
`scripts/workspace-client/` (`pnpm workspace-client`: a workstation without VS Code),
`scripts/remote-workspace/` (`pnpm check:remote-workspace`: the workspace on another
machine, with Docker), and `scripts/maintenance/` (model catalog, concept audit).

### Developing quassel and RAgents together

The chat building blocks are the quassel library (github.com/SchlenkR/quassel, npm `quassel`); RAgents
uses it as an ordinary dependency (`^0.4.5` in the root, `apps/web`, and `apps/server`,
`minimumReleaseAgeExclude` in `pnpm-workspace.yaml` for freshly published versions). Anyone
changing both at the same time temporarily links quassel to its sources:

```yaml
# pnpm-workspace.yaml, local only
overrides:
  quassel: link:/path/to/quassel/packages/quassel
```

Then run `pnpm install`; in the quassel repo, `pnpm --filter quassel dev` keeps the stylesheet
`build/chat.css` up to date. Work with `scripts/start.sh <profile> --dev`: Vite and `tsx`
compile quassel's TypeScript sources along with it, the server compiles the stylesheet per request,
and a change shows after reloading. `pnpm build:web` and type checking do not work this way:
the homepage's mini-app demo accepts only sources from the repo, and quassel's sources see
a second copy of the React types. Before every commit, `overrides` and the `pnpm-lock.yaml`
changed by it are removed again (`pnpm install` afterwards); checks and commits are always made against
a published version. RAgents takes over a new quassel version with
`pnpm up -r quassel`; if it changes names that plugins use, `pnpm update:host-api` and
a new `HOST_API_VERSION` are needed (`docs/spec/plugins.md`, section Bundle, build tool, and host API).

## Tools, checks, and publishing

### Build and check tasks in VS Code

`Tasks: Run Task` offers three entry points. `Tasks: Run Build Task`
(Cmd+Shift+B on macOS) starts `build` by default. The tasks contain only
script calls. The three scripts under `build/` can also be started from another
working directory; they need Bash and the installed pnpm.

| Task | Script | Purpose |
| --- | --- | --- |
| `RAgents: build` | `build/build.sh` | Build the agent runtime, built-in plugins, web, and homepage |
| `RAgents: check` | `build/check.sh` | Complete project check including the homepage |
| `RAgents: open homepage` | `build/homepage.sh --open` | Build the homepage and open it in the default browser (macOS) |

`pnpm build`, `pnpm check`, and `pnpm open:homepage` use the same workflows.
`pnpm generate:homepage` calls `build/homepage.sh` without an option, `pnpm check:homepage`
uses `--check`. Every workflow aborts at the first error; a failed
homepage build does not open a browser. What is opened is the static export under
`docs/homepage/dist/index.html`. The reference check reports outdated files without
overwriting them; that is why it comes before the web build in the complete check. The package checks
and the run through distribution, `connect`, and startup (`scripts/remote/connect-start.test.ts`)
run afterwards, because the package and the fetched version need the host's built web. Not in the
complete check, because it needs `npm install` against the registry: `pnpm check:package` installs
the built package into its own prefix, builds a foreign plugin from it in an empty folder including
type checking, and starts it with its own profile.

For targeted work, `pnpm build:agent`, `pnpm build:web`, `pnpm lint`, and
`pnpm test:engine` remain available. They call the respective tools directly. Further
individual checks run through the workspace packages, for example `pnpm --filter @ragents/host test`
or `pnpm -r typecheck`. After a fresh clone, individual checks require the installed
dependencies and one run of `pnpm build:agent`. `pnpm check:remote-workspace` checks the workspace on another machine
with a Linux container (below, "Testing a workspace on another
machine"); it
is not part of `pnpm check`, because it needs Docker.

### Shared web entry points

`apps/web/index.html` loads `src/main.tsx` for browser runs and VS Code run/app frames.
The host build emits the same HTML as `run-panel.html` for the iframe host contract; the server
verifies that both pages match. Both routes share access, theme, host modules, and `RunPanelApp`.
Start, Runs, and the run belong to this server in both hosts, including its plugin header before
a run opens. The extension selects one environment per workspace and sends navigation to that
server's frame. `src/panel.tsx` binds VS Code messages to the local connection-management and
unavailable-server shell using `panel/PanelPage`.
`pnpm --filter @ragents/web build:panel` builds its JavaScript and CSS, without a separate HTML
page, into the extension. `pnpm --filter ragents-vscode build` includes this navigation build.

After changes run `pnpm build:web`, the package typechecks, `pnpm lint`, and `pnpm check`.
The web suite skips browser cases without `RAGENTS_BROWSER_TESTS=1`; the VS Code stub suite runs through
`pnpm --filter ragents-vscode test`. Browser and VS Code host checks need an environment that
permits browser launches and local listening sockets; report restricted checks explicitly.

### Homepage and generated references

`docs/homepage/index.html` is maintained editorially. The text versions `reference.md` (building blocks
and UI contracts) and `developer.md` (extension points with code examples) are generated from the
neutral sources; they are internal build outputs and not part of the public
export. `guide.html` opens up the
explanatory chapters on getting started, runtime, functions, programs, plugins, and access.
These texts are in the spec chapters as well as in `docs/usage.md` and `docs/operations.md`:
`<!-- guide:<id> -->` and `<!-- /guide:<id> -->` mark the public excerpts.
Several blocks are joined in their source order. Only these excerpts go
into the guide; its generated HTML and Markdown files are not edited by hand.
Chapter order, source files, and links are in `scripts/homepage/homepage-guide.ts`; a
chapter can join blocks from several files of the same folder in the order named there.
After a fresh clone,
this requires, as for the application, `pnpm install` and one run of `pnpm build:agent`.
The header in `index.html` is also the template for all subpages. The shared
layout and sticky behavior are in `site.css` and `site.js`; both files are
exported too. The feature sequence of the main page uses GSAP ScrollTrigger. The local
`scroll-vendor.js` is generated from the pinned GSAP package version through
`scripts/homepage/homepage-motion.ts`; like the reference files, it is generated and checked for being up to date.
The operable mini-app in the main section comes from the reference template `shared-actor-list`.
`scripts/homepage/homepage-mini-app.ts` bundles its original sources with the local adapter from
`docs/homepage/mini-app-runtime.ts`. Do not change the generated files `mini-app.html`, `mini-app.js`, and
`mini-app.css` by hand; the build also copies them into the help.
Menu entries are changed only in the main page and then regenerated; generator,
type checking (`tsconfig.homepage.json`), and tests are together under `scripts/homepage/`:

```bash
pnpm generate:homepage
pnpm check:homepage
```

The same build generates the LLM documentation under `docs/homepage/`: `llms.txt` as a small
index, `guide.md` and `guide-*.md` for the explanatory chapters, `run-setup.md` with complete package examples and the test contract, `run-api.d.ts` with the
generated TypeScript contracts, and `reference.md` and `developer.md` with the remaining contracts
and extension examples. `rpc-api.md` and `openrpc.json` describe the shared
JSON-RPC API from its actual contracts. Give an external model the `llms.txt`; for a run setup, the
setup guide and the API linked there are enough at first. These files are generated, not edited
by hand. New tools, result types, and package files appear with the next build.
The generated reference describes showcase, not private profiles or individual run permissions.

The homepage build also generates `docs/homepage/dist/`. For static hosting, the
contents of this folder are uploaded, including JS, CSS, and screenshots if any. That is exactly
what the GitHub workflow `.github/workflows/homepage.yml` does: on every push to `main` (and by
hand through "Run workflow") it installs the dependencies, builds the agent runtime, generates the
homepage, and publishes `docs/homepage/dist/` through GitHub Pages at
https://schlenkr.github.io/RAgents/. A one-time prerequisite is the source "GitHub Actions" in the repository settings
under Pages. The README links this address.
No backend is required for this; hosting under a subpath is possible too.
Links within the website stay relative, links to source code and repository documents
lead to GitHub. Previews, generator sources, and private files are not part of the export.

`pnpm build:web` regenerates the homepage automatically and copies the same export to
`apps/web/dist/help/`; `pnpm build` already includes this step. The question mark next to
Settings opens `/help/index.html` in a large modal dialog. Close or Escape
returns to the application; external source links open a new tab. In Vite development mode,
`/help` is forwarded to the configured server like the API and shows its last build.

The second command checks generator types, guide excerpts, the exclusion rules, local page
and jump targets, and that a rebuild produces no changes;
it is also part of `pnpm check`. If outputs differ, regenerate the reference. New
extension points need an example in `scripts/homepage/homepage-extensions.ts`; coverage
is checked against the actual contracts. UI demos are maintained as a source in
`docs/homepage/reference-ui.tsx`, their props come from the public UI contract.

Tool discovery composes only the neutral plugins from the literal
core list in a separate process with its own temporary storage and a fixed
test configuration. It starts no lifecycles, models, tools, or runs. The real
profile configuration is not executed. Private product names and local paths in the
outputs abort the generation. The finished pages need only their local JS/CSS
files.

### Checking concept against implementation

`scripts/maintenance/concept-audit.fsx` is an external developer tool for a read-only comparison
between the public guide and the neutral code including tests. It needs the .NET 10 SDK with F#
Interactive and loads `Microsoft.Agents.AI.OpenAI` version `1.20.0` through NuGet. The
model connection goes through OpenRouter; the key comes from `OPENROUTER_API_KEY` in the
environment. The script does not read any shell configuration.

The public guide must already be generated (`pnpm generate:homepage`). Parameters and the file
corpus can be checked without a model call; this creates the source manifest and
`status.json` with the status `dry-run`:

```sh
dotnet fsi scripts/maintenance/concept-audit.fsx -- --dry-run
```

The normal call uses `z-ai/glm-5.3`. A question and limits can be set explicitly:

```sh
dotnet fsi scripts/maintenance/concept-audit.fsx -- --focus "Do the function selection and the documented permissions match?" --max-calls 60 --timeout-seconds 900
```

For duplicate implementations, the same script uses three code reviewers for interface/CSS,
runtime, and plugin boundaries plus a synthesis. This mode needs no guide
and also covers product-specific plugins; excerpts that are read go to the chosen
model provider. The report names both implementations, consequences, and a shared replacement.

```sh
dotnet fsi scripts/maintenance/concept-audit.fsx -- --duplicates --reasoning-high --model z-ai/glm-5.3 --max-calls 24 --timeout-seconds 900
```

`--reasoning-high` explicitly sets `reasoning.effort` to `high` in the OpenRouter request.
`--model` selects a different model, `--repo` a different repository. `--output` must name a new
folder outside the repository; without it, a temporary folder is created.
The defaults are 60 model calls and 900 seconds per agent. These limits apply in total,
including possible result corrections. The same time limit covers the network exchange.
Model requests allow up to 16000 output tokens. The last permitted model round
blocks further tool calls and requests a report from the sources already read.
`--endpoint` changes the API address, by default `https://openrouter.ai/api/v1`; `--help` shows all options.

The console shows timestamps and understandable role names: guide reviewer, code reviewer,
boundary reviewer, and synthesis. It reports phases, search terms and matches, files read
with line ranges, and the number of every model call. During a longer wait,
a waiting message follows after 20 seconds. The conclusion names duration, number of calls, and result folder.

Three independent roles read separately: `guide-reader` only the generated `guide*.md`,
`code-reader` and `boundary-reader` neutral code and tests. The subsequent synthesis
can verify evidence with the same read and search tools. The last
model response counts as the result; intermediate comments are not concatenated with it. The synthesis gets a
JSON schema for `assessment`, `findings`, and `openQuestions` in concept mode. In
duplicate mode, the prompt requests these JSON fields; during tool use the
response format stays free, so that GLM does not output the tool calls as JSON text. Even with
empty findings, the assessment explains which reviewer hints were discarded and why. The synthesis must itself
read a comparison source, in concept mode from the guide. Field types, required details, and source evidence
are checked before the report. Invalid final responses get up to two
correction requests in the same agent session; after that, an invalid result remains
an error. Existing read accesses and the shared call and time limits are preserved.
Contiguous excerpts that were read may together cover one piece of evidence; an unread
gap is still rejected.

If only the synthesis fails, `--resume <previous output folder>` takes over the three
stored reviewer reports and read accesses. Only the synthesis runs again; it
gets a new call and time budget. Source list, file contents, focus, and audit mode
must be unchanged, otherwise a new audit is needed. The results are again created in
a new folder; the original check run is preserved.

After a successful model run, the output folder contains `report.md`, raw responses per role, call and usage data, and
`manifest.json`, `status.json`, and `coverage.json` with the actual read accesses.
`<role>-attempt-N.txt` and `<role>-attempt-N-usage.json` keep every attempt. `<role>.txt`
contains the last response; `<role>-usage.json` sums model calls and usage over
all attempts of this role.
On a resume, `manifest.json` refers to the previous check run under `options.resume`;
its usage data stays there and is not counted as new model calls.
The report is a limited check, not a claimed full scan. The tool changes neither
the spec nor the implementation automatically and starts no RAgents runs.

`python3 scripts/maintenance/concept-audit.test.py` checks the workflow with the real Agent Framework against
a local test endpoint. No API keys or external model calls are needed for this.

### Publishing, developing, and testing the VS Code extension

`pnpm publish:vscode` starts the same all-channel release as `pnpm release`; it never publishes
the extension alone. The local publisher uses `AZURE_DEVOPS_VSCE_RAGENTS_PAT`, an Azure DevOps PAT
with Marketplace publish access for `purestate`, passed only to vsce as `VSCE_PAT`.
The publisher must exist at
https://marketplace.visualstudio.com/manage under the account that owns the token.
`vsce verify-pat purestate` checks it before publication. The pinned `vsce` version is in
`scripts/vscode/publish-extension.ts` and runs through `pnpm dlx`.

`pnpm package:vscode` builds and packages locally without a token or version edits. What goes
into the `.vsix` is in `apps/vscode/.vscodeignore`: `dist/` (without source maps and test runners),
`media/`, `package.json`, `README.md`, `CHANGELOG.md`, and `LICENSE`.

Seven files are packaged into `dist/`: a universal `ragents-vscode-<version>.vsix` without
Bash and rg, and one each for `win32-x64`, `win32-arm64`, `darwin-arm64`, `darwin-x64`, `linux-x64`,
and `linux-arm64` (`vsce package --target`), which additionally carries ripgrep under `dist/rg/<platform>`,
the two Windows files also the bundled Bash under `dist/bash/<platform>`. The
Marketplace delivers each machine the file for its platform, all others (such as Alpine or
linux-armhf) the universal one; `vsce publish` gets all seven in one call. For the
platform files, the script writes its own ignore file per run into the temp folder: the
allowlist of `.vscodeignore` plus `!dist/rg/<platform>/**` and on Windows
`!dist/bash/<platform>/**`; the `.vscodeignore` in the repo stays the universal one. Packaging lists
the shared contents once, per platform the number of files under its folders, and aborts
if a platform file does not carry its folder or carries another platform's.

`pnpm bundle:rg [<platform> ...]` builds ripgrep (`scripts/vscode/bundle-rg.ts`; packaging calls it
itself): per platform it downloads the archive of the pinned ripgrep version from GitHub
(version, target, and SHA-256 as constants in the script; on Linux the statically linked
musl version), checks the hash, reads ZIP and tar.gz in memory, and places
`rg` or `rg.exe` unchanged into `apps/vscode/dist/rg/<platform>/`, with the license texts
`COPYING`, `LICENSE-MIT`, and `UNLICENSE` under `licenses/` and a `NOTICE.txt` with the source archive
and hash. The archives stay under `<tmp>/ragents-rg-cache`; `scripts/vscode/bundle-rg.test.ts`
builds from this cache without network and is skipped without it. A new ripgrep version means:
change `RIPGREP_VERSION` and all six hashes (from the release's `.sha256` files and recomputed
yourself) and run `pnpm bundle:rg`. Started from the checkout, the
extension finds rg only if it is built for its platform (`pnpm bundle:rg darwin-arm64`); otherwise
the Bash uses an rg from `PATH`, if there is one.

`pnpm bundle:bash [win32-x64] [win32-arm64]` builds the Bash itself
(`scripts/vscode/bundle-bash.ts`; packaging calls it itself): it downloads the pinned
PortableGit archive of Git for Windows (version, file names, and SHA-256 as constants in the script),
checks the hash, unpacks it with 7-Zip (`7zz` or `7z` on `PATH`, otherwise an error with
installation instructions), and copies a fixed list of programs together with the DLLs they load.
The script determines this closure itself from the import and delay-import tables of the PE files
(`scripts/vscode/pe-imports.ts`); a DLL that is neither in `usr/bin` nor a
Windows system library aborts the build, as do Git, Perl, editors, SSH, GnuPG, OpenSSL,
or a terminal program in the selection. Added to this are `etc/fstab`, a custom
`etc/nsswitch.conf`, the license texts under `licenses/`, and a `NOTICE.txt` with the source archive,
package versions, and source references. The archive stays under `<tmp>/ragents-bash-cache`;
`apps/vscode/dist/` is not checked in. A new Git for Windows version means: change the tag, file names,
and both hashes in the script and run `pnpm bundle:bash`. Anyone starting the extension on
Windows from the checkout builds the Bash once beforehand with `pnpm bundle:bash win32-x64`.
`scripts/vscode/install-local.sh`, like the Marketplace, installs the file for its own platform
and the universal one only without it. `scripts/vscode/publish-extension.ts` copies `README.md` and `LICENSE` from the root
next to it for the `vsce` call and removes the copies again afterwards. The Marketplace README and the GitHub README
thus have the same source.

Setup for developing:

1. `scripts/start-vscode.sh core` (also another profile or a server address)
   starts the server if needed, builds the extension, and starts a separate VS Code instance with
   it and the repo as the folder, with an entry for this server;
   layout and sign-in of this instance stay under `~/.local/share/ragents/vscode`. Alternatively F5
   with your own `.vscode/launch.json` (not checked in), type `extensionHost` with
   `--extensionDevelopmentPath=${workspaceFolder}/apps/vscode`, `outFiles` set to
   `${workspaceFolder}/apps/vscode/dist/**/*.js`, and `preLaunchTask` `vscode: build`.
2. `pnpm --filter ragents-vscode build` builds `dist/extension.js` (esbuild, CommonJS) and
   `dist/webview`, `watch` does the same continuously. The tests' stub is the server's real
   transport; so that its modules can be loaded, `apps/vscode/tests/` is an ESM folder through its own
   `package.json`, while the bundled extension stays CommonJS.

Testing: `pnpm --filter ragents-vscode test` runs without VS Code against a stub server and
is part of `pnpm check`; `RAGENTS_HOST_TEST_SERVER=http://localhost:4710 pnpm --filter
ragents-vscode test:host` starts the installed VS Code with a temporary user folder
against the running server (at least one run with a mini-app, such as the collection board from a
server with the `showcase` profile) and checks
connection, run panel, run switching, and a mini-app in the center; `RAGENTS_HOST_TEST_LOGIN=id:password`
or `RAGENTS_HOST_TEST_TOKEN=<token>` check sign-in.
`RAGENTS_HOST_TEST_WORKSPACE=<folder>` additionally checks a run on the workstation,
`RAGENTS_HOST_TEST_SECOND=<address>` a second server alongside: both connected at the same time, the
selected server's Start page, environment switching, the workstation registered with both servers,
a click on a template, the way back to the same Start page, deleting a run, a new empty run,
and a disconnect that affects only one. `RAGENTS_HOST_TEST_VSIX=<path>` checks the packaged
extension instead of the checkout: the runner unpacks the file into its user folder and
loads `extension/` from it, that is, exactly what is also installed - without `node_modules`
next to it. With `RAGENTS_HOST_TEST_SETTINGS=1` the runner checks the settings page without
a host path; if `RAGENTS_HOST_PACKAGE_SPEC=<path to the .tgz>` is added, the extension fetches
its host from this file instead of from npm and starts the local profile from
`RAGENTS_HOST_TEST_PROFILE` with it. The override exists only for this test; in everyday use the
specifier is always `@schlenkr/ragents@<version>`. Without VS Code, `apps/vscode/tests/extension-bundle.test.ts` checks the same on a small scale: the
built `dist/extension.js` lies in an empty temp folder, and a child process calls `activate`
with a stub `vscode`.

### Building and publishing the package

The package is built from what the host actually loads; the build determines the dependencies
from the imports of the included files, the packages that an executor contribution resolves from
the host with `hostPackageFile`, and the libraries that the actor programs link at
runtime. If a package exists in the checkout in two versions, the package names one of them
and the build says which.

A local build uses the root `package.json` version; CI supplies the shared release version.
`pnpm build:package --pack` also writes the npm tarball. Platform packages reuse `bundle-rg.ts`
and `bundle-bash.ts`; their `os`/`cpu` constraints select the user's platform. To assemble their
folders locally, run `pnpm --filter @ragents/host exec node --import tsx ../../scripts/package/tools-package.ts`
(optionally followed by target names). Publishing goes through the shared release below.

### Releasing all channels

`pnpm release`, `pnpm publish:all`, `pnpm publish:package`, and `pnpm publish:vscode` all run the
same local release command. Every release contains the host and six tool packages on npm, the
universal extension and six platform VSIX files in the Marketplace, and six standalone archives
with checksums and installers in GitHub Releases.

```sh
pnpm release --dry-run          # inspect the version and source without edits, builds, or publishing
pnpm release                    # build every target, then publish every channel locally
pnpm release --version 0.1.21   # resume saved artifacts, or build this exact version
```

Publishing uses the existing local credentials: `npm_key` for npm,
`AZURE_DEVOPS_VSCE_RAGENTS_PAT` for the Marketplace, and the GitHub CLI login for releases.
No repository secrets are needed. Credentials go only to their publishing child processes;
they are not sent to the native build workflow.

A new release requires a clean checkout whose source commit is already on GitHub, so all native
builders use the same source. The command never commits or pushes. It selects one stable X.Y.Z
version above the versions published on npm, in the Marketplace, and in GitHub tags or reserved
releases, or uses a higher local version. `--version` keeps an explicit version. The build sets
the root version, extension version, and extension host-package version in its own checkout.

`.github/workflows/release.yml` only builds and checks. The local command starts it with the
fixed version, source commit, and a unique request identifier, waits for exactly that run, and
downloads its complete artifact set. The workflow prepares npm packages and VSIX files, then
assembles and tests archives on Windows, macOS, and Linux, each x64 and ARM64. A manually started
workflow also only builds; it cannot publish. Local `--dry-run` prints the plan without starting
GitHub Actions or modifying files.

After all builders succeed, the local publisher verifies the artifacts and reserves them with
a checksum manifest in a draft GitHub Release. It publishes the tool packages before the npm
host, then every Marketplace variant, then makes the GitHub Release public. A failure can leave
npm or Marketplace temporarily ahead: the services do not share a transaction. Run the same
version with `--version` to resume from the draft's original source and artifacts without
rebuilding; the current working tree is not part of that retry. Existing npm packages must match their saved integrity; already published VSIX
targets are skipped. Do not start a new version to repair a partially published release.

### Standalone archive builds

For a local build on the current platform:

```sh
pnpm build:agent
pnpm build:plugins
pnpm build:web
pnpm prepare:release
pnpm build:standalone
```

`scripts/release/prepare-release.ts` writes `dist/release-input`: the host, six tool tarballs, and
one dependency lock shared by all native jobs. It also writes the seven registry-ready npm
tarballs with their integrity metadata to `dist/release-publish`. It requires npm, network access, and 7-Zip for the
Windows Bash packages. `build-standalone.mjs` downloads the Node.js distribution pinned by version
and SHA-256 in `node-runtime.json`, uses its npm to install from that lock on the current platform,
and writes `dist/releases/ragents-<version>-<platform>-<arch>.tar.gz` (Windows: `.zip`). All native
dependencies are installed on their target OS and architecture. Archives include Node's license
and dependency licenses. Linux builds target glibc; external development SDKs stay outside them.

The builder extracts its finished archive into a fresh folder before checking it. The check uses
the bundled runtime to execute the launcher, platform tools, TypeScript/esbuild plugin build,
and a temporary host on port 0 with isolated data and no model calls; it checks RPC, web assets,
and Tailwind CSS, then stops its own processes. The temporary test profile disables the process
sandbox; it executes no model work and does not test sandbox isolation.
`pnpm check:release` exercises launchers and
installers with local release fixtures, including upgrades and failures that preserve the active
installation. It also runs in `pnpm check`; native Windows installer tests run on Windows runners.
Installation instructions are generated into the public guide from `docs/operations.md`.

### Real browser test

The targeted real browser test starts only a short-lived local fixture and writes to
temp: `RAGENTS_BROWSER_TESTS=1 PRODUCT_PROFILE=core pnpm --filter @ragents/host exec node
--import tsx --test tests/browser-live.test.ts`. `BROWSER_EXECUTABLE_PATH` can be set as an
environment variable for this call. The regular server checks contain the
browser contract and lifecycle tests; the real browser test needs the explicit flag.

### Testing a workspace on another machine

Whether a run really works on another machine is checked by `pnpm check:remote-workspace` on
a Mac with OrbStack or Docker Desktop. A Linux container is the other machine: its own
file system, its own process table, its own `localhost`, a different platform; inside it,
`ragents workspace-client` from the built package runs as the workstation of `alice`. The server runs on
this machine with `--port 0`, its own data folder under `/tmp`, and a test profile with `alice`,
`bob`, and `admin`; instead of a language model, a scripted model drives the tools, without cloud and
without randomness. The runner writes one line per check: `ok`, `FAILED` with the cause, or `--`:
sign-in and visibility of the workstation, binding, `bash`, `read`, `write`, and a binary
attachment in the container, `typescript_eval` in the server's folder, system prompt with the platform and folder
of the workstation, an actor program and a skill through the server's roots (`@actors`,
`@skills`) including Bash with an alias on the server, the Files tab, process display and termination, permissions of `bob` and `admin`, the
emergency stop including cleanup on both machines, disconnecting and re-registering, and a stop while the
container has no network that takes effect after it returns. Switches:
`--shared-path` also creates the same path with different contents on this machine (instead of
`/work/project`, which must not exist here), `--browser` opens a page with `browser_navigate`
that runs only on `localhost` in the container, `--vscode` additionally runs the extension's host test
in its own VS Code window against the same server. The runner ends only what it
started itself: server and VS Code launcher by their own PID, containers and images only
by their labels, processes of this machine only with a run marker of its server or its
session marker; the next check run cleans up leftovers of an aborted one at its start. The first
image build needs network (Node image, npm, with `--browser` Chromium from Debian); after that these
layers come from the cache, and only the package is rebuilt. After a failure, the
logs stay under `/tmp/ragents-rwc-logs-<session>`. Details are in
`scripts/remote-workspace/README.md`.

## For AI assistants

The owner is SchlenkR. He works on several machines; do not rely on a
session memory. Everything a new session needs to know is in the repo, namely here and in
the following files. `AGENTS.md` and `CLAUDE.md` are only pointers here, for Codex and
Claude Code; they get no content of their own. The `README.md` at the root is the
GitHub entry point and not a source of rules.

### Required reading in this order

1. `docs/spec/overview.md` - guiding principle, terms, layers, course (consolidate instead of expanding;
   security secondary; no migrations), and the binding rules.
2. The spec chapter for the task: `docs/spec/core.md` (run, actor, turn, event, journal),
   `typescript-platform.md`, `actor-programs.md` (actor programs, mini-apps), `plugins.md`
   (contract, folders, web host, language servers, skill templates), `profiles.md` (profiles,
   configuration).
3. `docs/decisions.md`, the topmost entries - what changed most recently and why.
4. `docs/usage.md` - usage in the web, run panel, VS Code, and by agents and external clients;
   `docs/operations.md` - operations (installation, startup, access, package, distributed work,
   data storage).
5. `TODO.md` and `docs/concepts/` - open work, ideas, and worked-out concepts.
6. `selftest/LOG.md` - what the self-improvement rounds have found and which
   error classes are already fixed.

### Documentation: three places, one rule

The spec says what is, valid for the current code. A concept says what is not yet.
Nothing is both; a concept does not survive its implementation.

- `docs/spec/`: one chapter per topic, always true for HEAD, every chapter ends with "Open
  limits". Binding lists (events, plugin contract, schemas) are only in the code.
- `docs/concepts/<topic>.md`: what is not yet, with a status line Idea, In progress, or
  Rejected. "Implemented" is not a status.
- `docs/decisions.md`: the why, dated, newest first; every entry names the chapter it
  changed. No second spec.
- `TODO.md`: inbox for everything, sections "Open" and "Ideas", one line per entry, new at the top.
  Open work is only there; the spec's "Open limits" name permanent limits and
  do not repeat any TODO entry.
- Language: everything in the repository is English - spec, `docs/usage.md`,
  `docs/operations.md`, `docs/decisions.md`, `TODO.md`, `docs/concepts/`, this handbook,
  `README.md`, the homepage, UI texts, CLI output, error and log messages, prompts, tool
  descriptions, strings, code comments, tests, test data, and names. The sections between
  `<!-- guide:<id> -->` and `<!-- /guide:<id> -->` in the spec, `docs/usage.md`, and
  `docs/operations.md` become the homepage guide; a guide block covers whole sections including
  their heading. The guide quotes interface texts exactly as the interface shows them.
- `docs/usage.md`: usage, that is, what a user or an agent acting as a user sees and does.
  `docs/operations.md`: operations, that is, installation, startup, access, package, distributed work with
  server, workstation, and run transfer, Windows, and data storage. Contract and mechanics are in the
  spec, build, checks, and publishing here in the handbook; `usage.md` and `operations.md`
  refer to them instead of repeating them. `README.md`: the short entry point for GitHub and
  at the same time the extension's README in the Marketplace, with installation, getting started, and links, without
  domain details. `docs/development.md`: handbook for development and AI assistants, this file.
- `docs/homepage/index.html`: the product homepage for users, a handwritten static
  page (canvas scenes and styles inline, installation in `homepage-install.css` and
  `homepage-install.js`, shared navigation in `site.css` and `site.js`). Texts are short, direct sentences
  that say what you can do; no slogans, no mirrored sentence pairs, no invented
  features, planned things are marked as "Planned". Diagrams explain principles with general
  roles (agent, script, mini-app, server, laptop) instead of concrete example workflows; every scene has
  its own visual language. Scroll animations are tied directly to scroll progress (without smoothing,
  without overshoot). Usage details (buttons, spacing, pixel sizes, storage locations) belong in
  `docs/usage.md`, never on the main page. Screenshots on the main page show
  real runs with neutral example data; browser tests write their screenshots to the system
  temp directory (`ragents-browser-shots`), never into the repository. Private product names and integrations do not appear
  on the public pages. No external runtime resources. The generator does not check the content
  of the main page; it only takes over its header for the guide pages.
- `docs/homepage/guide.html` and `guide-*.html`: generated guide for getting started, way of working, and
  development. Maintain texts only in marked public sections of the spec,
  `docs/usage.md`, and `docs/operations.md` (`<!-- guide:<id> -->` to `<!-- /guide:<id> -->`), no second
  text copy. Chapters and presentation in `scripts/homepage/homepage-guide.ts`; build, export, and help
  use the same generator. New content must hold in the showcase profile, from which the help
  is generated.
- The public export under `docs/homepage/dist/` contains only the product page, the guide, and the
  conceptual mini-app. Generated technical files such as `reference.md`, `developer.md`,
  `llms.txt`, `rpc-api.md`, and `openrpc.json` remain internal build outputs and are not
  published. The executable sample previews are not part of the public export either.
- UI drafts are not committed: they are made locally for comparison, and the chosen direction
  goes into the spec.
- There are no other places.

How to document your work:

1. If you change behavior, you bring the affected spec chapter up to date in the same commit.
   The spec describes the current state, not history.
2. Add a dated entry at the top of `docs/decisions.md`: what, why, which chapter.
3. What remains open becomes a line in `TODO.md`. You delete completed lines.
4. If an idea needs more than three sentences, it gets `docs/concepts/<topic>.md` with the status
   Idea; the TODO line disappears. Once the concept is implemented: adjust the chapter, add an entry in
   `decisions.md`, delete the concept file.
5. No new documents alongside, no handover files. What a next session needs
   is in `TODO.md` and `decisions.md`.
6. If what a user sees or can do changes (tabs, start screen, surface, a
   capability, a skill template), you update the affected section of the homepage in the same
   commit; you retake outdated screenshots or remove them. The homepage
   promises nothing that does not run in core. At most one sentence goes onto the main page;
   the detailed usage belongs in `docs/usage.md`, from where the guide
   takes it over. A new core feature gets a section on the main page and its
   guide chapter in the same commit.

### Working

- Local server: the owner starts it HIMSELF with `scripts/start.sh <profile>`. Do not start a background instance, touch runtime data only on request. Occupied
  ports abort startup; do not look for replacement ports or terminate other instances. After
  web changes, run `pnpm build:web` and say "restart needed"; server changes take effect only
  after a restart. Exception: files that the server loads per call as `new Worker(...)` (such as
  `packages/ragents/src/typescript/compiler-worker.ts`) take effect immediately - a change to the
  worker protocol breaks running runs, so change it only while the server is stopped.
- The secret `OPENROUTER_API_KEY` comes from the shell environment: extract it from the
  startup file with grep, NEVER source the shell's startup file.
- Hand busywork (generation, assembling pages, check runs) to subagents; the large
  model scopes and decides. Subagents get target folders in the scratchpad.

### Rules

- NEVER commit, push, or deploy without the owner's explicit permission.
- The file storage stays isolated per run; taking a finished run over into a
  real project is the owner's job.
- No personal names in docs, decisions, self-test, and tests: requests as a requirement or with
  "the owner", test users neutral (`alice`). Names appear only in `LICENSE`, the `author` fields,
  and in the license section.
- Everything is English: file, folder, and identifier names as well as prose, strings, prompts,
  comments, and tests.
- Minimal comments (at most 1 line), only characters of the German keyboard (no arrows or
  typographic characters).
- No silent fallbacks: missing prerequisites are hard errors.
- Old or damaged journals lock only the affected run and report the cause. They
  must block neither the server start nor other runs; keep the original files.
- Generalize only once there are two real users; always finish removals completely.
- Document as above: spec chapter, entry in `docs/decisions.md`, the rest in `TODO.md`.
  There are no other storage places.
- Models do not copy anything: tool contracts must never require an LLM to reproduce hashes, tokens,
  IDs, paths, or file contents from earlier outputs - always resolve on the server side
  or work by reference.
- Tool results stay lean: only what the model does not have yet. No echo of the input,
  no whole state after a change, no immutable catalogs, no
  server bookkeeping (event envelopes, hashes, absolute paths, durations), open-ended output with
  a small limit, also per line. Details in the plugin guide, section 9 in `docs/spec/plugins.md`.

## Further reading

- `docs/spec/` - the spec: what is, one chapter per topic, entry point `overview.md`
- `docs/decisions.md` - the why: dated decisions, newest first
- `docs/usage.md` - usage: web, run panel, VS Code extension, global coordinator,
  usage by agents and external clients
- `docs/operations.md` - operations: installation, startup, access, package, server and workstation,
  run transfer, Windows, data storage
- `skills-for-agents/ragents/SKILL.md` - the short guide that a foreign AI agent loads to
  start RAgents locally and have it program a project
- `docs/concepts/` - what is not yet, one file per concept with a status line
- `docs/homepage/index.html` - the product homepage for users, published at
  https://schlenkr.github.io/RAgents/: what you can do, with a scroll sequence for the
  core features and static sections on teams, plugins, external control, and access;
  maintained with the spec
- [Guide](homepage/guide.html) - getting started, architecture, access (web and VS Code), distributed
  work, model context, programs, plugins, and permissions; generated directly from public
  sections of the spec, usage, and operations
- [Plugin guide](homepage/guide-plugins.html#plugin-guide) -
  choosing the execution form, connecting domain contracts and prompts, checking lifecycle and usage;
  the underlying findings are in `docs/spec/plugins.md`
- `docs/homepage/llms.txt`, `run-setup.md`, `reference.md`, `developer.md`, `rpc-api.md`, and
  `openrpc.json` - internal generated text and API references, not part of the public website

## License

RAgents is licensed under the PolyForm Shield License 1.0.0: using and operating it is allowed, also
commercially, as are modifying and distributing it; it is not allowed to offer a competing product
or a competing service with it. The complete text is in `LICENSE`,
the copyright holder is Ronald Schlenker.
