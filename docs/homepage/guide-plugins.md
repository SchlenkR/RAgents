# Plugins and skills

Choose the right plugin form, connect contracts and prompts, and verify lifecycle and UI behavior.

## Core boundary

A plugin bundles a workspace capability such as file access, questions, or actor programs. It
can contribute functions, prompts, skills, services, and an interface. A profile selects which
plugins load together. The core provides `PluginHost` and typed registries but knows no
product-specific integrations, tools, or tool shapes. Anything a plugin needs from the user is
carried in a payload opaque to the core and rendered by that plugin (`docs/spec/core.md`, Pending
actions).

A function is one callable plugin action. A skill is guidance for a model, with an optional
starting task and supporting files. A run script is executable TypeScript that builds a prepared
run. These contributions can live in one plugin but serve different purposes.

Snippets and actor programs use the same registered typed run functions. The host derives the
TypeScript API and explicitly native agent tools from them. Agent hooks resolve for a particular
run and agent: one runs before every model call and may add a hidden note, the other after every
tool call and may replace its result; the agent runtime behind them is not part of the plugin
contract. HTTP routes, UI contributions, and host-wide services remain plugin facets outside an
individual agent.

## Plugin guide

Start with the domain result and the state that people and models need to share. Then choose the
smallest existing plugin form that fully supports the task. These strategies use the current
functions, actor programs, language servers, and interfaces; they add no new mechanism.

| Need | Suitable form | Boundary |
| --- | --- | --- |
| Reusable domain action or external data access | Typed run function in the owning plugin | One implementation for snippets and programs; keep presentation separate |
| One-off composition of existing functions | TypeScript snippet | No separate actor needed |
| Fixed workflow with later inputs and state | TypeScript actor | Define state and lifecycle explicitly |
| Shared source for instructions and diagram | `WorkflowDefinition` with prompt files | Describes roles, transitions, and freedom; the control program executes and verifies |
| Investigation, conversation, or multi-step implementation | LLM actor with suitable functions | Context and tools must match the task |
| Controls or status for an existing actor | View on that actor | An interface alone does not justify another actor |
| Repeatable prepared run | Run script in the owning plugin | Setup in code, domain decisions in the responsible model |
| Reusable work instructions | Skill in the owning plugin | Describes the approach but does not perform required initialization |

### 1. Keep capabilities and workflows separate

The plugin owns data access, domain rules, configuration, and related guidance. A workflow built
on it decides when to use the capability and where its result goes next, through a registered
function contract or typed service token. General query functions must not open a particular
mini-app or assume its workflow. Removing a plugin should remove its contributions; dependent
plugins declare it through `requires`. The neutral host contains only behavior shared by several
real users. Product paths, account names, and domain selection rules remain in the calling
plugin. A shared host component is justified when several adapters need the same processes,
state, and cleanup, not for a single integration.

### 2. Use one contract for model and interface

A mini-app calls declared actor functions through `context.capabilities.call`. The backend
connects them to existing run functions or domain operations, and a model can perform the same
action. Shared state stays on the server and both paths receive a projection. Credentials and
external query logic belong in the backend. Define input, result, and errors before presentation.
Share schemas where data crosses layers, or verify agreement at the integration boundary. Store
large results and technical cursors with their owner. Models pass understandable references
instead of copying IDs, cursors, or file contents from prior output. Include every context field
needed for the next decision in the result contract.

### 3. Put deterministic work in code and judgment in models

Initialization, querying, validation, storage, and displaying current state are deterministic;
run scripts and functions should perform them directly. Prompting a model to "open the service
first" does not guarantee readiness when the app appears. Required preparation belongs in an
actual setup call. Independent steps can run in parallel; dependencies stay explicitly ordered.
A narrow transformation can use one model request inside a plugin function when no history or
tool loop is needed, but output, timeout, cancellation, uncertainty, and valid empty results need
a verifiable contract. This is a plugin implementation choice, not a replacement for actors.
Use fixed filters only when the domain is equally constrained; if the target already has a read
query language, prefer that contract with shared validation. A separate worker is valuable for a
separate task or context. Configure model and reasoning level for the task and validate them
against the runtime catalog; reusable workflows should not hard-code model names or uniformly
high reasoning.

### 4. Compose prompts by responsibility

A role prompt defines the goal, responsibility, handoffs, and completion criteria. Capability
rules belong to the providing plugin and bind to its actual functions. Short introductory notes
can load initially; detailed contracts and chapters are fetched through `typescript_api` when
needed. Duplicated domain chapters drift and enlarge every turn. Verify composed instructions for
every role, including scripted coordinators and workers. A path in a prompt grants neither read
access nor tools. Remove repetition while preserving responsibilities, boundaries, and sources.

