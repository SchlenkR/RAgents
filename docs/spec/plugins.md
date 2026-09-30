# Plugins: Contract, folders, and web host

<!-- guide:plugins -->
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
<!-- /guide:plugins -->

<!-- guide:plugins -->
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
| Program several run scripts use | Shared actor package in the owning plugin (`actors/<name>/`) | One actor per run; scripts name it and ensure it, none copies it |
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

A service that trusts a TypeScript actor more than others asks the actor programs service who it
is: `programOf(runId, actorId)` names the package, its revision, and its origin, a shared package
of a plugin, a run script's template, or a package created in the run, and a package changed in the
run counts as created there. Authorize by that identity, never by handle or package name: any
agent with the program functions creates a package under any free name.

### 7. Develop mini-apps in the actual host

The iframe constrains interaction, layout, and communication. Use shared controls and the
declared function bridge. For a dialog spanning host areas, the app signals intent through a
function and the owning web-plugin contribution opens it in the correct area. Keep applied server
state separate from unsent input. Unchanged polling responses must not overwrite drafts, and old
responses must not replace newer state. Keep loading and errors visible during actions, and retain
the last valid result after a failed request. Polling must neither overlap nor continue forever
in hidden areas. Test Enter, buttons, focus, narrow views, and dialogs inside the real host
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

Contract examples are in the [plugin guide](../homepage/guide-plugins.html). The guide to
[building mini-apps](../homepage/guide-programs.html) covers packages, state, and views.
<!-- /guide:plugins -->

## Evidence base for the plugin guide

The rules above carry observed boundaries over to plugins. The following mapping names their
concrete evidence; it is not another contract list.

| Observation | Evidence in the repository | Scope |
| --- | --- | --- |
| Enter and a button failed in the sandbox frame; long status queries exhausted the bridge | `apps/web/tests/actor-view-frame.test.ts`, `plugins/ragents.actor-programs/web/ActorViewFrame.tsx` | Check host interaction and longer use; the restriction applies to mini-app iframes |
| In 25 real runs, half of all tool output sent to models came from 41 calls above 8 KB: the whole state after every change, bash output up to 50 KB from a single minified line, full event envelopes, repeated declarations | `packages/agent/src/core/tools/truncate.ts`, `packages/ragents/src/agents/actor-input.ts` (`toolResultEventOf` redacts only event payloads) | Section 9; applies to every tool and every plugin function |

These findings do not justify a new generic search, model, or polling platform. Shared code
abstractions still emerge only once there are at least two real users.

<!-- guide:plugins -->
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
  executor.ts        contribution to the workspace executor, when present
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
<!-- /guide:plugins -->

### PluginHost registrations

The server-side `PluginHost` has registries for:

- agent hooks (`host.agentRuntime`, section Agent hooks), skill paths, and audiences
- templates (`host.startEntries`): everything a plugin puts on the Start page, in ONE
  contract with `id`, `title`, `description`, `order`, optional `guide` (ID of a web guide),
  optional `tags` (unique search keywords), and the discriminator `action`: `skill` carries the
  registered skill name, a freely named `category`, and the editable starting task
  `prompt`; `script` carries a run script package (`handle`, `coordinator`, optional
  `embeddable` and `sharedPrograms`, `files`, `programs`) that only the server sees. Optionally `fixedStartOptions` fixes start options (option ID to
  value, in a `RUN.md` as the header line `fixed-start-options` with a JSON object on one
  line); a run from this template runs with exactly these values. At startup the host strictly
  checks that every skill is registered, every package is complete, and every fixed start option
  is registered and its value satisfies its schema; the web checks that an active plugin provides
  the guide.
  A product plugin additionally reads `SKILLS_DIR`, so local skills including templates can be
  created without code and without a frontend build
- shared actor packages (`host.actorPackages`): packages with `name` and `files` that the run
  scripts of the profile name in `sharedPrograms` (in `RUN.md` the line `shared-programs: a, b`); a
  folder `actors/<name>/` in the plugin folder registers one. Names are one namespace per run: at
  startup the host rejects a name two plugins share, a shared name that equals a run script's handle
  or one of its bundled programs, and a script that needs a shared package no plugin provides
- typed run functions (`host.functions`) with optional native tool presentation
- named domain operations with an input schema, operator policy, and shared execution for
  several surfaces
- roles and prompt parts
- one run condition per plugin (`host.runCondition(condition)`): a synchronous function of the
  run ID that the plugin provides; the core knows neither product nor tool here. If it does not
  hold for a run, the plugin's run-related contributions are entirely absent there: its prompt parts
  (including chapters on demand and a selected system prompt it registers), its functions
  natively and in `context.functions`, its skills including those from its `skills/` folder, and its
  agent hooks. Services, methods, channels, delivery routes, start options, templates,
  lifecycle, run metadata, web half, and profile catalog remain. The host asks the
  condition on every prompt composition and on every resolution of a run's tools, skills, and hooks;
  it therefore reads a stored decision instead of determining one. If it throws,
  the turn fails with that cause, and the run stays blocked until it answers again.
  A plugin without a condition applies in every run; a second registration is a registration error
  (`RunConditionRegistry` in `packages/ragents/src/plugin-host.ts`)
- methods and channels of the message layer (`host.methods`, `host.channels`, section
  Message layer) as well as delivery routes (`host.http`) for files and frames
- public client configuration; through it the product plugins also publish
  the global chat display policy (`chatSteps` from `CHAT_STEPS_MODE_COORDINATOR/_AGENTS`,
  `_VISIBLE`, `_EXPANDABLE`, `_SELECTABLE`), which the web passes as the at-most-one contribution
  `chatDisplayPolicy` to every step render location; if the product allows it,
  the user switches the level of detail per chat. The browser preference is separated by run,
  actor, and display location: panel and inspector of the same chat
  each remember their own level of detail. Other actors and runs stay unchanged. The policy's
  role values are only defaults; without a product default, `grouped` applies to the coordinator,
  agents, and the global coordinator
- typed services and namespaced storage
- namespaced run metadata
- start options (`host.startOptions`): values the user chooses before the start or a host presets,
  which are frozen into the journal as plugin state when a run starts. An option names a schema,
  default value, `selectable`, `accept` (validates and normalizes a value or throws), and `describe`
  (presentation for the web). The host holds the value per run not yet started through
  `ragents.startOptions.list` and `ragents.startOptions.select`, writes every value at the start as initial
  plugin state under the option ID, and locks it afterwards. An option with `changeable` stays open:
  after the start the host writes its choice to the journal as new plugin state
  (`plugin.state-replaced`; an unchanged value writes nothing), with the same rights and
  the same validation by `accept`, and whoever reads it follows the currently stored value. Every
  call receives in `StartOptionContext`, besides the run, the acting user (`userId`, from the access of the
  respective request, `null` without sign-in): list and choice the user of the request, the defaults
  written at the start the user who creates the run; it is not remembered anywhere.
  Optionally `ownerOnly(value)` declares that a run with this stored value is operated only by its
  owner ([profiles.md](profiles.md), Ownership in detail). Optionally `rights` names rights needed beyond
  `runs.create`, such as `runs.inspect` for an option whose presentation gives
  technical insight: without them the option is missing from the list, the choice (also through `options`
  of `ragents.overseer.createRun`) fails with `access-denied` (403), and at the start its
  default value or the template's value applies. If a run starts from a
  template that fixes start options, its value applies instead of choice and default: `accept` accepts
  it with the user who starts, and a previously chosen differing value, or for a run
  already created a different stored value, is the error `start-option-fixed` (409)
  with template, option, and both values in the message; nothing is silently overwritten. Every state in the list
  says with `chosen` whether someone chose the value before the start (a default is not a choice); with that
  the preparation chat shows the conflict before the start (`conflictingStartOptions` in
  `apps/web/src/StartOptions.tsx`), locks "Create run", and offers to apply the template's
  values. This happens in one
  place in `RunChatSession` for every path with a template: `ragents.chat.start` and
  `ragents.runs.startScript` (run script, also from `pnpm driver`, `ragents run --entry`, and
  `ragents.overseer.createRun` with `script`; in a running run the stored value decides) and
  `ragents.chat.send` with `entry` (skill template, first message from the preparation chat or
  the Start page). The core only knows "this template fixes this option to this value".
  Model and system prompt choice are the
  start options `ragents.model` and `ragents.system-prompt` of the product plugin
  (`plugin-support/product-start-options.ts`); the workspace is the start option
  `ragents.workspace.binding` of the workspace plugin; the engine core reads only the
  system prompt state for prompt composition. The model choice is `changeable`: the host's
  scheduler takes the stored model including thinking level for every turn of the run coordinator
  (`coordinatorSelection` in `apps/server/src/ragents/coordinator.ts`), and the attachment check on
  sending does the same; a switch to a model that cannot process images, videos, or files in the
  coordinator's conversation fails with `model-history-unsupported` (400)
- access projections (`host.accessProjections`): per plugin state ID, what an
  access without `runs.inspect` sees of it. `state(entry)` receives the state including `updatedAt` and
  returns the visible value or `undefined`, in which case the state is missing from the run view; the host keeps
  ID, scope, and timestamp. `chatEvent({ type, payload })` applies to every chat event
  with this ID (a changed state appears in the chat as `state-replaced`) and returns the
  visible event or `undefined`, in which case it does not reach the access. The server applies both
  blindly per ID (`AccessProjectionRegistry` in `packages/ragents/src/plugin-host.ts`,
  called from `apps/server/src/access-projection.ts`) and knows neither plugin nor shape.
  Before that, one rule applies without a contribution: the stored value of a start option whose `rights`
  the access lacks is visible to it neither in the run view nor in the chat; that keeps model and system prompt
  hidden without `runs.inspect`. A state without a projection and without such a start option stays
  unchanged, including that of another plugin that registers none; whoever keeps technical details in its
  state therefore registers a projection. An ID has at most one projection; a
  second one is a registration error. The users are the actor programs
  (`plugins/ragents.actor-programs/server/access-projections.ts`): of a program, name,
  title, actor, revision, and per view ID, key, title, and visibility remain;
  of the call state only `{ version: 1, revision: updatedAt }`, and their chat events are dropped
  entirely
- initialization, run preparation, stop, deletion, and shutdown

A plugin implements only the facets it needs:

```typescript
const documentsPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.documents" },
  register: (host) => {
    host.provide(documentStoreToken, store)
    host.config(...ragentsDocumentsConfigDescriptors)
    host.functions(createDocumentToolContributor(filesFor))
    host.prompts(documentPrompt)
    host.methods(createFilesMethod(files))
    host.http(createFileContentRoute(files))
  },
}
```

An agent hook alone would be too small for a system plugin. TypeScript actors call no model,
and tabs, methods, or projections are host-wide. The plugin bundles these facets, while
its optional agent hooks hook precisely into the agents' model calls.

### Agent hooks

`host.agentRuntime(...contributions)` takes contributions with an ID and at least one of
two hooks; one without a hook is a registration error. Both first receive the agent
(`AgentContributionContext`: run, agent, audience, working directory) and run for every
agent except the global coordinator:

- `beforeModelCall(agent, call)` before every model call of a turn. A returned text
  reaches the model as a hidden note after the conversation history, only for this call;
  the chat does not show it, the journal does not name it, it is not model context. `call.kept` is
  the JSON value this contribution last stored for the agent with `call.keep(value)`,
  also after a host restart: it is in the journal as `plugin.state-replaced` with actor scope under
  the contribution's ID; the model never sees it. After the end of the turn,
  `call.keep` fails.
- `afterToolCall(agent, outcome, call)` after every tool call, with its name and whether it
  failed. A returned result made of text and image parts replaces what the model sees of
  the call; `isError` marks it as an error.

Both see `call.signal` of the running call and `call.modelReadsImages`. The users are the
project check of the actor programs (a note on new or fixed errors, state in
`call.kept`) and the browser's image display (replaces the result of `browser_view_screenshot`
with the capture). A contribution registers no tools; those come through `host.functions`.
The engine binds every contribution to the agent and calls it directly
(`packages/ragents/src/drivers/agent-hooks.ts`); the settings show it under its ID.

<!-- guide:plugins -->
## Provide functions

A plugin registers functions with `defineRunFunction` and `host.functions`, including a
short `description`, optional `longDescription`, input and result schemas, and implementation.
`label` is the human-readable name. The host derives `context.functions.<name>(input)` signatures
from this data. Snippets and actor programs use the same catalog and execution. Availability and
bound identity apply equally, while a program's `capabilities` limit its installed build.

Every domain function is available through `context.functions` in `typescript_eval`.
`nativeTool: true` additionally exposes it as a native model tool when the model normally must
read its result before taking the next step: browser interactions, domain reports and status,
language diagnostics, `read`, `edit`, `write`, `bash`, `document_write`, `show_document`,
`ask_user`, and `browser_view_screenshot`, which can return image pixels only natively. Snippets remain the right
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
<!-- /guide:plugins -->

### Prompt contributions and orchestration guidance

Already stored `actor.tools.opened` events remain readable as historical
journal information; they no longer control function availability. There are no new
open commands.

Prompt contributions distinguish between `initial` and `on-demand` through `delivery`. Without a value,
`initial` applies; the helper `boundToTools` sets tool-bound contributions to `on-demand` by
default. Short notes can explicitly stay initial, such as the mini-app introduction,
the document note, and the workspace rules. The binding checks the functions actually available. Workers also receive matching bound initial notes.
Long detail chapters are rendered only on demand and are not carried into later system prompts.
Whatever reads differently or is missing per run (`renderForRun`, the plugin's run condition) applies
equally to every delivery: in the coordinator's system prompt, in the workers' bound initial notes,
in the chapters on demand, and for the prompt part of the selected system prompts, whose
text the coordinator receives and, with `shareWithAgents`, every worker too. The actor SDK types use the current function contracts; the final build check
narrows them based on the program and its actor.
Mini-apps deliver their complete guide separately through `actor_program_controls` with `topic: "guide"`.

The orchestration guidance requires carrying out tasks yourself by default. Several
languages, files, or steps alone do not justify additional actors. Delegation
requires a concrete benefit of a separate role, its own context, or an
independent subtask, or an explicit request for more participants.
Even in multi-phase work, the actual work steps must be carried out and their
results checked; presentations, advice, and role play do not fulfill a build or
check task. The tool selection follows the task: `tools: []` fits only when
the supplied text is sufficient. An expert or critic who is to check files, verify
diagnostics, or change code needs the matching tools.

After a subscription has been created and a task issued, the orchestration guidance requires
ending the turn without a mere waiting message. Substantial results and actual phase changes
are still reported briefly. Deterministic tasks with durable state are
explicitly named, alongside routing, as a use case for TypeScript actors.

### Web halves at runtime

The host's web is the same for every profile; the web halves come from the server at runtime as bundles,
exactly those of the profile. The method `ragents.plugins.bootstrap` returns, in the
order of the plugin list, per plugin the ID, public configuration, and for a web half
its addresses (`web.entry`, with its own CSS also `web.css`, both under `/plugins/<id>/web/`),
plus the templates (`startEntries`) and `defaultStartEntry` when the profile file names a
default template and the user may start it (`profiles.md`); a script template carries
only `action`, `coordinator`, and the display texts there, never its source. `version` names the
server's RAgents version (the package version, `readPackageVersion` in `host-version.ts`); a
surface with its own version, the VS Code extension, compares it with its own. The shared web entry point
(`main.tsx`) puts every module of the host API's web list into
the registry `globalThis.__ragentsHostModules` (`apps/web/src/host-modules.ts`) before the first bundle; the bundles'
shims read from it, so host and plugins share one React and every context. The web host loads
every entry point with `import(url)` and links its CSS after the host's. A web half that
does not load or does not export a `webPlugin` with its ID does not take the surface down with it: it
appears as a plugin failure with ID, address, and cause above the surface
(`PluginFailureNotice`), the plugin keeps its place in the list without web contributions, and its
server side stays usable. Only if no plugin provides branding afterwards is there no
surface; the message then also names the failed web halves. Bundle and host match through
the host API number and the names used, not through a shared build
(section Bundle, build tool, and host API).

Public plugin configuration also controls the web contributions that are actually active. A
plugin that is installed but disabled for the current configuration stays in the profile for list matching,
but provides neither providers nor tabs or presenters, and its templates are dropped. That way
a domain plugin in an installation without its prerequisites disappears together with its server-side contributions.

### Transcript of an actor

`ragents.transcript` is a pure function plugin without a web half: `actor_transcript` returns
the history of an actor of this run as a compact transcript from the journal, for agents and
TypeScript actors with `event.subscribe`. Inputs, response texts, and tool calls each take
one line, tool inputs and results are shortened to 200 and 300 characters, reasoning
is dropped; when the character limit (default 20000) is exceeded, the oldest lines are dropped
first with a visible omission mark. Intended for handoffs, the coordinator's status reports,
and summaries; it replaces neither a fork nor compaction and is
not included in the review state of the rule review, so that reviewers check the code and not
the implementer's narrative.

## Ownership per facet

Every plugin folder owns the assets and contributions belonging to its capability; a purely
server-side plugin needs no empty web folder. Not every plugin needs every facet,
but an existing facet stays with its owner:

| Facet                     | Owner                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| Prompt                    | `.hbs` in the server plugin that provides the rule or capability          |
| Skill                     | `skills/<name>/SKILL.md` in the owning plugin, including audience and optional starting task |
| Run script                | `run-scripts/<name>/` in the plugin whose capability the run demonstrates |
| Selectable system prompt  | `prompts/<name>.md` or `.hbs` in the product plugin                       |
| API                       | Contracts in `contract.ts`, methods in the server plugin, `rpc.call` in the web plugin |
| UI and CSS                | Components and styles in the matching web plugin                          |
| Configuration             | Declaration and evaluation in the matching server plugin                  |
| Storage                   | `host.storage`, always under `plugins/<plugin-id>`                        |
| View without `runs.inspect` | `host.accessProjections` in the plugin that owns the state              |
| Lifecycle                 | Start, run preparation, deletion, and shutdown at the owner               |
| Provisioning              | `provision.ts` in the plugin folder, in the bundle an export of `server/index.js`; tools in `<data folder>/tools/<plugin-id>/` |
| Contribution to the executor | `executor.ts` (or `executor/index.ts`) in the plugin folder, in the bundle `executor/index.mjs`; runs in the executor of every machine (section Workspace, sandbox tools, and processes) |

Besides `initialize`, `prepareSession`, the stop phases, `deleteSession`, and `shutdown`, the
lifecycle (`host.lifecycle`) has the hook `sessionStarted({ runId, startEntry })`. The host calls
it when a start has provided the workspace and built the first actor, before
any actor receives input, and names the start's template (`{ id, action }` with `skill` or
`script`) or `null` for a start without a template. The start waits for it; whatever takes longer,
the plugin continues on its own. After a host restart it does not come again; a start
repeated after a failure calls it again; whoever may act only once keeps its
marker in the journal. The global coordinator does not get it. The hook knows no tool; what
a plugin does with it is its own business.

The host reads the three asset folders `skills/`, `run-scripts/`, and `prompts/` by CONVENTION from
the bundle folder of every composed plugin (`pluginFolder(id)` in
`plugin-support/plugin-folder.ts`, applied in `profile/compose.ts`). A missing asset folder is not an error; an existing one with broken
content remains a hard error. If a plugin additionally registers the same template or the same skill path
explicitly - for example because it sets an audience in doing so -, the explicit
registration wins and the convention contribution is dropped, in every run: if the
explicit contribution leaves out the path for a run, it does not come back there through the folder.
Assets and code come from the same bundle folder, which mirrors the source folder, so a
plugin lives entirely in its directory.

There is therefore no central collection for product prompts, skills, or plugin configuration.
Removing a domain plugin removes prompt, tools, projection, methods, channels, delivery,
configuration, web tab, CSS, and run data access as one capability. Already
persisted data is not silently deleted by this. Generic helpers for loading
an asset or registering a prompt remain reusable host components and
own no product domain logic.

`ProductRuntime` and `WorkspaceRuntime` conversely prevent the neutral host from needing product knowledge.
The product plugin provides the coordinator descriptor, default profile, display, and the
role contract. The workspace plugin resolves the workspace per run and describes its
mode. `ragents.workspace` reads the run's binding from the start option
`ragents.workspace.binding` (section Workspace, sandbox tools, and processes). For a
new folder per run on the server, it creates an empty directory per run under the
run storage; optionally a plugin provides the content or a different `cwd` through
`workspaceResolverToken` (`resolve({ runId, directory, choice, emitSystem })`). If the resolver reports
an `optionId`, `ragents.workspace` reads the user's choice from the journal and passes it on as
`choice`.

A contribution may bring its own **kind** of workspace without taking over the
workspace: `WorkspaceResolver.kind` names `id` (by which a workflow recognizes it), `label` (what the
start option and the run metadata call it), `serverFolders` (whether a folder of the
server machine may be bound alongside it), and optionally `directoryPattern` for display in the
settings. The kind occupies the new folder per run on the server: start option and selection show
its `label` instead of "Empty folder per run", and without `serverFolders` an existing server folder is
rejected with `workspace-binding-unsupported` (400). `WorkspaceRuntime.placementOf(runId)`
answers separately per run where it works (`machine`: `server` or `client`) and in which folder
(`folder`: `fresh` or `existing`), plus with `kind` the `id` of the kind when a contribution provided the new
folder. This is the one place where a workflow centrally asks where and in what a run
works; there is no mixed value of both. If a contribution reports a kind, `ragents.workspace`
creates no directory of its own for it; the contribution brings its own. The resolution then provides everything
`SessionWorkspace` knows: besides `cwd` also `description`, `gitEnv`, `gitConfig`, `extraEnv`,
`currentRoot`, `runOperation`, `hostSandbox` (home folder, read-only
roots, and with `ident` the account under which the sandbox executes), and `sandboxFolders` (folders
outside the workspace that the run's process sandbox allows, section Server process sandbox). Ending and deleting a run
follow suit: `stopSession(runId, sandbox)` wraps the contribution's stop around the stop of the host's
sandbox, `deleteSession(runId)` then cleans up what `resolve` created. Both apply only to
runs with a new folder on the server; a run on a workstation is cleaned up by the host alone.

The new folder per run on a workstation is created by that workstation's executor (section Workspace,
sandbox tools, and processes). Without a contribution it stays empty. With a contribution it exists there only
if the contribution explicitly provides it with `WorkspaceResolver.workstation`; otherwise the
start option rejects it with `workspace-binding-unsupported`: the contribution occupies the new folder, and
an empty one in its place would be a silent substitute. `workstation` names `label` (short form for
start option and run metadata), `prepare`, and optionally `release` and `description`. `prepare` and
`release` receive `runId`, the path of the folder on the workstation, its label, and the choice
from `optionId`, and return steps: executor operations there including input, such as
`commands.run` with `git worktree add` in an offered repository. No code runs on
the workstation for this; a contribution can use only what every executor can do, including the operations
that the executor contributions of the profile's plugins bring along. The steps of
`prepare` run once, right after the executor has created the folder; those of `release` before
cleanup when the run is deleted.

Before the run starts there is no working directory (error `run-not-started`, status 409), and the
resolution must be deterministic for the same binding, because the agent runtime expects the same
working directory after a restart. The host calls the resolution only after the run has been
created, so that the start options are in the journal; the scheduler receives the `cwd` per run through the
provider cache and passes it to the agent runtime as the tools' working directory; it receives its
own folder separately from that (`core.md`, Actor roster and workspace in the system prompt). Besides the `cwd`, the resolution
provides with `SessionWorkspace.description` a text that describes the resolved workspace;
it becomes a chapter in the system prompt of every actor with workspace tools (section
Actor roster and workspace in the system prompt in `core.md`). `ragents.workspace` words it per binding: an existing folder
on the server is called the project folder on the server machine, one on a workstation the project folder
there including that workstation's name; the new folder on the server is the run's private, initially empty folder
with the path the resolver provided, the new one on a workstation the same
there, with the contribution's `workstation.description` in its place. If the server has roots with
an alias (`WorkspaceSandboxHost.serverRoots()`: the registered ones and `@skills`),
`ragents.workspace` appends a paragraph about them to each of these descriptions, per binding: on the server
it names the aliases with access, that file tools and language servers take a path with an alias,
that `bash` runs in it with the path as `cwd`, and which variables `bash` has for that; on a
workstation it names the same aliases as roots of the server, which file tools and language servers
also reach from there, that `bash` runs there and only with an alias as `cwd` on the server,
that only this bash has the variables, and that one call reaches only one machine. No other
prompt contribution and no tool description names such a variable, only the alias. The
chat system note on resolution remains the notice for the user alongside it.

The file storage is a separate service: `ragents.documents` provides `documentStoreToken`
(`directoryFor(runId)`), by default under `host.storage.session(runId, "documents")`,
with `DOCUMENTS_DIR` as a subfolder per run under an external path. The storage is not in the workspace and is
not a bash path: `document_write` (`path` in the storage plus `content`) is the only way in.
A workspace file gets in through `read` and then `content`; a copy through the
model output of the `read` tool would be truncated for large files. Per topic a subdirectory is created there, and `ragents.documents` shows it in the
Documents tab.
Actor programs use their own private pnpm workspace under their run storage.
Its `actors/` collection is a server root with the alias `@actors`
(`registerWorkspaceRoot`): file tools and language servers reach it in every binding through
the alias and run at the server's executor for that, as does a bash with `@actors/...` as `cwd`,
and only there is `RAGENTS_ACTORS_DIR` available (section Workspace, sandbox tools, and
processes). The host reserves the alias `@skills` for the skill folders. Authorization and
resolution of these plugin workspaces happen through the shared workspace contract;
the model does not need to carry private storage paths over from responses.
Other plugins consume the workspace services through typed tokens.

`show_document` opens a document display from the logged tool arguments or
a file of the storage. Like `document_write`, it is a native model tool, so that a
display costs one round and not three. It publishes no core artifact: `RunView.artifacts` stays
unchanged. Immutable, versionable run results are created through `artifact_publish`;
the Documents view lists these results in addition to files and displays.
The document buttons in the primary chat, in the actor conversations and inspector use the same registered tool presenter and open the Documents view.
Its chat collection takes all loaded actor histories into account and lists the same
tool call from the main history and an actor history only once.

`ProductRuntime` and `WorkspaceRuntime` are mandatory contracts of every profile: if one of the two
services is missing, the server aborts at startup with a clear error message instead of running in a half
state. This is a documented exception to the REMOVAL TEST - the respective plugin
is not optional but part of the contract between profile and engine. The logic contribution, on the other hand,
is optional: without `ragents.orchestration` the server starts, and a TypeScript actor finds
no driver at runtime.

Run metadata are contributions as well. The server collects them per run under the plugin ID, and the
web renders the matching presentation from its registry. A workspace plugin thus provides,
for example, the branch for the run list and chat without the core
knowing Git domain logic. The run list queries contributions only for the runs the caller may see,
for all runs and contributions at once, and waits at most `SESSION_METADATA_TIMEOUT_MS`
(1.5 s, `apps/server/src/provider.ts`) per contribution. Whoever does not answer by then or fails loses only
its value: it is missing under `metadata` and appears with the reason under the run's `metadataUnavailable`;
the list itself arrives. Because every client queries the list every few seconds, a contribution with
expensive work (such as a call to a run's executor) keeps a short-lived intermediate result itself.
A contribution that reaches the run's workspace declares that with `requiresWorkspace: true`.
The host calls it only for runs whose workspace the caller may reach (the same rule as
`workspaceGuardToken`); otherwise it appears without a call, with the reason, under `metadataUnavailable`. A
list without a caller (host-internal) reaches no workspace of an `ownerOnly` run. Per run
the list also reports `workspaceAccessible`, the generic signal for the surfaces. A
locked run (`locked`, `core.md`) receives no contributions.

Storage paths are pure convention and cannot be declared: `host.storage.root(...)` lies under
`${DATA_DIR}/plugins/<plugin-id>/`, `host.storage.session(runId, ...)` under
`${DATA_DIR}/sessions/<runId>/plugins/<plugin-id>/`. A plugin receives these paths only through
`host.storage` and knows no raw `DATA_DIR`. A workspace plugin stores beneath it, for example,
UID mapping and Git infrastructure, a build plugin its caches and access configuration -
each under its own root directory, without a shared folder and without cross-references.

<!-- guide:plugins -->
## Build and ship a plugin

A plugin written outside this repository takes the same path as a built-in one. The host never
loads plugin sources; it loads finished bundles, and the author builds them. The npm package
`@schlenkr/ragents` carries everything this needs, so an empty folder and the package are enough.

**Source folder.** One folder per plugin, named after its ID, such as `acme.tickets`. It holds
`ragents-plugin.json`, `server/index.ts` exporting `plugin`, optionally `provision.ts` for tools the
plugin installs and `executor.ts` for work that runs on the machine of a workspace, such as a
language server, `web/index.tsx` exporting `webPlugin` when there is an interface, and assets such
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
`openRouterCompletionModel` from `@ragents/host/plugin-support/model-completion` or, for a profile
alias over the server's model runtime, the service `aliasCompletionModelToken` from there, and the
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
provisioning. The contribution to the workspace executor becomes one self-contained file that
imports only Node modules, so every machine can load it, the VS Code extension included; a
workstation loads it from the bundles of its own host, in exactly the version the server uses. To hand a profile together with its bundles to other machines, a server adds
`ragents.profile-distribution`; `ragents connect` fetches the profile and its bundles and starts
them with the local host ([Distributed work](../homepage/guide-distributed.html)). The client
profile names such bundles relative to itself (`./` or `../`); the client resolves an absolute or
`~/` path on its own machine, so the server refuses it.
<!-- /guide:plugins -->

## Bundle, build tool, and host API

The host builds no plugins, neither at startup nor otherwise; it only loads finished bundles. This applies
to the built-in `ragents.*`, to plugin repos next to the host, and to every third-party plugin.
Not affected are actor programs and run scripts, which `ragents.actor-programs` compiles per run from
sources that are edited in the run.

**Source and description.** A plugin source folder is named after its ID and describes itself in
`ragents-plugin.json` (`apps/server/src/plugin-build/plugin-description.ts`): `id` (equal to the
folder name), `exports` per half (`server`, `web`) as paths in the plugin folder without extension,
importable as `@ragents/plugins/<id>/<path>`, and `assets` for files or folders that go into the bundle
in addition to the default. Other fields are an error. The entry points remain convention:
`server/index.ts`, `web/index.tsx`, `provision.ts`, `executor.ts` (or `executor/index.ts`). Source
and bundle have different file names so that they are never confused.

**Bundle.** A bundle is a folder, its name is the ID, its only entry point
`ragents-bundle.json`; it mirrors the source folder, so that `pluginFolder(id)` and the
asset convention apply equally to source and bundle:

```
<id>/
  ragents-bundle.json    written by the build tool, never by hand
  server/index.js        ESM, exports plugin and optionally provision
  server/exports/        declared exports for other plugins
  server/chunks/         what entry point and exports share
  web/index.js           ESM, only with a web half; lazy chunks under web/chunks/
  web/index.css          the web half's own CSS, only if there is any
  web/classes.json       Tailwind candidates of the web half
  web/exports/           declared exports for the browser
  web/assets/            images and fonts that the code imports
  executor/index.mjs     contribution to the executor, self-contained, only with executor.ts
  prompt.hbs, prompts/, skills/, run-scripts/, ...   assets as in the source folder
```

The manifest (`profile/bundle-manifest.ts`, `format` 4) names `id`, `api` (the number of the
host API it was built against), `hostNames` (per half and module, the host API names the
bundle actually uses), `revision` (hash over all files of the bundle except the manifest and
`.DS_Store`), `sourceRevision` (hash over the source folder without `node_modules` and without the build
target, plus over the host inputs that shape every bundle: `host-api.ts`, `host-api.json`,
build tool and description reader, in the checkout `pnpm-lock.yaml`, in the package its `package.json`),
`server`, for a
web half `web` with `entry`, `classes`, and optionally `css`, for a contribution to the executor `executor`
(always `executor/index.mjs`), `exports` per half as a mapping from
export name to file, `uses`, and `assets`. Exports exist per half because a shared file
(`contract.ts`) is built separately for Node and browser; the name is the same, the half of the
importer chooses the file. `uses` names the plugins whose exports the bundle imports; the
build tool writes it because `requires` is in the code, and at startup the host checks that every
ID from it is in the plugin list and in `requires`. A bundle contains no
platform-dependent binaries and no `node_modules`, so that it is the same on every machine;
`provision` is an export of `server/index.js`, so that there is no third entry point, and
importing a bundle is therefore free of side effects. The contribution to the executor, on the other hand, is a
separate file, because it must also load in a process that knows neither the host's resolution hook nor
TypeScript sources, the VS Code extension host (section Workspace, sandbox tools,
and processes); `.mjs`, so that Node reads it as ESM without a `package.json` next to it. `revision` is checked by everyone who
copies or reuses a bundle: `pnpm build:package` after copying into the package, `ragents
connect` after unpacking the archive, and the build tool before it leaves a bundle in place as
current.

**In the profile.** The profile names a plugin by ID (a bundle under `bundles/`) or by a path
to a bundle folder: absolute, with `./` relative to the profile file, or with `~/`. Hard startup errors
with a cause are: an ID that occurs twice; a path without a folder; a folder without
`ragents-bundle.json` (if it has `server/index.ts` or `ragents-plugin.json`, the message reads
"source folder, not a bundle" together with `ragents plugin build`); a built-in plugin whose bundle is missing
(together with `pnpm build:plugins`); a manifest with a different `format` or a different `api` than
`HOST_API_VERSION` (together with the command to rebuild); a name from `hostNames` that this host's
`host-api.json` does not name (version contract); an ID from `uses` that is not in the plugin list
or not in `requires` of the module contract; a contribution to the executor that is missing, does not load,
or exports no function `executor`. `loadPlugins` in
`apps/server/src/profile/plugin-discovery.ts` checks this, registers every bundle folder with
`registerPluginFolder`, imports `server/index.js`, and loads the contribution to the executor
(`loadExecutorContribution`); `pluginFolder(id)` then returns the
bundle folder for skills, prompts, run scripts, and assets. For an ID without registration, that is,
code that loads plugin sources directly (unit tests, homepage generator), `plugins/<id>` applies. If the
bundle has a web half, the composer sets `manifest.web` to its addresses.

**Matching against the sources.** In a checkout (recognizable by `.git`), the server additionally checks at startup
that the profile's built-in bundles match their sources under `plugins/`: the
manifest field `sourceRevision` is a hash over the source folder and the host inputs, written
by the build tool; if it differs, startup aborts with the IDs and `pnpm build:plugins`. An
update of a bundled library, of the build tool, or of the host API thus makes every bundle
outdated. A package has no sources that change. The host does not check bundles from elsewhere
(Open limits). This applies to every path to the server, that is, to `scripts/start.sh`, `pnpm
start`, `ragents run`, `ragents start`, and the VS Code extension with a checkout as host; only
`scripts/start.sh` builds by itself before starting, the others name the command.

**Imports.** In the sources, plugins import host code through package names, never through relative paths
into `apps/`: `@ragents/host/<path>`, `@ragents/web/<path>`, `@ragents/web/ui`, `@ragents/engine`,
and the other modules of the host API list `apps/server/src/host-api.ts`; other plugins only through
their declared exports as `@ragents/plugins/<id>/<export>`. Test helpers are under
`@ragents/host/tests/<file>` and `@ragents/web/tests/<file>`.

**Resolution at runtime.** `apps/server/src/host-resolution.ts` registers the loader hook from
`host-resolution-hooks.mjs`, with a port through which `loadPlugins` reports the mapping from ID to bundle folder
to the loader thread before the first import. For code in a bundle:
`@ragents/plugins/<id>/<export>` leads to `server/exports/<export>.js` of the bundle `<id>` in the
plugin list; a bare specifier only if it is in the host API's server list, and then
resolved as if the import came from `apps/server/src/main.ts`, so that host modules keep their identity
(a class from the host is the same one in the bundle); `@ragents/workflow` leads to
`apps/server/src/plugin-support/actor-programs/workflow/index.ts`; everything else is a startup error
("imports <x>, which the host does not provide"). The hook always loads bundle files as ESM,
even without a `package.json` next to them. For code outside a bundle (profile files, tests over
plugin sources, scripts), the open fallback remains: if the normal resolution of a
bare specifier fails, it is treated as coming from `apps/server/src/main.ts`, then from
`apps/web/src/main.tsx`. The server entry point `main.ts` and `plugin-discovery.ts` register the
hook themselves; scripts and tests that load external files import `host-resolution.ts` through
`--import`.

Exception: `apps/web/src/actor-programs/client-ui` still imports host code relatively, because the
actor programs' client SDK copies these files including their import paths into actor projects.

**Web.** The host builds its web once, independent of the profile (`pnpm build:web` into
`apps/web/dist/`; Vite writes next to it, then every changed file is moved into
its place individually by renaming, pages and `host-web.json` last, leftovers go afterwards, so a running server
never loses the folder and never serves a half-written file). `apps/web/dist/host-web.json` names every source file the build
read, with its hash, plus `vite.config.ts` and `pnpm-lock.yaml`. The server serves the
web, under `/plugins/<id>/web/...` the `web/` folder of every bundle of its profile (only that,
never server code or assets; with ETag and `Cache-Control: no-cache`, because entry point and exports
keep their name across every build), and under `/ragents.css` the one stylesheet (section on
Tailwind below). The server checks these addresses before every plugin route, so a route beneath them is
never reachable. With an access token, exactly these files without source maps, the stylesheet, and
`/assets/` are free, so that an iframe without a cookie loads them, such as the run panel in the VS Code webview;
a source map carries the plugin's source text and, like every data route, requires the token, or with a
sign-in the signed-in user, and everything else under `/plugins/` stays behind access control.
Without a built web (`index.html`, `run-panel.html`) the server does not start; in a checkout
also not if a file from `host-web.json` has changed (together with `pnpm build:web`).
`scripts/start.sh` builds the web only then. Parallel web builds wait for each other through `apps/web/.dist.lock`.
The web always lies under the host's `apps/web/dist/`,
also for a profile that `ragents connect` fetched from a server; there is no key for another
location. In dev mode
(`RAGENTS_DEV=1` from `scripts/start.sh --dev`), the checks of web and bundles are skipped: the web
comes from the Vite dev server over the host's sources, `pnpm build:plugins --watch` keeps the bundles
current (at startup it builds only what is missing or outdated), and a changed plugin interface
takes effect after reloading the page. The server compiles the stylesheet at startup and again as soon as
a bundle's class list changes, also outside dev mode; in dev mode per request including the
classes of the host code. If that fails, only this request answers with 500. A plugin that declares `web`
itself is rejected like one with `requires` in the manifest.

**Host API.** `apps/server/src/host-api.ts` names per half every module that the host provides and
that must never go into a bundle, explicitly and without wildcards, because the web registry imports each one
individually, and for host code additionally every value a plugin may import from it. As of
host API 7: server 60 modules with 177 names from host code (the engine including its
contract modules, `@ragents/workspace-executor`, `@ragents/workflow`, the building blocks under
`@ragents/host/...`) and the libraries `typebox`, `typebox/value`, `handlebars`,
`playwright-core`, `tar` (`node:*` is always external); web 37 modules with 114 names from host
code (the modules under `@ragents/web/...` and the browser-capable contracts of engine and host)
and the libraries `react`, `react-dom`, `react/jsx-runtime`, `typebox`, and `quassel` (the
chat building blocks, because slots, link policy, and announcement region share context and module state with the host;
`quassel/events` has no state and is bundled). A library is in it
whole with `LIBRARY`, as its installed version ships it; a host module
is in it with a list of names, a module from which plugins obtain only types with an
empty one. Types are in no list because they disappear in the bundle. What belongs in it is whatever
shares module state, React context, or class identity with the host; pure libraries such as
`lucide-react`, `dompurify`, or `@base-ui/react` stay out, because every module in the registry
is a namespace import and defeats the tree shaking of the host web (measured: `lucide-react`
in the registry cost 1.0 MB, the rest of the list 0.18 MB). The same list is read by the build tool
(externals, names), the resolution hook (permission), the web registry, and
`apps/server/tests/host-api.test.ts`, which checks the built-in plugins against it.
`apps/server/src/host-api.json` holds per module the value names and the number they
apply to, generated with `pnpm update:host-api`: for host code the list from `host-api.ts`,
checked against the values the module exports according to its types, for a library its
types, intersected with what Node or a production bundle sees at runtime
(`handlebars` has only `default` under Node, `react` without `act` and `captureOwnerStack`). A
name the list does not name is an error when building, even if the module exports it:
the shim in the web does not know it, and the check of the server imports rejects it. This also applies to
a namespace import (`import * as ui`): in the web an access to a missing name is the
esbuild warning `import-is-undefined`, which the tool turns into an error; in the server it checks every
access `ns.name` and rejects a namespace that is passed on as a whole. `import()`
of a host module is an error, in the server except for a fully allowed library, because the
build does not see its names.

**What belongs in the host API.** The list follows five rules, and every removal is a new
`HOST_API_VERSION`, which is why removals are collected:

1. Only what a plugin actually imports. Plugins outside this repository count too,
   because their bundles break just the same; whoever removes a name checks their sources.
2. What exactly one plugin uses and the host itself does not need lives in that plugin, not in the
   host. Code that can run only with the host because it reads the host's files (such as
   `actor-programs/client-runtime` with the web's CSS) stays in the host.
3. The forked agent runtime (`@ragents/agent`, `@ragents/ai`) is not
   part of it. What plugins need from it gets a narrow contract in the host: the hooks into
   an agent's model calls (`host.agentRuntime`, section Agent hooks), the built-in
   model catalog of a provider (`builtinCatalog` from `plugin-support/model-choice`), and a
   single model question without history and tools (`openRouterCompletionModel` and the service
   `aliasCompletionModelToken` from `plugin-support/model-completion`;
   `host.service(aliasCompletionModelToken)(alias)` is undefined for an unknown alias and otherwise
   offers the alias's levels as `thinkingLevels`). Host signatures may name runtime types,
   such as a model in the catalog; plugins only pass them through.
4. From `@ragents/workspace-executor` only the names plugins need, as for every host
   module.
5. An entry without users drops out at the next version jump, as does a name.

**Version contract.** `HOST_API_VERSION` increases with every incompatible change of a
list entry, a listed name, or a fully allowed library, not with every
package version; whatever else a host module exports changes without a new number. The manifest names it
in `api`; the host requires equality and otherwise aborts with a cause and the command to rebuild;
`format` versions the manifest itself. New names are added without a new number; so that a
bundle built against a newer host with the same number does not silently get
`undefined` on an older one, the manifest names every used name in `hostNames` (server from the
import analysis of the built files, web from the value modules esbuild keeps), and the host
checks them against its `host-api.json` when resolving the plugin list: a missing name is a
startup error with module, name, and the advice to update or rebuild the host. Loading and
building read the same `host-api.json` through `checkedHostApiRecord` (`host-version.ts`), which checks its
number against `HOST_API_VERSION`; a forgotten `pnpm update:host-api` therefore also stops the
start. A value that is nevertheless missing from the web registry throws when the web half loads, with
module and name. `apps/server/tests/host-api-names.test.ts` turns every
deviation of the value names from the stored state red, and `pnpm update:host-api` refuses
removed names without a higher number; a changed meaning under the same name remains the decision
of whoever the red test leads there. The declared exports of built-in plugins are
not part of the host API and carry no number of their own; a third-party bundle that imports them breaks,
with the same host API, only on loading, when a name is missing.

**Build tool.** `ragents plugin build <source-folder...> [--out <folder>] [--watch]
[--no-typecheck]` (`apps/server/src/plugin-build/`, `scripts/plugin/plugin-cli.ts`, in the checkout
`pnpm ragents plugin build`) builds with the host's esbuild and fixed settings, so that every
bundle looks the same; `tsconfigRaw: {}` disables a `tsconfig.json` of the plugin.

- Server: `platform: node`, `format: esm`, `target: node22`, `splitting`, one entry point from
  `server/index.ts` (with `provision.ts` a generated entry point that passes both on) and one per
  export; external are `node:*`, the server list, and exports of other plugins. Source map
  linked, not minified. Every file begins with a banner of the tool that builds `require` from
  `createRequire(import.meta.url)`, so that a bundled CommonJS library can load Node modules
  (in ESM output esbuild's `__require` otherwise throws "Dynamic require"); the rule against
  `import.meta` and `createRequire` applies to plugin code, not to the banner. `require` of a
  host module is a build error, because the host provides it only as an ESM import with its own identity.
- Web: `format: esm`, `jsx: automatic`, `splitting`, `target: es2022`, minified with a linked
  source map, `process.env.NODE_ENV` equal to `production`. A host module becomes an ESM shim with an
  explicit export list from `host-api.json`; every name comes from its own value module without
  side effects that reads from the registry, so that esbuild discards unused ones and the metafile names the
  used ones. An unknown name is a build error, and if registry, module, or name is missing,
  the value module throws on loading with module and name. An
  export of another plugin becomes `/plugins/<id>/web/exports/<export>.js`, so that the browser shares the
  module through its address; because of `splitting`, entry point and exports of the same plugin share
  one instance. Images and fonts go to `web/assets/`, own CSS only through the entry point
  to `web/index.css`, the Tailwind candidates, found with Tailwind's scanner in the bundled
  files of the plugin's own folder, to `web/classes.json`.
- Contribution to the executor: from `executor.ts` (or `executor/index.ts`) like the server half with
  banner, but without `splitting`, into exactly one file `executor/index.mjs`; only `node:*` is external.
  An import of a host module or of another plugin is a build error there; host types
  (`import type`) are free; what the contribution needs from the host it receives at runtime through the
  machine (`WorkspaceExecutorMachine`). The server half may import the file relatively, such as
  for description and constants; there it is bundled along.
- It bundles bare imports outside the list; the host's `node_modules` is last in the
  search path, and the plugin's own wins. `react` and every other host module always come from the
  host, even if the plugin brings its own copy.
- Relative imports into a sibling plugin (a folder with `ragents-plugin.json`) are allowed
  if the file is a declared export of this half; the tool rewrites them to
  `@ragents/plugins/<id>/<export>`.
- Assets: `skills/`, `prompts/`, `run-scripts/`, `*.hbs` at the root, and `assets` from the
  description; links and `node_modules` in them are an error.
- Build errors, each location with file, line, and cause: an import outside the list, the plugin's own folder,
  and declared exports (including the plugin itself through its package name and a Node module in the
  web); a name the host API does not offer for a module, also through a namespace; a
  namespace of a host module that is passed on as a whole in the server; `import()` of a host module;
  `require` of a host module in the server; `import.meta`, `__dirname`,
  `__filename`, `createRequire`, or `require.resolve` in plugin code; a bundled library
  that looks for files through its own location; `.node` files and packages with `os`, `cpu`, or
  platform-dependent optional dependencies; a `pluginAsset("<id>", "<name>")` with a fixed
  name that does not go into the bundle; CSS outside the web entry point; a host module or
  another plugin in the contribution to the executor; an ID that does not match the
  folder name, unknown fields, and exports without a source file.
- Type check in one TypeScript program per half over all named plugins (the contribution to the
  executor and `provision.ts` belong to the server half) against
  `apps/server/tsconfig.plugin.json` and `apps/web/tsconfig.plugin.json` (paths to the host API,
  valid for every folder) including paths to the siblings; errors in host files are left to the host.
  Type errors and other findings appear together, and then nothing is written. `--watch` checks
  no types; the editor does that. Measured: 19 built-in plugins 9 s with and 2.5 s without
  type check.
- Output is written to a temporary folder next to the target. If the bundle does not exist yet,
  the folder is renamed; otherwise every changed file is moved into its place individually by renaming, the
  manifest last, and afterwards leftovers of the old version go (`installFolder` in
  `apps/server/src/folder-install.ts`). That way the bundle folder of a running host never disappears,
  not even briefly, and unchanged files stay untouched, so `tsx watch` restarts only when
  server files change. Each file is either old or new; the bundle as a whole does not switch
  in one step; Node cannot swap a folder atomically. Builds into the same target
  wait for each other through `<out>/.build.lock`; the lock of an ended process is taken over.
  A rejected plugin leaves nothing behind, and it does not hold up the others (exit code 1 then).
  The default for `--out` is `./dist/plugins` from the caller. `--watch` watches the plugin folder
  without `node_modules` and the target, rebuilds the whole plugin after every change, and for that reads
  the description, entry points, assets, and the siblings' exports afresh each time; at startup it builds
  only what is missing or outdated. A bundle is outdated if it has a different `format`, a different `api`,
  a different `sourceRevision`, or files that no longer match `revision`.

The package `@schlenkr/ragents` carries the build tool including esbuild, TypeScript, Tailwind's
scanner, the Node and React types, the host API sources, and the built types of the
agent runtime (`packages/{ai,agent}/dist/**/*.d.ts`; host API modules name
their types in their signatures, such as a model in the catalog; without them the type check would fail
for every plugin that names such a module). A third-party author
needs nothing else; `pnpm check:package` (`scripts/package/package-plugin.test.ts`) checks this:
build the package, put it into its own prefix with `npm install --global`, in an empty folder build a
plugin with server and web half including the type check, watch a plugin with a type error fail,
and start the own profile with `ragents start`. The guide for authors is above in the
section Build and ship a plugin.

**Built-in plugins** take the same path: `pnpm build:plugins`
(`scripts/plugin/build-builtin-plugins.ts`) builds from `plugins/*` without a type check, because `pnpm -r
typecheck` already checks the sources, only the outdated ones into `bundles/<id>/` (gitignored), leaves
current ones untouched, and removes bundles without a source folder; `scripts/start.sh`, the test entry point of
`apps/server`, and `pnpm build:package` call it beforehand. A second server from the same checkout
and parallel tests thus keep their bundles. Host code that imports plugin files (VS Code extension, `ragents run`, `connect`,
`workspace-client`, homepage generator) treats them as host sources; for that the package carries
`plugins/` as sources, and nothing is loaded from it.

**Plugin projects outside the repo** check themselves: they extend
the host's `apps/server/tsconfig.plugin.json` or `apps/web/tsconfig.plugin.json` through
`extends` (`paths` and `typeRoots` there point to the host API) and name their own `include` lists.
They build their bundles themselves, before starting and before tests, and their profiles name the bundles
(`./dist/plugins/<id>`). `pnpm check` in the repo checks only the repo plugins. `pnpm provision`,
on the other hand, provisions every plugin of the profile, including one from outside, because it imports `provision` from
its bundle.

Plugin repos next to the host switch over the same way: `ragents-plugin.json` per plugin with
exports for the siblings, assets through `pluginFolder(id)`, a build step before starting and before tests,
profiles pointing to `./dist/plugins/<id>`, containers build the bundles in the image. Tests of such a
repo that replace a plugin's classes through the prototype do not reach them in the bundle and
compose from sources; whatever is a host module or provided by a plugin as a service stays
replaceable.

## Rights in server and web contributions

The dispatcher checks a contract's `rights` before a method runs or a channel
opens, and gives the execution the access as `context.access` with the shared rights query
`can`. The host likewise gives every delivery route an `HttpRouteContext.access`;
`requiredRights` on the route contribution accepts a list or a function
of request and URL. All named rights must be present; the host checks them before
`handle`. Without its own specification, reading deliveries require the run read rights and other
methods additionally the run write rights. Own lists replace this default.
The current contracts and the host route mapping are generated from the code in the developer reference;
the owning plugin names further rights itself.

If the input of a method or the parameters of a channel name a `runId`, the
dispatcher additionally checks membership of the run ([profiles.md](profiles.md)). If the
contract requires `runs.write`, the method operates the run: if a start option has reserved the run for its
owner with `ownerOnly`, the dispatcher rejects every other access with `run-owner-only`
(403) before the method runs, even one with `runs.read.all`. This applies without own code
to every contribution, such as answering a question, a mini-app action, or ending
a single process; `ragents.chat.stop` and `ragents.runs.stopAll` stop the whole run,
and `ragents.runs.interruptTurn` interrupts an actor's running turn.

In the browser, `useAccess` provides the same access context and `logout`.
`accessMode` distinguishes hidden, read-only, and editable. Workspace tabs, run header, and status contributions can require their own
read right through `readRight`. Technical contributions use `runs.inspect`. Workspace tabs and header contributions
that need the run's workspace declare that with `requiresWorkspace: true`; they are missing
when the run list reports `workspaceAccessible: false` for the run (`workspaceAccessible` from
`PluginRegistry`; a run not yet listed counts as reachable). A contribution with mixed
content queries the same itself, such as the Files tab, which then shows only the file storage. Settings contributions can
also require their own read right; without one, the settings read right applies.
The component checks its write actions as well. Hiding does not replace a server-side
check: own routes declare their required rights independently of the UI.

The global coordinator has its own rights in the contract of `ragents.overseer`.
Reading allows history and model display; tasks and reset additionally need writing.
Model changes also require settings write access. Its run routes are mapped through the
`GlobalChatPolicy` contributed by the plugin: `isCoordinator` recognizes every
coordinator ID, `runIdFor` names a user's coordinator (`null` without sign-in), and
`access` names the two rights. The model choice applies to all coordinators of the profile together. The general
engine contains no hard-wired plugin right names. The optional sign-in mode and
its limits are in [profiles.md](profiles.md).

## Message layer

The server's API is JSON-RPC 2.0 with typed contracts; there is no longer a REST-style HTTP API.
A contract is an object from `defineOperation` or `defineChannel`
(`packages/ragents/src/rpc/contract.ts`) in the plugin's `contract.ts`: a namespaced ID
(`ragents.<plugin>.<name>`), description, rights, and TypeBox schemas for input and result
or parameters and message. Server and web take their types from the same object:
`host.methods(implement(contract, (input, context) => result))` enforces input and output through
`Static<>`, and the web client `rpc.call(contract, input)` returns the result typed. Large
domain values are an open schema with a TypeScript type (`openJson<T>`); the runtime does not check
them in detail, and the reference names the type.

The dispatcher (`apps/server/src/rpc/dispatcher.ts`) serves every connection: it checks the
contract's rights against the connection's access, validates the input against the schema,
executes, and validates the result; a response that violates its contract is an internal
error and is logged. Both messages name every violated path with a reason, such as
`Invalid input for ragents.chat.send: text must be string, got 5` (`schemaComplaints`,
rule in `overview.md`). Errors come as JSON-RPC errors: `-32601` unknown method,
`-32602` invalid input, `-32000` domain error with `data.code` and `data.status` from the
`DomainError`, `-32001` cancelled, `-32003` time limit. The host decides rights per run
dynamically (`apps/server/src/api/rights.ts`: ordinary runs through `runs.*`, the global chat through
the rights of its plugin); such contracts name no static rights but their rule
in the description. The `context` of a method: `access`, `signal` (cancellation through `rpc.cancel`
or end of connection), `progress` (intermediate states as `rpc.progress`), `connection`, and
`local` (call from the own machine: stdio or loopback).

Channels are notifications: `rpc.subscribe { channel, params }` returns a
subscription ID, after which `rpc.event { subscription, channel, message }` arrive until
`rpc.unsubscribe`. A provider repeats its initial state on opening, because a client resubscribes after
losing the connection; messages during opening are delivered only after the
subscription response. At most 64 subscriptions per connection.

The protocol is symmetric: an operation with `implementedBy: "client"` is implemented by the
client (`rpc.handle`), and the server calls it through `context.connection.call` on the same
connection, such as the file operations of a workstation. This requires an event stream;
a connection without a stream (`streamless`) can neither subscribe nor be called back.

Transports serve the same dispatcher. HTTP: `POST /rpc` per message (request, the client's
response to a callback, or notification) and `GET /rpc/stream` as an SSE stream per
connection, which announces itself with `hello` and a connection ID and carries notifications as well as
requests from the server; the ID comes along in the header `x-ragents-connection`. Stdio: one
JSON message per line on stdin and stdout; the caller counts as trusted and has all rights.
Sign-in is a transport matter: HTTP with cookie, bearer, or `?access=` as before
(`/api/access`, `/api/access/login`, `/api/access/logout` stay HTTP), stdio without.

Core contracts: `ragents.chat.*`, `ragents.runs.*` (run list, run view, journal,
queues, stop, and questions from the engine), `ragents.startOptions.*`,
`ragents.runs.prepare`, `ragents.settings.*`, `ragents.plugins.bootstrap`, `ragents.external.set`,
and the channels `ragents.runs`, `ragents.run`, and `ragents.chat`
(`apps/server/src/api/contracts.ts`, `packages/ragents/src/http/contracts.ts`). Whatever is not a
JSON message remains delivery through `host.http`: static interface, mini-app frames,
artifact and attachment content under `/files/runs/<run>/artifacts/<id>` and
`/files/runs/<run>/attachments/<id>`, document content, help, and `/health`. The registry
`http` exists only for that; every JSON response is a method.

The reference is generated from the registrations: `host.methods.describe()` and
`host.channels.describe()` provide owner, ID, description, rights, and schemas for the readable
reference and the OpenRPC document. The web client (`apps/web/src/rpc/client.ts`) also runs
under Node; the VS Code extension and `pnpm driver` use it with their own `fetch`.

## Web as plugin host

Every page holds exactly ONE live connection to the server: the client `rpc` (`apps/web/src/rpc.ts`)
opens `GET /rpc/stream` with the first subscription or the first callback handler and closes
it when nothing is open anymore. Requests go as `POST /rpc`. Subscriptions are channel contracts:
`rpc.subscribe(contract, params, onMessage, onError)`; on connection loss the client reconnects,
resubscribes all channels, and calls `onConnected` listeners, which is why providers repeat
their initial state on subscribing. Core channels: `ragents.runs` (list changes, one
message immediately), `ragents.run` (`ready` on subscribing, then `run` per journal change), and
`ragents.chat` (the chat events with replay). Plugins register their own channels through
`host.channels`: `ragents.processes` per run, `ragents.workspace.browse` per run and root.
Background: browsers allow only six simultaneous HTTP/1.1 connections per host;
four own streams per page plus a second tab had used up the supply, so that no
further request went out.

The shared run panel shows chat and mini-apps with the same semantic theme tokens as the
inspection rail, header, status bar, and dialogs. Colors, fonts, radii, and shadows are defined
in `apps/web/src/ui/theme.css`; mini-app controls share these tokens.

Under Settings, Appearance, the interface can be shown light, dark, or according to the system setting.
Without a stored choice, the interface starts dark. The choice applies immediately to
all runs and open tabs of the same server address in this browser; it is not a profile value
and is not stored on the server. Changing it requires settings write rights.
The interface applies the stored appearance before the first React render. Only with the
system choice does it follow later changes of the system setting. Theme switches change
neither mounted views nor input drafts. Invalid stored values
and storage errors are shown explicitly. The appearance is a fixed host area
and stays reachable independently of contribution filters and the loading of the plugin settings.
Mini-app frames receive the resolved appearance through their existing bridge (see actor-programs.md).

Menus, header hints, actor popouts, chat step details, journal, and global
coordinator are `Popover`, `Tooltip`, and `Select` from the UI library; Base UI positions
them at the anchor (also at a virtual position or below the header edge), limits them to
the available space, and follows scrolling and layout changes. Spacing, opening direction,
focus target, and closing behavior remain properties of the respective caller.

The local chat and run panel settings share storage, validation before
writing, and notification in the same and in other browser tabs. The theme uses
the same storage listener; their own parsers, keys, and error displays stay separate
by domain. Dialog and DialogContent offer a shared
header with optional additional actions; preview dialogs use this shell as well.
A dialog that shows a foreign web application in an iframe names its address and always offers
"Open in new tab": applications may refuse embedding (X-Frame-Options,
CSP `frame-ancestors`, Office.js leaves every non-top window for `about:blank`), and the
host cannot detect that across the origin boundary. The preview therefore never depends on the
iframe alone.

The dispatcher passes a `DomainError` with code and status on as the response's error data;
the delivery helper (`guardedJsonRoute`) keeps its status. Domain translations of
external errors and targeted masking remain with the respective plugins.

The central chat knows no fixed domain tool names. `RunPanelWorkspace` knows no fixed tabs.
Instead, plugins fill typed slots for:

- start options (`startOptions`: control component and badge per option ID;
  without a component, a selection menu from a presentation `{ kind: "choice", label, options }`).
  They appear in the preparation chat; `placement` chooses the area below the input (`page`,
  default) or the input bar (`composer`); the model contribution uses the input bar.
  The input bar contributions additionally appear in the chat input of every run (`ChatSurface`
  in `PluginChat.tsx`, that is, web and run panel), as long as the server does not lock the option: in the
  empty run before the first message and, for a changeable option, also afterwards. Until the server
  has answered after the first message, every option counts as locked there.
  The control component receives with `machines` (`apps/web/src/offered-machines.ts`) which
  machines the host offers for new runs: `server` in the browser, `all` in the VS Code run panel
  (`RunPanelHost.machines`, provided by `RunPanelHostProvider`). The workspace choice
  then shows workstations or only the server; an already chosen workstation stays readable as a
  value. The server does not check this; VS Code and `ragents run` still bind to workstations.
- overview contributions (`overviewPanels`): independent areas with `placement` in the overview
  (default `overview`), the header (`toolbar`), or the main area while no run is open (`idle`,
  the first visible one wins; only with `runs.read`); `readRight` limits visibility.
  Their context contains the registry, open state, `onOpen`, `onClose`, and `onBusy`. The host
  coordinates overview and toolbar history. Toolbar contributions are mounted from application start,
  but activate their own connections only on use and keep them afterwards across run switches.
- workspace tabs and badges (`workspaceTabs`, `workspaceTabsFor`): the toolbar at the right edge
  with the tab area as a popout over the selected content view; the same contribution, the same visibility (`readRight`, `requiresWorkspace`, `available`)
- tool and entity presenters; the run providers bind tool presentations together to
  run and navigation. The standard chat and the actor chat consume the same renderer.
- run metadata
- run header contributions (`sessionHeaders`): contributions appear in the shared run details.
- run providers and surface (`surface.RunPanel`): one component for browser and VS Code
  receives `SurfaceCenterContext`, including chat, catalog, navigation, and card contributions.

- run status contributions (`sessionStatus`): groups sorted by `order` in the shared
  bottom status bar; `Status` receives the same run and navigation context as a
  header contribution. The surface receives the target for its status group through `statusContainer`.
- sections on an actor (`cardSections`)
- presentation of a pending action (`actionViews`): per owner exactly one component that
  receives the action's title, payload, and result and knows its shape itself. The chat shows an
  action without a registered presentation generically: title, "waiting for input", and "Discard".
  quassel decides where it appears based on its state: when open, `ChatMessages` renders it in a
  `ChatPanel` with input in the dock directly above the input (`data-chat="actions"`, at most
  half the frame height `--qsl-panel-height`, beyond that it scrolls) and not in the history; confirmed
  or discarded, it stays as a record in its place in the history. This applies to the run chat,
  the actor chat in the run panel, which both use `ChatPanel` with input. Without
  `ChatPanel` with input, in the actor inspector, and for the global
  coordinator, open actions stay in the history. For this the web knows only open actions,
  no question shape.
  `ragents.ask` creates its actions with the payload `{ question, options, multi }` and
  answers them through its own contract `ragents.ask.answer`; the core does not know this shape
  (`docs/spec/core.md`, Pending actions).
- guides (`guides`): per ID a React component that the host shows in a dialog when a
  template with `guide` is clicked; `onComplete` returns for a skill the text of the
  first message, for a run script the start value as JSON (such as the conversation round
  of `ragents.reference`)

The shared `main.tsx` bootstrap renders `RunPanelApp` for either host. Browser navigation uses the same
`PanelPage`, `StartPage`, and `RunsPage` as the extension with one current-server adapter.
Start offers recent runs and permitted templates; Runs adds search and deletion with confirmation.
Free creation, template access, reading, and deletion retain their independent rights.
The browser preserves per-user read markers, owner labels, and contributed run metadata.
Global coordinator and other toolbar contributions stay mounted across run switches and starts;
overview and idle contributions retain their slots. Settings and Help are in the panel menu.
Guided templates still use the existing preparation dialog and chat. Browser runs use the server.
The journal remains in the shared bottom status bar.

The shared panel defaults to the primary chat actor. The addressee selector below the input
selects another actor and retains visited chat drafts. `Inspect actor` opens that actor in
the Inspection rail tab, including sources, turns, inputs, subscriptions, and artifacts.
Inspection requires `runs.inspect`; read-only chats retain their existing restrictions.

In the actor view (`FlowInspector` in Inspection), a
single-line toolbar chooses exactly one view. The X on the left shows
chat and input; the other buttons each show a detail area in the same place
with the full available height. Tooltips and accessible labels contain names
and, where applicable, counts. The info chip shows status, actor kind, driver, model, thinking level,
open inputs, turn count, and, where applicable, cost. Chat and input stay mounted but hidden on switching,
so that the draft is preserved. Arrow keys, Home, and End also choose the
view; when space is short, the toolbar scrolls horizontally.

The shared inspection rail opens one panel over the content. Its active tab is stored per run.
Visited contributions with `keepMounted` retain their component state while hidden and receive
`active: false`. Unavailable tabs stay closed. File-browser state belongs to its component instance
and disappears on unmount; there is no stored sidebar width or expanded workspace layout.

The actor view's chat sets the selected actor as the presentation owner: its own
messages appear without a speech bubble, contributions of other participants keep their previous
presentation. The actor projection provides sender IDs independent of display names for this.

The contribution `cardSections` (`id`, `order`, `Section`) renders sections on every actor, in
the shared run panel; a contribution without content returns `null`; several contributions
on the same actor are the normal case. The core web does NOT know the actor domain model at this boundary: the context
passes `actor` through untyped, and the contributing plugin parses it through the contract of the
orchestration plugin. Currently `ragents.orchestration` (artifacts with
`createdBy === actor.id`) and `ragents.todo` (actor scope from `RunView.pluginStates`) contribute.
Open actions are not a card contribution; they are in the chat's dock (section on
`actionViews`). The sections stay scrollable above the actor chat and never change
an actor's identity, capabilities, or tool selection.

Browser runs show a tab strip `Chat | App A | App B` with exactly one visible content view.
Mini-apps mount on their first visit and remain mounted and inert while hidden. Chat also stays
mounted, preserving drafts, app input, and frame identity across tab switches. Visible apps enter
the catalog without changing selection. If the selected app disappears, becomes hidden, or its
actor stops, the browser returns to Chat. Reactivation makes the app available without selecting it.
VS Code keeps the chat in the panel and opens or focuses one editor per server, run, and app.
Questions and news remain in the chat; background app tabs have no additional notifications.

`ragents.orchestration` provides "Stop run" in the run title bar for users with
write rights. Its tool `run_stop` allows the
primary actor with `execution.stopOwned` to stop its own run completely through the same run management.
The run identity comes from the call context. The call does not wait
for its own turn end; the host reports cleanup errors in the server log.

Programs do not arrange the host interface. Activated visible views enter the app catalog through
their actor ownership, including views created by embedded starts. There is no layout function
or placement service. Before replay, the host rejects journals containing removed layout calls,
capabilities, program layouts, or view placements. Only that run is locked with a clear cause;
its files remain unchanged, and startup and other runs continue.

`SurfaceController` reports the selected actor or mini-app to the global coordinator as the
current location. Artifact links open Documents; actor detail links use Inspection.
The status bar spans the run content and hosts the journal contribution.

The orchestration plugin's journal contribution opens a non-modal surface upward,
at most 900 pixels wide and 480 pixels high, limited by the visible viewport.
It reads actual events of the active run from its existing event endpoint.
Loading happens only while the view is open, on changes of the existing run revision, and
through Refresh; no additional polling cycle arises. Newest events come
first. A search covers event content and actor handle. Initially 100 matches
are shown; a button reveals 100 more each time. Entries open their complete
JSON content in the existing code block. Clicking outside and tabbing out close the surface;
Escape and X close with focus returned to the journal button. The view uses no modal.

The workspace tab `Executions` belongs to `ragents.orchestration`. It shows the
`typescript_eval` calls of all actors of the current run, independent of the selected actor
or primary chat. Newest calls come first. The list names actor, status, start time, and duration. The search
covers actor, code, path, result, logs, and errors; the status filter distinguishes running,
finished, failed, and interrupted calls. A selected entry shows the stored
TypeScript source text, for file execution the original path, result, logs, and errors.
The view is read-only; it starts no code and does not change the run.

The active tab loads the existing event endpoint on opening and on a change
of the run revision; running times keep counting locally. An inactive or collapsed
tab loads no execution data. Leaving or switching runs aborts running requests.
On a load error, the last loaded state stays visible; `Reload` repeats
only the reading journal query. The display is built from
the journaled call, source text, result, and error events; the identity is composed
of actor, turn, and call. Even when the type check fails, the checked source text stays visible. Older inline calls use their
`code` input value from back then. If an old file-based call lacks a source text snapshot,
`Executions` shows that explicitly and does not read a current working file as the historical source.
Native snippet execution remains part of the server's basic equipment even without the optional orchestration plugin;
only this tab is dropped without the plugin.



The run panel and actor inspector use the same
`ActorChat` building block with `ChatMessages` and the same message projection. Markdown, code,
attachments, and sender presentation are therefore the same: own responses of the
selected actor appear without a speech bubble, other contributions keep their presentation.
Chat messages are rendered with Streamdown as Markdown, including dividers, nested
lists, and GFM tables. Open assistant messages use the streaming mode,
which provisionally completes incomplete formatting; closed messages, user texts,
and system texts use the static mode. The unchanged message text keeps
indentation and line breaks. HTML from messages is not executed; links keep
the host's link handling. The styling stays in the shared chat CSS.
The chat history shows the normal mouse pointer; text stays selectable, inputs keep
the text cursor. User messages with text have a small copy icon, also in
colored speech bubbles and without a speech bubble. It copies the unchanged message text
including Markdown and line breaks; attachments keep their download links.
The button sits without its own row at the top right above the message and appears on hover
or keyboard focus. On devices without hover it stays reachable. It confirms success with
a check mark and reports failed copying.
Chat views show timestamps according to their chat's choice and use the chosen
level of detail for agents, from hidden steps to fully visible details;
the expand permission stays in effect. Without a product default, `grouped` applies (see below);
`ChatMessages` without a value uses `current` ("current"). In `current`, while
a chat is running, at most the last step appears as a shared quassel chip: "Thinking" or the running
tool name, with expandable details given the corresponding permission. Custom tool renderers
are not used in this mode. Without the expand permission, only "Thinking" or
"Tool running" appears, without tool names and without a clickable surface.
Earlier steps stay hidden. If a tool runs longer than three seconds, its step shows the elapsed time after it (quassel `toolElapsedThreshold`), so that a slow step does not look like a hanging one.
A following message, the tool result, or the end of the turn removes the display; normal
messages and questions stay visible. Own inputs sent afterwards behind the
running step do not remove the chip. The shared working animation additionally stays
visible as long as the agent is running. The host's run chat shows it as long as any agent
or program of the run executes a turn and the connection is up; the placeholder of its
input follows the same signal, the stop button only the turn of its own actor (see below). Actor inspectors show the running state
of the respective actor. The previous levels of detail stay selectable; stored choices and
explicit product defaults take precedence. The level of detail `grouped` ("grouped") combines all
consecutive thinking and tool steps between two other messages into one
collapsed row "N steps"; while the last step is running, the row names it and
pulses. Expanded, the steps are below it as single-line rows as in `compact`, each
openable individually through a popover given the expand permission. The collapse state lives only in the view.
Accesses without `runs.inspect` receive, when step display is enabled, only this
current, non-expandable status. Disabled steps stay hidden.
The default of all chats is `grouped`; a product can use it without expanding or switching.
Both views use the same link navigation.
The primary actor uses the existing chat stream. Other actors receive their own
conversation projection from the journal, with delivered inputs, published responses,
thinking steps, and tool calls including arguments, results, and errors. The host reloads them
through `ragents.chat.actorHistory` on changes of the run; the compact run view stays
without tool payloads. A change of the primary actor removes no steps from the
previous actor's conversation. Load errors are shown in the chat. The chat does not cut the message list
to a fixed number. Actor chats use the shared quassel input with attachments and detail-level choice.
The run panel places it through `ChatPanel`; the inspector uses `ChatInputToolbar` where an
actor accepts input. TypeScript actors are operated through functions or mini-apps, not chat.
Each conversation keeps its own scrolling position and follows new messages at the end.

The history shows the working display of `ChatMessages` from `WorkingScenes` and the
existing running state, without further data channels. Even without new stream events it stays
visible during a running turn and disappears as soon as the agent is no longer running;
this also applies after an error or stop. With the system setting for reduced
motion enabled, the scenes stay static: both frame rate and scene changes pause.

The inspector shows TypeScript actor history and read-only program sources.
Missing source text is reported explicitly.

`apps/web/src/run-apps.ts` builds the shared mini-app catalog from surface contributions
for the shared panel and the standalone app route. Entries retain the run ID,
plugin definition (ID, title, ownership, and data), and renderer; `visible: false` entries
are excluded and duplicate IDs within a run are errors. Selection resolves only an exact
visible ID. The browser panel shows Chat when its stored app selection is unavailable;
the standalone route shows its unavailable message instead.
`RunAppView` passes the same session and navigation to the contributed renderer and rejects
an entry from another run. `RunAppNavigation.openApp` is the host navigation contract;
the VS Code adapter sends the editor open/focus message. Host API 10 requires the single
`surface.RunPanel` contract and removes the surface header placement; older bundles must be rebuilt.

`ragents.actor-programs` contributes the Functions tab, typed tool cards, and mini-app rendering.
Installed visible apps appear automatically in the shared catalog. `actor_view_set_visibility`
changes journaled visibility while preserving installation and state. The app frame occupies
the selected view without another title bar. Necessary host status messages reserve 28 pixels
below its content; confirmations and errors remain visible. There is one frame per visited app
in the browser and one per open editor in VS Code.
Packages provide their bundled client and typed action contracts. The plugin owns the sandbox
iframe, MessageChannel bridge, shared event transport, status display, and confirmation handling.

Controls are not a registry slot: the host provides them as a UI library under
`apps/web/src/ui/`, and plugins use them directly instead of building their own. The library
is the shadcn/ui components on Base UI (`components.json` in `apps/web`, style `base-nova`),
copied into the source tree by CLI and styled with Tailwind: `Button`, `Badge`, `Toggle`,
`ToggleGroup`, `Tabs`, `Select`, `Dialog`, `Popover`, `Tooltip`, `DropdownMenu`, `Input`,
`Textarea`, `Checkbox`, `Switch`, `RadioGroup`, `Field`, `Label`, `Table`, `Card`, `Alert`,
`Progress`, `Separator`, `Skeleton`, `Spinner`, `Empty` with their parts (`SelectTrigger`,
`DialogContent`, `TabsList`, and so on), plus `cn` and icons from `lucide-react`. Props, variants, and
composition are those documented by shadcn; the library invents no prop names
of its own. The host's own building blocks on top are `ListDetail`, `SectionLabel`, `SvgEdge`,
and, only in the host, the page `Modal` in `modal.tsx`. The choice follows the role, not
taste:

- `Button` without a variant (`default`): the ONE main action of a surface or dialog
  (Start, Confirm, New run); at most one per view.
- `variant="outline"`: an ordinary action with a border; several may stand side by side.
- `variant="ghost"`: a quiet action without a surface in bars, rows, and in the composer.
- `variant="destructive"` for deleting actions; the text says what happens.
- Icon buttons are `Button` with `size="icon"` (small `icon-sm`, large `icon-lg`), a
  lucide icon as child, and a required `aria-label`; `title` provides the native tooltip.
  Close and Back in dialog headers are round icon buttons (`rounded-full`) with an X
  or an arrow. The overview corner on the left of the header is deliberately not a
  library button (see below).
- `size="sm"` in rows, cards, and toolbars, `size="lg"` for highlighted
  header actions, otherwise the default height.
- `Toggle` for an on/off state and filter chips; `ToggleGroup` for exactly one of
  few options (`spacing={0}` as a connected segment bar) or a
  multiple selection; `Select` for one or several (`multiple`) of many, with `items` for the
  labels; `Tabs` for navigating between the views of a surface; a count
  per tab is a `Badge` (`destructive` for items that need the user, otherwise
  `secondary`). A value is not a tab: `ToggleGroup` chooses an option, `Tabs` switches
  the view.
- `Card` is the ONE surface of the house: `rounded-panel`, host outline, card surface, and
  `shadow-bar`. Every static surface and every card is a `Card`; deviations are given as
  `className` on it (`shadow-pop` for floating things, `p-0`, `gap-0`). Floating surfaces with
  their own component (`DialogContent`, `PopoverContent`)
  stay what they are; lighter inner surfaces in a card stay local classes.
- `SectionLabel` is the small uppercase group label above a section;
  a count next to it moves to the other end. Labels that are a heading or
  a `dt` stay that element.
- There are no longer native `<select>`, custom buttons, or class contracts; the built-in
  plugins bring no CSS of their own.

Tailwind applies to the whole interface. Host, plugins, mini-app building blocks, and the
bundled mini-apps write their styling as utility classes directly on the elements;
there are no longer stylesheets with their own class contracts. `apps/web/src/ui/theme.css` is
the only token source: the shadcn variables (`--background`, `--card`, `--primary`,
`--border`, `--radius`, and so on) and the additional host colors `shell`, `app`, `surface`,
`border-soft`, `border-strong`, `success`, `warning`, `info`, `teal`, `destructive-soft`, and
the material colors `glass-*` are there once per mode, light and dark follow `data-theme`;
plus font, the compact spacing scale with `header`, `statusbar`, and `workspace-inset`,
the card radius `rounded-panel`, the shadows `shadow-bar`, `shadow-status`, `shadow-pop`,
`shadow-card`, `shadow-workspace`, `shadow-glass-icon`, and the animations `animate-fade-pulse`,
`animate-working-pulse`, `animate-ring-pulse`, `animate-edge-flow`, `animate-progress-sweep`.
`tailwind.css` is the host entry point with preflight; `frame.css` the entry point of the mini-app frames.
Both include `quassel.css` after the host's utilities: the precompiled stylesheet
of the chat building blocks `quassel/chat.css` (classes with prefix `qsl:`, variables `--qsl-*`) and the
mapping of every quassel variable to the tokens from `theme.css` (colors, fonts, radius,
shadows, `--qsl-color-scheme` per mode, spacing and font scale through `--theme()`), so that
every change to the theme also affects the chat. Because quassel's classes come after the host's,
they win at equal specificity, also against the base classes of the slots; a class
that the host passes through `className` to a quassel building block and that collides there with a class of its own
therefore needs `!` (such as `min-h-16!` in the global coordinator).
The web receives a single stylesheet from the server (`/ragents.css`,
`apps/server/src/web-stylesheet.ts`): `@tailwindcss/node` compiles `tailwind.css` for the
candidates from the sources under `apps/web/src` and from `web/classes.json` of every web bundle of the
profile, once at startup and minified, in dev mode anew per request. Separate stylesheets per
plugin do not work, because Tailwind fixes the order of utility and variant, and a
stylesheet loaded later would put base utilities after the host's variants. A plugin's own
CSS (`web/index.css`) is linked by the web after the stylesheet. Vite builds the pages of the
VS Code extension without a server with `@tailwindcss/vite`; the mini-app compiler and the
homepage builds use `@tailwindcss/node` (`server/tailwind.ts`) over the host sources, the
building blocks, and the respective mini-app sources. Recurring patterns are components, not classes: header cells are
`ToolbarItem`, `ToolbarCopy`, `ToolbarLabel`, and `ToolbarText` from `apps/web/src/Toolbar.tsx`,
counters `Badge`, empty states `Empty`, messages `Alert`, surfaces `Card`, wait indicators
`Spinner`. Context-dependent presentation runs through `data-*` attributes on the frame and
`in-data-[...]` variants in the component. Own CSS remains only for markup generated by others
with fixed classes: the token colors of highlight.js (`apps/web/src/highlighting.css`), the
stylesheet of react-diff-view, and the edges of xyflow in the flow diagram
(`client-ui/flow-diagram.css`). Tests select elements by roles, labels, text, or
`data-*` states, never by classes.

`Select` opens its list in a portal above the trigger or below it, depending on space,
and is not clipped by composer and dialog outlines. Escape first closes the
menu and focuses the trigger; clicking outside and disabling close it as well.

The shared `ChatInputToolbar` clears text and attachments immediately at the start of a valid
send action. During the request, further send actions and new attachments are locked;
text input stays possible unless the calling view explicitly disables it.
Success does not change a draft that has become new in the meantime. If sending fails without an intermediate
text change, the input automatically restores the sent text including attachments.
Otherwise the current text stays unchanged and the failed task appears
separately with a preview. "Insert unsent input" deliberately appends its text and its attachments
to the current draft; the attachment limits apply here as well. Several errors stay
retrievable individually. Reset discards the draft and failed tasks and ignores
late results of the previous requests.

Dialogs use round icon buttons with an X or an arrow for Close and Back. This
applies to the start dialog, Settings, Help, and document dialogs, as well as
the Back actions in narrow `ListDetail` views; otherwise the shared
`DialogContent` shows shadcn's X at the top right. Accessible names and tooltips
still name the respective action.

Mini-apps use the same components with the same look; the mini-app runtime sets
`data-ui-surface="mini-app"` on the frame root element only as a marker for font and
base dimensions. Details on forms, tables, theme bridge, and own app CSS are in actor-programs.md.

The journal surface and the global coordinator history are `PopoverContent` surfaces with their own
opening direction and corner shape. `PopoverContent` keeps 8 pixels of distance to the
calling control by default. Dialogs and dimming popouts share
`--backdrop` from the theme (black at 40 percent opacity in the light and 60 percent in the dark
theme); individual surfaces define no dimming color of their own.

Settings and Help are actions in the shared panel menu. The run title opens metadata, start
options, and contributed run controls. The header also provides Back to Start and Stop run.

`DialogContent` distinguishes four regular app areas with `scope` (`ModalScope`); the
host's page `Modal` passes it through:

- `page` covers the whole screen with header and bottom status bar.
- `run` covers the run content between header and status bar; both bars stay free.
- `workspace` covers everything below the header, including the bottom status bar.
- `surface` covers only the surface; header, status bar, and sidebar stay free.

The host provides the run, workspace, and surface areas through `RunModalContext`,
`WorkspaceModalContext`, and `SurfaceModalContext` from `apps/web/src/ui/dialog.tsx`;
the dialog's portal lands in this area. Only the respective background area becomes
inert; bars outside stay operable; a click there does not close the dialog
(`disablePointerDismissal`; a backdrop click still closes). Specifically provided local
containers remain possible, such as for the reset confirmation over the global chat. The
overview corner opens `workspace`; Settings and Help use `page`. Keyboard focus
stays in the topmost dialog (`page` modal, otherwise `trap-focus`); Escape handles only its
current step. Native controls such as `<select>` have no place in the interface.

The page `Modal` in `apps/web/src/ui/modal.tsx` provides its content with a typed
dialog controller. `useModalController()` requires such a host; outside one the
call is an error.
The contracts for pages and control are in `apps/web/src/ui/modal-controller.ts`.
With `nextBehavior`, the host determines how a further step uses the same frame:
`push` is the default and keeps the previous page with a way back; `replace` removes the
current page and creates no additional way back. Already existing earlier steps
are kept even when this host default changes. A new page provides its title,
optionally a subtitle and initial focus target, as well as its content as a render function with the controller.

The navigation uses one frame and one backdrop. Retained pages stay
mounted but are hidden and inert. Back, Escape, and background click lead to the previous step
when there is history; without history, Escape and background click request
closing. The X and `controller.close()` request closing the whole dialog
regardless of the history. All closing paths use the host's `onClose`; until
it changes its props, a locked or asynchronously closing dialog stays.
Back returns focus to the triggering element of the previous step. `open={false}`
resets the navigation and keeps the root content mounted but hidden.
On closing, the modal restores the previous focus only if it is still in the
modal or on the document body. A deliberate switch from a run dialog into
the toolbar input, which stays operable, is kept.

`ragents.orchestration` contributes the surface component in the web slot `surface`.
The engine itself provides only the generic runtime methods `ragents.runs.*`. The
surface component uses this API without the server needing to know a surface.
Its writing methods run one after another per run; a running stop of one run does not hold up
the methods of other runs. An actor field takes an ID or handle and is resolved like every
actor reference (`actorByReference`, `core.md`, IDs and handles); the same rule is available
to plugins through the host API, `@ragents/engine` in the server and
`@ragents/engine/src/http/contracts` in both halves, plus `actorByHandle` for places that accept only
handles, and `handleKey` for the spelling in which handles are stored.

Git changes query their data only when the tab is active. In embedded mode the flow owns
exactly one `RunStore` and one channel subscription. React distributes the same
`RunView` to surface and popouts through a versioned same-origin bridge contract. The
surface opens no second stream when embedded.

The chat building blocks come from the standalone library quassel (npm `quassel`,
github.com/SchlenkR/quassel, MIT): `ChatPanel`, `ChatMessages`, `ChatInputToolbar`,
`DetailModeSwitch`, `TimestampSwitch`, `Markdown`, and their helpers from `quassel`, the wire contract
of the ChatEvents including `applyEvent` and the attachment check from `quassel/events`, which server and
web import alike. They know no product. What knows the run stays in RAgents:
`useChat`, `requests`, `useAttachmentCapabilities`, `StoppedActorNotice`, `chat-target`, and
`user-location` under `apps/web/src/chat/`, on the server `chat-handler.ts`. `QuasselHost`
(`apps/web/src/chat/QuasselHost.tsx`) gives quassel the host's basic building blocks as slots
(`Button`, `Toggle`, `Card`, `StopButton`, `Popover`, `PopoverContent` from `apps/web/src/ui`) and
lets links into a run (`flow:actor/...`, `input`, `turn`, `subscription`,
`action`, `artifact`) through in Markdown; without it quassel discards every scheme other than http, https, mailto,
tel, ftp, irc, and xmpp. `main.tsx` wraps it around the whole interface, that is, also
around every plugin, and the mini-app building blocks around their chat, `ChatMessages`, `Markdown`, `MessageList`,
and `DocumentViewer`. The history is not a live region: quassel announces finished responses and new actions
once through its shared region; the global coordinator switches that off with
`announce={false}`.
`ChatPanel` and `ChatMessages` use the full available width by default with 24 pixels of
side spacing. `maxWidth` and `horizontalPadding` adjust these dimensions from outside; the panel's
defaults apply to history and input together. Responses have no additional
percentage width limit. Timestamps stay controllable through `showTimestamps`. The separate
`TimestampSwitch` receives state and callback from the host and can be put into the toolbar with its own texts and
a label that can be hidden when space is short.
Every chat of the host and the plugins takes level of detail and timestamps from ONE building block,
`@ragents/web/chat-view-settings`: `useChatViewSettings(runId, actorId, scope, display?)` returns
both values including setters for the message list, and `ChatViewSwitches` the two switches for the
input (the level of detail only if it is selectable). This applies to the run chat, actor chats in the panel,
popout, inspector, and run panel, the preparation chat of a template, and the global
coordinator. Without input (stopped actor, TypeScript actor, human, hidden input,
read-only), the switches take its place as long as messages are shown. The
timestamp choice applies per chat, that is, per run and actor, equally in all display locations, and stays
stored in the browser, initially switched on; the level of detail is additionally separated by display location
(`display`). Mini-app chats (`UI.Chat`, `UI.ChatMessages`, `UI.MessageList`) use the same
message list but do not get the switches: there the program sets the presentation through
`showTimestamps` and `detailMode`. An embedding of the run chat (`renderChat` in the
surface contribution) passes with `ChatDisplayOptions` only what it needs today: an additional class
(`chatElementClassName`), access to the scroll area (`chatScrollerRef`), elements on the left of
the input bar (`toolbarLeft`), and `notice`, which takes the place of the history as long as it is set;
the input below stays operable; the run panel shows its loading state with it
(section on the run panel).
The presentation options are props of the shared building blocks (`ChatPanel`, `ChatMessages`,
`ChatInputToolbar`); they create no settings interface and no new stored
preferences:

- `appearance` sets font size, line height, message spacing, and spacing of dense steps.
  Numbers for font size and spacing are pixels; numeric line heights are factors.
  `ChatPanel` passes these values on to history and input together; `ChatMessages` can
  receive them directly when used on its own.
- `timestampOptions` determines `time`, `date-time`, or `relative`, language, time zone, and
  optional day separators. Relative times update every 15 seconds. Day boundaries
  follow the configured time zone, also split step groups, and are independent of the
  timestamp column. Missing or invalid message data create neither separators nor
  invalid date displays. The default remains local time in the format HH:MM.
  The timestamp aligns with the first text line, also for step groups and
  multi-line messages with different paddings.
- `codeBlockOptions` controls wrapping, maximum height, and an optional copy button for
  Markdown code blocks. Inline code stays unchanged; copying takes the code content
  without controls. The default remains horizontal overflow without a copy button.
- `bubbleOptions` chooses the existing mix (`default`), running text (`plain`), or
  speech bubbles (`bubbles`), limits their width, sets the side per role, and controls the
  sender label including its own name resolution. Without defaults, message defaults,
  owner presentation, and existing sender labels are kept. An explicit owner stays without a
  speech bubble; default bubbles are at most 86 percent on wide surfaces, full width on mobile.
- `messageActions` configures copying per text message, editing own messages,
  requesting responses again, and custom actions. Editing and requesting again
  appear only with a host callback; the components change neither the journal nor the model run.
  Asynchronous actions lock further actions of the same message until they return and report
  errors visibly. The default remains copying own messages. `texts` replaces the texts,
  including action and clipboard errors.
- `sendShortcut` on `ChatInputToolbar` chooses `enter` or `mod-enter` (Ctrl/Command+Enter).
  Shift+Enter stays a line break; IME input and key repeat do not send multiple times.
- `autoFocus` on `ChatInputToolbar` requests focus once as soon as the input is visible and
  enabled; the default is `false`. User actions or a foreign dialog end the
  request. `onAutoFocusSettled` reports both focus and cancellation to the host, which can use it
  to prevent focusing again after the input is rebuilt.
- `scrollOnSend` on `ChatPanel` enables following after a successful send and jumps
  to the end of the same panel. The local context also applies to messages that arrive
  only afterwards; errors and empty calls force no jump. The default is `false`: an
  existing reading position stays put, and normal following at the end stays active.
  A composer that is reset or removed discards its pending completions;
  they scroll neither a new input nor another view of the same panel.

`ChatMessages` can determine through `owner` a sender whose user and
assistant messages appear without a speech bubble. The comparison uses `sender`,
independent of role, color, and label. Without an owner or with `null`, the
message defaults stay in effect. This presentation owner grants no rights and is independent
of a run's human owner.
Mini-apps receive bundled, typed controls from it under `UI`. The mini-app plugin
adds forms, tables, file selection, progress, as well as document and diff views, and
also owns the lookup tool fed automatically from the type contracts. The host
contains no new domain branches for this. The chat can follow an actor of the same run or
receive history and send action from the mini-app (see actor-programs.md). The actor view shares the
inspector's history projection and uses the existing run connection. The input building block
waits for the send action and keeps the draft on errors. Questions without an answer callback
are shown as text with options.

A technical cancellation ends the wait on `ask_user` and closes the open question in the
journal as `dismissed`. The ask plugin derives neither a user answer nor a
new ActorInput from it. An explicit dismissal by the user, on the other hand, reaches the
waiting call; answers to restored questions without an active call are still
delivered as ActorInput. Outside a turn, the run's owner asks (`AskCall.agentId`,
`turnId: null`); `AskRequest.recipient` then names the actor the question is for. It is in the
payload, receives such an answer as ActorInput, and appears in the "asks" note; the question
itself appears, like every action of the owner, in the run chat, not in another
actor's chat. An action posed by the owner carries no name in front of it in the main chat.
`AskService.withdraw(runId, actionId)` discards an open question of the plugin: a waiting call
receives the dismissal answer; an actor receives no input.

A human's message to the asker settles a question that blocks the asker's running turn,
that is, one posed with `AskCall.turnId`: as soon as a not yet claimed
input with `origin: "human"` is waiting for the asker (`docs/spec/core.md`, Origin of an input), the
plugin closes the question as `dismissed` with the result `{ supersededBy: <inputId> }`. The waiting
call receives "Not answered: the user sent a new message instead." (`SUPERSEDED_ANSWER`), no
answer input is created, and the message enters the turn as steering after the tool result.
If such a message is already waiting when the tool asks, the plugin creates no question
and returns the same text immediately. Questions without a turn, such as the start question of `ragents.lsp-roslyn`,
inputs without `origin`, and messages to another actor leave a question open. In the chat,
the record of a question settled this way shows this text instead of "The user dismissed the question."

Every chat history reserves two normal text lines of free scroll space below the last contribution,
at least the 40 pixels of the bottom fade zone. A visible input box
additionally reserves its measured height. The spacing belongs to the content padding of the
shared history, also without input and in material cards. The input's height measurement
stays active on rerender; its ResizeObserver updates size changes without
removing the reserved space in the meantime.
Manually scrolling to the end enables following again. New messages, streaming, and
content loaded later then hold the actual scroll boundary including the footer space;
scrolling up pauses following. The jump-to-end button enables it explicitly.
Size changes alone do not switch following off and do not move outer dialogs.
Only an actual upward movement with mouse, touch, keyboard, or scrollbar pauses
following. Scroll positions limited by the browser through content or size changes
do not count as manual reading back. Hidden views keep their follow state.
The end button appears only at more than 120 pixels of distance to the end. `jumpToEndThreshold`
adjusts this visibility from outside, independently of pausing and resuming
following. Small upward movements may therefore pause following without showing the button
immediately.

If a chat's actor currently has a turn and the input is empty, the chat composer shows
"Stop work". The button interrupts only this turn through `ragents.runs.interruptTurn`
(`interruptActorTurn` from `@ragents/web/api`): the actor stays active and accepts the next
message; its children, other actors, and the run keep running. If only another
actor is working, the input pulses but offers no stop. This applies to the run chat (the partner is
the primary actor), the actor chats in the run panel, and the global
coordinator. With text or attachments, the send action stays available. Errors while interrupting
appear in the chat concerned and allow a retry. Stopping an actor permanently
is offered only by the actor card ("Stop"), stopping the whole run only by "Stop run" in the
title bar; no chat input calls `ragents.chat.stop`.

If a chat's actor is stopped, `StoppedActorNotice` takes the place of the input
(`@ragents/web/chat/StoppedActorNotice`): `@handle stopped: <reason>` and, for accesses with
`runs.write` and `runs.inspect`, the button "Restart" (`ragents.runs.restartActor`); the buttons
on the left of the input, such as the run panel's recipient choice, stay below it. The run chat
continues to treat an actor stopped as primary (`stoppedPrimaryActorId`, `chatPrimaryId` from
`@ragents/web/run-view`) as its partner, also in the actor bar and in the run panel;
after the restart it is the primary actor again and the chat continues. A mini-app's chat
also names the reason but does not offer the restart.

All chat inputs accept attachments through file selection, drag and drop, and the clipboard:
preparation chat, running chat, global coordinator, actor popout, and mini-app controls.
The shared composer shows images and videos as previews and files with name and size;
attachments can be removed before sending. A message without text is also possible.
The limits for count and total size are in the shared chat attachment contract in the code.
A send error keeps text and attachments. The run history contains durable, run-bound
download links and media previews, also after reopening.

For selected attachments, the host queries the input capabilities of the target model. Images
need `image`, videos `video`, and native PDFs `file`; a conflict blocks sending in the
composer. The server checks the same prerequisites again before accepting. Text files are
delivered as UTF-8 text; other files require file tools at the target agent. The
OpenRouter catalog contains the input modalities published by the provider. Videos are
transmitted as video input, PDFs with explicitly native processing, without automatic
OCR fallback processing. TypeScript actors receive files as referenced artifacts.

The composer slot `toolbarLeft` is reachable only for the owner of the surface; the host deliberately offers no general
composer toolbar slot.

Guided templates and Help samples use a draft in a page-wide dialog named "New run".
Closing discards the local draft without creating a run. The journal is created only when the run
starts. The dialog uses the run, start-option, and plugin providers for preparation.
Direct Start entries without a guide create an empty chat or launch the template immediately.

The start selection looks like Start in VS Code and consists of the same building block
`StartTiles` (`apps/web/src/StartTiles.tsx`) that `panel/StartPage.tsx` also uses: under the
heading "New" with the number of entries, first the server's default template
(`defaultStartEntry` from `ragents.plugins.bootstrap`, marker "Default") or, without one,
"New chat", then the other templates in the server's order, per tile category
(a run script without a category under "Run scripts", without `runs.inspect` under "Workflows"), title,
two lines of description, and "Start" or, for a guide, "Set up"; the start selection's width token
limits them to 880 pixels. Task input, start options, search, and preview do not exist
there. "New chat" is there only with `runs.create` and turns the draft into the open run without a request to the
server, whose task is created in the chat; a skill is there only with `runs.create`.
A template without a guide starts on click as in VS Code (`startEntryDirectly` in
`apps/web/src/chat/requests.ts`, the same call as `startLaunch` in the run panel): a run script
through `ragents.chat.start` with the start value `null`, a skill through `ragents.chat.send` with its
prepared task and the template as `entry`. The browser uses the same Start page with one
server. Guided starts use the preparation dialog. New browser runs use the server workspace.
While start options are loading or being saved, such as the preset from VS Code, and
as long as a start is running, the tiles are locked.
During the start dialog, the live stream and periodic query of the hidden run list pause.
After closing, they resume with an immediate refresh.
The draft subscribes only to the run stream to detect the start. Only the started run
opens a chat stream.

The guide of a skill template leads with its result into the next step in the same
modal. There a preparation chat begins with the editable prompt in the original quassel control, initially centered, after
the first message below the history. `ChatPanel`, `ChatMessages`, and `ChatInputToolbar` as well as
the same start options provide presentation, model choice, thinking level, and attachments. Sending discusses
the task with a separate preparation instance of the coordinator. It uses the
agent runtime and a base prompt shared with the global coordinator, extended by the
preparation role. Only an explicit go from the user to execute, in whatever words, allows it
`start_run`; there are no fixed confirmation phrases. Confirmations of details, quoted start commands,
questions about capabilities, and a skill's task text are not a go-ahead. When in doubt, the model should
ask. The separate button "Create run" still starts directly, both through
`ragents.chat.send` with the template's ID as `entry`. Both paths take over the discussed
history, skill, and attachments as the first run task; the button also takes along the last unsent
addition. Model responses are explicitly suggestions here. Errors keep the input;
"Stop discussion" cancels the request. Back keeps the start selection; the local
preparation history is discarded when leaving its step.

`ragents.runs.prepare` receives `RunPreparationRequest` and returns `RunPreparationResponse`;
the contract is in `apps/server/src/run-preparation-contract.ts`. The host uses the same
resolved coordinator selection as the later run. `ragents.overseer` provides the
preparation prompt through the global chat contract; if it is missing, the request is rejected.
Every request runs directly on the agent loop with the history sent along in memory.
The global conversation context, its management tools, and the plugins' hooks are not
taken over. The only tool, `start_run`, registers the handoff without requiring model arguments
for task, IDs, or files. Only after a successfully completed
agent turn does the server return either a response or the fully prepared
start task. The browser hands this over once to the same start path as the button.
Detecting the go is up to the model; there is no keyword check.
No run, journal, or working directory is created before the handoff. The history
stays in the browser and is sent along with each request. Attachments are processed
according to model capability; files that need a working directory are explicitly rejected.
Already started runs and parallel preparation requests are rejected; closing,
deletion, and shutdown cancel running requests. Cancelled, failed, or late
responses start no run.

When the run is created, the selected skill stays linked to the task and is loaded for
its first turn. The current, edited task takes precedence over a
default or example task in the skill. Back and Cancel lead to the start selection.
A run script opens its guide or starts directly;
as long as the start request is running, further starts are locked. Errors appear in the start selection.
A run script calls `ragents.chat.start { runId, entry, input }` with the guide result
as `input`. A workflow without a coordinator says so. After `send` or `start` is accepted, the start dialog closes
and opens the new run. In addition, the draft observes the existing run stream: as soon as
the server delivers a run, the interface switches into this run even while the start response is still pending.
The transition is reported only once. During a running
run query, further stream updates are combined into one follow-up query;
slow responses therefore stay visible even with continuous events. A run switch
or unmount discards late responses. An already closed start dialog cannot close a new draft through
its old start response. A rejected request without a created
run stays visible as an error in the dialog. The
run list is called "Runs", the default title is "New run"; a run script gives the run its
title.
As long as the surface has no visible content yet, it shows an animated progress bar
in the center while loading and setting up, with the current preparation step. This also applies with
hidden control actors. The display lies above the content
and takes an open sidebar into account. After
preparation, waiting inputs and active turns follow the actual run state;
questions, errors, and stopped runs replace the bar with a matching notice.
Visible content replaces the central display. The display invents no percentages.
Frequent live events discard no run query that is still running: the first response is
taken over, and further updates are combined into a subsequent query.
As a result, the start dialog does not hang even with slow responses. Already closed
start dialogs ignore late send responses, so that these cannot close a newly opened draft.

The shared header contains on the left the overview corner and the global coordinator, then
title and metadata of the active run, its start options, run status, errors, and attention notices. The plugin contributions
add visible apps, activity, and processes. Every main entry uses the shared
full bar height and separation. Installed tool shortcuts do not appear here.
The activity display reads running tool calls of all actors from the `toolCalls` of the
projected turns. Subagent tools carry the name of their actor; the identity of a
call consists of turn and call ID. It mixes in no additional entries from the primary
chat history. Completed, failed, and interrupted calls disappear.

Running tools come before the other running turns, the oldest first in each case.
As long as a turn has running tools, no additional turn entry appears for it;
afterwards its turn entry can appear again. The primary turn stays hidden based on `primaryActorId`;
its tools stay visible. This selection happens before the limit of
three entries and the remainder count. Chat histories and their level of detail are not extended by this.
The run-bound `sessionHeaders` are together with Settings and Help in the same
bar. `PluginChat` puts its contribution into this bar through a portal and keeps its
run providers and the `RunModalContext` in doing so. There is no additional title or placeholder bar
above the surface.

The OVERVIEW opens up runs and the plugin contributions placed for them. At the top left of the
header sits the overview corner: a square of bar height with a spark icon. A click
or `Cmd+I` on macOS or `Ctrl+I` opens the overview in the shared modal
dialog with `scope: "workspace"` over the run area, including the bottom status bar.
The header stays reachable. The global coordinator belongs to the toolbar and does not appear here
again. The former split into coordinator and run column, including the stored
width slider, is gone.

Clicking the corner again, the same shortcut, Escape, or a click on the background
closes the overview with focus returned to the corner. The shared `Modal` takes over
background, inert state, focus, and dialog stack. If a page-wide dialog is open, the
shortcut does nothing. The overview is mounted on first opening and then stays
mounted but hidden. Its open state is not stored; it does not change the split.
Opening the overview closes an open toolbar history; opening a toolbar history
closes the overview.

Overview contributions are sorted by `order` and filtered by `readRight`. The run list shows, in a responsive grid, cards with title,
processing status, creation time with date and time, last update, and the
plugin metadata. The creation time comes unchanged from the journal; during the
preparation of a run not yet created it is missing. The current run is marked;
the empty state reads "No runs yet." Selecting opens the run and closes the overview.
The grid is structured in descending order of last journal activity into local calendar days:
Today, Yesterday, and after that individual date headings. Older runs with new activity
therefore appear at the top again. The cards get a subtle colored header area.
Blue with a running icon means running work of any actor of the run, including
assigned workers; without active work the status reads Idle or Open, not Done.
An additional violet marker says New activity when the journal revision is newer
than the last viewed state. Without a personal read state it reads Not viewed.
The browser keeps the read state per user and run; other users and devices receive no
read receipt. Only a loaded run in the visible browser tab and without an overlying
overview, Settings, Help, start dialog, or toolbar history updates it.
List queries and background updates mark no run as viewed. The
revision comes from the journal; mere title compaction creates no new activity.
Without an explicitly set title, the list initially shows the original task.
The host can compact its first 4000 characters into a title line in the background: the
request asks for three to eight words, and the stored output stays limited to 80 characters.
The task goes into one user message after the instruction, wrapped in `<task>` tags, without a
system prompt, so that a model does not answer it. The model call uses at most 48 output tokens, reasoning switched off, no
client retries, and a deadline of eight seconds. OpenRouter chooses providers preferably
by latency. An error is logged; the original task stays as list text.
This generation changes neither run titles in the journal nor agent tasks.

After a finished title is stored, the channel `ragents.runs` reports the change to the
browser. The list is thereby updated without waiting for the periodic fetch. The
five-second fetch remains for further metadata. The actual model response has
no guaranteed immediate running time. Titles from `run_configure` or a prepared setup
still take precedence; stored automatic titles are kept when the model changes.

"New run" is the only main action of the run list: the first card of the list (with zero
runs the only one), as in the run panel, and it switches to the start dialog. Single and multiple deletion with All/None, confirmation, and
visible errors are kept; the profile rights determine whether opening, creating, or
deleting is offered. Without a run read right and without a visible contribution there is no corner.
The global header stays in one bar. When space is short, its middle run area scrolls horizontally; it can be
focused by keyboard. Long names stay limited to two lines. The overview corner as well as
Settings and Help stay reachable outside this scroll area.

On the left are the overview corner and the independent
toolbar contributions. The flexible area
next to them shows the details of the current run; on the right are the sidebar tabs and its
expand/collapse button as well as the gear icon for Settings and next to it a question mark
for Help. Both dialog buttons have accessible labels. Help opens the bundled
homepage under `/help/index.html` in a large page-wide modal dialog through an iframe.
The page fills the dialog without an additional title row or padding. An overlaid
Close button stays visible at the top right; the dialog name is provided for screen readers.
The embedded pages reserve space on the right of their header for this button,
without changing the standalone export.
The run stays intact in the background and cannot be operated in the meantime.
Close, Escape (also inside Help), or a click on the background close the
dialog and restore focus to the Help button. Internal page links stay in the dialog;
external source links open a new tab. Keyboard focus stays in the dialog.
Help and the statically opened documentation use high-contrast native scrollbars.
The iframe adapts its height to the available dialog space; the page scrolls within the frame.

"Start sample" appears in the built-in Help only for run scripts of the loaded profile
and with read and write rights for runs. The host checks the origin, the sending Help frame, and the
template ID. The sample links below the homepage previews also start
the associated run in Help instead of navigating to the reference. Outside the application they stay
links to the sample description. A click opens the existing run creation with the chosen sample:
a required guide appears directly; a sample without a guide is built immediately.
Errors stay visible in the run creation. On the standalone homepage,
preview, sources, and start instructions remain available; it creates no run.
Under `/help/` the server delivers exclusively the static Help. Missing Help files
return 404, text references a readable text content. `/help` redirects to `/help/` so that
relative page links resolve correctly.

`ragents.overseer` provides the global coordinator as a permanent toolbar contribution to the right
of the overview buttons. On display and after every user change, the contribution queries
the run ID of the user's own coordinator with `ragents.overseer.coordinator` and only then binds chat,
level of detail, and attachments to it; until then the space stays empty, and an error appears as an exclamation mark.
The VS Code extension shows no global coordinator; it does not see coordinators in the
run list either. The input shows "Global coordinator" as placeholder; a
separate heading and its own dropdown arrow are dropped. Input and status are on
one row; the input stays single-line and scrolls with more text, and the header keeps
its fixed height of 45 pixels. The contribution is up to 570 pixels wide. Focus in the text field
opens the history as a non-modal dropdown below the header. The input stays at the top; in the
history there is no second composer. Attachment, level of detail, model, reasoning, and reset
are in one shared control row. In a narrow view, level of detail and reasoning are
shown compactly; the model name is shortened if needed. The contribution has one conversation, one draft
with attachments, and one stream, independent of the active run. The shared composer logic
serves this arrangement as well as the other chat inputs.

Focus or explicit opening activates the stream for the first time. After that it stays connected for responses
even with the dropdown closed, until the application ends or the read right is lost.
Before first use, no new responses are reported. Run switches, closing, and
reopening keep draft, attachments, history, and running work. With an interrupted connection,
writing stays possible and sending is locked. A valid send action clears the draft immediately;
the shared composer logic restores it on errors or keeps it retrievable separately
if new text has been entered in the meantime. Enter sends, Shift+Enter adds a line. IME confirmation and
a held Enter send nothing. The text box shows at most two lines and scrolls longer
text; attachment previews are compact below it and do not enlarge the header.

Running work draws the same pulsing frame around the input as for working
agents in their chat. The state begins already during the send request and then follows the
running server state. The shared animation visibly strengthens outline and outer glow
and lasts 1.9 seconds; with reduced motion,
the highlighted frame stays without pulsing. An accessible status reports "Working";
the stop stays at the input. An additional spinner or "New response" notice is dropped.
Errors stay visibly attributed and are made recognizable at the top when the history is closed.
Responses do not open the dropdown and do not move focus.

When sending to the global coordinator, the interface captures its current location:
start view, run overview, or opened run, active area and tab, as well as an existing
element selection, such as an actor. The run overview can still name the run opened beneath it;
tab and element selection are passed only for the run view. The browser
transmits only small IDs; the server
adds run title, short run reference, and actor names. That way a question like "What is this
actor doing?" can mean the currently selected AI or TypeScript actor, without
the user copying an ID.

The orientation belongs to the sent input and stays unchanged even on a later run switch
or delayed processing. The visible message text contains no
appended context block. A message without UI information receives no current location;
earlier information is not taken over as the current location. View switches alone
send nothing to a model. The snapshot includes no screenshots, DOM or
form content, and no complete run state. The coordinator reads domain details
through its existing tools when needed; the orientation grants no rights.

With `quick_answer`, the global coordinator can briefly restate the current user question and its answer,
each a non-empty sentence of at most 240 characters without line breaks.
A new quick answer shows both texts automatically as a toast directly
below the toolbar input, only as long as the history is closed; with the history open,
no toast appears. The toast is twice as wide as the input, at least 480 pixels,
and begins six pixels below the shared header edge; question and answer are
one below the other, with a round X to the right.
Clicking the text area opens the conversation and focuses its input,
or the history for read-only access. Only the X removes the toast without opening the conversation.
Appearing by itself changes neither focus nor open state.
Opening the history and resetting the conversation remove an existing notice. The normal
chat response stays independent of this. The first replay shows no old quick answers.
After reconnecting, the newest quick answer from the meantime is taken into account exactly once based on its
conversation identity and journal sequence; a renewed replay does not show
dismissed toasts again. No separate read cursor and no visibility-dependent
read receipts are kept.

The dropdown has an accessible name, no combobox semantics, and no focus trap.
Tab, focus change, and clicking outside close it when leaving the whole area.
Input and history count together for this. Escape first closes an open
selection menu and then the dropdown; on closing from the history, focus returns to the upper
input without opening it again. Another click or starting to type
opens it again. The overview and page-wide dialogs also close the history but keep
the conversation. The dropdown height takes the visible viewport into account; when narrow, it uses
the available width. The input stays reachable at the top, as do overview, Settings,
and Help.

The global chat uses the coordinator's level of detail, `grouped` without a product default. Its
level of detail stays switchable and is stored in the browser separately from the run chats.
Model choice, reasoning, details, and reset are in the dropdown. The model selection is limited to the
available space. Created runs appear in the shared run list.

`Reset conversation` opens a highlighted dialog over the whole dropdown surface.
The existing modal host limits backdrop and blurred background to the global chat;
its remaining content is inert in the meantime. Focus starts on Cancel. During a
running reset, the confirmation cannot be closed. After confirmation, the
plugin route clears the global history and model context; running global work is
stopped beforehand. Input and model choice are locked during the reset. A successful reset discards
draft, attachments, and the displayed toast, also in other already connected views. An ordinary
stream rebuild discards no draft. Model/reasoning choice and normal runs are kept.
Errors stay visible and allow a retry; the reset issues no task.

Without the plugin or read right, the whole contribution is dropped. With read access without write rights,
the text input stays read-only and focusable, so that the history can still be opened through
focus. Send functions and other write actions are locked.
Server behavior and tool limits are in `core.md`.

Model and reasoning level of the global coordinator can be set in the dropdown above the
history. The same component is in Settings under Models and in the
plugin `ragents.overseer`. Both views share one state; only a confirmed
server response takes over the new selection. While saving, selection and sending are
locked; an error keeps the previous selection and the message draft. Available are
the configured models and their actually supported reasoning levels. The selection
is independent of the visibility of the start options of normal runs.

Web plugins contribute editable settings through `settings`. The host assigns each
contribution its plugin ID, checks for unique IDs, and sorts by order and ID.
With `category: "models"`, contributions appear in the Models area, with `category: "appearance"`
in the Appearance area. Without a category they stay on the associated plugin page before the
contribution inventory. Assigned contributions are additionally reachable there. The inventory filter does not hide these settings. Without the plugin,
its settings interfaces disappear together with its other contributions.

Settings open a page-wide modal dialog with `scope: "page"`. Its backdrop
also covers the title bar; the background is locked and keyboard focus stays in the dialog.

Settings start in the Models area with the editable contributions Global
coordinator as well as New runs and agents. The host adds titles with its own
model choice or No automatic titles. Larger catalogs get a search;
Save applies the draft, Discard changes restores the confirmed
selection. A load error can be retried; a save error keeps the draft.
With read rights the stored state is visible; changes need write rights.
Appearance contains theme and run panel.
These two areas load independently of the technical contribution catalog. An error of the
catalog fetch therefore does not block the existing settings forms.

Plugins contains the technical contribution inventory. "By plugin" shows the
plugin IDs on the left and their details on the right. "By capability" shows tools, prompts,
templates, skills, hooks, configuration, and web across their owners. Both
views use the same detail components, including skill files. Runtime shows
technical overview facts, configured models, profiles, and system prompt. These catalogs
are read views; new model defaults are edited in the Models area.
Skill templates show their single prompt with a copy action.

For tools, the settings response optionally contains the required execution rights
as `requiredCapabilities`. The browser check accepts this field as a list of names;
tools without it stay valid. Unknown tool fields, missing required fields,
and invalid field types are still rejected.

In both views the search acts on the contributions and their counters; capabilities without matches
show an empty state. The plugin view additionally keeps the filter by contribution kind.
When switching axes, search text and the last selection per axis are kept. The direct link
to a plugin opens its complete inventory without search or contribution filter. In
narrow windows the navigation items are on one row that can be scrolled sideways.

`index.html` is the only server HTML source and loads `main.tsx`, which composes `RunPanelApp`.
Vite emits an identical `run-panel.html` alias for the iframe host contract; both routes load the
same assets and initialize host modules, access, theme, and host navigation once. The server
rejects a build whose entry pages differ. `?run=<id>` chooses a run;
without a run the browser shows Start. The back arrow returns there. In VS Code the extension
owns Start, Runs, and Servers and sends the selected run to the panel.
`?layout=app&run=<id>&element=<id>` renders one app through the same catalog and renderer.
`PluginChat` has only `panel` and `{ element }`; the single `surface.RunPanel` contribution
receives `SurfaceCenterContext`. Without it the host renders the standard chat.

In the run panel, the sidebar tabs (`workspaceTabs`, `workspaceTabsFor`) are a
toolbar at the right edge (`RunPanelRail`, `apps/web/src/run-panel/`), below the
header across the full height next to the selected content view: per available tab a button with
the contribution's `Icon`, the name as tooltip and accessible label, the contribution's
badge small at the top right, and a dot at the bottom right when something
new has arrived since the last visit. Order and visibility are the same as in the web
(`registry.availableTabs`, that is, `readRight`, `requiresWorkspace`, and `available`). A click opens the tab area
(`RunPanelWorkspace`) as a popout over the selected content view, to the left of the toolbar: 8 pixels of
space all around, the surface below dimmed with `--backdrop`; if the run panel's content is
at least 960 pixels wide (container `chat-content`, two areas side by side), it covers only
the right 60 percent. At the top a header with the tab's name and an X,
below it the contribution's `Panel` with the same `WorkspaceTabContext` as in the web. The button of the
open tab is pressed (`aria-pressed`); another click, the X, Escape, or a click
on the dimmed surface closes the area; the chat below keeps size and state.
On opening, the popout receives focus.
Visited tabs with `keepMounted` stay mounted but hidden and receive `active: false`,
through `mountedTabs`. The open tab is stored per run
in browser storage (`ragents.run-panel.workspace-tab:<runId>` with `{ tab }`; `tab: null`
means closed); any other value is a hard error. `PluginChat` uses this same tab state in
both hosts. `SessionNavigation.openTab` opens the requested panel and `activeTabId` names it
while it is available.

A remembered tab that is currently not available (such as `Executions` before the first
run view) keeps the area closed until it is available again. Without an available tab
there is neither toolbar nor tab area; the layout `app` (a mini-app in the editor tab) never has
either. The chat reports the tab of the open tab area to the global coordinator as the opened
area in both hosts.
The run panel's header is one row (`RunPanelHeader`): title, a pulsing dot
during processing, the attention badge, and a chevron; a click on the title
opens the plugins' header contributions, the run metadata, and the start options as a
popover. The run panel's popouts (run details, menu, recipient) dim the rest
(`dim` on the popover building block), so that they stand out. At the far right is a menu (`RunPanelMenu`) with Settings (the same dialog as in
the web app), in the host `vscode` "Open in browser", and with a signed-in user "Sign out"; the
run list without a run and the header of the loading state before a run also carry it. `ragents.orchestration` provides the run panel (`web/run-panel/`): mini-apps come from the shared app catalog with `visible !== false`. In VS Code the panel stays on
chat and every app entry opens or focuses its editor tab. In the browser panel, Chat and the apps
are tabs with exactly one visible content view. Apps mount on their first visit and stay mounted
while hidden, preserving local input. New apps do not change the selection; an unavailable selected
app shows Chat. Questions and news remain in the chat.

Until the run has content, a loading state stands in the chat instead of the history (`useRunPanelStartup` in
`web/run-panel/run-panel-startup.ts`). Content is a mini-app or a conversation contribution: a
message from the user, a response with text or attachment, a question; system lines and
work steps do not count, because even the preparation of the workspace writes a
system line. What stands there is determined by the same logic as on the surface
(`surfaceStartupState`): connecting, the preparation with the server's message, the
work of the actors, an open question, a stopped run, and as an error a failed or
aborted setup or an unreachable run status, all in the same place and in
the same presentation (`StartupNotice` in `apps/web/src/ui/startup-notice.tsx`: title, with
running work a progress bar, below it what is happening right now). The run panel passes it
as `notice` to `renderChat` and to another actor's chat; the input stays operable,
the notice is centered and moves up only where it would otherwise end up under the input.
The pending panel already reserves the run status bar so connecting does not shift this center. With the first
content the loading state ends and does not return for this run. If work ends while the
chat is connected, the last display stays for up to 1.5 seconds until the run view
has caught up; that way the transition from the server's start status to the work of a run script
does not flicker. Connecting holds nothing: an empty, idle free run shows no loading state after
connecting.

The coordinator shows the main chat (`renderChat`), another actor its history with the plugins'
card sections and its own composer. Visited chats stay mounted when switching recipients so that
unsent drafts remain separate. The addressee selector is at the bottom of the input and defaults
to `chatPrimaryId`; runs without a coordinator retain their existing primary actor handling.
The popout lists all permitted actors as a "who created whom" tree, independently of surface visibility.
`addresseeTree` (`web/run-panel/addressee-tree.ts`) builds the tree solely from
`createdBy` of the run view: an actor hangs under its nearest creator that is itself in the tree;
a human or a creator missing from the view makes it a root, and the
coordinator comes first among the roots. That way, without `runs.inspect`, where TypeScript actors
are missing, an agent created by a program hangs under that program's creator. Siblings are in
creation order; from four of the same kind (the same kind and the same handle stem, the first word
of the handle without a counter suffix, such as `review-*`) the tree combines them into a group with the shared
prefix, count, and state count. A group is collapsed unless it contains the chosen
actor or a search is running; a click reverses that. Per entry there are the handle, a differing
display name, the short description (the actor's `description`, otherwise the first line of its first
own input, shortened to 90 characters, otherwise a differing display name), and the state:
`working`, `waiting for input` (an open action of the actor), `waiting`, or `stopped`. The
search appears only with more than twelve actors, finds every word in handle, display name, and
short description, shows matches together with their creators, and clears on closing. A click
chooses the recipient. Next to it the bar names the first working other actor with a spinner
and waiting inputs. Chosen app and actor are stored per run in browser storage
(`ragents.orchestration.run-navigation:<runId>`). This navigation state has its own storage key;
layout preferences are not migrated. Invalid navigation values are a hard error.

The run panel talks to its host through `apps/web/src/run-panel/host.ts`. The host `browser`
(default) opens links itself, navigates apps locally, and offers only the server for new runs; the host `vscode` (`?host=vscode`, only
embedded) sends `ready`, `runChanged`, `showStart`, `openInCenter`, `login`, `logout`,
`openExternal`, and `openPage` through `postMessage` to the surrounding window and receives from there `selectRun`, `newRun`
(with preset start options and optionally the ID of a template, which the start selection then
opens right away), and `theme`; the
import-free contract is in `run-panel/host-contract.ts`. After `newRun` in the host `vscode`,
the panel focuses the visible chat input that is ready for writing once, for templates after a successful
start. It waits for the chat connection. Existing runs, browser views, and pure mini-apps
receive no such start focus; reconnections or messages do not bring it back.
If the panel cannot execute a `newRun` because the right to new runs is missing or a free run is requested
without `runs.create`, it shows the reason and "Back to Start" (`showStart`) instead of the loading state.
`?theme=light|dark` sets the appearance
on loading. If the page runs without a sign-in cookie, it carries the access token from `?access=`:
`apps/web/src/access-token.ts` attaches it as `Authorization: Bearer` to every fetch to the
own server and as a query parameter to addresses without headers (mini-app frames).
A host that can show web pages offers itself to the interface as `PageOpener`
(`apps/web/src/page-opener.tsx`): domain plugins with an application preview ask it
first and then open a running application there instead of in their own dialog with an iframe; in VS Code that is a Simple Browser tab
(`openPage`); in the browser there is no host and the dialog stays. If the server then requires a sign-in, the run panel in the host `vscode` shows,
instead of the form, the request to the host (`AccessGate` with its own `Login`). The mini-app frames allow as
ancestors, besides their own origin, the VS Code webviews (`https://*.vscode-cdn.net`,
`vscode-file:`, `vscode-webview:`).

The VS Code shell scales its whole interface with `ragents.zoom` (50 to 200 percent,
default 100), independently of the window zoom and the font size settings of VS Code.
The scaling applies once at the outermost shell, also for nested mini-apps. Start,
Runs, Servers, run panel, and mini-app editor tabs take over changes through a host message
without reloading and keep their state. Normal browser pages stay unchanged. A value
outside the limits is an error: every view shows the message instead of its content and rebuilds
itself as soon as the setting is valid again.

The VS Code extension under `apps/vscode` is such a host, and for several servers
at once: every configured **server** (a RAgents server by address or a local profile) has
its own session with connection, runs, templates, and workstation. "Server" is the name in every
visible text; in the code the types are called `Connection*`. Without a chosen run, the panel in
the secondary sidebar shows one of three pages - Start, Runs, or Servers; they are a separate
page composed from the shared web components (`apps/web/src/panel/`) that runs without a server, receives its state as
`PanelState` from the extension, and sends its actions back as `PanelAction`. With
a chosen run, the run panel of its server is there as an iframe; per mini-app an editor tab
with `layout=app` is added. `PanelState.page` therefore carries four values (`start`, `runs`, `run`,
`connections`), and the action `page` only the three the panel may switch to itself; with
`connection`, the chip on Start passes its server to the Runs page, and the extension passes it back
as `PanelState.runsConnection`. The paths between the pages and the commands (Start, Runs,
Servers, New run, Refresh) are exclusively in the view's `view/title` menu; the
pages themselves carry no icons for them (`panel/PanelHeader.tsx` has only back arrow and title,
Start no header), and the commands `ragents.showStart`, `ragents.showRuns`, and
`ragents.showConnections` also work while the run panel's iframe is shown. In the host `vscode`, the run panel itself executes paste, copy, and cut
(`installClipboardBridge`, `apps/web/src/run-panel/clipboard.ts`): macOS delivers these commands through
the application menu, and VS Code passes them only to the document of its webview, never into
an iframe of foreign origin. The run panel therefore fetches clipboard text and files through the shell
(`clipboardRead` and `clipboardContent` in `host-contract.ts`), which is the only one allowed to read it; the
extension does not see these messages. After reading, the shell restores focus to the run panel
frame before returning the content. Files from the shell's paste event travel as structured-cloned
`File` objects. The requesting input receives a paste event with these files, so the shared composer
handles previews, removal, limits, and model capabilities. Plain text retains native undo through
`insertText`. Each relay restores its captured child iframe before forwarding
the reply, unless the frame was removed or the transport disposed. The requesting frame then
focuses its own window before its input,
including for an empty clipboard. An input can still be its document's active element while
the document itself has lost focus. Unhandled key presses and releases are passed by the
run panel through `installKeyboardBridge` as `keyboardEvent` to the shell. The shell checks source,
origin, and message shape and dispatches a `KeyboardEvent` there; VS Code uses its normal
keybinding resolution, including custom bindings and key chord sequences. The
messages do not go to the extension host. Paste, copy, cut, local
text editing, IME, and already handled keys stay in the chat. Normal character input is
not suppressed; print, find, and save browser defaults are prevented before passing on.
The asynchronous frame boundary provides no synchronous feedback about matched bindings;
local editing keys therefore take precedence.

Hosted mini-app frames use the same input handlers. The existing MessagePort connection,
checked by frame token, transports keyboard events and clipboard requests
up to the run panel; responses go back to the requesting frame. The VS Code root
enables this capability, and further hosted frames pass it on. Without this enabling,
native input is kept in the normal browser. The function does not depend on a
particular chat building block but also applies to normal text fields in mini-apps.
The nested clipboard browser regression waits for both editor and document focus with
frame-local polling before typing, without refocusing the editor through a locator action.

There is no longer an Explorer tree next to it: Start and
Runs show the same servers, runs, and templates more flatly, and a second navigation tree would be
a second truth. Every session speaks the same
message layer with the same client (`RpcClient` with its own `fetch` and bearer), keeps its
own event stream, signs in itself with `POST /api/access/login`, and reads its
templates from `ragents.plugins.bootstrap` of its server; operation and limits are in
`docs/usage.md`.

**One vocabulary for all pages.** Per state there is exactly one word and exactly one colored icon;
in the panel the icon is shown, the word only in the `title`. The words are in
`apps/web/src/ui/state-vocabulary.ts` (without React, so that the extension can read them too), the
icons and colors in `ui/state-icon.tsx`. A run is running, waiting for input (with the number of open
inputs next to it), idle, ended, failed, or cancelled; a server is connected,
ready, starting, sign-in required, unreachable, or stopped, plus failed and
no access as the two error cases. `panel/connection-state.ts` maps `ConnectionView` onto this: a
connected local profile is **ready**, a connected server **connected**. No plugin,
tool, or mini-app name ever appears as a state. The time is compact and without "ago"
(`ui/relative-time.ts`): `now` under one minute, then `5 min`, `3 h`, `1 d`, `2 d`, from seven
days on the date `09/13`; the written-out form is only in the `title`. No state icon ever carries
the stop glyph (a square, alone or in a circle): cancelled and unreachable are a
circle with a slash, ended a check mark in a circle, idle and stopped an empty circle. Every
real stop button comes from `ui/stop-button.tsx`: `StopGlyph` is the filled square in
`--destructive`, `StopButton` the button for it (icon, word in the `title`, same hover and disabled state),
and `RunPanelApp`, `ChatInputToolbar`, `ragents.processes`, and the menu entry "Stop run" of
`ragents.orchestration` use only it. The term throughout the web is "run", never a synonym: ending
the whole run is called "Stop run" everywhere, interrupting the running turn in the chat "Stop
work".

**Start** is the Start page and has no header. The **servers** are a block of their own
at the very top, with a count in the heading, and do not filter: equally wide chips in a grid -
two per row at 420 pixels, all in one row from 560 (container query `@[560px]/panel`). Every chip
is a split button: the left part is a `button` with `aria-label`, state icon, name, and
an action word in muted small type that depends on the state ("Sign in" for
`login-required` and `forbidden`, "Retry" for `unreachable` and `failed`, "Start" for
a stopped profile and "Connect" for a stopped server, "Runs" for `connected` and
`ready` with the action `page` including `connection`, "starting ..." for `starting` as a locked
button); below it, in the monospace font of the time, the route line from `ConnectionView.route`
(`panel/connection-state.ts`, `routeLabel`): `local · <profile>`, the server's host, or
`<host> · local` when a server has distributed a client profile. The extension provides `route`
from the connection and `ConnectionSnapshot.localHost`; the page guesses nothing from paths or addresses.
The right part is the plus behind a fine divider: it sends `newRun` with the
`entryId` from `ConnectionView.defaultEntry` when the server's profile names a default template,
otherwise without `entryId` as an empty chat; without the start right an empty placeholder of the same
width stands there. For `failed`, `unreachable`, and `forbidden`, the state icon is a button of its own
("Show error of <server>"), which opens a `Popover` with the state word as title, the
message from `ConnectionState.message` (`stateDetail`, the same source as the Servers page), and
the buttons "Open output" (action `showOutput`; the extension shows the RAgents channel) and
the chip's action word; the popover survives the short `connecting` state of an
automatic retry and closes as soon as the server is without error again. For
`login-required`, the lock opens the sign-in dialog ("Sign in to <server>"); in all
other states the icon has no action of its own. The separate icon button is 32 pixels wide
and centers the icon; the following content begins with 8 pixels of padding. Below that,
**Continue** with the last five runs of all
servers in `RunList` (`panel/RunLine.tsx`): a CSS grid with the columns state, title, time,
and, from two servers on, server, in selection mode the checkbox in front; every row and its
button are `grid-cols-subgrid`, so that the columns stand at the same edge in all rows, and
"All N runs" leads to the Runs page. If the extension cannot read a run's run view,
for example because of an invalid program state, it stays as a row with the reason
(`ConnectionRun.problem`, a red notice icon with a tooltip); the other runs, the badge, and the
status bar stay unaffected. Below that, **New**, as soon as a server is connected and
allows new runs: per such server first its default template - the template from
`ConnectionView.defaultEntry` with the marker "Default", without a default the entry "New chat"
(category "No template", dashed edge, plus icon, `newRun` without `entryId`) -, then
all other templates of all servers flat, the default not a second time; the
count in the heading counts all entries. An entry shows category,
title, two lines of description, at the bottom "Start", for a template with a guide, as in the
web app, "Set up" (`ConnectionEntry.guided` from the template's `guide`), and on the right the server; skill round and
`--primary`, run script angular and `--success`, the grid
`repeat(auto-fill, minmax(182px, 1fr))`. There is no search here, and `ListDetail` does not fit,
because it measures itself by its own width and would become a list with a detail page at 420 pixels
(decisions of 09/19 and 09/21/2026). The tiles including the heading are the building block
`StartTiles`, the same as in the browser's start selection.

**Runs** is the same merged list, only complete: search over title and server,
"Hide ended", the server filter from `PanelState.runsConnection` as a pressed toggle
with the name (a click removes it; the page is rebuilt per server), and a
selection mode with checkboxes, which names the count in a bar at the bottom
and deletes several runs after a confirmation question in a dialog. The deletion itself is the
host's business: the page sends `deleteRuns` per server with the IDs, the extension calls
`ragents.runs.delete` and refreshes the list.

**The host `vscode` needs the run panel's start selection only for guides.** A click on a template sends
`newRun` with `name` and `entryId`; the extension creates the run on this server (bound to
itself as workstation with the workspace folder, unless the template fixes the workspace itself;
then it also asks for no folder, `preselectable` in `overview-model.ts`), the run panel
in the host `vscode` sets the start options the template does not fix
(`withoutFixedStartOptions`), calls `ragents.chat.start` with the start value `null` for a run script
and `ragents.chat.send` with the skill's prepared task and the
template as `entry` for a skill, and then opens itself on the
running run (`startLaunch` in `run-panel/RunPanelApp.tsx`). If the template names a guide
(`registry.guideFor`), the run panel does not start it itself but takes the web app's path:
the start selection with this template (`initialEntryId`), in it `openStartEntry` with the guide,
whose result is the start value; after the start the run panel opens on the new run, and
closing leads to the Start page. A start counts only as long as it is the current one: a later
click on a template, a free run, a chosen run, or the way back supersede it, and its
result then opens nothing anymore; an already created run stays in the list. The entry "New chat" and the plus of a
server without a default send the same without `entryId`; the run panel then immediately opens an
empty run whose task is created in the chat. The default template comes from the server: `RunStore`
reads `defaultStartEntry` from `ragents.plugins.bootstrap` and rejects one that is not among
the delivered templates; `ConnectionSnapshot.defaultEntry` and `ConnectionView.defaultEntry` pass
it through; the page guesses nothing. `newRunChoices` in `overview-model.ts` makes it the first
row of its server in the QuickPick of `ragents.newRun`.
For this the extension first shows the run panel without a run and sends `newRun` afterwards, for a
newly built iframe only on its `ready`. Without a chosen run, the run panel in the host
`vscode` therefore never shows the run list, but, under the same header as a run (back arrow,
title, server pill, menu), the loading state "Starting run"; even loading the
profile before that shows it in the same presentation. The start of a template keeps header,
presentation, and place and names the template's title; the run panel then continues the loading state
in the chat until the run has content, and the new run carries, until its entry in the
run list, the title of its template or "New run". If the start fails, the
reason and "Back to Start" are shown there; if no start request arrives within five seconds,
"No run selected" is shown there with the same way back instead of an endless loading state.
The run panel's header carries on the left a back arrow that always leads to the Start page
(`showStart`, the intent instead of its consequence `runChanged`), then the run title, on the right the
server pill from `?connection=`, the state icon, and the stop as an icon.
`StartSelection` is the browser's path and, in the host `vscode`, the path of a template with a guide.
For this `ConnectionEntry` carries, besides `id`, `title`, and `description`, also `kind`, `category`, and
`guided`; a run script may name its own `category` in its `RUN.md`;
without one it is under "Run scripts".

**Servers** is the page where setup happens: per server a row with icon,
name, kind, address or profile file (shortened, full path in the title), and state icon, plus
Connect and Disconnect, Sign in, Sign out, Edit, and Remove with a confirmation question in a dialog; at the bottom,
next to "New server", the jump into `settings.json`. A
local profile no longer has "Start" and "Stop": the extension starts it silently as a child process on
activation, and the row shows only "starting" and then "ready". Besides `PRODUCT_PROFILE`,
`PRODUCT_PROFILE_FILE`, and `DATA_DIR`, the child process also receives `RAGENTS_PARENT_PID`
with the extension's process ID. On an orderly end, `deactivate` waits until all
sessions are disconnected and all own hosts are stopped, at most four seconds, because VS Code gives
the extension host only a short time to clean up on reload; after a crash or force quit, the host
ends itself through its watchdog (section Profiles in [profiles.md](profiles.md)). An
orphaned host would otherwise hold the writer lock of the profile folder. None of this is a form on the page: "New server" and
"Edit" open the same dialog (`panel/PanelDialogs.tsx` on `ui/dialog.tsx`) with a toggle
Server / Local profile, the fields, the error below the fields, and Cancel/Save; for a
profile, "Choose file ..." chooses through the VS Code file dialog with `defaultUri` on the host folder;
next to it the profiles found there are offered as suggestions (`PanelState.profileSuggestions`), and
the name comes from the file name. "Sign in" opens the same dialog from both pages with
`LoginForm` in the dialog body. Editing sends `updateServer` or `updateProfile` and replaces the
entry in its place in `ragents.connections`, so that renaming keeps the stored
sign-in data - it is tied to the address, not to the name.

## Workspace, sandbox tools, and processes

The workspace plugins give agents exactly four
sandbox tools from `@ragents/workspace-executor`: `read` (line numbers, truncation at 2000
lines or 50 KB), `edit` (unique match; for an ambiguous `oldText` it names the locations with
line numbers, optional anchors `occurrence`, `nearLine`, and `replaceAll`), `write`, and `bash`
(the last 2000 lines or 20 KB, lines over 1000 characters shortened and marked, the full
output then in a log file whose path the result names). `ls`, `grep`, `find`, or a separate type check are not tools, because
`bash` can do them and the sandbox knows no permission level below bash. `git` runs
without restriction in the run's working directory; a plugin provides credentials through the
sandbox's Git environment (`SessionWorkspace.gitConfig`) to the server's executor.

**Seen file state.** The model never names a hash; the host keeps a file's state.
A direct call of `read`, `edit`, or `write` by the model passes along the state that
this actor last saw of the file: after a `read` including the excerpt (`offset`,
`limit`), after its own successful `edit` or `write` without one. The server
(`WorkspaceSandboxHost`) keeps it in memory per run, actor, model context, and path as the
model writes it, and passes it to the executor of the machine that has the file as the field `seen`
of the operation (`null`: nothing seen); the executor compares the resolved file and the SHA-256 of the
content and reports the new state back in `details.seen` (`packages/workspace-executor/src/sandbox-tools.ts`).
The executor thus stays without state, also on a workstation. `edit` on a file without a
seen state fails with `workspace-file-unread` ("read the file with read first"), on one
changed since then with `workspace-file-changed` ("... changed since reading ...; read again");
`write` checks the same for an existing file; a new one is created without `read`. After its own
`edit` or `write`, the new state counts as seen. Another `read` of the same excerpt
of an unchanged file answers with "Unchanged since the last read in this conversation;
the earlier content still applies."; a state from `edit` or `write` does not trigger that, because the
model has not seen the whole content then. The model context (`ToolScope.modelContext`,
set by the agent runtime on every direct call) names the run's conversation and the
actor's last compaction (`core.md`); after a compaction or a conversation reset
the marker starts empty.
Calls from TypeScript (snippets, actor programs) and `files.read` run without a marker, because their
result does not end up in the model context: they check nothing and remember nothing. A server restart,
fork (a new actor), run move, and run stop clear the marker; that requires at most a
new `read`, never a wrong notice. An input with the former field `expectedHash` is
ignored, old journals stay readable, and a replay executes no tool again.

The **executor** is the package `packages/workspace-executor`, built from modules: every module
registers named operations whose handlers receive the process context of this machine, and
optionally its cleanup per run (`stopRun`) and on ending (`shutdown`). `shutdown` is final:
nobody calls the executor again afterwards, and a module may reject later calls with a cause;
whoever needs one again builds a new one. The executor itself
(`WorkspaceOperationExecutor`) knows no operation name; an unknown one fails with
`workspace-operation-unknown` (400), a doubly registered one already at construction. An executor carries
its own modules and the plugins' contributions (`workspaceExecutorModules({ contributions })`,
section Contributions to the executor): the four sandbox tools with process groups,
environment, and path checks (`read`, `edit`, `write`, `bash`), the language server sessions for every
language server a contribution brings along (`<id>_open`, `<id>_diagnostics`, `<id>_close`,
`<id>_snapshot`, with solutions `<id>_solutions` and `<id>_switch`), the files (`files.list`, `files.read`, `files.watch`, `files.attach`), the
processes (`processes.snapshot`, `processes.stop`, `processes.stopAll`), the commands (`commands.run`),
the contributions' modules, such as the browser of the browser check (`browser.*`, section
Browser checks), and the folder per run. No language, no language server, and no browser is
built into it. After `edit` and
`write`, the tool module asks all modules for an annotation on the written file; the
language servers attach their diagnostics this way. Messages of the file tools name the path as
the model passed it, also with an alias, never the resolved one under the data folder. The interface is
`execute(runId, operation, input, options)` with progress as a JSON value and cancellation, plus
`stopRun(runId)` and `shutdown()`; the executor knows neither engine nor run contract nor plugins,
but only folders, environment, and calls of its own machine. A domain error of an
operation carries an ID and status (`WorkspaceOperationError`) and arrives at the caller as a
`DomainError`, regardless of whether the executor ran in the server or on the workstation. A further
capability that needs the workspace's machine becomes a further module and, if it belongs to
a plugin, a contribution of that plugin. Server and VS Code extension import the same package;
it is never loaded later at runtime; at runtime only the plugins' contributions are added.