### 5. Build lifecycle into the capability

Starting, loading, ready, failed, and stopped are distinct states. A visible tab or living
process does not prove domain readiness. Report success only after confirmation from the
responsible system, and keep status queries responsive during long startup. Concurrent starts of
the same resource should share one initialization. Stops or task changes invalidate late results.
Propagate cancellation, bound local waiting, and clean up at the owner on run stop, deletion, or
host shutdown. Define what survives restart and what must reopen. Startup failures need a cause
and an explicit retry path; diagnostics must not hide them by silently starting again.

### 6. Present activity and results separately

The runtime knows whether an actor is working; a domain report says what it last worked on.
Combine them without presenting an old report as current activity. Waiting, stopped, and failed
also need understandable presentation. A completed response or screenshot alone does not prove
a successful check. A compact status contract can expose state and work step without raw
reasoning or tool arguments. Grant diagnostic and change permissions independently from full
technical inspection and enforce them on the server. Roles belong in configuration; neutral
components check permissions, not user names.

### 7. Develop mini-apps in the actual host

The iframe constrains interaction, layout, and communication. Use shared controls and the
declared function bridge. For a dialog spanning host areas, the app signals intent through a
function and the owning web-plugin contribution opens it in the correct area. Keep applied server
state separate from unsent input. Unchanged polling responses must not overwrite drafts, and old
responses must not replace newer state. Keep loading and errors visible during actions, and retain
the last valid result after a failed request. Polling must neither overlap nor continue forever
in hidden areas. Test Enter, buttons, focus, narrow tiles, and dialogs inside the real host
iframe; a render test alone does not prove native interactions work there.

### 8. Choose evidence for what it proves

Contract tests verify inputs, state transitions, and errors. Integration tests verify real
registration, prompt composition, permissions, and the UI-to-service connection. Process tests
cover startup, concurrency, and cleanup. Browser tests exercise the mini-app inside its sandbox.
Choose layers whose behavior changed; tests should target failure risks, not restate the
implementation. Simulated model responses prove validation and error handling, not natural
interpretation quality, which needs separate model runs with representative ambiguous requests.
External connections and real projects require live acceptance. Keep test data isolated in
temporary directories and fail visibly when product connections are absent. Build affected
packages and state whether a restart or new prepared run is required.

### 9. Return only what the model does not already have

Every tool result stays in the context of all later turns. A result reports what is new: created
references, facts the call established, and what the next decision needs. It never repeats the
input, neither literally nor as a normalized copy. A changing call returns an acknowledgement or
the change, not the complete state; a separate status function provides the full picture on
request. A query is different: its answer is the requested data, so it returns that data in
full, bounded only by its limit. Catalogs that do not change during a run, such as rule lists,
component lists, or environments, belong in the prompt or behind a lookup, not in every result.
Server bookkeeping nobody asked for stays on the server: event envelopes in an acknowledgement,
hashes, absolute host paths, and timings. A failure names its cause and the next step instead of
forwarding a raw test-runner or stack dump. A query the server can resolve itself, such as a
status group, stays a parameter instead of expanded text the model has to carry along.
Open-ended output such as shell output, logs, queries, and event lists has a small default limit
and a limit per line, puts relevant parts first (errors, warnings, the end of a log), and says how
to read more. Reading unchanged content again returns a short notice instead of the content.
Measure result sizes in real runs; a result that regularly exceeds a few kilobytes needs a
narrower contract.

## Implementation sequence

1. Identify the owner, domain state, and required decisions; inspect existing functions and
   reference programs.
2. Define the smallest complete contract, including errors, cancellation, and permissions.
3. Connect capability and workflow; equip only the necessary model roles and prompt chapters.
4. Add interaction and an observable lifecycle; explicitly prove startup and success.
5. Check and build the affected boundaries, then name any remaining live acceptance work.
6. Update this specification or the relevant neighboring chapter, record the reason in the
   decision log, and carry public changes into the guide.

Contract examples are in the [plugin guide](guide-plugins.html). The guide to
[building mini-apps](guide-programs.html) covers packages, state, and views.

## Plugin contract

A plugin is a source folder named after its ID that keeps both halves and their assets together;
the built-in plugins live under `plugins/<id>/`:

```
plugins/ragents.actor-programs/
  ragents-plugin.json  ID, declared exports, and additional assets
  server/index.ts    server half and runtime-discovery entry point
  web/index.tsx      web half in its own chunk, when present
  contract.ts        import-free contract shared by both halves, when present
  prompt.hbs         assets at the plugin root, alongside prompts/, skills/,
                     run-scripts/, provision.ts
```

`server/index.ts` exports exactly one entry point:

```ts
export const plugin: PluginModule = {
  requires: ["ragents.ask"],           // optional, checked before composition
  create: (host) => ({ manifest: { id: "ragents.actor-programs" }, register: (registration) => { ... } }),
};
```

`create` receives `PluginHost` and creates the plugin instance with its manifest and registration
function. `register` then contributes functions, prompts, services, methods, channels, and other
features through the plugin-bound `PluginRegistration`.

The plugin folder name, meaning the parent of `server/`, is its ID; a different `manifest.id`
causes startup to fail. `requires` belongs in the module contract, not the manifest, preserving
one source of truth. Anything needed beyond the plugin folder is obtained through `PluginHost`,
with services addressed by tokens. There is no special external wiring, and a missing required
service is a startup error.

The server never loads this source folder. `ragents plugin build <folder>` turns it into a bundle
with exactly one entry point, `ragents-bundle.json`, and the profile names that bundle; the
built-in plugins become bundles under `bundles/<id>/` with `pnpm build:plugins`. A source folder
in the profile is a startup error that names the build command.

## Provide functions

A plugin registers functions with `defineRunFunction` and `host.functions`, including a
short `description`, optional `longDescription`, input and result schemas, and implementation.
`label` is the human-readable name. The host derives `context.functions.<name>(input)` signatures
from this data. Snippets and actor programs use the same catalog and execution. Availability and
bound identity apply equally, while a program's `capabilities` limit its installed build.

Every domain function is available through `context.functions` in `typescript_eval`.
`nativeTool: true` additionally exposes it as a native model tool when the model normally must
read its result before taking the next step: browser interactions, domain reports and status,
language diagnostics, `read`, `edit`, `write`, `bash`, `document_write`, `show_document`, and
`browser_view_screenshot`, which can return image pixels only natively. Snippets remain the right
form for calls that combine, filter, or pass results onward, including data queries, management
functions, list results, and values passed from earlier responses without transcription. Native
tools remain callable from snippets. The building-block reference marks them in the catalog and
the system overview calls them direct tools.

The server registers `typescript_api` and `typescript_eval` as native foundation independent of
plugins. Models use them to discover functions and execute TypeScript snippets. The optional
actor-program plugin adds persistent programs and views; removing it does not remove snippets or
other plugin functions. A named `typescript_api` request returns exact declarations, long
descriptions, and attached guidance; the declarations of `context` itself come once through
`context: true`; list and search return short descriptions. Catalog and
signatures come from the live registry, with no second hand-maintained capability list.

Model-facing functions return compact results. Lists and large structures appear only on
explicit request and in reduced form; mini-apps obtain complete state through their own
operations. Observers create an ActorInput only when something changes and name that change;
unchanged intermediate states create no model turn. `ragents.watch` provides neutral watchers
whose wake condition is a TypeScript function body, evaluated without a model.

For a closed input object (`additionalProperties: false`), the engine removes unknown top-level
fields before a native tool runs, records them as `ignoredFields` in `tool.call.started`, and
mentions them in the result. Open schemas pass all fields through. Missing required fields,
wrong types, and unknown fields in nested objects remain errors. Field semantics belong in
TypeBox property descriptions, which appear as comments in generated declarations. Function
descriptions do not name fields. The description-drift test verifies this across all registered
contracts.

Activating, replacing, or removing dynamic actor functions changes the API during a running
turn. Every equipped LLM actor automatically receives names and short descriptions for the
functions available to it, including subagents and the global coordinator. The overview updates
after API changes; schemas and long descriptions stay on demand. Resolution, overview, catalog,
type checking, and execution all use the same current set. `tools: []` leaves an LLM without run
or workspace access and without a function overview. Named selection and grants constrain
availability; choosing a snippet or actor program creates neither a second implementation nor
additional permissions.

## Build and ship a plugin

A plugin written outside this repository takes the same path as a built-in one. The host never
loads plugin sources; it loads finished bundles, and the author builds them. The npm package
`@schlenkr/ragents` carries everything this needs, so an empty folder and the package are enough.

**Source folder.** One folder per plugin, named after its ID, such as `acme.tickets`. It holds
`ragents-plugin.json`, `server/index.ts` exporting `plugin`, optionally `provision.ts` for tools the
plugin installs, `web/index.tsx` exporting `webPlugin` when there is an interface, and assets such
as `prompt.hbs`, `prompts/`, `skills/`, and `run-scripts/` at the root. `ragents-plugin.json`
names the ID, the files other plugins may import (per half, as paths without extension), and
additional assets that go into the bundle:

```json
{ "id": "acme.tickets", "exports": { "server": ["server/contract"], "web": ["contract"] }, "assets": ["templates"] }
```

**Imports.** Host code comes only from the modules of the host API list in
`apps/server/src/host-api.ts`: `@ragents/engine`, `@ragents/host/...`, `@ragents/web/...`,
`react`, `typebox`, and the other entries there. From a host module a plugin imports only the
values the list names; types are free. A library such as `react` or `typebox` counts whole. The
agent runtime behind the host (`@ragents/agent`, `@ragents/ai`) is not part of it: hooks into an
agent's model calls come through `host.agentRuntime`, a single question to a model through
`openRouterCompletionModel` from `@ragents/host/plugin-support/model-completion`, and the
built-in model catalog of a provider through `builtinCatalog` from
`@ragents/host/plugin-support/model-choice`. Another plugin is reachable only through its
declared exports as `@ragents/plugins/<id>/<export>`, and only if its ID is in `requires`; plugins
of the same repository may keep relative imports of such exports. A host module is imported
statically, by name or as a namespace read by name, so that the build checks every name; `import()`
of a host module is a build error. Any other library, such as `lucide-react`, is bundled into the
plugin, CommonJS libraries that `require` Node modules included. A plugin finds its own files with
`pluginFolder(id)` and `pluginAsset(id, name)`, never through `import.meta.url`, `__dirname`, or
`createRequire`.

**Build.** `ragents plugin build <folder...>` type-checks the plugins and writes one bundle per
folder to `./dist/plugins/<id>`; `--out <folder>` changes the target, and `--watch` rebuilds after
every change without type checks, reading `ragents-plugin.json`, entries, and assets afresh each
time. Each broken rule is a build error with file, line, and cause, and nothing is written for a
plugin that fails. An existing bundle is updated file by file, so a running host never loses its
folder, and parallel builds into the same folder wait for each other. For editor support, a project can extend
`apps/server/tsconfig.plugin.json` and `apps/web/tsconfig.plugin.json` of the host.

**Start.** The profile names the bundle by a path relative to the profile file, next to built-in
plugins named by ID:

```ts
PLUGINS: ["ragents.orchestration", "ragents.workspace", "ragents.product", "./dist/plugins/<id>"],
```

`ragents start <path-to-profile>` starts it. A changed server half needs a restart, a changed web
half only a page reload, new Tailwind classes included. A source folder in the profile stops the
start and names the build command. The host does not check whether a bundle still matches its
sources, so build before starting and before tests.

**Versions.** A bundle records the number of the host API it was built against and every name of
the host API it uses. A host with a different number refuses the bundle and asks for a rebuild, and
so does a host with the same number that lacks one of the names, as an older host may. The number
changes only when the host API changes incompatibly, not with every host release.

**Ship.** A bundle is a plain folder without `node_modules` or native binaries and runs wherever a
host offers the same host API with the names it uses. Native tools such as language servers come through the plugin's
provisioning. To hand a profile together with its bundles to other machines, a server adds
`ragents.profile-distribution`; `ragents connect` fetches the profile and its bundles and starts
them with the local host ([Distributed work](guide-distributed.html)). The client
profile names such bundles relative to itself (`./` or `../`); the client resolves an absolute or
`~/` path on its own machine, so the server refuses it.

## Skills and starting tasks

Skills belong to their plugin under `skills/<name>/SKILL.md`, with supporting files in the same
folder. `SKILLS_DIR` adds local skills outside the repository. Every skill has a `name`,
`description`, and non-empty instructional body. Without `start`, it is available only while
working. `start: true` also makes it selectable and requires a `title` and one non-empty
`category`; `order`, `tags`, and `guide` are optional. `prompt` can provide a short starting task,
otherwise the body is used. Explicit contributions use `action: "skill"`, `skill`, `category`,
and `prompt`, and the skill name must be registered.

A skill's name is its folder name and unique in a profile, across audiences; two folders with one
name stop the server at startup. The model reaches every skill folder read-only as
`@skills/<name>/`, whichever machine the run works on: the skill overview and preloading name
`@skills/<name>/SKILL.md`, never the path on the server, and relative paths in a skill resolve in
that folder. File tools read there, and `bash` runs there with `cwd: "@skills/<name>"`, on the
server.

Optional `disable-model-invocation: true` removes a skill from the model's automatic overview
while keeping explicit loading available. Simple example tasks use it but remain selectable
through `start: true`. Reusable instructions can also provide a short starting task so both stay
in one skill. Clicking shows only the preview; adopting it opens the preparation chat. Parser
tests verify files, starting tasks, tags, and publication, while `reference-run-scripts.test.ts`
checks, tests, and installs every reference package against core.