This contract is the only seam to the workspace: `WorkspaceRuntime` resolves the
folder per run, and `SandboxServices.execute(runId, operation, input, options)` is the plugins' only access
to it. Every root belongs to one machine: the run's root to the machine of its
binding, the additional roots with an alias (`@actors` of the actor programs, `@skills/<name>` of the
skills, section Skills and starting tasks) to the server. An operation runs at the executor of the
machine that owns the addressed root; the binding (`executorFor`) determines only the run's root
and thus where an operation without an alias runs: on the server in the server's executor, on
a workstation in its executor, regardless of whether in the new or in an existing folder. Which roots
an input addresses is declared by the module that owns the operation, with its footprint
(`WorkspaceExecutorModule.footprints`, per operation a function of the input that never throws): the
file tools with `path`, `bash` with `cwd`, the language servers with `root` and `paths`, `files.list`
and `files.read` with `alias`. A path with an alias addresses its root, every other one, even an
absolute one, the run's root; an operation without a footprint addresses no particular one. In addition the
footprint names the running time an input itself requires, for `bash` its time limit; it counts
as `durationMs` if the caller names none. `SandboxServices.execute` asks for the footprint
at the server's executor, which carries the same modules as every workstation, before it
sends anything: if the input names an alias, the operation runs at the server's executor in the context
of the run there (`serverProcessContextFor`, below), otherwise at the binding's executor. If a
call of a run on a workstation addresses roots of both machines, such as `<id>_diagnostics` with
`root: "@actors/app"` and `paths: ["src/a.ts"]`, it fails with `workspace-roots-mixed` (400) and
the cause that one call reaches only one machine; for a run on the server all
roots are on one machine, and nothing changes. The sandbox host decomposes no input itself;
a new operation with paths declares its footprint in its module. The four tools, the
language server tools, the tab `Files`, the process display, the browser check, and the
source file of `typescript_eval` all take this path; there is no "local or remote" branch
in the code of a consumer. Every method and every channel that leads from outside to the
workspace of a run (files of the working directory, process display, language server
state) first checks run and access with the host service `workspaceGuardToken`: a run that
only its owner operates (`ownerOnly`) is reached, even for reading, only by that owner, whatever the rights
(`run-workspace-owner-only`, 403). The same rule decides which run metadata with
`requiresWorkspace` the run list queries, and provides `workspaceAccessible` per run for the surfaces.
The check knows no workstation, only ownership of the run;
tools, lifecycle, and the run's own work run in its name and do not need it. No
plugin gets a local handle on the folder: on a workstation, `currentRoot()` of the `SessionWorkspace` fails loudly with a cause instead of
returning a path that looks usable on the server. What really runs on
the server, the native execution of `typescript_eval`, the actor programs, and every
operation on a server root, receives with `SandboxServices.serverProcessContextFor(runId)`
an explicitly named server context: on the server the same as the tools, on a
workstation a separate folder of the run in the run storage (`plugins/ragents.workspace/server`)
as the run's root, which is created on first need, never the workstation's path; the server's roots
and the run's process sandbox belong to it in both cases. `typescript_eval` with
`path` reads its source through `files.read`: relative to the run's root from the binding's executor
or with an alias such as `@actors/...` from the server, also for a run on a workstation; the server rejects an
unknown alias with `workspace-alias-unknown` and names the known ones. For the
model, `git` runs in `bash`. If a plugin itself needs a program in the workspace, such as `git`
for a view, it calls `commands.run` at the run's executor and evaluates the result itself;
it starts no processes of its own against the folder and computes no paths around it. Whoever fulfills the
contract thereby decides for all plugins at once where the folder lies and who
executes in it. `ragents.workspace` is the fulfillment in core; the
optional `WorkspaceResolver` (section Ownership per facet) is the
hook through which a further plugin contributes the content of a new folder, its own kind of
workspace on the server, or the new folder on a workstation. In core, no plugin
uses it.

Where and in what a run works is decided by its binding: the start option `ragents.workspace.binding`
of `ragents.workspace` with two separate values, `{ machine, folder }`
(`plugins/ragents.workspace/contract.ts`). `machine` is the machine, `"server"` or
`{ client, label }` for a connected workstation; `folder` is the folder, `"fresh"` for a
new one per run or `{ path }` for an existing one. All four combinations are valid. The default is
the new folder on the server, the empty folder under the run storage. An existing folder on
the server is an absolute folder of the server machine that exists at the time of choosing; the run works
directly in it, and neither stopping nor deleting the run touches it. A workstation is one of the
acting user: `accept` requires that this user has signed it in, for an
existing folder that the workstation offers it, and writes its label into the value so that the
run can name it even without the registry. For the new folder on a workstation, `accept` records
its path there, `{ path, fresh: true }`: the folder with the run's ID under the folder
for runs that the workstation names on sign-in (`runsDirectory`, with its separator;
the VS Code extension and the headless workstation take `runs` in their data folder, on macOS and
Linux `~/.local/share/ragents/workspace/runs`). That way the resolution stays possible without the workstation
and deterministic. On the server a new folder has no chosen path; there
`{ path, fresh: true }` is invalid. Another user's workstation behaves like a disconnected one,
and the selection in the web (`describe`) names only the workstations of whoever fetches it, plus per
machine what the new folder is called there (`fresh.server`, `fresh.client`, `null` where there is none),
and whether an existing server folder is allowed. A workstation that has left the registry
stays in the selection as "Workstation <label> (not connected)" as long as the binding
names it. Every binding to a workstation makes the option declare, with `ownerOnly`, a run that
only its owner operates, because its tools run on the machine and with the credentials of this
owner; everyone who sees it may read its journal and stop it, but only the owner may reach its
workspace (above).

The new folder on a workstation is created by that workstation's executor, with the operation
`runFolder.create` of the module for folders per run; only an executor that knows a folder for runs
has it in operation; the server's executor rejects it with `run-folder-unavailable` (409). The host calls it
before the run's first task in this server lifetime, never for cleanup (`whenReachable`), and
then runs a contribution's steps (`WorkspaceResolver.workstation.prepare`), but only if
the folder has just been created; after a restart it finds the folder in place and changes nothing.
If a step fails, `runFolder.remove` cleans the folder up again, and the next task
starts anew. Deleting the run stops it, runs the steps of `release`, and cleans up the
folder; if the workstation is not reachable then, the folder stays with a notice in the
log, and the run is deleted anyway. The workstation itself accepts tasks only in
its offered folders and in the run's folder under its folder for runs, never in the folder
of another run; an ID with path characters is not a folder name there.

Journals are immutable, and older ones carry the binding in the shape from before this separation,
`{ kind: "fresh" }`, `{ kind: "path", path }`, or `{ kind: "client", client, label, path }`.
`storedWorkspaceBinding` maps each of these on reading to exactly one current combination: new
folder on the server, existing folder on the server, existing folder on the workstation.
This is the only place that knows the old shape; server, `ownerOnly`, and web read stored
values only through it; `accept` and fixed start options accept only the current shape. Whatever matches neither
of the two shapes locks the run with the cause "The stored
workspace binding is invalid".

The VS Code extension and the headless workstation (`pnpm workspace-client`) always bind
themselves with an offered folder, even if the server runs on the same machine, unless a
template fixes the binding (plugin contract, start options); runs without a workstation
(web, `pnpm driver`, container) choose the server as machine, and the preparation chat in the VS Code run panel chooses
the new folder on a workstation; the browser offers no workstation (`machines`). On a workstation, the bound folder is the run's whole working directory
and its `cwd`: this path is what the workspace description in the system prompt names, because
a server folder there would name a different path to the agent than its tools
use. For the server it is only a name. On the server, for such a run, the
separate folder for work that runs there is created only when needed (above, the `cwd` of `serverProcessContextFor`). The
agent runtime needs no folder; its model context is in the journal; only the workspace description
names a path for the prompt. An attached chat attachment that the
model is to read with its file tools goes through the operation `files.attach` to the run's executor
and lies under `attachments/` in the workspace, so for a workstation there.
Actor programs keep their own folder under the run storage. The resolution never fails
because of a missing client or folder, because the server resolves all workspaces at startup; only
the individual tool call reports `workspace-client-disconnected` (409) or
`workspace-path-missing`. The plugin's prompt tells the agent that a project folder is the user's real
project; which binding applies is stated as a system note at the start of the run. The plugin provides the same
binding as the run metadatum `ragents.workspace` (`binding`, `summary`) for
the run list and header.

A workstation is a client that offers its file system to the server. It signs in with
a stable ID through `ragents.workspace.clients.register` (label, hostname,
platform, offered folders); the connection of this request becomes its way back and therefore
needs an event stream. In the VS Code extension every window has its own ID
(in the window's `workspaceState`), the headless workstation one per machine and folder set;
two windows therefore never displace each other. Over the network, the server accepts a sign-in only from a
signed-in user of a profile with `users`; without users (open server, `ACCESS_TOKEN`,
`anonymousUser`) there would be only one owner for all accesses, and anyone could bind runs to someone else's
machine. There a sign-in is therefore valid only over a loopback connection
(`MethodContext.local`); otherwise it fails with `workspace-client-login-required` (403). The
VS Code extension does not sign in in this case and names the reason at the server. `ragents.workspace.clients.unregister` signs out,
and `ragents.workspace.clients.list` shows the state: signed in is whoever is currently connected. When
the connection ends, the workstation leaves the registry; nothing needs the entry afterwards, because
a run carries the ID in its binding and signing in again recreates it. Signing out
is therefore idempotent: a workstation without an entry is not an error; the method returns `null`.
It acts only through the connection that holds the entry; a sign-in with the same ID over a
new connection replaces the entry, and the open calls over the old one fail immediately with
`workspace-client-disconnected` instead of waiting on a half-open connection.
On signing out, a workstation first releases its handlers, which closes its event stream;
the server may therefore already have removed the entry before the sign-out arrives, and a
sign-out after a disconnect must still go through. The registry lives in the server's memory;
after a restart every client signs in again, and bound runs stay valid.

On the workstation (`plugins/ragents.workspace/client`), every sign-in has its own
executor, built from the contributions the server names before the sign-in (section Contributions to the
executor). Signing out, whether explicitly or because no folder
is offered anymore, releases the handlers, signs out at the server, and at the same time ends the executor
of this sign-in with `shutdown`; the next sign-in builds a new one. It waits for the server
at most three seconds, a sign-in at most ten; a hanging server thus holds up neither
ending the extension nor language servers or browsers. Signing out waits for a sign-in that is still
running, and a later sign-in waits for the sign-out, so that the server sees both in
the workstation's order and an old sign-out never removes a new sign-in.
If the `RpcClient` loses the event stream (end, error, or 45 seconds without data, although the
server pings every 15 seconds), it aborts all handlers still running for the server: their
response would no longer reach it, and an observation or a long bash would otherwise run twice.
Afterwards the workstation signs in again through the same, still running executor as soon as the
event stream is back; if the server then names different contributions, for example after a restart with
a different profile, the workstation builds a new executor from them and ends the old one.

The extension and `ragents workspace-client` use the same `WorkspaceClient`, executor,
bundled-tool resolver, and HTTP sign-in client. The latter renews rejected sessions with configured
credentials, shares one in-flight login across concurrent requests, and retries each rejected
request once. Only the server's `login-required` refusal permits credential renewal; a token gate
requires an access token and never receives a password login. Each silent sign-in attempt logs
the server origin, without credentials, to the extension output or CLI stderr. VS Code obtains credentials from its secret store, the CLI from `RAGENTS_USER` and
`RAGENTS_PASSWORD`; `RAGENTS_TOKEN` supplies an initial or personal token. Credentials are never
arguments or log output. Missing or rejected credentials produce a visible sign-in failure; the
CLI unregisters and exits nonzero. A reconnect re-registers through the existing shared path.

A CLI workstation belongs to its launching process and terminal by default. SIGINT, SIGTERM,
SIGHUP, stdin EOF/close, IPC disconnect, or a dead owner initiate unregister and executor shutdown,
also during provisioning. The npm launcher forwards shutdown over IPC so Windows can shut down
cooperatively. Its worker watches both the launcher and the launcher's parent, checking every
second. After at most 15 seconds shutdown forces process cleanup. Remaining child processes,
including build helpers, are removed before exit (POSIX process enumeration, Windows CIM plus
`taskkill /T /F`); the npm launcher also clears the worker's POSIX process group. The extension
unregisters on deactivate and its local host already watches its parent.
`--detached` explicitly removes stdin, SIGHUP, and parent ownership for nohup or service managers;
SIGINT/SIGTERM still stop it. It does not fork a daemon or redirect standard streams.

Launcher-only differences preserve the same workspace effect: VS Code's loopback pre-check
anticipates the server's identical registration rule; folder changes rebind through `update`,
while CLI folders remain those supplied at startup; IDs are stable per VS Code window or per CLI
machine and folder set. None changes tool availability or execution.

A client belongs to the user who signed it in (without sign-in to nobody, `null`), and
the registry keeps it under owner and ID. Two users with the same ID have two
separate entries; signing in, signing out, and disconnecting one never affect the other.
`ragents.workspace.clients.list` returns only the caller's workstations, even with
`runs.read.all`, and signing out affects only one's own entry. Execution always happens on the
workstation of the run owner (`RunState.ownerUserId`) with the ID from the binding, and
the same applies to the prompt contribution about the platform; a run without an owner finds only a
workstation signed in without a user. There is no fallback to another workstation with
the same ID: if the owner's is missing, the call fails with
`workspace-client-disconnected`. The sign-in additionally names the version of the executor that the
workstation brings along; if it differs from the server's version, it fails with
`workspace-executor-version` (409), and the message names both versions and what to do: for
an older workstation update the RAgents extension or `@schlenkr/ragents` there,
for a newer one the server. The version counts before the shape, because a different version
does not know the fields of this version or brings its own; for example, a workstation with version
5 lacks the field `ripgrep`. The input of `ragents.workspace.clients.register` is therefore a
union: the complete sign-in (`clientRegistrationSchema` in
`plugins/ragents.workspace/contract.ts`, without further fields) or a sign-in with a different
version that requires only `label` and `executor` and that the server always rejects because of the version.
If a workstation names the server's version, its input must have the complete shape; otherwise
it fails like any invalid input (`-32602`, `Invalid input for ...`). Whether the workstation's bash
finds `rg` (`ripgrep`, required) is determined by the workstation itself on every sign-in:
the bundled `rg`, otherwise one in the `PATH` of its environment; a named one that is missing
makes the sign-in fail with that cause. Before signing in, the workstation asks with
`ragents.workspace.clients.contributions` for the contributions to the executor that the server carries; the
input is `label` and `executor`; the version counts first as with the sign-in, and further fields
do not count. It builds its executor from them and names them in the sign-in under `contributions`;
the server rejects a different list with `workspace-executor-contributions` (409), and the message names
both (section Contributions to the executor). If an older server does not know the question, the workstation's
message says exactly that and that the server needs to be updated. If the sign-in fails because of
one of these versions (`workspace-executor-version`, `workspace-executor-contributions`, a
missing question at the server, or a bundle of the own host that is missing or has a different version),
the client's status says so with `mismatch: true` (`WorkspaceClientStatus` in
`plugins/ragents.workspace/client/workspace-client.ts`), every other failure with `false`; it
reads the domain codes from the error itself, not from its class. The VS Code extension turns this into
the version error and, independently of that, compares its RAgents version with `version` from
`ragents.plugins.bootstrap` (`versionNotice` in `apps/vscode/src/sessions.ts`, operation in
`docs/usage.md`).

Exactly one operation goes to the workstation: `ragents.workspace.client.execute` with
`implementedBy: "client"`, with `runId`, `operation`, `cwd`, `env`, the operation's input, and,
only for a tool call of the model, `toolCallId`. The server calls it over the connection of the
sign-in; progress is the operation's JSON value (for `bash` the output as `{ text }`, for
`files.watch` first `{ kind: "ready" }`, then per change `{ kind: "changed" }`), and the result is
its value as JSON. `operation` is an operation of a module or `stop`, which releases what the
workstation holds for the run (its `stopRun`); `stop` checks no folder and succeeds even if the
bound folder is no longer offered. The server waits for a limited time per call: a single
safety limit of 15 minutes plus the duration the call itself requires (`durationMs`, for
`bash` its time limit), because the actual time limits sit in the executor. An observation
is declared explicitly by the call with `untilAborted`: it runs without a time limit until cancellation and
needs a cancellation signal for that. A cancellation sends `rpc.cancel`. Cleanup calls with `whenReachable`:
if the workstation is not connected or does not answer within ten seconds, the
call returns `null`. The run's stop (`stopRun`), on the other hand, is not lost, because the workstation's
executor survives a disconnect, and with it background processes, language servers, and browsers:
if it does not reach the workstation, the registry registers it per workstation and run, reports it in the
log as pending, and delivers it at the next sign-in of the same workstation, before
any new task of this run; if the workstation stays signed in but does not answer, it
tries again every 30 seconds. There is a reason why the server registers the stop instead of the workstation reconciling its runs
on reconnecting: a stop is an event, not a state; a
stopped run can keep running, and only the server knows that it was stopped. A connection loss makes open calls fail with
`workspace-client-disconnected`, and the cause names the workstation, so that it stays
recognizable that it is not the server that is gone; a bash already started may still run to completion; that
is not concealed. A domain error of the workstation arrives with ID and status as
the same `DomainError` as from the server's executor.

Every executor builds the environment from its own machine: a base, `HOME`,
`USER`/`LOGNAME` (with its own account that account's name, otherwise the values of the process of this machine),
and the variables of its roots. The caller chooses the base explicitly
(`baseEnvironment` of `workspaceProcessContext`, `base` of `sandboxEnvironment` in
`packages/workspace-executor/src/context.ts`): `"safe"` is the allowlist of safe variables
(`safe-environment.ts`) and applies without a value, that is, in the server's executor, whose environment
carries secrets of other users. `"inherited"` is the whole environment of the process without
`VSCODE_*`, `ELECTRON_*`, `BASH_ENV`, and `ENV` (`inheritedProcessEnvironment`); it is taken by the
workstation (`WorkspaceClient`), which runs on the developer's own machine, so that the developer's
tools, toolchain variables, and sign-ins work exactly as in their terminal. The extension shares the first
two exclusions for its child processes (`editorFreeEnvironment`); the
last two keep the user's startup files out of `bash -c`. `HOME`, `USERPROFILE`,
run marker, Git rules, and the run's additions override the base in both cases. From the
server comes only what is location-independent:
run marker, `CI`, `GIT_OPTIONAL_LOCKS`, and the sandbox's Git rules. The server's Git credentials and
toolchain paths do not travel into a foreign bash. An executor sees exclusively
the folders of its machine: in the server the run's root (for a run on a workstation
its server folder) plus the server's roots (`@actors`, `@skills/<name>`), in the
extension the offered project folder. Aliases exist only on the server, and a call
always reaches exactly one machine: which one is decided by the root its input addresses,
not by a comparison of absolute paths. An absolute path therefore applies on the binding's machine;
a run on a workstation reaches a server root only through its alias. On the workstation, `HOME` is
the developer's home,
so that Git, SSH, and NuGet work with the developer's own credentials; the `HOME` redirection is a
property of the executor in the container, not of the operating mode. Where a language server puts its
logs and intermediate state is stated separately by the context (`logDirectory`): in the server the
run storage, on the workstation a folder under `os.tmpdir()`, never the developer's home.

A bash result is the command's output; a non-zero exit code is the last
line of the result (`Command exited with code N`) and is not a tool error, such as `grep` without
matches. Tool errors are only start, time limit, and cancellation problems. Without `timeout` the
bash stops a command after 120 seconds; a call may request up to 3600 seconds; more is an
input error. Both are in the tool's description and schema (`default` and `maximum`,
`packages/agent/src/core/tools/bash.ts`), together with the sentence that builds, test runs, installations,
and other long commands need a larger `timeout`. When the time runs out, the command ends together with
its process group, and the error carries the output so far, the seconds, and what to do:
narrow the command, for example search with `rg` instead of `grep -r`, or pass a larger `timeout` up to 3600.
The server fills in the default before it passes a model call to an executor
(the schema defaults in `WorkspaceSandboxHost`); that way the time limit the model sees in the schema
also applies on a workstation, and the footprint knows it as `durationMs`.
`RAGENTS_BASH_TIMEOUT_SECONDS` (section `ragents.workspace`) changes the default for all runs of the
server, also on workstations, not the upper limit: allowed are more than 0 up to 3600 seconds;
another value aborts the start; a workstation does not read the variable. The folder of a
call is named by the optional `cwd`, the same on every machine: relative to the working directory or
a path with an alias such as `@actors/<name>`, never absolute (`workspace-path-invalid`, 400), always in
a root of the run, also a read-only one, and it must exist (`workspace-path-not-found`,
404); without `cwd` the bash runs in the working directory. With an alias it runs at the server's
executor, in the same process sandbox as every other process of the run there (section
Server process sandbox), and only this bash has the variables of the server's roots, such as
`RAGENTS_ACTORS_DIR`. Without an alias it runs at the binding's executor, so for a workstation
there and without these variables. A bash never sees both machines; there is no separate lock for the way
onto the server, because it resembles the Node processes a run starts there anyway
and follows the same sandbox. `ragents.workspace`
additionally provides a prompt contribution bound to `bash` (`plugins/ragents.workspace/server/shell-platform.ts`):
macOS with BSD tools (`grep` without `-P`, `sed -i ''`, `/bin/bash` 3.2 without associative arrays
and `mapfile`), Linux with GNU tools, Windows with the bundled bash (MSYS userland with
GNU tools; `git`, `dotnet`, and `node` are the machine's Windows programs and take
Windows paths; CRLF); an unknown platform is
an error, not a guessed text. In addition there is a sentence about searching: if the bash finds `rg`, the model should
search with `rg` and list files with `rg --files`, because it skips everything `.gitignore`
excludes (`node_modules`, `bin`, `obj`), and apply `grep` only to individual files or in pipes;
otherwise the sentence names the absence and requires excluding the
dependency and build folders for `grep -r` (`--exclude-dir`). The platform and `rg` named are those of the executor
that runs the run: on the server those of the server (`rg` from `RAGENTS_RG` or the `PATH`, determined at
startup), on a workstation those it reported on sign-in. For this a prompt contribution may bring a `renderForRun(runId)`; the server
uses it to replace the once-rendered text per run; an empty text leaves the contribution out there,
and `undefined` keeps the rendered one (`PromptContribution`,
`PromptContributionRegistry.runOverrides`). If the bound workstation is currently not
signed in, the contribution says exactly that instead of guessing a platform. The executor in the server
redirects `HOME` per run so that tools write only there; on Windows `USERPROFILE` goes
along. `PATH` comes from the executor's environment, so the toolchain of its machine
stays reachable. The uid switch and the `HOME` redirection are configuration of the executor,
not of the operating mode. If a required toolchain is missing, the call fails with that
cause.

The command module runs a program with `commands.run`, without a shell: `program` (a name from the
executor's `PATH` or a path) and `args` go to the process literally; no argument is
interpreted. The working folder `cwd` is relative to the run's root, without a value the root itself,
and is checked like a path of the file module: no `..`, not absolute, no symlink out of the
root, and it must be a folder. The process receives the executor's environment and account, that is,
run marker and the sandbox's Git rules and, on a workstation, its `HOME`; the call accepts no addition to
the environment. It runs within the workspace's frame (`runOperation`), like
the tools. `timeoutMs` is required and, as the command's footprint, extends how long the
server waits for a workstation beyond its safety limit; `cwd` knows no alias
here. The result names `exitCode`
(`null` after a signal) and `stdout` and `stderr` as UTF-8 text, per stream at most
`maxOutputBytes` (default and upper limit `COMMAND_OUTPUT_LIMIT`, 2 MiB, so that even a response
full of control characters fits through a workstation's connection), plus a flag each for whether
it was truncated; the command still runs to completion. As with `bash`, a non-zero exit code is
a result and not an error. Errors are an invalid input (`command-invalid`, 400), a
missing or non-executable program (`command-unavailable`, 409), the exceeded
time limit (`command-timeout`, 504), and cancellation; cancellation, `stopRun`, and `shutdown` end the
process, and except on Windows its process group ends with it, including everything it leaves behind in
the background. On Windows the module rejects `.cmd` and `.bat`, because Node starts them only through
a shell. The module is not a command lock: without a shell means that no argument
is interpreted, not that only certain programs run. Binary output is not intended; it
arrives as UTF-8 text.

After a bash call the host waits for the end of its process group. On macOS,
an already ended group with remaining zombie entries can report `EPERM` on the signal check.
In this case the host checks only the process group ID and process status;
only a provably empty or completely ended group counts as cleaned up. Living
processes, a failed status query, and unreadable results remain errors. Such an
ended remainder therefore discards neither the output nor the exit status of the actual command.

Which bash the tool `bash` starts is carried by the executor's context (`bash` in
`WorkspaceProcessContext`); `bashLaunch` (`packages/workspace-executor/src/bash-launch.ts`) turns
it into the start `bash --noprofile --norc -c <command>`. On macOS and Linux, without a value,
`/bin/bash` applies, otherwise `bash` from the `PATH` (`getShellConfig` in `packages/agent/src/utils/shell.ts`);
a fallback to `sh` is excluded.

Likewise the context carries the executor's `rg` (`rg`); `bashLaunch` puts its folder at the front of the `PATH`
on every platform, and if it is not at the named location, the call fails with that
cause. Without a value the bash finds an `rg` in the `PATH` if there is one; `ripgrepAvailable`
says whether it finds one. Both workstation launchers use `resolveBundledTools` in `packages/workspace-executor`.
The per-platform VSIX resolves `<extension>/dist/rg/<platform>-<arch>/rg` (`rg.exe` on Windows).
The npm package resolves the same layout inside its matching optional package,
`@schlenkr/ragents-tools-<platform>-<arch>`, pinned to the host package version. Its `os` and `cpu`
fields restrict installation to win32, darwin, or linux, each x64 or arm64. Missing optional tools
are a startup error with reinstall instructions. Both distributions use the same pinned archives,
checksums, extraction code, and license files in `scripts/vscode/bundle-rg.ts` and `bundle-bash.ts`.
VSIX contents stay unchanged. The universal extension and both launchers in a checkout without
built tools retain system-PATH discovery; `pnpm bundle:rg` supplies the checkout's shared binaries.
The extension passes its selection to its local host as `RAGENTS_RG`. A standalone server still
reads `RAGENTS_RG`; a configured missing file aborts startup.

On Windows the executor runs with the same Node standard APIs and without its own
platform layer. The bash there is exclusively the one RAgents brings along: an extract from
the pinned PortableGit archive of Git for Windows with `bash.exe`, `sh.exe`, coreutils,
`grep`, `sed`, `gawk`, `find`, `xargs`, the diffutils, `patch`, `tar`, `gzip`, `bzip2`, `unzip`,
`less`, `file`, `which`, `cygpath`, `dos2unix`, and the DLLs these programs load, plus
`etc/fstab` and its own `etc/nsswitch.conf` (`db_home: env windows`). Git, Perl, editors,
GnuPG, OpenSSH, OpenSSL, and terminal programs are not included; `git` is the user's `git.exe`
from the `PATH`, with their Credential Manager, their `~/.gitconfig`, and their `~/.ssh`.
RAgents never takes a Git Bash installation of the user or a `bash.exe` from the `PATH`. If
the bash is missing from the context or is not at the named location, the call fails with that
cause. The path is set by whoever builds the executor: the extension for its workstation from
`<extension>/dist/bash/<platform>-<arch>/usr/bin/bash.exe` and for its local host as the
environment variable `RAGENTS_BASH` (section `ragents.workspace`, in the server's executor as `bash`
of `WorkspaceSandboxHost`); the CLI workstation resolves the identical layout in its platform
package (or the extension build in a checkout), without requiring `RAGENTS_BASH`. `bashLaunch`
puts the bash's `usr/bin` before the process's `PATH`, otherwise `find.exe` and
`sort.exe` from `System32` would win; another spelling of `PATH` (`Path`) is merged into it, and
`MSYSTEM` is dropped because it belongs to a Git Bash sign-in; the `rg` comes before it. The
context sets `HOME` and `USERPROFILE` as everywhere. The extract is built with `pnpm bundle:bash`
(`scripts/vscode/bundle-bash.ts`, details in `docs/development.md`). There are no process groups
on Windows:
instead of a signal to the negative PID, `taskkill /T /F` ends the process tree
(`killProcessTree` in the agent package), and because taskkill runs alongside, there is no guarantee of when
the last grandchild is gone; a grace period before SIGKILL is therefore dropped as well. The data folder lies
under `%LOCALAPPDATA%\ragents\<profile>`; if `LOCALAPPDATA` is not set, the start aborts.
The permissions 0700 and 0711 have no effect on Windows but produce no error, and the
sandbox's uid switch still applies only to the container. The safe environment additionally passes through
the Windows base variables (`SystemRoot`, `ComSpec`, `PATHEXT`, `APPDATA`, `LOCALAPPDATA`,
and siblings), without which hardly any Windows program starts. There is no process table for win32:
the process module of a Windows executor rejects state and ending with that cause
instead of returning an empty display, and on run stop it remains at ending the bash trees.

Every sandbox process (bash children, language servers, also what the TypeScript platform starts in the
server context) carries the marker `RAGENTS_RUN_ID=<runId>` in its environment. Services started by a
plugin carry the same marker and appear automatically. Through it, the executor's process module
reads the process table of its machine per platform (macOS `ps -E` and `lsof`,
Linux `/proc`; as root, reading other processes' `environ` needs CAP_SYS_PTRACE); simultaneous queries
of several runs share one scan. Without root, the executor on Linux reads only processes of its
own account; if one of them has made itself unreadable (`PR_SET_DUMPABLE`, such as a Chrome helper process
while ending or `ssh-agent`), it carries no recognizable marker and counts toward no run,
instead of making display and stop fail. As root, a locked environment remains an error with
the hint about CAP_SYS_PTRACE. On macOS, `ps -E` does not show the environment of programs from the
system volume (`/bin`, `/usr/bin`, such as `sleep`, `bash`, `sh`, `zsh`, `perl`, `ruby`); such
a process that survives a tool call cannot be attributed to any run by the table
(Open limits). `ragents.processes` asks for it through the run's executor, for a workstation
therefore there, and shows in the header a full bar surface per process
with kind, label, and port links: background processes always, children of a running tool call
(direct children of the executor process) only with an open port. Background is recognizable by the dashed
right divider and in the tooltip, never by a color. This is a runtime resource,
not journal state: every two seconds the plugin queries the state of every run whose channel
`processes:<runId>` a browser has subscribed to, each at its executor, and reports only
changes; if permission, tool, or the workstation is missing, that is a named error in the
header. Every run is queried on its own, with a time limit of five ticks that also aborts the
executor; a hanging workstation thus freezes only the display of its runs, and whoever unsubscribes the
last observer of a run aborts its running query. macOS checks the command line before and
after reading the environment. Only PIDs changed in the meantime are queried again, with
at most three attempts; after that an unstable process remains an error and is not stored as
markerless. Vanished processes and explicit `<defunct>` entries are left out as
ended. Negative system UIDs in macOS process tables are kept as such
and block neither observation nor cleanup. Access, tool, and format errors trigger no retry.

Every visible process has a compact end button with icon and tooltip.
Process monitoring, its methods, and its channel require `runs.read` and `ragents.processes.read`.
With pure read access, port links stay usable; ending additionally requires `runs.write`
and `runs.inspect` and is otherwise disabled. A running
end request locks only the affected process in all open views; errors appear
at the entry and allow a new attempt. Only the next observed process state removes
the entry. The web uses the snapshot's opaque process reference, not just the PID.
The header shows at most four entries. The remainder counter opens a shared run dialog
with all processes and the same actions; there the entries stay compact pills with
a dashed border for background processes. Below 700 pixels, the first process surface stays
reachable with "All N". The dialog leaves the global header operable. If the currently
focused process disappears, focus moves to the next process control, in the empty dialog
to its empty state, and after closing to the header navigation. If there are no processes
left, the display is dropped. Escape and background click close the dialog.

The process plugin ends individual instances through their snapshot reference of PID and start ID.
The run's executor checks run membership, start ID, and UID again before every signal; the
method checks read and write rights and the run before the call, and cancellation of the request
reaches the executor between its steps. The executor's process (server or
workstation), its ancestors, and PID 1 are protected. Signals go exclusively to individual
positive PIDs, never to a process group possibly shared with foreign processes.
SIGTERM is followed by two seconds of waiting, if needed SIGKILL and another second for
checking. A pass is limited to eight seconds; missing rights, unreadable process tables,
and remaining processes are explicit errors.

On run stop, the process module ends, in the `stopRun` of its executor, all marked processes of the
run, also without a port and independently of their display in the header. For a run with a
workstation, the sandbox host stops its executor and the server's, because the
TypeScript platform runs there with the same marker. `ragents.processes` additionally calls the same cleanup
(`processes.stopAll`) in its lifecycle: on stop, in a final
pass after the end of the actors and the other stop contributions, which catches late-started children before the
run is released, and before deletion; an unreachable workstation lets these calls
pass empty with `whenReachable`; the registered stop of the run makes up for the ending (above). New children during cleanup are picked up
on every scan. This cleanup needs no open browser. macOS reads the marker only from the
environment part of `ps -E`, not from command arguments with the same text. The POSIX query of the
start ID and the signal are separate operating system calls; they form no atomic
process reference.

`ragents.workspace` also contributes the purely reading tab `Files`: the run's working directory and
file storage as a tree with text preview, without writing and deleting; the methods
`ragents.workspace.browse.list` and `ragents.workspace.browse.preview` provide tree and preview.
The tab reads the workspace through the file module of the run's executor, for a workstation
therefore there, and the location line then names its label and path
(`Workstation <label>: <path>`). The file storage of `ragents.documents` lies on the server and
does not belong to the workspace; the server reads it directly with the same functions of the package.
Paths are relative to the root, without `..` and not absolute; the check happens where reading happens, and
no symlink leads out of the root (`workspace-path-invalid`, 400; a missing path
`workspace-path-not-found`, 404). A list ends after 500 entries with `truncated`; a file
over 256 KB or a binary file names the reason instead of the content. The channel
`ragents.workspace.browse` (`runId`, `root`) reports every change, debounced at the executor; it
is up as soon as the observation is up, and if a running observation ends, it reports a change
so that the view reloads and shows the cause, and starts a new one every five seconds; when
it is up again, it reports one more change. The file module also ends open observations itself,
on run stop and on the executor's `shutdown`. A 30-second poll remains only as a fallback.

### Contributions to the executor

What a plugin does on the workspace's machine, such as starting a language server or controlling a
browser, it brings along as a contribution to the executor: `executor.ts` (or `executor/index.ts`)
exports `executor: WorkspaceExecutorContribution`, a function of the machine that returns
`WorkspaceExecutorParts`, `languageServers` (adapters, section Language server plugins),
and `modules` (modules with their own operations, section Browser checks). Contract and loading are
in `packages/workspace-executor/src/contributions.ts`. The contribution imports only types from the host;
everything it needs from the machine it receives through `WorkspaceExecutorMachine`: the
tools folder of its plugin on this machine (`toolsDirectory`, where its
provisioning downloads to), a file from the packages of this machine's host (`hostPackageFile`, without a host
or package an error with a cause), the checked resolution of a root in the workspace
(`resolveRootFile`, `resolveRootDirectory`), domain errors (`operationError`, at the caller a
`DomainError` like every error of the executor), and the environment of a process it starts itself
(`processEnvironment`: the safe selection of this machine, its `HOME`, and the run's marker). The
function touches neither disk nor network; resolution and checks happen only in the call.

The build tool turns it into a self-contained file `executor/index.mjs` that imports only `node:*`
(section Bundle, build tool, and host API). It therefore loads in every Node process, in the
server as in the VS Code extension host, which knows neither the host's resolution hook nor
TypeScript sources. `loadExecutorContribution` reads the file, takes the SHA-256 of its content
as the version, and imports it with the version in the address, so that a newly built contribution never comes from the
module cache; without a function `executor` it is an error that names the plugin.
`prepareExecutorContribution` calls it with the machine and checks what it returns (only
`languageServers` and `modules`, every language server with an ID of lowercase letters and digits and
all functions); a wrong shape is an error with a cause; two language servers with the same
ID are one when the executor is built.

In the server, `loadPlugins` loads the contributions with the profile's bundles, that is, before composition;
the composer builds them with the data folder's tools folders and provides them as the host service
`executorContributionsToken`. `ragents.workspace` uses them to build the server's executor and
names their IDs and versions to every workstation. Because the contributions are data of the bundles and
not a registration, they are fixed before any plugin registers; the order of the
plugins does not matter.

A workstation loads exactly these contributions from the built-in bundles of its own host
(`<host>/bundles/<id>/executor/index.mjs`; in the VS Code extension the host is `ragents.hostPath`
or the one started last, for the headless workstation its own), requires the server's version in doing so,
and builds them with its data folder's tools folders. If the host is missing, a bundle is missing, or
it has a different version, the sign-in fails with a cause and the advice to bring the host to the server's
version; without required contributions it needs no host. The executor of every machine
thus carries the same operations, and the footprint the server asks of its own executor
also applies to the workstation.

### Server process sandbox

Every process the server's executor starts for a run (`bash`, `commands.run`, the
language servers including their `git` calls), and the Node processes the TypeScript platform starts in the
server context (snippets of `typescript_eval`, backends and tests of the actor programs),
run in an operating system process sandbox: on macOS Seatbelt (`sandbox-exec`), on
Linux bubblewrap with its own network and PID namespace, both through the library
`@anthropic-ai/sandbox-runtime` (Apache-2.0, pinned version in `apps/server/package.json`). This also
applies to the work of a run whose workspace lies on a workstation, insofar as it runs on
the server, that is, also to a bash with an alias as `cwd` and to language servers on a
server root; the workstation's executor itself gets no sandbox; there it remains the
developer's bash. The core does not know the sandbox: the server's sandbox host
(`WorkspaceSandboxHost`) passes it along with a run's process context (`WorkspaceProcessContext.sandbox`),
and every place that starts a process wraps it with `sandboxedLaunch`; without a sandbox in the
context it starts unchanged. The browser of the browser check starts without a sandbox (Open limits).

The rules are created per run from its folders (`apps/server/src/plugin-support/process-sandbox.ts`).
Blocked for reading are the server account's home, the other homes (`/Users`, on Linux `/home`
and `/root`), `os.tmpdir()`, `/tmp`, and the profile's data folder, on Linux also an existing
Docker socket. Within these, readable again are the host folder, the toolchains from `PATH`,
`DOTNET_ROOT`, and `PNPM_HOME` including their prefix (never an ancestor of the data folder), the storage of the
run itself (`sessions/<run-id>`), and its read-only roots (skills; for the global coordinator
without users the journal folder). A run may read and write the root of its
workspace or its server folder, the registered roots (`@actors`), its
home, the shared NuGet cache, and its own temp folder `sessions/<run-id>/tmp`, which is in
`TMPDIR`, `TMP`, and `TEMP`. Added to that are the folders its workspace explicitly
allows (`SessionWorkspace.sandboxFolders`, below). The rest of the system (`/usr`, `/opt`, toolchains)
stays readable and
is not writable; the library additionally blocks writing `.git/hooks`, `.vscode`,
`.idea`, and shell startup files; `.git/config` stays writable. The processes therefore do not see other runs, foreign journals, and
secrets in the home; on macOS such an access fails with
`Operation not permitted`, on Linux the blocked folder is empty. Because `PATH` entries are often
symlinks into blocked folders (such as fnm), `PATH` in the sandbox names their targets. An allowed
folder that contains a blocked or a writable one is decomposed into its other entries at the start of every process,
so that neither the block nor the write access within it is lost;
what is created next to it afterwards is seen only by the next process.

What the runs must share because tools prescribe it: on macOS, .NET puts its
named mutexes under `/tmp/.dotnet`, and MSBuild the sockets of its build nodes under
`/tmp/MSBuild*`; both are writable, Unix sockets are allowed under `/tmp` and in the data folder,
and the certificate service `trustd` is reachable, without which .NET and Go verify no TLS.
On Linux, `/tmp` is a separate empty folder per command, and Unix sockets are allowed entirely,
because seccomp does not distinguish them by path. So that no build process survives the command and
accepts builds of other runs in its sandbox, MSBuild runs without node reuse
(`MSBUILDDISABLENODEREUSE`), without build servers, and without a shared compiler (`UseSharedCompilation`).

Every process goes onto the network only through the library's proxy, which lets through exclusively the targets of the
allowlist; it answers everything else with 403 ("Connection blocked by network
allowlist"). The allowlist is `PROCESS_SANDBOX_NETWORK` in the section `ragents.workspace`, a
list of domains such as `*.example.com` or `host:port`; without a value
`PROCESS_SANDBOX_DEFAULT_NETWORK` applies: `registry.npmjs.org` for npm and pnpm, `api.nuget.org` and
`globalcdn.nuget.org` for NuGet, `github.com`, `*.github.com`, and `*.githubusercontent.com` for Git
over HTTPS and releases. The server's own address (`127.0.0.1:<port>`) is always added, because
the global coordinator reaches its server through `RAGENTS_API_BASE_URL`. In the sandbox,
`NO_PROXY` is empty so that this call also goes through the proxy, `NODE_USE_ENV_PROXY=1` makes `fetch`
in snippets take the proxy, and `DOTNET_SYSTEM_NET_DISABLEIPV6=1` keeps .NET on IPv4, because the
macOS sandbox does not recognize an IPv4-mapped address as localhost.

A workspace can need folders outside its folder that would otherwise stay blocked, such as
a Git worktree whose shared repository (`git rev-parse --git-common-dir`) lies elsewhere:
without an allowance, Git in the sandbox fails with `not a git repository`. For this,
`SessionWorkspace.sandboxFolders` (for a contribution in its `WorkspaceResolution`) names per folder
`directory`, absolute, and `access`, `read` or `write`; the sandbox host takes them over into the
readable or writable folders of the run; a relative path is an error. The
core knows no Git here, and the allowance applies only to processes: the file tools do not reach
such folders.

`PROCESS_SANDBOX` in the same section is `"on"` without a value; `"off"` switches the sandbox off for the
whole server, and the start reports that in the log. The extension starts the VS Code extension's local host
with `"off"`, because it is the developer's workstation. At startup the server checks the
prerequisites, starts the proxy, and runs one process in the sandbox once; every failure is a
startup error with a cause and an instruction: Windows (the per-run folder rules cannot be
set there), another platform, on Linux missing bubblewrap, socat, or ripgrep, and a
kernel or container without user namespaces. `ragents.workspace` gives the building block
`ServerProcessSandbox` the instruction for switching off the sandbox as `disableSetting`
(`PROCESS_SANDBOX: "off" in the ragents.workspace section`); the building block itself names neither
key nor section. The library has one state per process;
several servers in one process (tests) share it, and their network allowances are merged.

## Provisioning per plugin

A plugin that needs tools on the machine brings a `provision.ts` in the
plugin folder next to `server/`; in the bundle, `server/index.js` passes its export on. It exports
`provision` with two functions (contract in `apps/server/src/plugin-support/provision.ts`):

- `check(target)` returns `{ kind: "ready" }` or a named gap
  `{ kind: "gap", name, instruction, installable }`.
- `apply(target, log)` closes a gap with `installable`; for `ready` it does nothing; for a
  gap without `installable` it aborts with the gap's instruction.

`target` is the plugin's tools folder, `<data folder>/tools/<plugin-id>/`, that is, a folder
outside the repository, and one per host. Idempotent means: after `apply`, `check` returns
`ready`, and a second `apply` downloads nothing and changes nothing. For this the
provisioning stores a `provisioned.json` with the pinned version next to the files; a
different version is a gap again. Provisioning is pure Node code, not a shell script:
Node downloads (`downloadArchive`), and the host's small ZIP reader unpacks archives
(`plugin-support/zip.ts`; only store and deflate; Zip64 is an error).

What cannot be installed, `check` reports as a gap without `installable`, together with an instruction:
missing `dotnet` for Roslyn and FSAC, a `BROWSER_EXECUTABLE_PATH` that points nowhere. At
server startup, an open gap is a hard error, not a notice.

`pnpm provision [<profile>|<path>]` (`scripts/provision/run-provision.ts`) loads the profile file like
the server, imports the profile's bundles, provisions every one that exports `provision`, and reports per plugin
`ready`, `installed`, or `missing: <reason>`; a remaining gap is a non-zero exit
code. `pnpm connect` calls the same between fetching and starting, and the VS Code extension before starting
the local host.

A workstation has no profile. `pnpm provision --workspace` (`workspaceProvisionPlugins` in
`apps/server/src/profile/provisioning.ts`) provisions there every built-in plugin of its host
whose bundle carries a contribution to the executor, because its tools run on this machine
(section Contributions to the executor); they land in the tools folders under
`~/.local/share/ragents/workspace/`, or wherever a plugin's provisioning otherwise puts them, such as
Chromium in Playwright's browser cache. Which plugins these are is not written down anywhere as a list but is in
the manifest of their bundles. The bundles whose exports these import are loaded along, because a
bundle does not load without them; only what exports `provision` is provisioned. The workstation
provisions at its own start, before it knows a server, and therefore according to its host and not
according to a server's list; what a server requires must be among these bundles anyway,
otherwise the sign-in fails.
`pnpm workspace-client` and the VS Code extension call this at their own start; a gap
does not hold up the workstation; it fails only when the affected contribution is called.

A profile names a provisioned file with `provisioned("<plugin-id>", "<path>")` instead of an
absolute path; when the profile file is loaded, this becomes `<data folder>/tools/<plugin-id>/<path>`.
The data folder is the same as at startup (`DATA_DIR`, otherwise `host.DATA_DIR`, otherwise
`~/.local/share/ragents/<profile>`). An absolute path stays permitted, such as for a self-installed
server.

## Language server plugins

Diagnostics without a build: `ragents.lsp-roslyn` (C#), `ragents.lsp-fsharp` (F#, fsautocomplete), and
`ragents.lsp-typescript` are three product-neutral plugins on top of ONE shared client in the
executor (`packages/workspace-executor/src/language-server/`: JSON-RPC over stdio, document sync
with full text, diagnostics by pull or push, process through `startManagedService`). The client
knows no language server. Every plugin brings its adapter (`LanguageServerAdapter`: ID,
name, extensions, root type, start, and loading) as a contribution to the executor in `executor.ts`
(`languageServers`, section Contributions to the executor), there also its constants, for the F# plugin the
reader for `.sln`. Its server half is description (`LanguageServerDescription`, from the same
file), configuration keys, tab, and forwarding through the shared factory
`createLanguageServerPlugin`, which knows no language server. A further language is therefore a
further plugin of this form, without changes to executor, host, or extension. Which
machine starts the language server is decided by the root the call names (section
Workspace, sandbox tools, and processes): `<id>_open` with `root: "@actors/app"` starts it
on the server, also in a run on a workstation, a path without an alias at the binding's executor;
if it is missing there, the call fails with a cause. If a call names no root,
`<id>_diagnostics` without `root` and `paths`, `<id>_close` without `root`, and the state for the
diagnostics tab, it asks for the instances at the binding's executor; a run on a workstation reaches an instance on a
server root through `root` or `paths` with an alias. The adapter takes the path to the
server from its plugin's tools folder on this machine
(the machine's `toolsDirectory`, `<data folder>/tools/<plugin-id>/`, see Provisioning per
plugin); in the server, the plugin's profile section sets it to the same place with `provisioned(...)`.
The environment variables `ROSLYN_LANGUAGE_SERVER` and `FSHARP_LANGUAGE_SERVER` override it, for example
for a self-installed server; if both are missing, the error names the expected path and the
command. A `.dll` starts through `dotnet`, an executable file directly. The adapter checks the root
with the machine's root resolution (`resolveRootFile` with the extensions of its
project files, `resolveRootDirectory` for TypeScript).
TypeScript is not provisioned but lies in the host's `node_modules`; the adapter therefore
resolves `typescript-language-server` and `typescript` through the machine's `hostPackageFile` from the
folder the run's context names as `hostRoot`. Every
caller of the executor sets the value: the server its own root (`hostRoot()`), the headless workstation
the same, the VS Code extension `ragents.hostPath` or the host it started last
(`ragents.lastHostPath`, the fetched package under `<globalStorage>/hosts/<version>/`). No adapter
and no module resolves anything, downloads anything, or checks anything on
disk when its contribution is loaded: every resolution happens only in the call and fails there with a cause. A contribution that
did so on loading would take down every executor that carries it, such as the VS Code extension's.
The stdio connection uses `vscode-jsonrpc` for framing, request mapping, and responses.
The host connects `AbortSignal` with JSON-RPC cancellation and ends the local request immediately;
late responses do not change its result. Transport errors close open requests with a cause
and end the associated managed process. Process start, document synchronization, and domain
diagnostics stay with the shared language server client.

- Per plugin three native tools: `<id>_open(root)`, `<id>_diagnostics(paths?, root?, warnings?)`,
  and `<id>_close(root?)`, with solutions a fourth, `<id>_solutions`. The server starts through
  an explicit function call of an agent or prepared actor program, through the
  selection in the tab, or, where switched on, at the start of the run (Solutions, below).
  Product-specific roots belong to the calling plugin, not to the host.
- The key of an instance is run PLUS root, not the run alone: `<id>_open` starts an
  instance for exactly this root if it does not exist yet and leaves the other instances
  of the same run in place. For the same root the call is idempotent. The return value names the
  root and the number of open instances of this language in the run. A run can therefore have two
  solutions loaded at the same time.
  Without `paths`, `<id>_diagnostics` asks `git status` per open instance against the repo's root
  and narrows with `-- .` to the root of this instance; a workspace may therefore be a
  subfolder of a repo. With `paths`, each file is answered by the instance whose root
  contains it - with several, the one with the longest prefix. A file outside every open root
  is a named error that names the open roots. `root` asks one instance specifically.
  `<id>_close` ends one instance, without `root` all of the run.
- While loading, the instance is immediately `opening`; `ready` follows only after
  the adapter has finished loading. For Roslyn this includes the confirmation of project initialization.
  `failed` keeps the root and the concrete cause until it is opened again or stopped; the
  root is resolved against the workspace, even if the path check already failed,
  and `<id>_close(root)` finds it under the named path. `<id>_diagnostics` without `root` and
  without `paths` skips a failed instance and appends its cause to the result of the
  others; it fails only if all instances have failed. With `root` or with a
  file in its root, the failed instance remains an error with its cause; a new
  start happens only through `<id>_open`. The operations check their input themselves (`root`,
  `paths`, `warnings`) and reject wrong types with `language-server-input-invalid`.
  The diagnostics tab lists all instances of the run with root, state, and summary and
  shows loading state and errors without deriving freedom from errors from them. The snapshot is
  therefore a list, not a single state. Opening the same root in parallel shares the start.
  Stopping, closing, and shutdown prevent late success reports and end the
  managed processes; a different root leaves the running instances untouched.
- After every successful `edit`/`write`, the executor appends the errors of the written file
  as a further text part to the tool result, for every language server that knows the extension and
  has an instance in the run whose root contains the file; the choice uses the same longest
  root prefix as for `paths`. If no instance fits, the annotation is left out. For this the server's
  sandbox host offers the slot `sandboxServicesToken` (`execute`, `serverProcessContextFor`,
  `registerWorkspaceRoot`, `shutdown`).
- One instance per plugin, run, and root, shared by all actors of the run, started with the
  environment and UID of the run's bash; idleness ends each instance individually after 20 minutes, and the
  next access reloads its remembered root. `<id>_close`, run stop, and server shutdown
  end it; run stop and shutdown end all instances of the run. No journal state: after
  a host restart nothing is open, `<id>_diagnostics` fails hard, and the annotation
  stays silent.
- Solutions: an adapter with `solutionExtensions` (today only Roslyn with `.sln` and `.slnx`; FSAC
  and TypeScript not) receives the operations `<id>_solutions` and `<id>_switch` and the
  tool `<id>_solutions`. The search runs in the executor with `git ls-files --cached --others
  --exclude-standard` in the root of the workspace, that is, tracked and new, non-ignored
  files, without paths under `node_modules`, `bin`, and `obj`, only existing files within the
  workspace. Without a Git working directory it searches the folder itself, six levels deep
  and without hidden folders, and says so (`source: "directory"`). Every solution names its path
  relative to the root, its resolved root, and its state in the run (`null` for not open);
  `opened` says whether an instance is already open or being opened. `<id>_open` stays
  additive: the model loads further solutions in addition.
- For plugins, `<id>_open` accepts `ifNoneOpen: true`: checking and claiming happen in the executor without
  interruption. If an opening of the run is already running, even one that is still resolving its path, or if
  an instance exists, even a failed one or one ended after idleness, the call loads nothing and
  says so.
- Switching: `<pluginId>.switch` (rights `runs.read`, `runs.write`, `<pluginId>.read`, and
  `<pluginId>.write`) loads the chosen solution, ends every other instance of the run, and does not wait
  for the loading, so that no request stays open for minutes; an already loaded one stays;
  `root: null` ends all. `<pluginId>.solutions` (rights `runs.read` and `<pluginId>.read`)
  returns the list. Both first check run and access with `workspaceGuardToken` like the
  snapshot. Above the instances, the tab shows the selection "Solution" with "None" and every
  solution found; it is set to the one open solution, to "None", or shows several
  or another open root. Without write rights it is locked. Whether a plugin
  knows solutions is told to the web by `clientConfig.solutions`.
- Solution at start: with `ROSLYN_SOLUTION_ON_START: "on"` (without a value
  `"off"`; any other value aborts the start), `ragents.lsp-roslyn` loads the solution when a run starts. It hooks
  into the lifecycle hook `sessionStarted` (section Ownership per facet) and first writes
  a marker as the run's plugin state into the journal; if the marker is already there, it does nothing,
  also after a host restart. A start through a run script (`startEntry.action` is
  `script`) gets the marker and nothing else: the script loads what it needs itself, and nobody
  is asked. Otherwise it lists the solutions through the executor, which has already provided the
  workspace. None, or an instance already open or opening: nothing. Exactly one: it
  is loaded with `ifNoneOpen`, so a simultaneous opening by model, script, or tab cannot
  start anything twice. If the profile names a solution with `ROSLYN_SOLUTION_PREFERRED`
  (a path with forward slashes, as `<id>_solutions` names it), only the solutions whose path
  equals it or ends with `/<preferred>` count, regardless of case; that way
  it also takes effect when the workspace is a folder above the checkout. Exactly one matching one is
  loaded the same way, also next to further solutions and without a question; several matching ones, such as several
  checkouts under one folder, lead to a question with only them; if none matches, the following applies. An absolute path, one with a backslash, or the
  preference without `ROSLYN_SOLUTION_ON_START: "on"` aborts the start. Several: a question through `ragents.ask` with every solution and
  "Load none", asked before the hook returns and thus before the run's first input.
  Outside a turn only the run's owner may give commands, which is why the owner asks, and the
  question carries the coordinator as `recipient`: it appears in the coordinator's chat without a name in front
  and in its card. The answer loads the chosen solution; "Load none" and dismissing load
  nothing; a free-form answer goes to the coordinator as input. After a restart nobody waits
  for the question anymore; `ragents.ask` then passes the answer to the `recipient`, and the coordinator
  loads by itself with `<id>_open`. Stopping and deleting the run discard an open question. If
  someone opens an instance while the question is open (model or actor program with `<id>_open`,
  switching in the tab), the plugin discards it with `AskService.withdraw`: the waiting call
  receives the dismissal answer, loads nothing, and passes nothing on, also after a restart.
  The framework reports the occasion through `onOpened` of `createLanguageServerPlugin` after every
  successful opening through the tool or `<pluginId>.switch` with a solution.
- Errors always, warnings only counted (listed on request), capped at 30 lines.
- The TypeScript adapter sets `publishesOnlyChangedDiagnostics`: because
  typescript-language-server publishes nothing after `didChange` when diagnostics stay empty,
  the session closes an error-free, changed file and opens it again instead of waiting for
  a response. Roslyn uses pull diagnostics and is not affected.
- Limits: Roslyn sees F# projects only as a built DLL, FSAC C# projects likewise; Roslyn knows a newly
  created file only once its file watcher has reported it.

<!-- guide:plugins -->
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
<!-- /guide:plugins -->

### Example of a skill template

```markdown
---
name: two-perspectives
description: Compare two perspectives on a task.
start: true
title: Two perspectives
disable-model-invocation: true
category: Collaboration
order: 10
tags: Use case, Concept demo, Agent teams
---
I would like two different perspectives on my task and a shared recommendation.
```

The file lies under `skills/two-perspectives/SKILL.md`; folder name and `name` match.
Without its own `prompt` field, the body is also the editable starting task. `tags` is
optional for general plugins and required in the reference catalog; an empty or duplicate value
fails on reading.

## Reference cases from ragents.reference

`ragents.reference` bundles neutral skills, run scripts, and web guides as bundled
demos and possible high-level test cases for RAgents. Customer-specific workflows and
integrations do not belong in this catalog. The plugin belongs to the profile `showcase`;
`core` remains the template for real profiles without this teaching material, but, like every
other profile, lists it in its plugin list when needed.
The examples have two overlapping perspectives: use cases start with a
concrete task, concept demos make a platform capability specifically observable.
Every skill template describes a goal in a short, freely worded prompt and counts as
one example. Its single category is in `category`, independent of concept tags.
The `description` of every demo template names its demonstration purpose in short prose:
which concepts work together and what is meant to become observable. This applies to skills and
run scripts; for similar cases it names the difference. The text is directly in the
existing description field and appears in the start selection and the reference.
The host has no fixed list of permitted categories. The reference templates use, among
others, Mini-apps, TypeScript without UI, Collaboration, and Code and diagnostics. The
mini-app group contains pure views, shared functions, LLM views, several views
of one state, and automatically collected agent answers.
The skill template Balcony wizard asks for a standalone app on the surface that mediates a limited
conversation with an AI advisor in the background. After each answer the LLM determines
the next question based on the conversation so far; a fixed list of questions does not fulfill the task.
Answers are entered exclusively in the app; after five answers there is a
design recommendation. The app is not integrated into an LLM chat card.
The template requires shared layout and form building blocks as well as
progress, loading, and error states. It is a task to build, not a preinstalled wizard.

Alongside it, the run script `balcony-wizard` offers a prepared demo of the same task.
Without a coordinator, it creates an advisor with the role `standard` and an empty tool list,
binds its own view to it, and chooses it as primary actor. The start button in the app
begins the interview; the setup does not call a model yet. The form counts five answers;
the advisor determines the questions and the final recommendation. Progress and finished
outputs come from the actor conversation and are kept on reload. Failed
model responses can be requested again without counting another user answer.
The demo uses AppLayout, Stack, and Form and has no chat widget. It is a concrete
reference package, not a domain requirement for the general run builder.

The concept mapping is in the templates' `tags`: for skills and run scripts in the comma-separated
frontmatter, for explicit contributions as a string list. The host treats all keywords equally;
it knows no reference catalog. Names must be non-empty, unique, and without outer spaces.
The UI shows the keywords and uses them for search and selection filters.
The concept catalog lies exclusively in `plugins/ragents.reference/examples.ts`.
Walkthroughs in `plugins/ragents.reference/walkthroughs.ts` add concepts outside a
template, such as the global coordinator and recovery. They describe concrete
user steps and expected behavior but register no additional templates.
The generated reference forms from them and from the actual templates the two
perspectives and the concept overview. `pnpm check:homepage` requires at least two
examples per product concept as well as valid mappings. For ordinary concepts skill templates count;
start guides, run scripts, walkthroughs, and the primary actor have the counting kind explicitly
given in the catalog. The same scenario as skill and script does not double the domain coverage.
The mapping is editorial coverage, not proof of successful model runs.
UI controls are not concepts of their own in this catalog. The demos combine controls
according to their use case; neither a minimum number per control nor complete
control coverage is required. The technical UI reference is still generated independently of this
from the exported contracts.

Two web guides offer their own interface before the run: `Set up conversation circle`
collects topic and number of rounds, `Set up collection board` title and first entry including a preview.
Only `onComplete` passes the values to the respective run script; Cancel and Escape start
nothing. The scripts validate inputs before the first capability calls and use them
for the run title and the agent tasks. With an explicitly passed `null`, the default values described in the
package apply. The further flow stays controlled by the model.
`Moderated round without coordinator` additionally demonstrates `coordinator: false` and a
different primary actor. `Take stock of the run` (`run-roster`) is the embeddable one: started from
the run menu, `ragents script`, or the coordinator's `run_script_start`, it joins a running run,
lists the other participants with `actor_list`, and ends each start with `context.finish`. Two neutral skill templates guide a decision or a
learning unit as reusable work instructions in the chat, without a programmed setup.

## Browser checks

`ragents.browser` adds a real browser controlled through Playwright and requires
`ragents.documents`. Every run has its own browser process with one page, isolated
cookies, and no inherited sign-in. Opening, semantic reading, clicking, filling,
selecting, keyboard input, checks, and screenshots are typed run functions.
The binding schemas are in `plugins/ragents.browser/server/tools.ts`.
The ARIA snapshot contains accessible roles, names, and element references; actions resolve
role/name, label, text, test ID, or CSS in the run's browser. Models need to copy neither
snapshot IDs nor result file paths. An optional target iframe is chosen by CSS.

The browser runs where the run's workspace lies. Browser, page, and everything the
page touches are the browser module that `ragents.browser` brings along as a contribution to the executor
(`plugins/ragents.browser/executor/`, `modules` in the section Contributions to the executor), with the
operations `browser.open`, `browser.snapshot`, `browser.viewport`, `browser.click`, `browser.fill`, `browser.select`, `browser.press`, `browser.check`, `browser.screenshot`,
`browser.state`, and `browser.close`; the module's `stopRun` and `shutdown` close the browser,
and after `shutdown` the module starts no more browsers but rejects every operation on the page with
a cause.
On the server, the server's executor therefore starts it, on a workstation that workstation's, and `localhost` means the machine on which the checked application also runs.
The plugin's server half keeps tool descriptions, schemas, skill, the storage of the
captures, the evidence, the chosen viewport, and the lifecycle, and calls everything else through
`SandboxServices.execute`, for a tool call with its ID.

The module loads playwright-core only in the call, through the machine's `hostPackageFile` from the
host root of this machine (`hostRoot`), as the TypeScript adapter does for its language server; neither the
contribution nor the VS Code extension's bundle contains it. If playwright-core is missing in the host,
`browser_open` fails with exactly this cause. It reports input errors with the machine's `operationError`
as `browser-input-invalid` (400); Chrome starts with the machine's `processEnvironment`.
Chrome is the browser from `BROWSER_EXECUTABLE_PATH` in the environment of this machine, otherwise the Chromium that
provisioning puts into Playwright's browser cache for the pinned playwright-core version;
if both are missing, the error names the expected path and the command. On the server, the
profile section `ragents.browser` sets the value in its environment. It does not travel to a workstation:
there its own environment applies or the Chromium from `pnpm provision --workspace`.
Chrome thus starts with the safe environment of this machine, its `HOME`, and the run's marker,
and the process display therefore attributes it to the run.

What stays visible in the run is held by the server. Besides its result, every operation on the page returns
the page's state: address, captured errors, whether a check has passed since the last action or
navigation, and the IDs of the captures since then. From this the server keeps
the run's evidence. The server sets the time of a passed check with its own
clock, so that it can be compared with its other times, even if the browser runs on a
workstation with a different clock. If a call fails, the server queries the state with
`browser.state`; if the executor is not reachable, the page counts as closed. A
screenshot comes back from the executor as PNG in Base64, and the server puts it into the
run's file storage.

A run's actions run in order and use Playwright wait conditions.
Ambiguous or non-operable targets, missing browsers, and failed navigations
report errors; for ambiguity the error names the candidates and the way out. A target
chooses one of several matches with `nth` (0-based) or `first: true`; `browser_check`
checks with `count` the number of visible matches of a target instead of its uniqueness
(`0` proves absence). Pure visibility and address checks in `browser_check` wait
at most 5 seconds, actions the full time limit of 15 seconds.
Console, JavaScript exceptions, and failed network responses feed into
the check; a failed request appears only once in the error list, even if
HTTP status, console ("Failed to load resource"), and network report it. Successful explicit assertions create a timestamp; actions
and navigation discard it; new errors stay visible in the run's error list without
discarding the check. A screenshot alone is not a successful test.

By default the page runs in a viewport of 1920 x 1080 pixels (16:9, scale 1),
so that screenshots are Full HD images without enlargement and wide interfaces such as
a ribbon are fully visible. `browser_viewport` changes the size per run, for example for
narrow layouts; the chosen value applies until the next change, also after a restart
of the browser in the same run, because the server holds it and passes it to every new browser; a
server restart forgets it. Screenshots are stored as PNG under `browser/` in the
run's file storage and are reachable through its existing image display. An atomically written, hidden capture list keeps
names and file references across browser stop and server restart. Preparing a run
loads it again; no browser is started in the process. The service `browserRuntimeToken` provides
the historical capture list separately from current captures and the valid check time.
Damaged capture metadata report an error for the affected run.
The native agent tool `browser_view_screenshot` returns the last image directly as
image content, without a path. A model without image support receives an explicit error.

Browser stop and cancellation close the processes at the executor that started them;
stored captures are kept. A cancellation before it was the action's turn leaves
the browser open.
Run deletion and shutdown release the resources. After closing there is no current
URL or valid check time anymore. New windows are reported and closed; several
operable tabs and taking over personal browser profiles are not part of this plugin.

## Watchers with a wake condition

`ragents.watch` observes actors per run and wakes other actors as soon as a condition written as TypeScript
returns a reason for the changed state. There is no model in the watcher.
`watch_create` names the observed actor (`source`), the condition (`condition`) as the body
of a function `(now: WatchState, before: WatchState) => string | undefined`, the actor to wake
(`target`, without a value the caller), optionally a named operation without input
(`observe`) whose result supplements the observed state, a text appended to every wake-up
(`instruction`), and `stallAfterSeconds`. On creation, the condition is checked with the
shared TypeScript compiler against the types of `WatchState`; an error rejects the
creation. At runtime it runs in a `vm` context without access to Node or the server,
with a limit of 200 ms per evaluation; it returns the wake reason as text or nothing; anything else is
an error. A watcher with the same source, the same target, and the same condition is not
created twice; `watch_list` and `watch_remove` manage the stock. The definitions are stored,
with baseline, counter, and the last ten verdicts (time, woken or not, reason,
presented changes), as plugin state on the run in the journal and are recompiled and restored when a
run is prepared.

The observed state is deterministic: lifecycle of the source actor, number of finished
turns, state and reason of the last turn, waiting inputs, open questions, the last
output text shortened, plus the result of the operation from `observe` and, as soon as
`stallAfterSeconds` have passed since the last event of the source actor, `stalledForSeconds` in whole
multiples of this span; every further period changes the state again, so a heartbeat
wakes as long as the condition names it. The time base is the runtime's clock. The service listens to
the run's journal events and evaluates throttled (by default one second after the first
event); a timer checks for stalls. Evaluation happens only if the state has changed since the
last evaluation, the target is free (no running turn, no waiting input,
no open question of the target), and the source has come to rest: as long as the observed actor
executes a turn or inputs are waiting for it, there is no evaluation; the changes accumulate
until the end of the chain in one evaluation; only a detected stall is evaluated even while
a turn is running. An empty change list, or one unchanged since the last evaluation,
is not evaluated again. On creation, the first state is stored silently as the
baseline; `before` in the condition is always the state at the last wake-up.

If the condition returns a reason, the target receives an ActorInput with
`presentation: "background"` in the owner's name: reason, changes since the last wake-up
as flat lines (`path: old -> new`, `(new)`, `removed`), and the text from `instruction`. The
woken state becomes the new baseline. A stall tick that does not wake changes only the
in-memory state, not the journal. A throwing condition does not wake, is logged,
and leaves the watcher in place; the next change is evaluated again. Stop, deletion, and
shutdown end the observation.

The watcher starts no work itself and knows no domain logic.

## Model relay

`ragents.model-relay` makes this server's models usable for other RAgents servers without
revealing provider, real model names, or keys. It offers the profile's aliases,
`MODEL_ALIASES` in the section `host` (objects with alias, target, optional thinking level, optional
mapping of the offered thinking levels, and compaction values; see [profiles.md](profiles.md)),
the same ones under which the server's own runs
run; without
aliases the start aborts. Every alias must point to a provider that a product plugin provides through
the service `modelUpstreamsToken` (`plugin-support/model-upstreams.ts`, address, key,
catalog) or to a provider of the profile in `MODEL_PROVIDERS` (`configuredModelProviders`), and to a model from its catalog that its thinking levels and
compaction values fit (`validatedAliasModel`); otherwise the start aborts.
`ragents.product` provides `openrouter` as soon as `OPENROUTER_API_KEY` is set; the key
is not declared a second time.

Two delivery routes under `/relay/v1`, both with the right `models.use`:
`GET /models` returns the aliases in the OpenAI list format with a `catalog` block per entry
(reasoning, the alias's thinking levels with what goes to the target per level, input types,
context size, output limit, the alias's compaction values as `compaction`, and `compat` for
the wire), without names, providers, or costs; a client thus offers the same levels, sends
the same as the server, and compacts with the same values. `POST /chat/completions` reads the request body, replaces
the alias with the real model, sets the server key, and passes through the request together with the
response stream; other headers of the client (such as session affinity) go along,
`Authorization`, `Cookie`, and `Host` do not. An unknown alias is 404, a dead provider
502, and a cancellation by the client cancels the call at the provider. On the way back, the
relay replaces the field `model` with the alias in every SSE block and in the non-streamed response
and removes the field `provider`, because both name the server's secret; every other
line and every other field passes unchanged, and the last `usage` block for the log comes
from the same pass. The relay builds no streaming logic of its own. Per
call, user, alias, real target, status, and token count are written to
`plugins/ragents.model-relay/relay.log` in the data storage. There are no quotas or billing;
whoever has the token has the relay's model access.

On the consumer side the relay is simply the provider `relay` (see [profiles.md](profiles.md),
`AGENT_PROVIDER: "relay"`); between two RAgents servers nothing runs but the
OpenAI-compatible wire. The relay carries no run membership and does not depend on the engine.

## Profile distribution

`ragents.profile-distribution` offers a client profile of this server for download.
`CLIENT_PROFILE_FILE` names the client profile file, relative to the server profile file (one file per
variant: `ragents.config.customer-client.ts` next to `ragents.config.customer.ts`); without
the key the plugin is inactive and says so in the log; a set key without a file
aborts the start. At startup the plugin checks the file without its environment: name
`ragents.config.<profile>.ts`, `host.PRODUCT_PROFILE` equal to the name, `host.PLUGINS` not
empty, every section belongs to a plugin of the list, host keys known, secrets only as
`env(...)`, `users` and `anonymousUser` well-formed; the keys per plugin are checked only by the
client at startup against the declarations. Plugins by ID come to the client as
built-in bundles from its host (checkout or package `@schlenkr/ragents`) and are not
shipped along. Plugins by path are bundles that the distributor checks with the same reader as the
server (manifest, ID, `format`, `api` equal to its host API); they go into the archive unchanged,
their provisioning as an export of `server/index.js`. A source folder instead of a
bundle and symbolic links in a bundle are startup errors of the distributor, not a silent
omission, as is a bundle that the client profile file names absolutely or with `~/`: the client
resolves the file on its own machine and would find under this path not the delivered
bundle but nothing or a foreign one. The client profile file therefore names shipped bundles with `./` or
`../` relative to itself. After unpacking, `connect` checks the `revision` of every bundle in the archive.

The archive contains exactly the profile file and the files of these bundles, relative to their
shared folder, as a deterministic `tar.gz` (package `tar`, pure JavaScript, without
timestamps); the version is its SHA-256 and is determined anew at every start. A web is not in it:
the host's web is the same for every profile and lies in every host installation; the
web halves come from the bundles at runtime. Values of `env(...)`, data under `DATA_DIR`,
and `node_modules` are never in the archive.

The method `ragents.profile.describe` (right `profile.fetch`) names the profile name, version, the
host API number (`hostApi`, from `host-api.json` of the running host, against which the bundles in the
archive are built), the commit of the running host (from `.git` or from `ragents.hostVersion`
of the package, as a fallback the key `HOST_VERSION` for containers without either), the
package version this server itself carries (`packageVersion`, from its own
`package.json`: in the package its `version`, in the checkout the root's), the path of the
profile file in the archive, the size, the archive path, and the plugins with origin `host` or
`archive`. Only `hostApi` is binding for the client; commit and package version show the way
to a matching host if it differs. The route `GET /profile/<version>.tar.gz` (same
right) returns the archive; a different version is 404. The counterpart is `ragents connect`
([profiles.md](profiles.md), server-delivered profiles).

## Open limits

- Plugins are not installed. At runtime the server loads only the bundles the profile
  names: built-in ones under `bundles/` or bundle folders at a fixed place on disk.
  Loading a plugin at runtime from a foreign source is NOT intended - no
  registry, no signature check. Bundles are downloaded only before the start, as part
  of a client profile that `connect` fetches from a RAgents server (section Profile distribution).
- Whether a bundle from outside the host matches its sources is not checked by the host, because the
  bundle does not name its source folder; an external repo builds by itself before starting and before tests. The
  open fallback of the resolution hook still applies to code outside bundles.
- A new plugin interface takes effect only after reloading the page; there is no HMR for web bundles,
  and for classes in host code only with a reload, because the stylesheet comes from the server.
  Libraries bundled by several plugins exist several times in the browser. If someone rebuilds a bundle
  while a server is running from it, the server delivers the new web half and new assets with its
  old server code until it restarts; the host keeps no version per running server.
- The build tool does not see pure type imports, because they disappear in the bundle: a third-party
  plugin can name types from a module outside the host API, such as from the agent runtime,
  and still builds. For the built-in plugins, `apps/server/tests/host-api.test.ts` also checks
  type imports. If such a type changes, only the type check breaks for the third-party author.
- An access projection is a declaration by the plugin, not a check: a plugin without a
  projection shows its states completely to an access without `runs.inspect`, and the host does not check
  whether a registered ID belongs to the states of the registering plugin; an ID
  only has at most one projection.
- `requiresWorkspace` is a declaration by the contribution, not a check: a metadata contribution that
  asks the executor without declaring that also reaches other users' `ownerOnly` workspaces. Until the
  run list has reported a run, web and VS Code show its workspace tabs; the server
  then rejects their accesses with `run-workspace-owner-only`.


- The recipient tree groups siblings of the same kind only by kind and first handle word;
  actors with a similar task but a different handle start stay individual, and coincidentally
  equal starts fall into a group from four actors on. The creator sets the short description;
  without it the first task is shown there, which without `runs.inspect` only the owner's inputs carry.
- The run panel knows exactly one surface contribution with `RunPanel`; its state is stored per
  browser storage, in VS Code therefore per window. The inspection area opens one tab at a time.
  Run and app frames load from their server; only the server navigation shell is packaged locally.
  A local profile of the extension names its templates only once its host is running; before the
  start nobody knows the templates, because they come into being only with the registered plugins.
  The extension does not clean up fetched host versions: each stays under
  `<globalStorage>/hosts/<version>/`, about 250 MB per version, until someone deletes the
  folder.
  Whether a `newRun` still comes after a run panel without a run is not stated by the contract; the panel
  therefore waits five seconds. If the extension rebuilds the iframe during a start (for example
  when switching theme or access token), the start request is lost: the panel shows
  "No run selected", and an already created run then appears only on the Start page. The run view
  loads independently of the chat; until it is there, a run whose only content is a mini-app
  can briefly show an empty chat after connecting. Only a surface contribution with `RunPanel`
  shows a loading state in the run; without it the empty chat is shown.
- The message layer knows no batch requests and no WebSocket; over HTTP every
  JSON-RPC response is an HTTP 200 with `result` or `error`; only transport errors (no JSON, too
  large, foreign connection) carry a different status. Stdio has no sign-in: whoever starts the
  process has all rights.
- The browser check's evidence is the state of the last call: what the page does between two
  calls, such as a late console message or a navigation by itself, the server sees only
  with the next one. A screenshot travels as Base64 in the executor's response; for
  a workstation, the message size of 32 MiB limits how long a whole page may
  become.
- Two runs on the same folder collide; that is the user's decision.
- A registered stop for a workstation lives in the server's memory: if the server restarts
  before the workstation signs in again, whatever the run started there stays on the workstation
  until it is stopped again or the workstation signs out. On signing out
  the executor ends, but detached background processes of a run do not; only a
  stop of this run ends them.
- The server cleans up the new folder of a deleted run on the workstation only if the workstation
  is reachable at that time; otherwise it stays under the workstation's folder for runs, and there is no
  later cleanup. A contribution's steps are operations every executor
  knows; a plugin brings its own code to the workstation only as a contribution to the executor.
- A workstation finds contributions to the executor only among the built-in bundles of its host. A server can share a
  plugin from outside the host that contributes to the executor only with workstations
  whose host carries the same bundle under `bundles/`; otherwise their sign-in fails with a
  cause. Server and workstation need the same version for every contribution, that is, as a rule
  the same version of host and plugins.
- On a Mac, the process table does not recognize the run marker of programs from the system volume:
  `ps -E` does not show their environment (SIP), measured for `/bin/sleep`, `/bin/bash`, `/bin/sh`,
  `/bin/zsh`, `/usr/bin/perl`, `/usr/bin/ruby`, and `/usr/bin/tail`; Node, Homebrew programs, and
  Xcode's Python show it. Such a process that has detached from the process group of its
  tool call (such as a shell script started with `detached`) appears neither in
  the process bar nor is it cleaned up by the stop. There is no second detection without the environment:
  on detaching, process group and session change, and the parent process becomes launchd. Whatever stays in the
  process group of a bash call is ended by the call itself together with it.
- Provisioning knows no uninstalling and no second version side by side: a
  tools folder carries exactly the pinned version, and a version change replaces it. Two
  profiles on one machine have two tools folders and download the same files twice.
- The relay does not check the provider's response for further traces: `id` and
  `system_fingerprint` pass unchanged, because they name neither model nor provider and the
  client needs the ID for correlation; their pattern still allows conclusions. A
  provider's error text is also passed through, including everything it names. Whoever has the token
  has model access to the extent the relay allows; there are no quotas or billing.
  Two developers on one machine are two data folders and two tokens; a shared
  local server for several users is not intended. A connection loss in the middle of
  a bash on the workstation yields partial results: the call fails with a cause
  that names the workstation, and the workstation aborts the command as soon as it notices the loss;
  until then it may have kept running.
- The server process sandbox (section Server process sandbox) has gaps that its
  tools dictate: the browser of the browser check runs without it; the NuGet cache is shared by all runs
  and writable; on macOS a run reaches Unix sockets under `/tmp` and thus also
  build servers of other processes of the same account (a running `VBCSCompiler` or
  MSBuild nodes of an IDE), and `trustd` fetches revocation lists outside the sandbox, which is a
  side channel onto the network; on Linux all Unix sockets that are visible in the sandbox's
  file system are reachable. Tools that search up to the root for a file and do not treat `EPERM`
  like absence fail on macOS at a blocked ancestor of the workspace,
  such as corepack without `packageManager` in the `package.json`. Node 22 reports
  `EnvHttpProxyAgent is experimental` on stderr at every start. The library is a research preview
  (version 0.0.x). On Linux in a container, bubblewrap needs user namespaces, that is,
  relaxed container profiles (`docs/operations.md`).
- On Windows, `scripts/start.sh` and the repository's other shell scripts need the developer's
  own bash (such as Git Bash); the bundled bash applies only to the runs' tool
  `bash`. A standalone server (`ragents start`) still needs `RAGENTS_BASH` pointing to
  such a `bash.exe`; both workstation launchers select their bundled Bash automatically. The bundled
  bash for win32-arm64 consists of the same x64 programs as for win32-x64, because MSYS2 has no
  native ARM64 userland; it runs in Windows emulation. The platform is checked only
  in unit tests that simulate it (shell resolution, data folder, environment, prompt contribution,
  rejection of the process table); the real run-through is in `TODO.md`.
- Only the per-platform version of the extension brings `rg` (win32, darwin, and linux, each x64 and
  arm64), as do the npm platform tool packages. The universal extension, which the Marketplace
  delivers for example to Alpine or linux-armhf, and a server without `RAGENTS_RG` find `rg` only
  in the `PATH`; otherwise the prompt steers toward `grep`
  with excluded folders. The search with `rg` respects `.gitignore` only in a Git repository;
  in a folder without Git it skips only hidden files and what `.ignore` and
  `.rgignore` exclude.
- `bash` runs at most 3600 seconds per call, and whatever a command starts in its process group in
  the background ends with it. A command that takes longer, such as a cold build of a
  large solution, does not go through `bash` but through a plugin's workflow with its own
  time limit (`commands.run` with `timeoutMs`).
