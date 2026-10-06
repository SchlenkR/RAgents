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
  folder `actors/<name>/` in the plugin folder registers one. A shared package lives in the main
  room of a run, whose names every room sees: at startup the host rejects a name two plugins share,
  a shared name that equals a run script's handle or one of its bundled programs, and a script that
  needs a shared package no plugin provides
- typed run functions (`host.functions`), native model tools unless they opt out
- named domain operations with an input schema, operator policy, and shared execution for
  several surfaces
- roles and prompt parts
- external actor runtimes (`host.actorRuntimes`): named contributions of
  `{ id, title, driver: AgentDriver<"external"> }`. IDs are unique across plugins; duplicate or
  missing names fail with a cause. The catalog exposes the names and titles for actor creation,
  and the scheduler dispatches the ordinary turn and lifecycle methods through the registered
  driver. Protocol behavior belongs to the plugin, never to a core branch
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
  Message layer) as well as delivery routes (`host.http`) for files, frames, and connection
  upgrades (section Rights in server and web contributions)
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
- access projections (`host.accessProjections`): visibility of a plugin state and its chat
  events by state ID. `private: true` removes both from the run view and chat even with
  `runs.inspect`. Journal event queries and subscription delivery also omit its state events,
  including `event_query`, TypeScript access, and the host's journal methods. The raw persisted
  journal, archives, and internal state replay keep them. Otherwise inspection access receives
  the original state and events, and the callbacks define what restricted access sees.
  `state(entry)` receives the state including `updatedAt` and returns the visible value or
  `undefined`, in which case the state is missing from the run view; the host keeps
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
agent, including the global coordinator:

- `beforeModelCall(agent, call)` before every model call of a turn. A returned text
  reaches the model as a hidden note after the conversation history, only for this call;
  the chat does not show it, the journal does not name it, it is not model context. `call.kept` is
  the JSON value this contribution last stored for the agent with `call.keep(value)`,
  also after a host restart: it is in the journal as `plugin.state-replaced` with actor scope under
  the contribution's ID; the model never sees it. After the end of the turn,
  `call.keep` fails.
- `afterToolCall(agent, outcome, call)` after every tool call, with its name and whether it
  failed. A returned result made of text and image parts replaces what the model sees of
  the call; `isError` marks it as an error. Optional `outcome.toolCallId` identifies the
  completed call, so a plugin can take its stored image result by run and call ID even
  when several calls run in parallel.

Both see `call.signal` of the running call and `call.modelReadsImages`. The users are the
project check of the actor programs (a note on new or fixed errors, state in
`call.kept`), image reads, and the browser's image display (replaces the result of
`browser_view_screenshot` with the capture). A contribution registers no tools; those come through `host.functions`.
The engine binds every contribution to the agent and calls it directly
(`packages/ragents/src/drivers/agent-hooks.ts`); the settings show it under its ID.

<!-- guide:plugins -->
## Provide functions

A plugin registers functions with `defineRunFunction` and `host.functions`, including a
short `description`, optional `longDescription`, input and result schemas, and implementation.
`label` is the human-readable name. The host derives `context.functions.<name>(input)` signatures
from this data. Snippets and actor programs use the same catalog and execution. Availability and
bound identity apply equally, while a program's `capabilities` limit its installed build.

Every function is a native model tool and is also available through `context.functions` in
`typescript_eval`. The model calls a single action directly; a snippet combines calls, filters
results, and passes values onward without transcription. `nativeTool: false` keeps a function
snippet-only. That is the exception for low-level interfaces whose raw results belong in code,
such as the engine's journal event functions (`event_query`, `event_subscribe`,
`event_unsubscribe`, `event_subscription_list`); for models, `watch_*` covers waiting for state.
A function whose purpose only works natively, such as `browser_view_screenshot` returning image
pixels, must not opt out. Functions that only programs may call are limited by their
availability, not by the native flag. The building-block reference marks snippet-only functions
in the catalog, and the system prompt lists them as the functions only available through
`context.functions`.
The native calls of one model step run concurrently only when every called function declares
`executionMode: "parallel"`; otherwise the step runs them one after another in their order.

`endsTurn(output)` lets a native tool end the caller's turn with its result, as `ask_user` does
after posing a question: when every call of a model step ends the turn this way, the model gets
no further request in that turn unless an input already waits for it (`docs/spec/core.md`, Turns
of an agent). An error result never ends the turn, and a call through `typescript_eval` does not
either.

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
its addresses (`web.entry`, with its own CSS also `web.css`, both under `/plugins/<id>/web/` with
the bundle revision as `?v=`, so that no browser or proxy cache keeps an old web half after a deploy),
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

Bootstrap also returns `hostPackage`: either `null` or
`{ path: "/api/host-package", integrity: "sha512-..." }`. The descriptor is present only when
the server has a retained package archive and the caller is eligible to register a workstation.
Loopback access can register without profile users; network access requires enabled sign-in and
a signed-in user. Both require `runs.write`. Token-only network access to a profile without
users receives `hostPackage: null` and a 403 on download.
`RAGENTS_HOST_TARBALL` explicitly names that archive. Before
listening, startup checks its package name, version, source commit, complete published file set,
and file bytes against the installed host, excluding installed `node_modules`. A missing,
damaged, or mismatching archive aborts startup. Without the variable, bootstrap advertises none;
the server does not recreate a package from its installation or serve a source checkout.
`GET /api/host-package` applies the same ownership and permission rules as registration and
returns the retained tarball bytes with
`X-Ragents-Integrity` set to their SHA-512 integrity. The archive contains only published package
content, without profiles from outside the package, credentials, or runtime data.

Public plugin configuration also controls the web contributions that are actually active. A
plugin that is installed but disabled for the current configuration stays in the profile for list matching,
but provides neither providers nor tabs or presenters, and its templates are dropped. That way
a domain plugin in an installation without its prerequisites disappears together with its server-side contributions.

## Ownership per facet

Every plugin folder owns the assets and contributions belonging to its capability; a purely
server-side plugin needs no empty web folder. Not every plugin needs every facet,
but an existing facet stays with its owner:

| Facet                        | Owner                                                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prompt                       | `.hbs` in the server plugin that provides the rule or capability                                                                                                                         |
| Skill                        | `skills/<name>/SKILL.md` in the owning plugin, including audience and optional starting task                                                                                             |
| Run script                   | `run-scripts/<name>/` in the plugin whose capability the run demonstrates                                                                                                                |
| Selectable system prompt     | `prompts/<name>.md` or `.hbs` in the product plugin                                                                                                                                      |
| API                          | Contracts in `contract.ts`, methods in the server plugin, `rpc.call` in the web plugin                                                                                                   |
| UI and CSS                   | Components and styles in the matching web plugin                                                                                                                                         |
| Configuration                | Declaration and evaluation in the matching server plugin                                                                                                                                 |
| Storage                      | `host.storage`, always under `plugins/<plugin-id>`                                                                                                                                       |
| State and chat visibility    | `host.accessProjections` in the plugin that owns the state                                                                                                                               |
| Lifecycle                    | Start, run preparation, deletion, and shutdown at the owner                                                                                                                              |
| Provisioning                 | `provision.ts` in the plugin folder, in the bundle an export of `server/index.js`; tools in `<data folder>/tools/<plugin-id>/`                                                           |
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

A run whose journal could not be loaded receives no stop hooks during deletion because it has no
live session. Every delete hook is still invoked; a `journal-unavailable` error from cleanup that
requires its state is skipped only for such a run. Other deletion errors remain failures, all
other hooks still run, and the host keeps the intent and reports the run as locked (`core.md`).

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
answers separately per run where it works (`machine`: `server` or `client`, for `client` with
`workstation`, its ID and current label) and in which folder
(`folder`: `fresh` or `existing`), plus with `kind` the `id` of the kind when a contribution provided the new
folder. This is the one place where a workflow centrally asks where and in what a run
works; there is no mixed value of both. If a contribution reports a kind, `ragents.workspace`
creates no directory of its own for it; the contribution brings its own. The resolution then provides everything
`SessionWorkspace` knows: besides `cwd` also `description`, `gitEnv`, `gitConfig`, `extraEnv`,
`currentRoot`, `runOperation`, `hostSandbox` (home folder, read-only
roots, and with `ident` the account under which the sandbox executes), and `sandboxFolders` (folders
outside the workspace that the run's process sandbox allows, section Server process sandbox).
With `ident`, the sandbox host hands every registered root of the server (`@actors`, `@documents`) to
that account (`syncWorkspaceOwnership`), and it does so only inside the run storage. The resolution
therefore refuses a run whose registered root lies outside it, such as `@documents` with
`DOCUMENTS_DIR`, with `workspace-root-outside-storage` (409) and the root's alias, before any tool
runs; the root is never left out of the handover, because the run's account could then not write
in it. Ending and deleting a run
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

The document store is a separate service: `ragents.documents` provides `documentStoreToken`
(`directoryFor(runId)`), by default under `host.storage.session(runId, "documents")`,
with `DOCUMENTS_DIR` as a subfolder per run under an external path. The store is not in the
workspace but a writable server root with the alias `@documents`, registered like `@actors`
(`registerWorkspaceRoot`, with `RAGENTS_DOCUMENTS_DIR` for a bash on the server): file tools,
`copy`, `show_document`, language servers, and a bash with `@documents/...` as `cwd` reach it in
every binding and run at the server's executor for it (section Workspace, sandbox tools, and
processes). Writing text is `write` with `@documents/<topic>/<file>`; an existing file or folder
goes there unchanged with `copy`, so the model never retypes a file. Per topic a subdirectory is
created there, and `ragents.documents` shows it in the Documents tab. Its prompt contribution, bound
to `show_document`, `write`, and `copy`, says that evidence and reports go to `@documents/...` and
deliverables into the project, that `copy` moves between the two, and that a document embeds
images with a path relative to itself or with `@documents/...`.
Its `contract` (content route paths, the grant operation, and the grant lifetime) is a declared
export for the server and web halves of plugins that require `ragents.documents`.
Actor programs use their own private pnpm workspace under their run storage.
Its `actors/` collection is a server root with the alias `@actors`
(`registerWorkspaceRoot`): file tools and language servers reach it in every binding through
the alias and run at the server's executor for that, as does a bash with `@actors/...` as `cwd`,
and only there is `RAGENTS_ACTORS_DIR` available (section Workspace, sandbox tools, and
processes). The host reserves the alias `@skills` for the skill folders. Authorization and
resolution of these plugin workspaces happen through the shared workspace contract;
the model does not need to carry private storage paths over from responses.
Other plugins consume the workspace services through typed tokens.

`show_document` opens a document display from exactly one source: `file_path` for any file `read`
reaches, named the same way, also an image or another binary file and a file under `@documents`,
or `content` for text the model wrote; a correlation error names the two forms. The call checks a
`file_path` through `files.text` at the machine of its root, where a binary or too large file
counts as present, and returns only "Shown to the user."; the display reads the current bytes
again through the content route below. It is a native model tool, so that a
display costs one round and not three. It publishes no core artifact: `RunView.artifacts` stays
unchanged. Immutable, versionable run results are created through `artifact_publish`;
the Documents view lists these results in addition to files and displays.
The document buttons in the primary chat, in the actor conversations and inspector use the same registered tool presenter and open the Documents view.
Its chat collection takes all loaded actor histories into account and lists the same
tool call from the main history and an actor history only once.
Image documents use the host's `ImagePreview`; Markdown images use `ImagePreviewGroup`.
Clicking a preview opens the shared full-window image viewer. Text documents keep their
"Expand document" action.

The content route `GET /api/plugins/ragents.documents/runs/<runId>/raw/<reference>` serves the
bytes of one file, text or binary, with the media type of its extension, `Cache-Control: no-store`,
`Content-Security-Policy: sandbox`, and `X-Content-Type-Options: nosniff`. `<reference>` names the
file as `read` does, one encoded path segment per segment: relative to the run's root, absolute (an
empty first segment), or with an alias such as `@documents/...`. Because the reference is a path,
relative addresses inside a document follow plain URL semantics. The server reads the file with the
executor operation `bytes.read` at the machine that holds its root, a workstation included, at most
16 MiB; a folder, a missing file, a path outside the roots, and the limit are errors that name their
cause. A server root needs `runs.read` and the run check, as the store always did; the run's root
needs `runs.read`, `runs.inspect`, and access to the run's workspace (`workspaceGuardToken`), as the
Files view does. A reference whose decoded segment holds a `/` or climbs with `..` (between `/` or
`\`) names no file and counts as the run's root, so an encoded separator cannot lead from an alias
into the run's root with `runs.read` alone. Reading a server root does not need the run's root to
exist (section Workspace, sandbox tools, and processes). The Documents view, the shown files, and the
browser evidence use this one route.

Besides `raw/`, the route accepts `grant/<grant>/<reference>`, for a page that cannot send the
sign-in with a document's own requests. `ragents.documents.grant` (`runId`, `root`: an alias, or empty
for the run's root) issues a grant to its caller under the rights the route asks for that root: 32
random bytes, ten minutes long (`DOCUMENT_GRANT_LIFETIME_MS` in the plugin's contract), held only in
the server's memory, for `GET` only, and standing for the caller's access only at references of its
run and its root (otherwise `document-grant-invalid` or `document-grant-outside`, both 403). The route
reads it with `accessFromAddress` (section Rights in server and web contributions), and the host
checks run and rights against the grant's access as for a signed-in request. The long-lived access
token never appears in such an address.

The viewer resolves the addresses inside a document against the document's own reference
(`plugins/ragents.documents/web/links.ts`): a relative one against the document's folder, one with
an alias against that root, while `http(s):`, `mailto:`, other schemes, addresses from the site
root, and `#anchors` stay as they are; text the model wrote has no folder and resolves against the
run's root, and a result without a file keeps its addresses as written. A Markdown document hands
this resolution to quassel as `QuasselProvider` with `resolveUrl` around its `Markdown`; quassel maps
every link and image address with it before its link policy, so the source stays as written and code
blocks stay untouched. An HTML document gets a `<base href>` for its folder and
`<meta name="referrer" content="no-referrer">` at its start, after a doctype, in the `srcDoc` of its
frame; the frame keeps its sandbox without scripts but with `allow-same-origin`, so that the browser
sends the sign-in cookie with the images the document names. Image documents and downloads load
from the route directly.

Where the page carries an access token instead of a cookie (VS Code), no address of a document
carries it. Every address of the content route takes, instead of `raw/`, the grant of the root its
first segment names (`grantedAddressOf` in `web/links.ts`): resolved Markdown addresses, image
documents, and downloads alike, so a Markdown address that climbs from `@documents` into the run's
root takes that root's grant. An HTML document puts the grant of its own root into its base
(`.../runs/<runId>/grant/<grant>/` and its folder), so that its relative addresses keep it, and keeps
the grant it opened with until its file changes, so that a renewal does not reload the frame. The
page holds one grant per run and root (`DocumentGrantStore` in `web/grants.ts`), shared by the
Documents view and the chat: it asks for one when an address first needs it, renews it after half its
lifetime while a view watches, and hands none out in its last minute. A failed grant is asked again
after 30 seconds; until then a document shows the error instead, and a Markdown address keeps its
plain address, which fails visibly. While a grant loads, a Markdown address is empty. A result of
`artifact_publish` lies on the host's artifact route, which knows no grant: with a token, its image
or download loads with the page's bearer, as text documents always did, and shows under a `blob:`
address.

quassel resolves a Markdown address only when its Markdown mounts: Streamdown's memo ignores a
changed `urlTransform`. The Documents view therefore mounts its Markdown again with every change of
the grants, and with a token the plugin's `SessionProvider` shows a run only once the grants of its
own root and of `@documents` have settled (`useRunGrantsSettled`), once per run, so that the chat
names its images with them from its first render.

The run's chat resolves its Markdown the same way: `ragents.documents` contributes `resolveRunUrl`
(section Web as plugin host), which maps a relative address and one with an alias against the run's
root, with a token through the page's current grants, and keeps every absolute one, so that an
answer with `![shot](@documents/browser/x.png)` shows the image.

`ProductRuntime` and `WorkspaceRuntime` are mandatory contracts of every profile: if one of the two
services is missing, the server aborts at startup with a clear error message instead of running in a half
state. This is a documented exception to the REMOVAL TEST - the respective plugin
is not optional but part of the contract between profile and engine. The logic contribution, on the other hand,
is optional: without `ragents.orchestration` the server starts, and a TypeScript actor finds
no driver at runtime.

Run metadata are contributions as well. The server collects them per run under the plugin ID, and the
web renders the matching presentation in the run header from its registry. A workspace plugin thus provides,
for example, the branch for the run list and chat without the core
knowing Git domain logic. For the run list a contribution declares `listDetail(value)`: it turns
its value into one line `{ label, text, icon? }` (`RunListDetail`, `plugin-types.ts`), the icon
`folder`, `branch`, or none. `ragents.runs.list` delivers these lines per run as `listDetails` in
registration order; a contribution without a value or without `listDetail`, or whose
`listDetail` returns undefined, adds none, and one that throws or returns another shape counts as
failed like a failing `describe`. The browser and VS Code draw the lines the same way below the
run title, so the run list needs no web component of the plugin. `ragents.workspace` lists the
workspace summary with the folder icon unless the run works in the new folder on the server.
The run list queries contributions only for the runs the caller may see,
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
workstation loads it from the selected host's bundles, in exactly the version the server uses
(section Contributions to the executor). To hand a profile together with its bundles to other machines, a server adds
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
to a bundle folder: absolute, with `./` relative to the profile file, or with `~/`. Windows drive
and UNC paths are absolute paths; relative and home paths also accept backslashes. Hard startup errors
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

**Version contract.** `HOST_API_VERSION` is 12 for the external driver and updated host contracts. It increases with every incompatible change of a
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
A request that cannot carry the sign-in, such as an image of a document in a frame without the
sign-in cookie or the access token, can carry its own short-lived credential in the address:
`accessFromAddress` on the route contribution returns the access such an address stands for,
undefined for every other address, and throws the error of an invalid credential. The host asks it
first, before the access token and the sign-in, and then checks the run named in the path and the
route's rights against that access exactly as for a signed-in request; an error answers the request
with its status. `ragents.documents` is the only user (grants of its content route, section
Ownership per facet).

A route can additionally take HTTP upgrade requests, such as a WebSocket: `upgrade` on the same
contribution receives `HttpUpgradeContext` (`request`, the raw `socket`, `head` with the bytes
already read, and `url`) for every upgrade request that `matches` accepts, and answers or takes over
the connection itself (`HttpContributionRegistry.dispatchUpgrade`). Of the host's gates only the
switch for external access applies to an upgrade: the host knows no sign-in, no access token, and
no `requiredRights` there, so an upgrade route authenticates its requests itself, as the service
tunnel does with one-time secrets (section Workspace, sandbox tools, and processes). An upgrade that
no route takes is answered with 404 on the raw connection, a disabled external access with 503.
The host passes the connection on unchanged; a route that speaks WebSocket bundles its own
library, as `ragents.processes` bundles `ws`.
The current contracts and the host route mapping are generated from the code in the developer reference;
the owning plugin names further rights itself.

If the input of a method or the parameters of a channel name a `runId`, the
dispatcher additionally checks membership of the run ([profiles.md](profiles.md)); a run shared
with the caller counts. If the contract requires `runs.write`, the method operates the run: a
caller who sees the run through a share for reading gets `run-read-only` (403), and if a start
option has reserved the run for its owner with `ownerOnly`, the dispatcher rejects every other
access with `run-owner-only` (403) before the method runs, even one with `runs.read.all`. This
applies without own code to every contribution, such as answering a question, a mini-app action,
or ending a single process; `ragents.chat.stop` and `ragents.runs.stopAll` stop the whole run,
`ragents.runs.pause` pauses it, and `ragents.runs.interruptTurn` interrupts an actor's running
turn. `ragents.runs.resume` operates the run and therefore needs `runs.write`. A channel with `runId` ends as
soon as its caller no longer sees the run because a share was taken back.

In the browser, `useAccess` provides the same access context and `logout`.
`accessMode` distinguishes hidden, read-only, and editable. Workspace tabs, run header, and status contributions can require their own
read right through `readRight`. Technical contributions use `runs.inspect`. Workspace tabs and header contributions
that need the run's workspace declare that with `requiresWorkspace: true`; they are missing
when the run list reports `workspaceAccessible: false` for the run (`workspaceAccessible` from
`PluginRegistry`; a run not yet listed counts as reachable). A contribution with mixed
content queries the same itself, such as the Files tab, which then shows only the document store. Settings contributions can
also require their own read right; without one, the settings read right applies.
The component checks its write actions as well. Hiding does not replace a server-side
check: own routes declare their required rights independently of the UI.
`SessionInfo` carries the caller's sharing from the run list: `operable` (false in a run shared
for viewing only and in someone else's run only its owner operates; missing until the run is
listed), `canShare` and `shared` for whoever may change the sharing, and `sharedAccess` for
whoever sees the run only through a share ([profiles.md](profiles.md), Sharing in detail). For a
run with `operable: false`, `PluginChat` wraps everything below it, header and status
contributions, tabs, mini-apps, and the frame of a single app included, in `RunAccessScope`
(`AccessContext.tsx`): there `useAccess().can("runs.write")` is false and every other right stays,
so a contribution that checks `runs.write` turns read-only without code of its own. Rights read
directly from the snapshot (`hasRight`, `canStartEntry`) are not narrowed.

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

Core contracts: `ragents.chat.*`, `ragents.runs.*` (run list and read markers, run view, journal,
queues, stop, and questions from the engine), `ragents.startOptions.*`,
`ragents.runs.prepare`, `ragents.settings.*`, `ragents.plugins.bootstrap`, `ragents.external.set`,
and the channels `ragents.runs`, `ragents.run`, and `ragents.chat`
(`apps/server/src/api/contracts.ts`, `packages/ragents/src/http/contracts.ts`). Whatever is not a
JSON message remains delivery through `host.http`: static interface, mini-app frames,
artifact and attachment content under `/files/runs/<run>/artifacts/<id>` and
`/files/runs/<run>/attachments/<id>`, document content, help, `/health`, and the WebSocket legs
of the service tunnel. The registry `http` exists only for that; every JSON response is a method.

The reference is generated from the registrations: `host.methods.describe()` and
`host.channels.describe()` provide owner, ID, description, rights, and schemas for the readable
reference and the OpenRPC document. The web client (`apps/web/src/rpc/client.ts`) also runs
under Node; the VS Code extension and `pnpm driver` use it with their own `fetch`.

## Web as plugin host

Chat content uses the host's `--chat-max-width` token (900 pixels). quassel's inherited
`--qsl-chat-content-max-width` constrains transcript content, composers, and action docks,
while transcript scrollers fill their panels. Standalone actor composers use the same token.
Hover sidebar state exists only in the current page; persisted layouts store it as hidden.
Pending run starts retain a visible title in the accessible Run title bar region.

Every page holds exactly ONE live connection to the server: the client `rpc` (`apps/web/src/rpc.ts`)
opens `GET /rpc/stream` with the first subscription or the first callback handler and closes
it when nothing is open anymore. Requests go as `POST /rpc`. Subscriptions are channel contracts:
`rpc.subscribe(contract, params, onMessage, onError)`; on connection loss the client reconnects,
resubscribes all channels, and calls `onConnected` listeners, which is why providers repeat
their initial state on subscribing. Core channels: `ragents.runs` (list changes, one
message immediately; a changed read marker reaches only the subscriptions of its user), `ragents.run` (`ready` on subscribing, then `run` per journal change), and
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

In the browser host, Settings, Appearance, Zoom scales the whole page in the steps 80, 90, 100, 110,
120, 130, and 150 percent, default 100 (`apps/web/src/zoom.ts`). Like the appearance, the choice is
stored in this browser per server address (`ragents.zoom`), synchronized with open tabs, and an
invalid stored value or a storage error is shown explicitly; it needs no settings right, because it
changes only the own display. The interface applies it before the first React render as CSS `zoom`
on the root element, and mini-app frames scale along. `body` is `position: relative`, so it is the
offset parent of the popups and Base UI measures the zoom there; menus, popovers, and selections stay at
their anchor. Pointer events report zoomed client coordinates, the dock geometry is unzoomed: the dock
divides pointer movements by the ratio of rendered to layout width of its container, while reordering
the header's window buttons compares client coordinates with client rectangles. The host
`vscode` has no such setting, the shell's `ragents.zoom` applies there (`apps/web/tests/zoom.test.ts`,
`apps/web/tests/zoom-browser.test.ts`).

Menus, header hints, actor popouts, chat step details, and journal use `Popover`, `Tooltip`,
and `Select` from the UI library. Base UI follows their anchors, scrolling, and layout changes.
Header dropdowns share `HeaderDropdown`, exported through `@ragents/web/ui`: Run details,
Run script, Agents, Share, and the global coordinator use the same square panel, labeled
heading, close button, 8 px padding, and theme dimming. The panel opens below the nearest
header, inset 8 px from its right edge; outside a header it follows the calling row or action.
Its width is `min(800px, max(320px, anchor width - 16px), available width)`, so narrow action
anchors still give a readable panel and the viewport always limits its width. Height is limited
to 70 percent of the viewport, 560 px, and the available space. The portal sits within the
nearest header by default, keeping the trigger above dimming. The nonmodal Base UI popover
closes on Escape or an outside press and restores focus unless it has moved elsewhere.
The global conversation uses region semantics, keeps its history mounted, and initially
focuses its composer.

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
  (default `overview`) or the header (`toolbar`); `readRight` limits visibility.
  Their context contains the registry, open state, `onOpen`, `onClose`, and `onBusy`. The host
  coordinates overview and toolbar history. Toolbar contributions are mounted from application start,
  but activate their own connections only on use and keep them afterwards across run switches.
  In both browser and VS Code, only the selected server supplies these contributions, including
  on Start before a run is opened. Contributions from different environments are never merged.
- Start sections (`startSections`): `StartSectionContribution` declares `id`, `order`, optional
  `readRight`, and `Section`, a component receiving `StartSectionContext` with `runs` and
  `onOpenRun(runId)`. Sections follow "Continue", sorted by `order` and then `id`. The context
  carries every run the server lists for the viewer, sorted by update time, through readonly
  `ConnectionRun` values including `id`, `title`, `updatedAt`, and optional `metadata` keyed by
  server-side `sessionMetadata` contribution ID. `connectionRunOf` preserves `ListedSession.metadata`;
  row detail lines still come from `listDetail`. `onOpenRun` uses the same navigation as a run
  row. The slot performs no additional run access checks; `readRight` only gates the section.
  A section owns its heading and spacing and may return `null`, leaving no empty wrapper or gap.
  `RunPanelApp` passes its registry to `PanelPage` for both browser and VS Code server frames;
  the local VS Code shell has no registry and shows no sections. `PanelPage` also works without a registry.
- workspace tabs and badges (`workspaceTabs`, `workspaceTabsFor`): the toolbar at the right edge
  with the tab area as a popout over the selected content view; the same contribution, the same visibility (`readRight`, `requiresWorkspace`, `available`);
  `placement: "window"` (default `"sidebar"`) lists a tab in the browser among the run's windows in the
  header by default, like a mini-app; per-run user layout overrides can move either kind of button
  between the header and rail (section on the docking workspace below)
- tool and entity presenters; the run providers bind tool presentations together to
  run and navigation. The standard chat and the actor chat consume the same renderer.
- Markdown addresses in a run (`resolveRunUrl`, `RunUrlResolver`): at most one active plugin maps a
  link or image address to one the page can load and returns every other address unchanged;
  `PluginChat` hands it to quassel as `resolveUrl` for everything below the run (`RunUrls` in
  `apps/web/src/chat/QuasselHost.tsx`), and a display with a better base sets its own
  `QuasselProvider`, whose resolver wins. Several active resolvers are an error. quassel resolves an
  address once, when its Markdown mounts, so whatever the resolution needs must be there before.
- run metadata (`sessionMetadata`): a component for the Run details dropdown opened from the
  run title; responsive cells contain every metadata contribution, start option badge, and
  details-placed header contribution. Cells and their text wrap in narrow panels without
  horizontal clipping. The run list takes its lines from the server-side `listDetail` instead
- run header contributions (`sessionHeaders`): contributions appear in the shared run details;
  with `placement: "bar"` instead in the run's title bar between the window buttons and "Share"
  (`RunPanelHeader`), where a contribution that has nothing to show renders `null`.
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
  `ragents.ask` creates one action per call with the payload `{ questions, recipient? }`, each
  question `{ question, header, options: [{ label, description }], multiSelect }`, and answers it
  through its own contract `ragents.ask.answer`; the core does not know this shape
  (`docs/spec/core.md`, Pending actions).
- guides (`guides`): per ID a React component that the host shows in a dialog when a
  template with `guide` is clicked; `onComplete` returns for a skill the text of the
  first message, for a run script the start value as JSON (such as the conversation round
  of `ragents.reference`)

The shared `main.tsx` bootstrap renders `RunPanelApp` for either host. The browser and the VS Code
iframe use the same `PanelPage`, `StartPage`, and `RunsPage` with one current-server adapter.
In the browser the address selects that server; in VS Code the selected environment does.
Start shows permitted templates under "New", then the five recent runs under "Continue", then
plugin sections; Runs adds search and deletion with confirmation.
Neither page combines servers, and Start contains no server chips.
Free creation, template access, reading, and deletion retain their independent rights.
Both hosts draw run rows from the same mapping of `ragents.runs.list` (`connectionRunOf` in
`run-overview.ts`): state, pending actions, read notice, owner, metadata lines, and lock.
The shared panel reloads the list on the `ragents.runs` channel and every five seconds.
Equal responses retain the previous array and run entries; changed responses reuse unchanged
entries. Equality includes metadata, access, and viewed state, not just the run revision.
Derived session contexts retain their identity while their inputs are unchanged, so polling and
unrelated parent renders do not notify context consumers. Real chat, run-view, or session changes
still update the context.
Global coordinator and other toolbar contributions stay mounted across run switches and starts;
overview contributions retain their slot. Settings and Help are header buttons.
Guided templates still use the existing preparation dialog and chat. Browser runs use the server.
The journal remains in the shared bottom status bar and is also a dockable browser tool.

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

The browser inspection rail opens a flyout, and its tools can also become
windows in the docking workspace. Visited browser panels retain their instances while hidden,
with React effects paused as described below. In VS Code, inspection stays in the existing
popout; only contributions with `keepMounted` retain their state there, with the same pause.
File-browser state belongs to its component instance
and disappears on unmount.

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

Browser runs automatically place Chat on the left and mini-app tabs on the right in equal
areas when the workspace container is at least 1000 pixels wide. Narrower containers use one
tab area. The first mini-app can arrive after the chat has opened. Automatic layouts adapt to
width changes until the user moves, closes, resizes, maximizes, or explicitly opens a window.
Previously saved layouts without automatic placement retain their arrangement. Chat, mini-apps,
and inspection tools are equal windows in a user-controlled docking workspace (`DockWorkspace`
in `apps/web/src/run-panel/`). Areas form a binary split tree with draggable dividers. Tabs share
the strip width equally, truncate long titles, and each have a close button. Every area header
has a grip for moving all its tabs. A populated area offers maximize/restore only when another
area exists. The area controls (a tool's header contribution, return to sidebar, maximize/restore)
sit in the active tab cell before its close button, so that cell ends with
`[return to sidebar] [maximize/restore] [X]`. Only an empty area with a neighbour has a close-area
button; populated areas use the individual tab close buttons. Tabs use the existing actor,
mini-app, and inspection icons.

Dock areas (including empty ones), the inspection rail, and the flyout have a 1 px token
border, `rounded-lg` corners, and `bg-card` surfaces over the `bg-app` workspace. The focused
area uses `border-primary/70`. Headers sit inside the border with a subtle bottom rule. Cards
have 6 px gaps, also at workspace edges; docked cards have no shadow. Active tab cells
are square, borderless fills stretched flush to the strip, with no inset padding or inter-tab
gap. The strip clips overflow to its rounded top corners; the tabs themselves have no radius.
Dividers
are transparent gaps with centered three-dot grips aligned along the divider. Their hit areas
are at least 8 px wide or high. The same dots appear on header and flyout drag grips,
muted by default, stronger on hover/focus, and primary while dragging. Resize cursors persist
during capture. Split previews exclude the new gap; merge previews cover the target card.
Frames remain stable siblings, inset within the cards rather than reparented into them.

Dragging a tab or grip shows a five-field compass centered on the area under the pointer and
four guides on the outer workspace edges. The compass sides split the area in half, the center
and tab strips merge tabs, and outer guides allocate 35 percent of the workspace. A translucent
preview shows the result. Escape cancels the drag; outside a target nothing changes. Moving the
last window within its own area leaves an empty half with "Drop a window here" and "Close area".
Moving it to another area removes the emptied source. Closing the last tab removes its area
when others exist; closing the sole area leaves it empty. Escape also restores a maximized area.
By default, the run header lists every view (Chat, each window tab, and each app) as an icon-and-label button in a "Layout
actions" group, whether shown or not; a visible view's button is pressed (`aria-pressed`).
`revealDockPanel` decides the click: a closed view opens beside the focused area in wide browser
workspaces or as a tab in narrow ones; a background tab or the active tab of an area hidden by
another maximized area is selected and its area focused; an already visible view changes nothing.
Every view button and the extra and reset actions remain directly available regardless of width
or window count. Whole buttons wrap to further rows with flex layout; the run header grows with
them instead of hiding actions or scrolling horizontally. Labels remain visible within the
available button width. VS Code uses the same wrapping app buttons to open editor tabs, without
a pressed state, grips, or dragging. In the browser, each view button carries a small `GripVerticalIcon` inside its
existing left padding (`data-dock-window-grip`), so buttons keep their width; it is transparent
until the button is hovered, focused, or dragged and always visible under `pointer: coarse`. The whole button is the drag source through the dock's
pointer capture: a press that moves less than 6 px stays a click and calls `revealDockPanel`; a
longer drag inside the "Layout actions" group inserts the view at the pointer's row and horizontal
position (a 2 px primary line marks the slot; no line and no change where the order
would stay). A rail button dropped there joins at that slot. Dropping a header button on the
rail moves its button there; when all buttons are in the header, a temporary empty rail appears
during a button drag. These drops call `moveDockButton` and leave panel location, visibility,
focus, and automatic layout unchanged. Right-click or Shift+F10 on either button opens the
shared context menu with "Move to sidebar" or "Move to header"; the latter appends to the header,
and focus follows the moved button. Elsewhere a button uses the same compass, edge guides, previews, and
`moveDockPanels` as a tab drag, so the drop opens a closed view or moves an open one. Escape
cancels. Alt+ArrowLeft and Alt+ArrowRight move a focused button by one place and keep its focus.
The header slot compares client coordinates with the buttons' client rectangles, so the page zoom
cancels out there.

After the views, the browser always offers "Empty space" (`extra` of `DockWindowActions`,
`SquareDashedIcon`, no pressed state, not part of `order`), as a direct button.
Its click adds an empty pane through `addDockEmptyPane` the same way `revealDockPanel` opens a
closed view; its drag drops a new pane on a docking guide, and a drop inside the header changes
nothing. Empty panes are panels with the ID `empty:<uuid>`, titled "Empty space": they live only
in the tree and in `known`, never in `closed`, `bar`, or `order`; catalog reconciliation keeps them,
and closing one removes it. Their content is the hint "Drag an app or actor here". A center drop
(header button, tab, area grip, or rail tool) on an area whose active tab is an empty pane replaces
that pane in place; for such an area the whole content is a center target and the compass center
reads "Replace empty pane". A background empty pane is merged beside like any tab.
"Reset layout" uses the standard header icon button directly after the views and extra actions,
and restores the automatic layout, default button positions and order, and the inspection rail,
and removes empty panes. Arrow keys, Home, and End select tabs; focused dividers resize with arrow keys.

A workspace tab with `placement: "window"` defaults to a header button and opens like an app.
Its panel has the ID `tab:<tab id>` (`workspaceTabPanelId` in `dock-state.ts`; a default sidebar
tab is `tool:<tab id>`). Moving a button never changes this ID or the plugin contribution.
`dockButtonPlacement` resolves a user override before the default. Any entry, including Chat,
apps, and both kinds of workspace tab, can have its button in either place. The catalog order is
Chat, window tabs in tab order, then apps, so apps that arrive later still join at the end.
Such a tab joins the layout like a new
app (the automatic wide layout puts it into the app area; Reset layout opens it again), and its
header button shows its `Icon` and `label` with grip and reordering like any view.
Its `Badge` or pending activity is drawn as the same `bg-info` dot inside `BadgeDisplayProvider
value="dot"` at the top right of its directly available header button. Its `Header` renders in the area
header while it is the area's active tab, and its `Panel` receives `active` while it is visible. It
has no panel return-to-sidebar control by default. `SessionNavigation.openTab`
selects an existing docked panel, focuses an open sidebar panel, or opens a closed one in the
button's chosen place (sidebar or the focused area)
(`selectDockPanel`, which ignores IDs outside `known`), and `activeTabId` names it while it is the
active tab of the focused area or focused sidebar. A changed plugin default is reconciled through
the catalog; a user's button move only changes local layout state.

`dock-state.ts` holds the tree operations and catalog reconciliation; `dock-geometry.ts` calculates
rectangles and drag targets. The layout including empty panes, split ratios, active tabs, closed
windows, undocked panels (`bar`), maximized area, optional button overrides
(`placements`, mapping stable panel IDs to `"sidebar"` or `"window"`), and the optional header
button order (`order`, applied by
`dockWindowOrder` and changed by `moveDockWindow`, which never touches the tree or the automatic
layout) are stored locally per server origin and run
(`ragents.docking:<encoded-origin>:<encoded-run>`). Views missing from `order` follow in catalog
order, and catalog reconciliation drops unavailable views from order and overrides. Flyout
visibility is transient; no flyout width is stored. Older saved sidebar modes and widths
reconcile to a closed flyout without migration. Sidebar buttons remain available when their
panels are docked; their position is independent of `bar`.
Older saved layouts without overrides use plugin defaults. Invalid storage or a failed
write is reported; "Reset layout" explicitly replaces invalid state. No server function controls this layout.
The first run snapshot reconciles saved IDs with the shared catalog from `run-apps.ts`; loading
alone does not discard positions. Unavailable apps are removed, including stopped or hidden views.
In automatic wide layouts, new apps join the right-hand app area. In user-arranged layouts,
they enter the original group if it still exists, otherwise the first area, without changing
focus or another selected tab. Reactivated apps appear again without taking focus.

Chat and visited app/tool containers are stable siblings positioned by rectangles, independent of
the split tree. Hidden or closed panels are inert and use React `Activity` in hidden mode:
React state and DOM, including iframe identity, are retained, while effects are cleaned up.
The host retains the panel's parent-fed props while hidden, so session updates do not render
that panel. Revealing it supplies the latest props and resumes its effects. Moves, splits,
merges, and maximization never reparent a frame. Removed or unavailable contributions, leaving a run,
reloading the page, and an app's own rebuild can still unmount or reload its content. Persistence
stores layout, not unsent input across a page reload. VS Code keeps chat in the panel and opens
or focuses one editor per server, run, and app. Questions and news remain in the chat; background
app tabs have no additional notifications.

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
`ToggleGroup`, `Tabs`, `Select`, `ChoiceSelect`, `Combobox`, `FilterSelect`, `Dialog`, `Popover`,
`Tooltip`, `DropdownMenu`, `Input`,
`Textarea`, `Checkbox`, `Switch`, `RadioGroup`, `Field`, `Label`, `Table`, `Card`, `Alert`,
`Progress`, `Separator`, `Skeleton`, `Spinner`, `Empty` with their parts (`SelectTrigger`,
`DialogContent`, `TabsList`, and so on), plus `cn` and icons from `lucide-react`. Props, variants, and
composition follow shadcn; `Badge` additionally accepts semantic `tone` (see below).
The host's own building blocks on top are `InteractiveItem`, `ListDetail`, `SectionLabel`,
`SvgEdge`, `HeaderDropdown`, and, only in the host, the page `Modal` in `modal.tsx`.
The choice follows the role, not taste:

- `Button` without a variant (`default`): the ONE main action of a surface or dialog
  (Start, Confirm, New run); at most one per view.
- `variant="outline"`: an ordinary action with a border; several may stand side by side.
- `variant="ghost"`: a quiet action without a surface in bars, rows, and in the composer.
- `variant="destructive"` for deleting actions; the text says what happens.
- Icon buttons are `Button` with `size="icon"` (smaller `icon-xs`, small `icon-sm`, large `icon-lg`), a
  lucide icon as child, and a required `aria-label`; `title` provides the native tooltip.
  Close and Back in dialog headers are round icon buttons (`rounded-full`) with an X
  or an arrow. The overview corner on the left of the header is deliberately not a
  library button (see below).
- `size="sm"` in rows, cards, and toolbars, `size="lg"` for highlighted
  header actions, otherwise the default height.
- `Toggle` for an on/off state; `ToggleGroup` for a short option set, with
  `multiple` for several selected values; `ChoiceSelect` for one required choice with
  automatic presentation by list length; `Select` for one or several (`multiple`) of many,
  with `items` for the labels; `FilterSelect` for a multi-value toolbar filter; `Tabs` for
  navigating between the views of a surface; a count
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
  a `dt` stay that element. The host's page sections use its heading form
  `SectionHeading` from the same file (an `h2` with the count beside the title and an
  action at the other end); it is not part of the plugin API.
- There are no longer native `<select>`, custom buttons, or class contracts; the built-in
  plugins bring no CSS of their own.

The `xs`, `sm`, `default`, and `lg` size steps share the `--spacing-control-*` heights in
`theme.css`, applied through `control-size.ts`. `Button`, `Toggle`,
`ToggleGroupItem`, `SelectTrigger`, `Input`, and filter or combobox triggers have exactly the
same outer height and vertically centered text at the same step. `Textarea` uses that step
as its single-line minimum and grows for additional lines. Size is a component prop; a
toolbar chooses one step instead of overriding individual heights.

`ToggleGroup` is the shared segmented control for single and multiple selection. Its items
join without gaps or rounding inside one square border, with a single divider between
neighbors. Selected segments use the shared selection tint; adjacent selected segments
keep their divider. The group owns this treatment, so callers set its size and selection
instead of individual spacing, borders, or variants. Settings theme and zoom, sharing access,
view and grouping choices, and other short option groups use it. Each group has an accessible
name. Tab enters the group once; arrow keys move along its orientation, Home and End move to
the first and last enabled segment, and Space or Enter changes the focused segment's
selection. Disabled segments remain unavailable. `value` and `onValueChange` use arrays in
both modes; `multiple` permits independent selections.

`ChoiceSelect` takes `label`, `options`, controlled `value`, and `onValueChange`, with the shared
`size`, `disabled`, and `className` props. Its options provide `value`, `label`, and optional
`disabled`. One to five options use `ToggleGroup`; longer lists use `Select`. The current choice
cannot be deselected. Start options, contribution kinds, machine, file and folder choices, and reasoning
levels use this component instead of choosing their presentation per view. Plugins and mini-apps
receive the same control through `@ragents/web/ui` and `UI.ChoiceSelect`.

`SelectContent` opens outside its trigger, below by default and above when space requires it,
with at least the trigger's width. It never aligns an option over the trigger. Select,
dropdown menu, context menu, and popover panels share the square corners of `HeaderDropdown`.
Selects with more than eight options show a search field at the top; `searchable` on `Select`
enables or disables it explicitly. Search matches option labels without case sensitivity. Arrow keys
move through the filtered options, Enter selects, and Escape closes the popup; no matches
show "No matching options." `Combobox` and its trigger, content, and item parts supply this
search behavior for Select and FilterSelect rather than separate implementations per view.

`FilterSelect` takes `label`, `options`, controlled `value`, and `onValueChange`, plus the same
`size` steps. Each option has `value` and `label`, optional `color`, `count`, and `disabled`.
One to five options render as the same multiple-selection `ToggleGroup`, with color dots and
counts on the segments and a separate "Clear" action. An empty value array means no restriction;
"Clear" or toggling selected segments off removes the restriction. Longer lists use a dropdown
whose trigger shows the filter name and chosen count, or "All" for no restriction. Its popup
uses the same search field by default (`searchable={false}` disables it) and panel treatment,
with checkbox options, optional color dots and counts, and "Clear" to remove the restriction. Several filters belong together in a
toolbar; long checkbox facet lists do not need their own sidebar.

`Table` opts into column resizing with `id` and `columns`. Each `TableColumnDefinition` has
`id`, optional `label`, initial `width`, `minWidth`, and `resizable`; widths are pixels,
defaulting to 180 initially and 64 for the minimum. `resizable: false` on a definition omits
its handle. Headers and cells follow definition order; `TableHead columnId="..."` optionally
binds a header explicitly for advanced markup. Header
handles drag widths down to each column's minimum; double-click fits a column to its rendered
content. Keyboard handles use Left/Right (10 pixels, Shift for 50), Home for the minimum,
and End or Enter to fit. Widths are stored per browser origin and table ID through the shared
local-setting helpers. Corrupt values and failed saves show "Reset column widths". If the
browser denies storage access, the table remains visible at initial widths with disabled
handles, a visible error, and "Retry column widths". Resizable cells truncate overflow with an ellipsis
and expose their full text as a tooltip. A table without the opt-in keeps its ordinary layout.
Plugins import these controls and table parts from `@ragents/web/ui`; additive exports enter
`host-api.json` through `pnpm update:host-api` without changing `HOST_API_VERSION`.

Interaction states use the shared `hover`/`hover-foreground`,
`selected`/`selected-foreground`/`selected-border`, and `ring` tokens in both themes.
Selected cards, rows, options, navigation items, and tabs use a clearly tinted surface and a
uniform one-pixel border in the selection hue on all four sides. Hover remains subtler than
selection; hovering a selected item gently strengthens its tint. Selection adds no shadows,
rings, inset edges, bevels, or asymmetric borders. Tabs have square corners, selection-colored
text, and no bottom indicator. Icon-only action toggles remain borderless and ringless in every
state; their selection-colored or filled icon sits on a subtler `selected-icon` surface.
Keyboard focus uses a solid one-pixel ring on `:focus-visible`, except for icon-only actions,
where the background marks focus. Text and secondary labels reach AA in both themes.
`Button`, `Toggle`, `ToggleGroup`, `Tabs`, `Select`, menu items, selectable field labels,
and table rows apply these states themselves. `InteractiveItem` supplies the same behavior
for clickable rows, tiles, and navigation, including `aria-current="page"` or `"true"`,
`aria-pressed`, `aria-selected`, and expanded states. It accepts a `render` element like
other Base UI composites. Layout and corners stay with the caller; shared state colors do not. Existing card and
document surfaces retain their appearance unless a state needs better visibility. Actor cards
use these shared selection states in both the Agents view and the addressee chooser.

Status displays use `Badge tone="success|warning|danger|info|neutral|active"`:
success for passed or completed work, warning for attention or open actions, danger for
failure, info for information or queued work, neutral for idle or inactive states, and
active for ongoing work. Tones map to the semantic foreground and `-soft` surface tokens;
danger uses `destructive`/`destructive-soft`, neutral uses
`muted-foreground`/`secondary`. Labels and state icons still name or depict the state;
color never carries it alone. Compact rail badges retain their tone as dots and their
label for screen readers. Existing badge variants remain available for counts and
non-status labels. Plugins import `Badge` and `InteractiveItem` from `@ragents/web/ui`;
no separate status palette or per-screen interaction colors are allowed. Text on these
surfaces meets WCAG AA contrast in both modes.

Tailwind applies to the whole interface. Host, plugins, mini-app building blocks, and the
bundled mini-apps write their styling as utility classes directly on the elements;
there are no longer stylesheets with their own class contracts. `apps/web/src/ui/theme.css` is
the only token source: the shadcn variables (`--background`, `--card`, `--primary`,
`--border`, `--radius`, and so on) and the additional host colors `shell`, `app`, `surface`,
`border-soft`, `border-strong`, `hover`, `selected`, `success`, `warning`, `info`, `active`,
their foreground, border, or soft counterparts, `teal`, `destructive-soft`, and
the material colors `glass-*` are there once per mode, light and dark follow `data-theme`;
plus font, the compact spacing scale with `header`, `statusbar`, and `workspace-inset`,
the card radius `rounded-panel`, the shadows `shadow-bar`, `shadow-status`, `shadow-pop`,
`shadow-card`, `shadow-workspace`, `shadow-glass-icon`, and the animations `animate-fade-pulse`,
`animate-working-pulse`, `animate-ring-pulse`, `animate-edge-flow`, `animate-progress-sweep`.
The text roles are utilities there too: `type-title` (page title), `type-label` (uppercase
section label), `type-item` (item title), `type-body` (descriptions, notices, empty states),
`type-meta` (time, address, route, counts), and `type-caption` (uppercase category and kind).
Each sets size in `rem`, line height, weight, and letter spacing; `leading-*`, `font-*`, and
`tracking-*` still override them. They are called `type-*` because `cn` takes every unknown
`text-<name>` for a text color and drops it next to `text-muted-foreground` or `text-destructive`.
Text on Start, Runs, Server, in their dialogs, on the template tiles, and in the run header uses
these roles; controls such as buttons, inputs, and dialog titles keep the library's size scale.
`type-prose` styles rendered Markdown that a plugin draws itself: headings in four clearly
distinct steps, lists, tables with a muted first column, code, quotes, and framed images.
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
profile, once at startup and minified, in dev mode anew per request. The pages `index.html` and
`run-panel.html` link it under its content hash as `/ragents.css?v=<hash>`: the server writes the
hash into the link on every delivery of a page and delivers the pages with `Cache-Control: no-cache`.
Every new compilation (start, changed class list, in dev mode every request) gives a new hash and
with it a new address. The current address is answered with `Cache-Control: public, max-age=31536000,
immutable`, the plain `/ragents.css` and an outdated version with the current stylesheet, ETag, and
`no-cache`. So no cache in between keeps an old stylesheet next to new scripts, not even a CDN that
extends `no-cache` to hours. In dev mode Vite delivers the pages with the plain address.
Separate stylesheets per plugin do not work, because Tailwind fixes the order of utility and variant, and a
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

`@ragents/web/ui` exports `ImageViewer`, `ImagePreview`, and `ImagePreviewGroup` as additive
host API names; the version remains 12. `ImagePreview` takes an image source and file name;
`ImagePreviewGroup` enhances images in rendered Markdown and chat attachments without changing
their resolved addresses. The host's `QuasselHost` applies the group to its chats. Previews
have a zoom-in cursor, a small magnifier on hover, and a keyboard opening action.
`ImageViewer` uses a page dialog with the file name, focus trapping and restored trigger focus.
Wheel and trackpad pinch zoom around the pointer; + and - zoom, 0 fits, and dragging pans an
image that exceeds the viewport. The Fit/100 % control and double click switch between fitted
and natural size. Escape, Close, or clicking outside the image closes it. The viewer uses host
controls and Tailwind theme colors in light and dark mode.

Mini-apps use the same components with the same look; the mini-app runtime sets
`data-ui-surface="mini-app"` on the frame root element only as a marker for font and
base dimensions. Details on forms, tables, theme bridge, and own app CSS are in actor-programs.md.

The journal surface uses `PopoverContent`; header panels use `HeaderDropdown` with shared
positioning and the same square corners as the other dropdown panels. `PopoverContent` keeps 8 pixels of distance to the
calling control by default. Dialogs and dimming popouts share
`--backdrop` from the theme (black at 40 percent opacity in the light and 60 percent in the dark
theme); individual surfaces define no dimming color of their own. `PopoverContent` with `dim`
dims everything in the stacking context of its portal; `container` moves the portal into a given
element, which lets a header button remain above its dropdown's dimming.

Settings and Help are icon buttons in the shared header. The run title opens metadata, start
options, and contributed run controls. The logo at the left of the header is the button
"Back to Start"; the header also provides Stop run.
`ShareContent` in `panel/SharePanel.tsx` owns loading, access choices, errors, Save, and Cancel;
`SharePanel` presents it in the same dropdown shell for run headers and run-list actions.
Callers without an action anchor use a virtual anchor at the top of their page container.

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
`useChat`, `requests`, `useAttachmentCapabilities`, `StoppedActorNotice`, `PausedRunNotice`, `chat-target`, and
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

`ask_user` takes the shape of the question tools of common agent harnesses: `questions` with 1 to
4 entries, each with `question` (the complete question), `header` (a chip of at most 12
characters), `options` (2 to 4 entries of `label` and `description`), and `multiSelect`. There is no
"Other" option; the user can always answer any question freely instead. One call is one action
whose title is the questions, one per line. The service checks the same rules for every caller
before it shows anything: non-empty texts, distinct questions, distinct labels per question, at
least two options; a violation names every path and reason. The limits of four questions and four
options are the tool's; internal callers may list more options, as the start question of
`ragents.lsp-roslyn` does with every solution. The former single question with `options` as a list
of texts and `multi` is not accepted; journals that still hold one lock their run
(`docs/spec/core.md`, journal).

`ask_user` does not wait. Through `AskService.pose` it shows the questions as an action and
returns at once "Questions shown to the user; the answers arrive together as a new message."
(`QUESTION_POSED`). This result ends the asker's turn (`endsTurn` of the function, `docs/spec/core.md`,
Turns of an agent): no further model request follows unless an input already waits for the
asker. Tool description and prompt chapter tell the model to call `ask_user` as the only tool of
its response. The questions stay open after the turn; an actor can have several open calls, and a
new one leaves the earlier ones open. The user answers all questions of a call at once, each with
the labels of the chosen options (exactly one without `multiSelect`) or a free answer;
`ragents.ask.answer` takes `answers` with one `{ selected }` or `{ text }` per question in their
order, or `dismiss: true`, and rejects answers that do not fit with the allowed labels. The journal
keeps `{ answers }` as the result. The answers reach the asker as ONE new ActorInput without
`origin`, with one line per question:

```text
The user answered your questions:
"Which branch?" = "release"
"Which checks?" = "lint", "tests"
"When?" = free answer "After the review."
```

A dismissal reads "The user dismissed your questions without an answer:" followed by the quoted
questions; with a single question the text says "question". If the asker's turn is still running,
the input enters it as steering. In the web, the card of a call shows every question with its chip,
its options with label and description, a free answer field per question, and one submit for all;
a single question with one choice is answered by clicking its option.

`AskService.ask` waits for the answers and is only for questions outside a turn that the run's
owner asks on behalf of the system (`AskCall.agentId` is the owner, `turnId: null`), such as the
start question of `ragents.lsp-roslyn` and the confirmations of the actor programs. It takes the
same questions and resolves to `{ kind: "answered", answers }` or `{ kind: "dismissed" }`; a result
that does not match the questions rejects the call. `answerMessageOf` builds the input text above
for callers that pass an answer on themselves.
`AskRequest.recipient` then names the actor the question is for. It is in the payload, receives
an answer nobody waits for anymore as ActorInput ("the question" instead of "your question"), and
appears in the "asks" note; the question
itself appears, like every action of the owner, in the run chat, not in another
actor's chat. An action posed by the owner carries no name in front of it in the main chat.
A technical cancellation of the waiting call withdraws the question; the plugin derives neither a
user answer nor a new ActorInput from it.
`AskService.withdraw(runId, actionId)` withdraws an open question of the plugin: the journal closes
it as `dismissed` with the result `{ withdrawn: true }`, a waiting call receives the dismissed
outcome, an actor receives no input, and the record in the chat shows "Withdrawn without an answer."

A human's message closes the open questions its addressee asked for itself: as soon as an input
with `origin: "human"` (`docs/spec/core.md`, Origin of an input) is enqueued for an actor, the
plugin closes every open question this actor asked without `recipient` as `dismissed` with the
result `{ supersededBy: <inputId> }`. No answer input is created; the message itself is the
asker's next input. The plugin reads the open questions from the journal state, so the rule also
covers questions from before a restart of the host. If such a message is already waiting when
the tool asks, the plugin creates no question and the tool returns "Not answered: the user sent a
new message instead." (`SUPERSEDED_ANSWER`). Questions of the owner, inputs without `origin`, and
messages to another actor leave a question open. In the chat, the record of a question closed
this way shows this text instead of "Dismissed by the user without an answer." Stopping the asker
(`actor.stopped`) and stopping or deleting the run (lifecycle `stopSession` and
`afterStopSession`) withdraw the open questions agents asked for themselves; questions of the
owner stay with their callers.

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

While any actor of the run works and the run is not paused, and the input is empty, the run chat
(the partner is the primary actor) and the actor chats in the run panel show "Stop work"; the
global coordinator shows it while its own turn runs. The button pauses the whole run through
`ragents.runs.pause` (`pauseRun` from `@ragents/web/api`; offered by `runPausable` from
`chat-target`): no turn of any actor starts any more and the running ones end (`core.md`, Pausing
a run). While `RunView.pause` is set, `PausedRunNotice` shows one line above the input, "Paused",
"Paused - 1 input waiting", or "Paused - 3 inputs waiting" (the waiting inputs of all actors that
are not stopped), with "Resume" (`ragents.runs.resume`, disabled without `runs.write`); a message
from the input resumes the run as well. The global coordinator loads no RunView and shows no such
line; its next message continues it. With text or attachments, the send action stays available.
Errors while pausing appear in the chat concerned and allow a retry. Interrupting the turn of a
single actor stays an API (`ragents.runs.interruptTurn`, `interruptActorTurn`); stopping an actor
permanently is offered only by the actor card ("Stop"), stopping the whole run only by "Stop run"
in the title bar; no chat input calls `ragents.chat.stop`.

The run chat marks every turn of the primary actor that no human input started with a line
before its output: "New turn, triggered by turn.finished of @implementer" for a subscription
delivery or an automatic notice with a source event, "New turn, triggered by a message from
@implementer" for an input another actor enqueued, and "New turn, triggered by an automatic
input" for other inputs under the owner. `run.paused` and `run.resumed` appear as "Run paused by
alice" and "Run resumed by alice" (without sign-in without the name).

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
"New chat", then the other templates in the server's order. Each card shows its title,
two lines of description, and an always-visible action icon at the top right: plus for
"New chat", play for a direct start, and sliders for a guide ("Set up"). Hover and keyboard
focus emphasize the icon. There is no category row or bottom action bar, and skill and
run script cards share the same flat appearance. Category metadata remains available;
the start selection's width token limits them to 880 pixels. Task input, start options,
search, and preview do not exist
there. "New chat" is there only with `runs.create` and turns the draft into the open run without a request to the
server, whose task is created in the chat; a skill is there only with `runs.create`.
A template without a guide starts on click as in VS Code (`startEntryDirectly` in
`apps/web/src/chat/requests.ts`, the same call as `startLaunch` in the run panel): a run script
through `ragents.chat.start` with the start value `null`, a skill through `ragents.chat.send` with its
prepared task and the template as `entry`. The browser uses the same Start page with one
server. Guided starts use the preparation dialog. New browser runs use the server workspace.
While start options are loading or being saved, such as the preset from VS Code, and
as long as a start is running, the tiles are locked. The tile of the running start (`StartTiles`
prop `starting`, an `entryId` or none for New chat) keeps full opacity, carries `aria-busy`, and
shows a `Spinner` with "Starting ..." in the top-right action position (`StartTile` prop `starting`).
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
default or example task in the skill. Back returns to the start selection within preparation;
cancelling the dialog returns to this server's Start page.
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

The shared header contains the brand on Start, or Back and the active run title. In VS Code,
the pill shows the selected server's name on every page, with the tooltip `Environment <name>`. The global
coordinator stays mounted beside it across navigation. Run layout actions share the run header
and wrap when needed; run details and plugin header contributions without bar placement open
from the title. Status, Stop, and the menu
remain on the right. Installed tool shortcuts do not appear here.
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
A dot inside the run's state ring replaces the state glyph when the journal revision is newer
than the last viewed state, or when there is no personal read state; the state's tooltip and
accessible name then add "new activity" or "not viewed yet", for example "Running, new activity".
The server keeps the read state per user and run (without sign-in for the one access): the run panel
reports the viewed revision with `ragents.runs.markViewed`, and `ragents.runs.list` returns it to the
same user as `seenRevision`, so it holds on every device and in both hosts; other users receive no
read receipt. Only a higher revision counts, a revision beyond the journal's is rejected, and the
global coordinators keep none. The markers lie in `run-read-markers.json` in the profile's data
directory, written atomically and at most once per second; deleting a run removes its markers.
Only a loaded run in the visible tab of the run panel and without an overlying
overview, Settings, Help, start dialog, or toolbar history updates it; the run panel sends one
request per run at a time and then only the newest revision (`run-panel/viewed-runs.ts`).
A changed marker reaches the `ragents.runs` subscriptions of the same user, the first at once and
further ones at most once per second, because a viewed running run reports every revision.
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
The global header stays in one bar: the brand logo on the left, the global coordinator button beside
it, and the menu on the right. The logo is a ghost button with the accessible name "Back to Start"
(`showStart`), with hover background and focus ring and the same footprint as the bare logo. Run layout actions share the run title row. `PanelPage` gives Start,
Runs, and Server the same top offset (`pt-6`), so their content begins at one height below the
header; sections on a page are `gap-8` apart, a section heading is `gap-3` above its content,
and all lists stay inside the centered 1280-pixel column.
Long titles truncate within the available space; the menu remains reachable.

Settings and Help are available through the header menu. Help opens the bundled
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
In VS Code the selected environment supplies its own global coordinator, also on Start. It
oversees only this server's runs; switching environments selects a separate conversation.
Coordinator runs do not appear in the ordinary run list. In the header the contribution is a plain button (`PopoverTrigger`) with the
accessible name "Global coordinator", styled like an input field with that text in muted color;
it fills its header slot, and the header keeps its fixed height of 45 pixels. Button and status
are on one row. The button opens the history in the shared square `HeaderDropdown` below the
header; `aria-expanded` and, while open, `aria-controls` point to the dropdown. The shared shell
provides its labeled heading, close button, width and height limits, padding, and dimming;
the button stays visible and clickable above the dimming. At the bottom is the normal card
composer of the run chat (`ChatPanel` with `ChatInputToolbar`); level of detail, attachment,
model, reasoning, reset, send, and stop are in
its toolbar. The contribution has one conversation, one draft with attachments, and one
stream, independent of the active run.

Opening activates the stream for the first time. After that it stays connected for responses
even with the dropdown closed, until the application ends or the read right is lost.
Before first use, no new responses are reported. The dropdown stays mounted while closed, so
run switches, closing, and reopening keep draft, attachments, history, and running work. With
an interrupted connection, writing stays possible and sending is locked. A valid send action
clears the draft immediately; the shared composer logic restores it on errors or keeps it
retrievable separately if new text has been entered in the meantime. Enter sends, Shift+Enter
adds a line. IME confirmation and a held Enter send nothing.

While the global coordinator works, the button draws the same pulsing frame as working
agents in their chat; it follows the running server state. The shared animation visibly
strengthens outline and outer glow; with reduced motion,
the highlighted frame stays without pulsing. An accessible status reports "Working";
the stop sits in the composer. An additional spinner or "New response" notice is dropped.
Errors stay visibly attributed and are made recognizable next to the button when the history is closed.
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

The dropdown keeps the role `region` with the name "Global coordinator", has no combobox
semantics, and no focus trap. A click, Enter, or Space on the button opens it, and its
composer input gets the focus at once; with read access only, the history gets it. Escape
first closes an open selection menu and then the dropdown; the close button, a click on the
header button or on the dimmed area, and tabbing out of button and dropdown close it as well.
On closing, focus returns to the button unless it already moved elsewhere. Typing on the closed
button does not open the dropdown. The overview and page-wide dialogs also close the history but keep the
conversation. Panel geometry comes from `HeaderDropdown` in both browser and VS Code.

The global chat uses the coordinator's level of detail, `grouped` without a product default. Its
level of detail stays switchable and is stored in the browser separately from the run chats.
Model choice, reasoning, details, and reset are in the composer toolbar. The model selection is limited to the
available space. Created runs appear in the shared run list.

`Reset conversation` opens a highlighted dialog over the whole dropdown surface.
The existing modal host limits backdrop and blurred background to the global chat;
its remaining content is inert in the meantime. Focus starts on Cancel. During a
running reset, the confirmation cannot be closed. After confirmation, the
plugin route clears the global history and model context; running global work is
stopped beforehand. Input and model choice are locked during the reset. A successful reset discards
draft and attachments, also in other already connected views. An ordinary
stream rebuild discards no draft. Model/reasoning choice and normal runs are kept.
Errors stay visible and allow a retry; the reset issues no task.

Without the plugin or read right, the whole contribution is dropped. With read access without write rights,
the button still opens the history, and the composer shows "Read access to the global
coordinator". Send functions and other write actions are locked.
Server behavior and tool limits are in `core.md`.

Model and reasoning level of the global coordinator can be set in the composer toolbar below the
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
without a run both hosts show this server's Start page. The logo returns there.
VS Code selects the environment and embeds its server interface for Start, Runs, and the run;
connection management and unavailable-server states remain in the extension's local shell.
`?layout=app&run=<id>&element=<id>` renders one app through the same catalog and renderer.
`PluginChat` has only `panel` and `{ element }`; the single `surface.RunPanel` contribution
receives `SurfaceCenterContext`. Without it the host renders the standard chat.

The sidebar tabs (`workspaceTabs`, `workspaceTabsFor`) appear as a vertical rail at the far
right, with each contribution's icon and accessible name; in the browser a tab with
`placement: "window"` defaults to the run's windows in the header. Browser layout overrides also
allow apps and Chat in the rail or default sidebar tabs in the header. The rail is left out
when no sidebar button remains, except as a drop target during a button drag. Hovering or
focusing a rail button immediately shows
the shared ui tooltip centered to its left, with an 8 px gap; no native `title` tooltip is set.
The tooltip names the tab and adds " - new activity" for pending activity. Its label does not
capture pointer events, so it cannot block the sidebar's header controls.
A rail button has exactly one marker:
a small `bg-info` dot at its top right when the contribution's `Badge` renders or the tab has
pending activity. The rail renders the badge inside `BadgeDisplayProvider value="dot"`, so the
ui `Badge` draws the dot and keeps its text for screen readers only; numeric badges elsewhere
are unchanged.
Order and visibility come from `registry.availableTabs` (`readRight`, `requiresWorkspace`, and
`available`), with optional `hosts` restricting a contribution to browser or VS Code. Journal and
Processes additionally expose their existing content as browser-only tools; their original status
and header access remains. `PluginChat` supplies these tools through `DockToolsContext` to the browser's
`DockWorkspace`; the orchestration plugin supplies its chat and the shared app catalog.
Without a surface contribution, the host supplies the standard chat to the same docking workspace.
Visible dock panels are named through `aria-labelledby` referencing their tab or sidebar title;
the inner chat keeps its own Chat region label.

In the browser, the sidebar has exactly two runtime modes: `hidden` and `hover-preview`.
Hovering a rail button previews the tool over the workspace; leaving both rail and flyout
closes it after a short delay. Clicking a rail button opens or focuses its flyout; X hides it.
The keyboard-accessible "Move into layout" button uses the same right outer-edge drop as a
drag through `moveDockPanels`, creating an ordinary window area at 35 percent of workspace
width. `transitionDockSide` handles flyout transitions. Moving the active tool into a group
clears sidebar visibility and focus. The flyout width is fixed at 630 pixels, limited by
available space. Hover previews close when the workspace mounts; old saved sidebar modes and
widths reconcile to a closed flyout without migration. Pointer presses cancel pending
hover-close timers. Capture keeps drag grips active through release or cancellation, even
beyond the flyout; after release, hover closing resumes based on the pointer position.
Pressing without motion never moves a panel into the layout.
The floating frame uses the same card tokens as docked areas, with `shadow-pop` and
ring-1 ring-foreground/10 in both themes, only theme tokens and no per-element shadow values.
The frame sits above the areas (z-30), so the shadow falls over them; the workspace clips it only
at the header and status bar edges.
Dragging a rail button or the sidebar header grip into the workspace docks a tool as a normal
window and keeps its button in its chosen place. Clicking that rail button selects the docked
window; hovering it does not create a second panel. Closing a tool window or dropping its tab
on the highlighted rail/sidebar leaves the panel undocked and hidden. Its "Return to sidebar"
button instead opens and focuses its hover-preview flyout without changing button placement.
The layout window has the same tabs, split, close, maximize, and drag controls as Chat and apps.
Compass and edge guides drawn over a hover flyout take precedence over it as drop targets.
Mixed document/tool groups cannot be dropped on the rail. Visited tools keep their mounted
instances across these moves and pause their React effects while hidden.
`SessionNavigation.openTab` selects an already docked tool in its area, focuses an open sidebar
panel, or opens a hidden tool in its button's chosen place.

Workspace tabs can contribute a `Header` with the same context as `Panel`. Docked group headers,
the sidebar title row and the VS Code popout render it. Inspection contributes the actor selector
there. Its second row contains the actor name (handle and creator in the tooltip), Stop or Restart,
chat detail/timestamp switches, and icon tabs with tooltips. It scrolls horizontally when narrow,
without adding rows. There is no bottom toolbar in read-only inspection; actor popouts with a
composer keep their input controls. Inspector transcripts use compact margins and timestamps.

In VS Code, `RunPanelRail` and `RunPanelWorkspace` retain the inspection popout over the chat.
A click opens it with its title and X, and the same icon, X, Escape, or backdrop closes it.
On opening it receives focus. Visited `keepMounted` contributions use the same hidden
`Activity` boundary and retained parent-fed props as browser panels; revealing them restores
the latest session and resumes effects. Other contributions unmount when hidden.
VS Code keeps every tab there, also one with `placement: "window"`: an editor tab exists only for
mini-apps, and a workspace tab has no editor layout of its own.
Its tab remains stored under `ragents.run-panel.workspace-tab:<runId>`; unavailable tabs stay
closed until available. The browser instead uses the docking state described above. The
`app` layout never has an inspection rail in either host. The chat reports the active inspection
tab through the existing navigation and user-location contract.
The run panel's header (`RunPanelHeader`) grows to fit its controls in both browser and VS Code.
The title shrinks within its row or moves to its own row; window buttons, bar contributions,
Share, Run script, and the remaining header icons wrap as whole controls and stay directly
reachable without clipping or horizontal scrolling. The header occupies its natural height in
the panel layout, so the dock's measured workspace begins below it. The title shows a pulsing
dot during processing, the attention badge, and a chevron; a click opens "Run details" in
`HeaderDropdown`, with every metadata contribution, start option badge, and header contribution
without bar placement in responsive cells. Cells and their content wrap without clipping.
With `runs.write`, "Run script" (`RunScriptMenu`) follows the layout actions behind a
thin divider: an outline button in the primary color whose pop-out lists the run scripts from
`ragents.runs.scripts` as the Start page's compact `StartTile` items filling their grid cells,
with title, two lines of description, and a play icon at the top right. Available ones come
first and unavailable ones after them disabled with their reason, each group in listed order.
`HeaderDropdown` supplies the shared panel geometry; the script cards form two columns from a
content width of 480 pixels and one column below it. A click starts the script through
`ragents.runs.startScript`; until the answer its item is `starting` ("Starting ..." with a
spinner in the action position) and every other item is locked. Success closes the pop-out;
a refusal stays visible in it. Its label stays visible when
the header wraps.
With `canShare`, "Share" (`RunShareButton`) stands right before it, its icon in the primary color
while the run is shared, and opens `SharePanel` (`panel/SharePanel.tsx`) against
`ragents.runs.sharing` and `ragents.runs.share`, in the browser and in the VS Code iframe alike;
its label stays visible when the header wraps. A run the panel opened under a fresh identifier (a new
empty run) counts as shareable before its first message when the profile has sign-in and the user
`runs.write`; the server keeps that choice until the run is created. For a sharee the title carries
a badge, "View only" for `sharedAccess: "read"` and "Shared" for `"write"`, with the tooltip "Shared
with you - view only" or "Shared with you - can operate". The panel hides "Stop run" and the stop
buttons of the chat inputs for a read share and keeps them for a run only its owner operates
(`canStopRun` on the access context below the run), and the chat input names why it is disabled ("Shared with you for viewing only", "Only its
owner operates this run", otherwise "Read access to this run"). When the open run, seen as shared
with the viewer, leaves the run list, the panel returns to Start with "This run is no longer available
to you."; in the host `vscode` it sends `showStart` with this `notice`.
The header dropdowns, including sharing, and the recipient popout use the shared theme dimming.
At the far right of the shared header, `RunPanelActions` shows icon buttons for Settings
(`settings.read`, the same dialog as in the web app), Help (`runs.inspect`), in the host `vscode`
"Open in browser", and with a signed-in
user a sign-out button whose tooltip names the account; there is no menu. `ragents.orchestration` provides the run panel (`web/run-panel/`): mini-apps come from the shared app catalog with `visible !== false`. In VS Code the panel stays on
chat and every app entry opens or focuses its editor tab. In the browser, it renders its chat and
the shared app catalog through `DockWorkspace`. Questions and news remain in the chat.

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
The popout shows all permitted actors as a top-down "who created whom" graph, independently of surface visibility.
`addresseeTree` (`web/run-panel/addressee-tree.ts`) builds the tree solely from
`createdBy` of the run view: an actor hangs under its nearest creator that is itself in the tree;
a human or a creator missing from the view makes it a root, and the
coordinator comes first among the roots. That way, without `runs.inspect`, where TypeScript actors
are missing, an agent created by a program hangs under that program's creator. Siblings are in
creation order; from four of the same kind (the same kind and the same handle stem, the first word
of the handle without a counter suffix, such as `review-*`) the tree combines them into a group with the shared
prefix, count, and state count. A group is collapsed unless it contains the chosen
actor; a click reverses that until the graph closes. `actorGraphLayout` (`web/run-panel/actor-graph.ts`)
lays the tree out deterministically, without a layout library: cards of fixed size, every creator
centered above the first row of its children, at most as many children per row as cards fit into
the largest canvas width the popout allows (`graphColumns`); further rows hang on a line in a gutter left of them, so no
edge crosses a card. Edges run orthogonally with rounded corners from the bottom of the creator
to the top of the child as `SvgEdge` from the UI library; an edge into a working actor (or a group
with a working member) is `accent` and `active`, one into an actor waiting for input `warning`.
An open group stands above a frame holding its members in rows, with a single edge into the frame.
The graph is a list of buttons in creator-before-child order, so Tab follows the tree.
The recipient's `ActorPopout` sizes itself by its content up to the room Base UI computes
beside the anchor (`--available-width`, `--available-height`) and hands that room, less its header, to its body as
`--popout-body-width` and `--popout-body-height`; the graph measures both with a `ResizeObserver` on a
hidden probe, so window resizes and new actors recompute columns, layout, and size. `graphViewport`
makes the view as large as the layout up to that room; an axis that does not fit pans over the
cards plus `GRAPH_PAN_MARGIN` (40 pixels) on each side, beyond the 16-pixel layout padding. The
canvas stays a native scroll container with hidden scrollbars, so wheel, touch, and focus scrolling
keep working within these limits. A left mouse or pen drag of at least 5 pixels pans from anywhere,
cards included, with `clampGraphPan` and pointer deltas divided by the page's CSS zoom; the click
that ends a drag is swallowed, a shorter press stays a click. On opening, the chosen actor is
centered (`graphPanTo`) and stays centered while the room settles, until the first press, wheel, or
key in the canvas. After a click on a group, the group card stays at its screen position as far as
the pan limits allow; the position is applied again on the first resize notification after the
popout has moved to fit its new size. `ActorGraph` (`ActorGraph.tsx`) is the only renderer, used by
the recipient popout without a header (its label only names the dialog, the close button sits in
the top right corner) and by `HeaderDropdown` with the title "Agents". The header graph uses
the shared panel's available body dimensions and pans within them. Per
card there are the handle, the state (`working` with a spinner, `waiting for input` for an open
action of the actor, `waiting`, or `stopped`), a time, the short description (the actor's
`description`, otherwise the first line of its first own input, shortened to 90 characters,
otherwise a differing display name), and the number of pending inputs. The time of a running
actor counts every second from `startedAt` of its running lifecycle, that is, the start of its
current turn; otherwise it is "last turn" with `finishedAt - startedAt` of its last finished turn
in `RunView.turns`, and without one there is none (`actorTimings`). A click chooses the recipient.
While the recipient is not the actor chosen without a stored choice (`selectedRunPanelActor` with
`null`, the primary chat actor), the chip carries a separate button "Back to @<handle>" that
chooses that actor directly without opening the popout.
Next to it the bar names the first working other actor with a spinner and waiting inputs. The
header contribution `ragents.orchestration.agents` (`placement: "bar"`, `AgentsHeader.tsx`) shows
"Agents" while the run lists at least one actor besides humans and opens the same graph in
the shared `HeaderDropdown`; a click there stores the chosen actor the same way, and the run
panel takes it over through the stored state. The chosen actor is stored per run in browser storage
(`ragents.orchestration.run-navigation:<runId>`); browser app selection belongs to the docking
state. These domains have separate storage keys; layout preferences are not migrated. Invalid
navigation values are a hard error.

The run panel talks to its host through `apps/web/src/run-panel/host.ts`. The host `browser`
(default) opens links itself, navigates apps locally, and offers only the server for new runs; the host `vscode` (`?host=vscode`, only
embedded) sends `ready`, `runChanged`, `showStart`, `openInCenter`, `login`, `logout`,
`openExternal`, `openPage`, and `openService` (a service of a run, section Workspace, sandbox tools,
and processes) through `postMessage` to the surrounding window and receives from there `selectRun`, `newRun`
(with preset start options and optionally the ID of a template, which the start selection then
opens right away), and `theme`; the
import-free contract is in `run-panel/host-contract.ts`. Starting or opening a run in either host
requests focus once for its visible writable chat input, including a remembered nonprimary
addressee. This includes direct run URLs and `selectRun`. The request waits for the chat
connection and remembered addressee; explicit user interaction or another dialog cancels it.
Pure mini-apps receive no chat focus; reconnections or messages do not bring it back.
If the panel cannot execute a `newRun` because the right to new runs is missing or a free run is requested
without `runs.create`, it shows the reason and "Back to Start" (`showStart`) instead of the loading state.
`?theme=light|dark` sets the appearance
on loading. If the page runs without a sign-in cookie, it carries the access token from `?access=`:
`apps/web/src/access-token.ts` attaches it as `Authorization: Bearer` to every fetch to the
own server and as a query parameter to addresses without headers (mini-app frames). The shared
web entry declares `<meta name="referrer" content="strict-origin">` before it loads anything, so no
request of the page sends more of its address than the origin: `same-origin` would send the whole
address with the token to the own server and every proxy before it, and `no-referrer` would make the
browser send `Origin: null` with the page's own changing requests, which the server's same-site
check refuses.
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
without reloading and keep their state. Normal browser pages stay unchanged; they have their own zoom
under Settings, Appearance. A value
outside the limits is an error: every view shows the message instead of its content and rebuilds
itself as soon as the setting is valid again. The shell sets `zoom: var(--ragents-zoom)` on its
`body` and no font size; text roles and spacing are `rem` against the webview's unchanged 16-pixel
root, and the theme's body rule in the layer `base` outranks the rules VS Code injects in the layer
`vscode-default`, so `--vscode-font-size` and the editor fonts change nothing. Text, controls, and
spacing therefore scale together and only with the window zoom and `ragents.zoom`
(`apps/vscode/tests/webview-html.test.ts`, `apps/web/tests/vscode-zoom-browser.test.ts`).

The VS Code extension under `apps/vscode` is such a host, and for several servers
at once: every configured **server** (a RAgents server by address or a local profile) has
its own session with connection, runs, templates, and workstation. An **environment** selects
one such server for the visible interface; the code types remain `Connection*`. The selection
is stored per VS Code workspace. Reopening restores it when still configured, otherwise the
first configured environment is selected. Switching environments changes the interface without
disconnecting other sessions, stopping their hosts, or ending runs.
The secondary sidebar embeds the selected server's interface for Start, Runs, and the run,
including its installed web plugins before a run is opened. A mini-app adds an editor tab with
`layout=app`. The local shell, composed from `apps/web/src/panel/` with `PanelState` and
`PanelAction`, retains connection management and the status, sign-in, and retry controls when
the selected environment is not connected. That fallback Server page shows only the selected
environment; the gear opens management of all configured connections.
The paths between the pages and the commands (Start, Runs, Switch environment,
Server, New run, Refresh) are exclusively in the view's `view/title` menu; the
pages themselves carry no icons for them (`panel/PanelHeader.tsx` has only back arrow and title,
Start no header; Runs keeps the back arrow in the browser too, where the logo also leads to Start;
Server management is local to VS Code), and the commands `ragents.showStart`, `ragents.showRuns`, and
`ragents.showConnections` also work while the server's iframe is shown. The server-environment
button opens the native "Switch environment" Quick Pick for configured remote servers and local
profiles (`ragents.selectEnvironment`). The view title is "RAgents: <name>".
Home and Runs navigate within the selected server; Refresh refreshes that environment. The gear
opens local connection and profile management. The new-run picker and view badge are scoped to
the selected environment.
The server interface reports its page changes to the extension, which restores that page when
the frame is recreated without sending a navigation echo.
In the host `vscode`, the run panel itself executes paste, copy, and cut
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
up to the run panel. Each relay posts the clipboard response into the requesting frame's
window, not through the port: Chromium delivers window messages after the focus changes made
before them, while a port message can overtake them, and such a late focus change from the shell
or the run panel would clear the input the requesting frame has just restored. The VS Code root
enables this capability, and further hosted frames pass it on. Without this enabling,
native input is kept in the normal browser. The function does not depend on a
particular chat building block but also applies to normal text fields in mini-apps.
The nested clipboard browser regression checks editor and document focus right after the pasted
text appears and, after an empty paste, waits for both with frame-local polling before typing,
without refocusing the editor through a locator action.

There is no longer an Explorer tree next to it: the selected server supplies Start and Runs,
and the native picker selects the environment. Every session speaks the same
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
(`ui/relative-time.ts`): `now` under one minute, then `5min`, `3h`, `1d`, `2d`, from seven
days on the date `09/13`; the written-out form is only in the `title`. No state icon ever carries
the stop glyph (a square, alone or in a circle): cancelled and unreachable are a
circle with a slash, ended a check mark in a circle, idle and stopped an empty circle. Every
real stop button comes from `ui/stop-button.tsx`: `StopGlyph` is the filled square in
`--destructive`, `StopButton` the button for it (icon, word in the `title`, same hover and disabled state),
and `RunPanelApp`, `ChatInputToolbar`, `ragents.processes`, and the menu entry "Stop run" of
`ragents.orchestration` use only it. The term throughout the web is "run", never a synonym: ending
the whole run is called "Stop run" everywhere, interrupting the running turn in the chat "Stop
work".

**Shared page width.** `PanelPage` owns one centered content column of at most 1280 pixels,
with side padding, for Start and Runs in both hosts and for Server in VS Code. The browser
page host adds no second padding; the outer header remains full width. The Runs search field
and run rows use the same bounded column.

**Start** has no page header or server block. **New** appears first as soon as the selected server
allows new runs. First is its default template from `ConnectionView.defaultEntry` with the marker
"Default" in the title row, or the entry "New chat" (plus icon, `newRun`
without `entryId`). Then follow the selected server's other templates, the default not a second
time; the count in the heading counts all entries. Each compact, flat card shows only its title
and two lines of description, with an always-visible action icon at the top right of the title
row: plus for "New chat", play for a direct start, and sliders for a template with a guide
("Set up", `ConnectionEntry.guided` from the template's `guide`). Hover and keyboard focus
emphasize the action. The whole card is one button, with accessible name "New chat",
`Start <title>`, or `Set up <title>`. A starting card shows a spinner and "Starting ..." in
the action position. There is no category row or bottom action bar, and no skill/run-script
shape or color badge. Category metadata stays intact. Cards use the shared typography;
the grid is `repeat(auto-fill, minmax(240px, 1fr))`, with cards capped at 320 pixels.
`StartTiles` measures its own container: below 240 pixels it uses one shrinking
column, without horizontal overflow. At the maximum content width the grid has five columns.
There is no search here, and `ListDetail` does not fit, because it measures itself by its own
width and would become a list with a detail page at 420 pixels (decisions of 09/19 and
09/21/2026). The tiles including the heading are the building block `StartTiles`, the same as in
the browser's start selection.

**Continue** follows with the selected server's last
five runs in `RunList` (`panel/RunLine.tsx`): a CSS grid with the columns state, title, and time,
in selection mode the checkbox in front; every row and its
button are `grid-cols-subgrid`, so that the columns stand at the same edge in all rows, and
"All N runs" leads to the Runs page. Below the title, inside the same button, a second line
names the owner (`ConnectionRun.owner`) and then the metadata lines (`ConnectionRun.details`), each
with its icon (`FolderIcon`, `GitBranchIcon`) and the tooltip "label: text"; hover, focus, and click
cover the whole item, in selection mode the click toggles it. The gap to the second line is
smaller than the gap between items. State and pending actions come from `ragents.runs.list`, which
derives them from the journal: running while an actor has a running turn or the session works,
otherwise waiting with pending actions, ended when every non-human actor has stopped, otherwise
idle (`run-list-state.ts`). The extension loads no run view for the list; its
badge sums `pendingActions` of the selected environment. A locked run shows its cause as a red notice icon with a tooltip.
The sharing comes from the same list (`connectionRunOf` in `run-overview.ts`): next to the title a
run with `ConnectionRun.shared` shows `UsersIcon` with the tooltip "Shared", one with
`sharedAccess` `EyeIcon` ("Shared with you - view only") or `UsersIcon` ("Shared with you - can
operate"). As soon as a listed row offers sharing or deletion, the list gets one more column
at the end. A row with `canShare` has the icon button "Share ..." (`aria-label` "Share <title>")
outside the row's button, beside its delete button when permitted. Rows without actions keep
an empty cell, so the columns stay aligned. The share button sends `openSharing` with
server and run; the host loads `ragents.runs.sharing` into `PanelState.sharing` (connection, run,
`result`, `pending`, `error`), and `PanelPage` shows `SharePanel` as long as it is set, anchored
to the row's share action or the top of the page when that action is unavailable. Its Save
sends `share` with the whole sharing; Cancel, Escape, and outside presses send `closeSharing`.
The host closes the panel on success and leaves a refusal in it, with the user's draft.
`openSharing` and `saveSharing` in `run-sharing.ts` are this flow for every host:
the server interface keeps the panel in React
state in both the browser and VS Code, and an answer for a panel closed meanwhile is dropped.
`PanelState.notice` is a short message on Start, such as the one for a share taken back.
Plugin `startSections` render directly below Continue with the complete server-listed visible
run list and its metadata; the host adds no heading or wrapper for a section.

**Runs** is the selected server's complete list: search over title, "Hide ended", and a
selection mode with checkboxes. Search and the toolbar below it stay sticky while the list
scrolls. Selection replaces "Hide ended" and "Select" with "Select all", the selected count,
"Delete", and "Cancel" in that order, without a bottom bar. "Select all" toggles only visible
deletable runs, including locked runs, and becomes "Select none" when all of them are selected;
selections outside the current search remain unchanged. "Delete" is disabled at zero and deletes
several runs after a confirmation question in the existing dialog. "Cancel" clears the selection
and leaves selection mode. The controls are keyboard accessible. The deletion itself is the
host's business: the page sends `deleteRuns` with the IDs, the server interface calls
`ragents.runs.delete` and refreshes the list. A row the user cannot delete, on a server without
`canDelete` or with `sharedAccess`, keeps an empty checkbox cell and opens its run on a click; the
selection mode hides the row actions. Start and Runs offer "Delete run ..." next to each
deletable row, including locked runs. Its confirmation names the run and sends `deleteRuns`
with that one ID; cancellation sends nothing. Rows shared with the viewer and users without
delete permission have no delete button. Deletion errors remain visible on both pages.

**New runs in VS Code** start within the selected server's interface. The extension binds the
new run to its workstation and the selected open folder unless the template fixes its workspace;
with several open folders it asks which to use. The run panel applies only start options the
template does not fix (`withoutFixedStartOptions`). Direct templates use `startLaunch`, guided
ones the shared preparation dialog and chat. Cancelling a guide returns to this server's Start
page. A cancelled folder choice or failed start releases the pending tile; an environment
switch or newer navigation prevents a late start result from reopening the old environment.
An already created run remains on its server.
The default template comes from `defaultStartEntry` in `ragents.plugins.bootstrap`; `RunStore`
rejects one absent from the delivered templates. The `ragents.newRun` Quick Pick puts the selected
environment's default first, or "New chat" when none is configured, followed by its other templates.
The extension sends `newRun` to the selected server iframe, waiting for `ready` when it is new.
The pending start keeps its template title or "New run" and shows preparation progress in the
chat area until content appears. A refusal remains visible with "Back to Start".
Home, the logo ("Back to Start"), and Runs keep the selected server; they preserve its mounted
toolbar contributions across run navigation.

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

Before workstation registration, each session selects the host in its server's reported RAgents
version (section Contributions to the executor). Its row shows `Fetching host package <version> ...`
and `Provisioning workstation tools ...`, or a failure with its cause. A remote server needs no
previously started local profile.

## Workspace, sandbox tools, and processes

The workspace plugins give agents exactly four
sandbox tools from `@ragents/workspace-executor`, the two tools of background commands
`task_output` and `task_stop` (below), plus `copy`. Names and input fields follow the file and shell
tools of the common agent harnesses, Claude Code first, because models are trained on these shapes
and fail on look-alikes; the schemas are closed, and an unknown field is removed with a notice
(`core.md`). `read` takes `file_path`, `offset` (1-based; 0 counts as 1), and `limit` and returns
the lines in cat -n style, line number, tab, line, at most 2000 lines and 50 KB; a line over 2000
characters ends in `... (line truncated to 2000 chars)`, and a note names the `offset` to continue
with. An empty file and an `offset` behind the end answer with a warning instead of content; an
image comes as an attachment for a model with image input. For a text-only model, a native image
read returns `isError: true` with "This model cannot see images; ask the user or use a model with
image input". The workspace hook keeps each read's image by run, actor, and call until presentation;
failed image reads do not mark the image as seen. The same behavior applies on the server and a
workstation, and detection uses file contents rather than the extension. A call from TypeScript
gets the same numbered text; image pixels require the native tool. `write` takes `file_path` and `content` and says whether it created
or updated the file. `edit` takes `file_path`, `old_string`, `new_string`, and `replace_all` and
makes one replacement per call: `old_string` occurs exactly once, with `replace_all` at least
once. An exact match wins; otherwise the match ignores trailing whitespace, typographic quotes and
dashes, and special spaces, and only the touched lines are rewritten. Deleting a text that ends a
line also removes its line break; an empty `old_string` creates a missing file, with its folders,
or fills an empty one. The errors use the standard's wording: "No changes to make: old_string and
new_string are exactly the same.", "String to replace not found in file.", "Found N matches of
the string to replace, but replace_all is false. ..." followed by the lines of the matches, "File
does not exist.", and "Cannot create new file - file already exists.". `bash` takes `command`,
`timeout` in milliseconds, `description`, `run_in_background`, and `cwd` (below) and returns the
last 2000 lines or 20 KB, lines over 1000 characters shortened and marked, the full output then in
a log file whose path the result names; with `run_in_background` it returns at once with the ID of
a background command (below). A file path is relative to the working directory,
absolute, or starts with an alias such as `@actors`; unlike in the standard it need not be
absolute, because an alias and not an absolute path decides the machine (below).
After aliases and path variables, `read`, `write`, and `edit` resolve the path exactly once,
including `file://`, home notation, and the read tool's macOS filename variants. The root
check, actual file access, seen state, and result all use that checked canonical path;
the agent tools receive an identity resolver instead of interpreting the path again.
The canonical check is a filesystem snapshot. Host-side operations still open files by
path: replacing a parent directory after the check can redirect that access. The child
process sandbox does not enclose these host operations, including seen/hash reads, file
and byte operations, and post-write language-server reads. They assume stable directory
parents and do not provide complete isolation against actively hostile run code.
`copy` takes `source` and `destination`, both named exactly as `read` names a file, and copies a
file or a folder with everything in it, unchanged and binary-safe; the standard has no counterpart,
because there one shell sees every file. Here a root with an alias lies on the server and the
run's root possibly on a workstation, so a `cp` in one `bash` cannot reach both. The destination
names the copy itself; a folder copy creates it, and existing files there are overwritten as `write`
overwrites them, without a seen state. The server reads with `bytes.read` (`recursive`) at the
machine of the source and writes with `bytes.write` at the machine of the destination, so a copy
between the project on a workstation and `@documents` is one call; the bytes travel through the
server as Base64, never through the model. The destination must lie in a writable root (never
`@skills`), writing runs within the same lock as `write`, `edit`, and `bash` of the run on that
machine, a folder is read without following links, and a destination link resolved outside
the roots is rejected. One call carries at most 16 MiB and 1000 files (`FILE_BYTES_LIMIT`, `FILE_COUNT_LIMIT`),
an error names the limit, and the result says only how many files were copied, such as "Copied 9
files.". `copy` belongs to `ragents.workspace` (`plugins/ragents.workspace/server/copy-tool.ts`)
and counts as a writing workspace tool, so it needs `workspace.use` like `write`.
`ls`, `grep`, `find`, or a separate type check are not tools, because
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
The executor thus stays without state, also on a workstation. The checks follow the standard.
`edit` or `write` of an existing file without a seen state fails with `workspace-file-unread`
("File has not been read yet. Read it first before writing to it."); a new file needs no `read`,
nor does an `edit` with an empty `old_string`. On a file changed since then, `write` fails with
`workspace-file-changed` ("File has been modified since read, either by the user or by a linter.
Read it again before attempting to write it."). An `edit` on a changed file still applies if
`old_string` selects its target as above, exactly once or with `replace_all` at least once; its
result then ends with the note that the file was modified on disk since the last read and contains
changes not in the model's context, and the seen state stays the old one, so a `write` fails until
the next `read`. Otherwise the `edit` fails with `workspace-file-changed` as well. After its own
successful `edit` or `write`, the new state counts as seen. Another `read` of the same excerpt
of an unchanged file answers with "File unchanged since last read. The content from the earlier
read result in this conversation is still current - refer to that instead of re-reading."; a state
from `edit` or `write` does not trigger that, because the model has not seen the whole content then. The model context (`ToolScope.modelContext`,
set by the agent runtime on every direct call) names the run's conversation and the
actor's last compaction (`core.md`); after a compaction or a conversation reset
the marker starts empty.
Calls from TypeScript (snippets, actor programs) and `files.read` run without a marker, because their
result does not end up in the model context: they check nothing and remember nothing. A server restart,
fork (a new actor), run move, and run stop clear the marker; that requires at most a
new `read`, never a wrong notice. Old journals keep the former arguments (`path`, `edits` with
`oldText`, a `timeout` in seconds); a replay executes no tool again, and the chat line of such a
call still names its `path`.

The **executor** is the package `packages/workspace-executor`, built from modules: every module
registers named operations whose handlers receive the process context of this machine, and
optionally its cleanup per run (`stopRun`) and on ending (`shutdown`). `shutdown` is final:
nobody calls the executor again afterwards, and a module may reject later calls with a cause;
whoever needs one again builds a new one. The executor itself
(`WorkspaceOperationExecutor`) knows no operation name; an unknown one fails with
`workspace-operation-unknown` (400), a doubly registered one already at construction. An executor carries
its own modules and the plugins' contributions (`workspaceExecutorModules({ contributions })`,
section Contributions to the executor): the four sandbox tools with process groups,
environment, and path checks (`read`, `edit`, `write`, `bash`), in the same module the background
commands of `bash` (`task_output`, `task_stop`, and the observation `tasks.wait`) and the byte
operations `bytes.read` and `bytes.write`, which read and write a file, or with `recursive` a folder,
in a root of this machine as Base64, at most 16 MiB and 1000 files per call, writing within the
lock of the tools; the language server sessions for every
language server a contribution brings along (`<id>_open`, `<id>_diagnostics`, `<id>_close`,
`<id>_snapshot`, with solutions `<id>_solutions` and `<id>_switch`), the files (`files.list`, `files.read`, `files.text`, `files.watch`, `files.attach`), the
processes (`processes.snapshot`, `processes.stop`, `processes.stopAll`, `processes.dial`), the commands (`commands.run`),
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
binding, the additional roots with an alias (`@actors` of the actor programs, `@documents` of the
document store, `@skills/<name>` of the skills, section Skills and starting tasks) to the server. An operation runs at the executor of the
machine that owns the addressed root; the binding (`executorFor`) determines only the run's root
and thus where an operation without an alias runs: on the server in the server's executor, on
a workstation in its executor, regardless of whether in the new or in an existing folder. Which roots
an input addresses is declared by the module that owns the operation, with its footprint
(`WorkspaceExecutorModule.footprints`, per operation a function of the input that never throws): the
file tools with `file_path`, `bash` with `cwd`, the language servers with `root` and `paths`, `files.list`
and `files.read` with `alias`, `files.text`, `bytes.read`, and `bytes.write` with `path`. A path with an alias addresses its root, every other one, even an
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
a new operation with paths declares its footprint in its module; a tool that needs two machines,
such as `copy`, makes one call per machine. The four tools, `copy`, the
language server tools, the tab `Files`, the process display, the browser check, the content route
of the documents, and the source file of `typescript_eval` all take this path; there is no "local or remote" branch
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
and the run's process sandbox belong to it in both cases. A trusted workspace contribution
can bootstrap its server folder with `SandboxServices.serverProcessContextForWorkspace`
and a supplied minimal `SessionWorkspace`: the host applies the same run policy,
environment, home, temporary folder, and account without recursively resolving the
workspace. It adds no registered roots and does not cache these bootstrap roots for later
operations. A contribution requiring this optional additive method fails on an older host
that does not provide it. An operation that addresses only roots of
the server does not need the run's root: if a run on the server has lost its root, such as a bound
project folder that no longer exists (`currentRoot()` fails), that operation runs at a second
executor of the server in the context of the run's server folder, as for a run on a workstation,
while every other operation reports why the root is missing and nothing creates it again. The
content route thus still serves `@documents` of such a run. `serverProcessContextFor` itself keeps
needing the root. `typescript_eval` with
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

If workspace resolution fails at startup or on first use, the host locks only that run with the cause,
retains its files and ownership, and lets the other runs start. Locked runs receive no
scheduler execution or tool validation. Repairing the prerequisite and restarting retries
resolution; an ordinarily disconnected workstation does not create this lock.

Where and in what a run works is decided by its binding: the start option `ragents.workspace.binding`
of `ragents.workspace` with two separate values, `{ machine, folder }`
(`plugins/ragents.workspace/contract.ts`). `machine` is the machine, `"server"` or
`{ client, label }` for a connected workstation; `folder` is the folder, `"fresh"` for a
new one per run or `{ path }` for an existing one. All four combinations are valid. The default is
the new folder on the server, the empty folder under the run storage. An existing folder on
the server is an absolute folder of the server machine that exists at the time of choosing; the run works
directly in it, and neither stopping nor deleting the run touches it. Selecting an existing
server folder requires administrator access (`*`) and the contribution's `serverFolders`
permission. Nonadministrators are not offered that choice. The runtime also rejects older
or imported existing-server-folder bindings of nonadministrator owners; enabling the
sandbox does not remove the administrator's ability to bind a permitted folder.
Archive rebind checks the same contribution rule as ordinary selection. A workstation is one of the
acting user: `accept` requires that this user has signed it in, for an
existing folder that the workstation offers it, and writes its label into the value so that the
run can name it even without the registry. While the workstation is registered, the location line,
the run list, and the run header name its current label instead (`withCurrentLabel`), so a
renamed workstation shows its new name in older runs too; the stored label only stands in while
it is not registered. Prompt texts already sent stay as they were. For the new folder on a workstation, `accept` records
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
the run header, and through `listDetail` the list line "Workspace" with the summary, which stays
away for the new folder on the server.

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
both (section Contributions to the executor). Under `backgroundTasks` the sign-in names the background
commands of `bash` whose end no observation has returned yet, each with run, ID, and the actor that
started it (section Background commands). If an older server does not know the question, the workstation's
message says exactly that and that the server needs to be updated. If the sign-in fails because of
one of these versions (`workspace-executor-version`, `workspace-executor-contributions`, a
missing question at the server, or a selected host package or bundle with a different version, or a missing bundle),
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
its server folder) plus the server's roots (`@actors`, `@documents`, `@skills/<name>`), in the
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
matches. Tool errors are only start, time limit, and cancellation problems. `timeout` is in
milliseconds as in the standard: without it the bash stops a command after 120000 ms; a call may
request up to 3600000 ms (60 minutes); more is an input error. The upper limit deliberately exceeds
Claude Code's 600000 ms, because cold builds of real projects take longer and their result belongs
in the call; models trained on the standard stay below it anyway. Both are in the tool's description and
schema (`default` and `maximum`, `packages/agent/src/core/tools/bash.ts`), together with the sentence
that builds, test runs, installations, and other long commands need a larger `timeout`. When the
time runs out, the command ends together with its process group, and the error carries the output
so far, the milliseconds, and what to do: narrow the command, for example search with `rg` instead
of `grep -r`, or pass a larger `timeout` up to 3600000. `description` is a short label of the
command for the user; the chat line of the call shows it instead of the command, and the execution
ignores it. With `run_in_background: true` the call starts a background command (below), and
`timeout` does not apply to it. The server fills in the default before it passes a model call to an executor
(the schema defaults in `WorkspaceSandboxHost`); that way the time limit the model sees in the schema
also applies on a workstation, and the footprint knows it as `durationMs`.
`RAGENTS_BASH_TIMEOUT_SECONDS` (section `ragents.workspace`) changes the default for all runs of the
server, also on workstations, not the upper limit; the operator names seconds, the server passes the
tool milliseconds. Allowed are more than 0 up to 3600 seconds;
another value aborts the start; a workstation does not read the variable. The standard has no
field for the folder, because its shell keeps the folder of the last `cd`; here every call starts
anew, and an alias root lies on the server, so the folder decides the machine before the command
starts and a `cd` in the command could not. The folder of a
call is therefore named by the optional `cwd`, the same on every machine: relative to the working directory or
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

**Background commands.** `bash` with `run_in_background: true` starts its command like every other
call, in the same lock, folder (`cwd`), environment, account, and process sandbox, but detached in a
process group of its own, and returns at once with one line: "Command running in background with
ID: b3f9a1. task_output reads its new output, task_stop ends it." The ID is `b` and six hexadecimal
digits, random per run and machine; nothing else, not the path of the output, reaches the model. The
command carries the run marker like every process of the run, so the process rail shows it, and it
survives the call: it ends when it exits, with `task_stop`, with the end button of the rail, with the
stop and the deletion of the run, and with the `shutdown` of the executor that started it, on the
server as on a workstation. `timeout` does not apply to it: the standard stops a background command
after 30 minutes by default and after two hours at most, while here it is a service that runs until
one of the above ends it. When the command itself exits, what is left in its process group ends with
it, as after every call, so `npm run dev &` as a background command ends at once; the description of
`bash` says to pass `run_in_background` instead of `&`, `nohup`, `setsid`, `disown`, a detached spawn,
or a service manager. The executor (`packages/workspace-executor/src/background-tasks.ts`, in the
module of the sandbox tools) writes stdout and stderr through pipes into one file per command below
the run's log folder on its machine (`logDirectory`: on the server the run's home in its storage, on
a workstation a folder below the system temp folder), `background/<id>.log`, and removes the files
when the run stops there. `task_output` takes `task_id` and returns what the command wrote since the
last `task_output`, then its status: "Status: running", "exited with code N", "ended by signal S", or
"stopped with task_stop"; without new output "(no new output)". One call reads at most 20 KB from
the end of the new output, starting at a line, and keeps its last 2000 lines with lines over 1000
characters shortened, the limits of `bash`; what it leaves out is named in the first line ("[1.2MB of
earlier output left out]") and not returned later. It does not wait for output, because no tool
waits. `task_stop` takes `task_id`, sends SIGTERM to the process group, waits two seconds, and then
ends the group with SIGKILL; on Windows it ends the tree with `taskkill /T /F` and the MSYS
processes of the command, as at the end of every call. It answers "Stopped background command
b3f9a1." or, for a command that had already ended, how it ended. An ID the executor does not know
fails with `background-task-unknown` (404). With an account per run (`uid`), the cleanup after a call
ends every process of that account except the background commands still running and everything
below them (`stopUidProcesses` with `keep`).

Names and fields follow the standard, checked against `sdk-tools.d.ts` of
`@anthropic-ai/claude-agent-sdk` 0.3.288: `run_in_background` of `Bash`, `task_stop` with `task_id` of
`TaskStop` (formerly `KillShell` with `shell_id`, which `TaskStop` still accepts as deprecated and
which is not taken here), and `task_output` with `task_id` of `TaskOutput`, which replaced `BashOutput`
with `bash_id` and has since been removed from Claude Code in favor of reading the output file with
`Read`. Here a model names no path: the output lies on the machine of the command, possibly a
workstation, outside every root `read` reaches, so the output tool stays and takes the ID; the `block`
and `timeout` of `TaskOutput` are not taken, because no tool waits.

The server keeps per run which executor started which ID (`WorkspaceSandboxHost`) and sends
`task_output` and `task_stop` there, for a command with an alias as `cwd` therefore to the server; an
ID it does not know goes to the executor of the binding, the only one that can still hold a command
after a server restart. The server passes the calling actor in the input of `bash` as `startedBy`,
which the executor keeps with the command without reading it; a background start without it fails
with `background-task-starter-missing` (400). Right after the start the server opens the observation
`tasks.wait` (`task_id`) at that executor, with `untilAborted` like `files.watch`; its result is the
status at the end. The actor that called `bash` then gets an ActorInput in the owner's name with
`presentation: "background"`:
"Background command b3f9a1 exited with code 1. task_output reads what it wrote last." (or "ended by
signal SIGTERM"). An end that `task_stop` caused brings no input, because the caller already knows
it; an end through the rail does. The stop of a run first aborts the observations of the run and only
then stops its executors, so the ends it causes reach nobody; an abort ends only the observation,
never the command. If the connection to the workstation is lost, the server opens the observation
again every 15 seconds until the workstation answers or the run stops; the executor keeps the status
of an ended command until the run stops there, so an end in the meantime arrives with the next
answer. A command on a workstation outlives a restart of the server, its observation does not: the
executor counts an end as reported once an observation has returned it, and the workstation names
every command of its executor without a reported end, except those `task_stop` ended, at each
sign-in (`backgroundTasks`, `WorkspaceOperationExecutor.unreportedBackgroundTasks`). For each one
whose run the server binds to this workstation of this owner, the server opens the observation
again for the named actor (`RunWorkspaceRuntime.resumeBackgroundTasks`), and `task_output` and
`task_stop` find the command by its ID; one it already observes keeps its observation, so a renewed
sign-in brings no second notice. An end while the server was down arrives right after the sign-in.
A command of a run that exists but is bound to another workstation, another owner, or the server
stays as it is, and the server names it in its log. For the commands of a run this server does not
have, the server stops that run on the workstation once, as a registered stop of the run (above;
`WorkspaceClientRegistry.stopAbsentRun`, with the workstation's `runsDirectory` as `cwd`, which the
stop does not check); a stop already pending for the run is that stop. Like every stop of a run
there, it ends the run's commands and removes their output files. The server names each command in
its log with the outcome: stopped and its output removed, its stop pending while it does not reach
the workstation (delivered at the next sign-in or retried as above), or the cause of a failed stop.
A run counts as absent only if the journal has no run with that ID
(`RunWorkspaceRuntimeOptions.runState` returns `null`, from `run-not-found`): the journal loads every
run of the data folder at startup and forgets a run only when it deletes it or resets a global
conversation, whose coordinator starts no background command, so the run was deleted or never
existed in this data folder, which includes a server that answers at the address of an earlier one
with another data folder. Whatever the server cannot answer keeps the command and goes to the log:
a run whose journal is locked (`journal-unavailable`), a server whose engine has not started, any
other error. A sign-in after a lost connection therefore stops nothing of a run that still exists; a
run deleted in between already had its registered stop, which the sign-in delivers. If the
observation fails for another reason, for example because a rebuilt
executor no longer knows the ID, the actor gets that cause as its input instead. `bash` starts a
background command only for an actor that has `task_output` and `task_stop`; otherwise the call fails with
`background-tools-missing` (400) and names what is missing, so nothing starts that its actor can
neither read nor end (the global coordinator has neither). The process display counts the process
group of a background command as background although the executor is its parent: the module names its
groups (`WorkspaceExecutorModule.backgroundGroups`), and the snapshot leaves them out of the groups of
running tool calls. In the server's process sandbox a background command runs in a sandbox of its own
that lives as long as the command; a service started there cannot be reached on Linux and cannot
listen on macOS (Open limits, `docs/concepts/sandbox-services.md`).

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
(the process groups of direct children of the executor process) only with an open port; the group of a
background command of `bash` counts as background (above). Background is recognizable by the dashed
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
With pure read access, port links stay usable; a tunnel to a port additionally requires `runs.inspect`,
ending `runs.write` and `runs.inspect`, and is otherwise disabled. A running
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

**Opening a service.** A port in the rail opens the service that listens on it, on the machine the
run works on. A viewer talks only to the server, so the link depends on the host. The snapshot names
the machine (`machine`: `"server"` or `{ client, label }` with the workstation's current label, from
`WorkspaceRuntime.placementOf`). The browser reaches only the machine of its page: for a run on the
server the port is a link to `http://<host name of the page>:<port>/`; for a run on a workstation the
pill shows only the port, and its tooltip names the workstation and that the VS Code extension can
forward it ("Port 5173 on workstation Notebook. The RAgents extension in VS Code can forward it.").
In VS Code the port is a button; the run panel hands the service to its host (`openService` with run,
port, the workstation's ID or `null`, and the tunnel method) and the extension acts like VS Code
Remote port forwarding. A service on its own machine opens directly as `http://localhost:<port>/`: on
the window's own workstation (the binding names its ID) and on the server when that is the
extension's own local host. Every other service gets a tunnel: the extension first asks the server
whether a process of the run listens on the port, then listens with TCP on `127.0.0.1` with the same
port number if it is free there and nothing on this machine answers on it on `127.0.0.1` or `[::1]`,
otherwise a free one, and opens `http://localhost:<local port>/` with
`vscode.env.openExternal`; a second click reuses the tunnel. Every accepted connection becomes one
byte stream through the server the run belongs to, and the extension pipes its bytes unchanged in
both directions, so HTTP with bodies of any size, server-sent events, WebSockets, and every other
TCP protocol pass. The `RAgents` output gets one line when a stream opens and one when it closes, with
the bytes of both directions and the cause of an abnormal end. A stream the server refuses closes its
connection without an answer. A tunnel ends with its open streams when the server answers that the
port, the run, or the access is gone (403, 404, or an unknown method), which a check every five seconds
also asks, when its server connection ends or is renewed, and when the extension deactivates
(`apps/vscode/src/service-tunnels.ts`). The extension names no plugin: the method comes with the
message, and its input and result are the host contract's (`ServiceTunnelInput`,
`ServiceTunnelResult` in `run-panel/host-contract.ts`).

`ragents.processes.tunnel` takes `runId`, `port`, and `connect`, and requires `runs.read`,
`runs.inspect`, and `ragents.processes.read` plus workspace access, because it reaches into the
machine like the Files tab. With `connect: false` it only asks the run's executor whether a process
of the run listens on the port and returns `null`. With `connect: true` the plugin's broker
(`server/tunnel-streams.ts`) opens a stream with two one-time secrets of 32 random bytes, one per
leg, and calls the executor operation `processes.dial` with the port and the path of the machine's
leg. The executor checks the port again against the run's processes, from the same scan as the
rail, which answers for two seconds; any other port fails with `tunnel-port-unknown` (404) before
anything connects. It connects with TCP to the listening address on its machine (a wildcard to
`127.0.0.1`, then `::1`, an IPv4 or IPv6 listener to its own address, the next address only if the
previous one refused the connection), opens its leg as a WebSocket to the server, and pipes; each of
the two may take ten seconds. For a run on the server that is the server's executor, which dials the
server's own address (`hostAddressToken`); for a workstation its executor, which dials the address
of its own connection to the server, in the VS Code extension as in `ragents workspace-client`; a
path that leads to another host is refused. The method returns the path with query of the caller's
leg once the machine's leg has arrived; the caller connects it within 15 seconds, otherwise the
stream closes. Both legs connect to `/api/plugins/ragents.processes/tunnel?secret=<secret>`,
authenticated only by their secret, which opens one leg once; a used, unknown, or expired secret
gets 404, a plain request to the path 426. A leg sends no header of its own, so any WebSocket client
can be one. The broker pairs the two legs and relays every frame unchanged; it holds what the
machine's leg sends until the caller's leg is there and stops reading a leg while the other one has
more than 1 MiB to send. Both ends of a stream speak one small protocol (`pipeTunnel` in
`packages/workspace-executor/src/processes/tunnel.ts`): the bytes travel as binary frames, the end
of one direction as the text frame `end`, so a half-closed connection keeps its other direction,
and the stream closes with code 1000 once both directions have ended; an error closes it with 1011
and the cause, which the other end turns into a reset of its connection. A closing leg closes the
other one with the same code. Every leg pings the server every 30 seconds, also while it does not
read; the server cuts a leg it has heard nothing from for 75 seconds while it reads it, and the
frames keep proxies from closing idle streams. Run stop and deletion close the run's streams on
the server, and the executor closes its own legs of the run in `stopRun` and all of them in
`shutdown`, so a workstation that signs out ends its legs. Errors name their cause:
`tunnel-invalid` (400), `tunnel-port-unknown` (404), `tunnel-unreachable` and `tunnel-failed`
(502), `tunnel-server-unknown` (503, an executor without the server's address, such as a server
without HTTP), and `tunnel-timeout` (504).

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
document store as a tree with text preview, without writing and deleting; the methods
`ragents.workspace.browse.list` and `ragents.workspace.browse.preview` provide tree and preview.
The tab reads the workspace through the file module of the run's executor, for a workstation
therefore there, and the location line then names its label and path
(`Workstation <label>: <path>`). The document store of `ragents.documents` (`@documents`) lies on the
server and does not belong to the workspace; the tab reads it directly with the same functions of the package.
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
(`resolveRootFile`, `resolveRootDirectory`, `resolveRootPath`), domain errors (`operationError`, at the caller a
`DomainError` like every error of the executor), and the environment of a process it starts itself
(`processEnvironment`: the safe selection of this machine, its `HOME`, and the run's marker).
`machine.startManagedService(options)` starts a managed child process from `ManagedServiceOptions`
and returns `ManagedService`. The contribution first wraps its launch with
`context.sandbox.wrap` when present, merges `machine.processEnvironment(runId)` with `context.env`,
and closes the service through `kill` and `finished` in its module's `stopRun` and `shutdown`.
`WorkspaceModuleHost.execute` lets a module use the executor's existing confined file and process
operations locally, including their cancellation and progress. `resolveRootPath` also checks paths
for files that do not exist yet and refuses links or paths outside the supplied root. The
contribution function touches neither disk nor network; resolution and checks happen only in the
call. `WORKSPACE_EXECUTOR_VERSION` is 14 because older machines cannot carry the browser's
run-owner network policy. The server supplies this policy in the executor request, separately
from the operation's input, and the workstation adds it to `WorkspaceProcessContext`.

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

A workstation loads exactly these contributions from the built-in bundles of its selected host
(`<host>/bundles/<id>/executor/index.mjs`) and builds them with its data folder's tools folders.
The VS Code extension and headless `ragents workspace-client` select a host separately for each
server from `version` in `ragents.plugins.bootstrap`. Their shared `ensureHostPackage` in
`scripts/package/host-package.ts` first installs `@schlenkr/ragents@<version>` from npm with the
client's configured process environment, including registry settings. If that fails and bootstrap
offers `hostPackage`, it downloads from the authenticated server, verifies SHA-512 against the
descriptor, and installs the tarball with npm into the same per-version cache. Integrity failures
abort before installation. If neither source works, registration reports the npm cause and the
download cause or its absence. No local profile or distributing server is required.

The extension cache is `<globalStorage>/hosts/<version>/`; the CLI cache is `ragents/hosts/<version>/`
under the operating system's user cache directory. Requests for the same version share the fetch;
installed packages are reused across sessions and restarts. The CLI reuses its launching host
when its package version matches the server. The Servers entry reports fetching progress and
failures with their cause.

An explicit `ragents.hostPath` overrides fetching. Before loading, the selected host's package
version must match the server's RAgents version, and every requested contribution must match its
SHA-256 state. A missing host, missing bundle, different package version, or different contribution
state fails registration with the cause; no other host is used as a fallback. A rejected executor
version or contribution state names both package versions. Every registration selects and
verifies the exact host version, including servers that request no contributions. The executor of
every machine thus carries the same operations, and the footprint the server asks of its own
executor also applies to the workstation.

### Server process sandbox

For a restricted run, every process the server's executor starts (`bash`, `commands.run`, the
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
context it starts unchanged. The browser check has its own Chromium sandbox and network policy
(section Browser checks).

Restriction is a property of the run's owner, obtained from the profile's current access
configuration through `host.run-owner-access`, never from whoever sends the current message.
An owner without administrator access (`*`), including an unknown or ownerless run on a
server with sign-in, always gets the sandbox. An administrator or unrestricted local user
can choose it through the Boolean start option `ragents.workspace.sandbox` ("Sandbox
protection"); it cannot change after the run starts. `PROCESS_SANDBOX: "on"` forces it for
every run. The default `"auto"` and the legacy `"off"` allow only administrator runs to
remain unrestricted. Neither a stored `false` nor an administrator's message can weaken a
nonadministrator owner's policy; an invalid stored choice fails. The service
`ragents.workspace.run-security` exposes the resulting `{ restricted }` to trusted plugins
so their process launches and credential selection follow the same policy.

The rules are created per run from its folders (`apps/server/src/plugin-support/process-sandbox.ts`).
Blocked for reading are the server account's home, the other homes (`/Users`, on Linux `/home`
and `/root`), `os.tmpdir()`, `/tmp`, and the profile's data folder, on Linux also an existing
Docker socket. Within these, readable again are the host folder, the toolchains from `PATH`,
`DOTNET_ROOT`, and `PNPM_HOME` including their prefix (never an ancestor of the data folder), the storage of the
run itself (`sessions/<run-id>`), and its read-only roots (skills; for the global coordinator
without users the journal folder). A run may read and write the root of its
workspace or its server folder, the registered roots (`@actors`), its
home, its own NuGet cache below that home, and its own temp folder `sessions/<run-id>/tmp`, which is in
`TMPDIR`, `TMP`, `TEMP`, and `CLAUDE_CODE_TMPDIR` (Claude Code ignores `TMPDIR`). Added to that
are the folders its workspace explicitly allows (`SessionWorkspace.sandboxFolders`, below).
The rest of the system (`/usr`, `/opt`, toolchains)
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

Every process goes onto the network through the library's proxy. `PROCESS_SANDBOX_NETWORK`
in the section `ragents.workspace` replaces the default policy with a list of domains such as
`*.example.com` or `host:port`. Without a value, `PROCESS_SANDBOX_DEFAULT_NETWORK` is `["*"]`:
the host automatically allows public web domains on ports 80 and 443, including redirects to
other public domains. The workspace prompt allows network access from Bash within this policy.
The host consumes `"*"` through the library's network callback, not as an unrestricted domain rule.
IP literals and localhost names need explicit entries; the library checks resolved addresses at
connection time, blocking loopback, link-local, host-interface and metadata addresses. In public
mode it additionally blocks private IPv4, IPv6 ULA and CGNAT ranges. An explicit IP and port
can allow a local or internal service. The public mode grants destinations, not HTTP methods or
data classifications: uploads and destructive API calls are not separately approved. A configured
list without `"*"` keeps the explicit allowlist behavior; `[]` permits only the own server.
If the host uses an upstream proxy, that proxy resolves names and must enforce the address limits.
Rejected destinations get the proxy's 403 response.
The server's own address (`127.0.0.1:<port>`) is always added, because
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

When forced by `PROCESS_SANDBOX: "on"`, startup checks the prerequisites, starts the proxy,
and runs one sandboxed process. Otherwise the first restricted server operation initializes
it. Initialization failures refuse that operation with their cause; execution never falls
back to an unrestricted process. Causes include Windows (unsupported per-run folder rules),
another unsupported platform, missing bubblewrap, socat, or ripgrep on Linux, and a kernel
or container without user namespaces. An unrestricted administrator run can still work
without these prerequisites. `ragents.workspace` gives `ServerProcessSandbox` a diagnostic
hint for administrator-only unrestricted operation as `disableSetting`; the building block
itself names neither key nor section. The library has one state per process;
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
bundle does not load without them; only what exports `provision` is provisioned. Both workstation
clients select their host from the server's bootstrap before provisioning and registration.
The VS Code extension provisions once per selected host during an activation, before registration,
including when the server requests no contributions. Neither uses the server's profile or a
fixed plugin list; what a server requires must be among the selected host's bundles, otherwise registration
fails. A provisioning gap does not hold up the workstation; it fails only when the affected
contribution is called.

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
caller of the executor sets the value: the server its own root (`hostRoot()`), both workstation
clients the host selected for this server: in VS Code the explicit `ragents.hostPath` or its
package under `<globalStorage>/hosts/<server-version>/`, in the CLI its matching launching host
or package in the user cache. No adapter
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
  preference without `ROSLYN_SOLUTION_ON_START: "on"` aborts the start. Several: a question through `ragents.ask` (header "Solution")
  with every solution and "Load none" as options, also more than four, asked before the hook returns and thus before the run's first input.
  Outside a turn only the run's owner may give commands, which is why the owner asks, and the
  question carries the coordinator as `recipient`: it appears in the coordinator's chat without a name in front
  and in its card. The answer loads the chosen solution, also a free answer that names one; "Load none" and dismissing load
  nothing; any other free answer goes to the coordinator as input. After a restart nobody waits
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
the run menu, `ragents script`, or the coordinator's `run_script_start`, it joins a running run in
a room of its own, lists the other participants with `actor_list`, and ends each start with
`context.finish`. Two neutral skill templates guide a decision or a
learning unit as reusable work instructions in the chat, without a programmed setup.

## MCP client

`ragents.mcp` connects external Model Context Protocol servers and contributes their tools as
native run functions. It requires the workspace plugin and adds nothing when neither the
profile nor the run supplies servers. `MCP_SERVERS` in the `ragents.mcp` profile section is a
map of server names to the usual `command`/`args`/`env`/`cwd` or `url`/`headers` definitions;
`type` optionally selects `stdio`, `http`, or `sse`. Unknown fields, invalid server names,
and incompatible fields are startup errors. Configuration and examples are in
[operations.md](../operations.md#connect-mcp-servers); structured configuration values and
nested `env(...)` references are described in [profiles.md](profiles.md).

Every connection belongs to the plugin's executor module on the machine of the run's workspace,
including HTTP and SSE, so `localhost` names that machine. A stdio server is a managed process
with the run's process sandbox and machine environment plus its configured `env`; its working
directory is the workspace or `cwd` below it. Bounded stderr is available in connection errors.
The client's `roots` capability names the workspace root. The self-contained executor bundle
contains the official MCP client SDK; the server half contains the same dependency wherever
its imports require it.

Negotiation covers the legacy `initialize` handshake and the `server/discover` era, with supported
protocols from 2024-10-07 through 2026-07-28. If a legacy stdio process exits on the discovery probe, the module restarts
it for the legacy handshake. An untyped URL first uses Streamable HTTP and tries legacy
HTTP+SSE only after a 4xx initialization rejection except 401, 403, 408, and 429; explicit `http`
or `sse` selects only that transport. Authentication, timeout, and rate-limit errors remain visible.

The first tool resolution connects the configured servers in parallel with a 15-second wait.
Later resolutions use the cached list. Tool-list change notifications reach the server half
through an executor observation and apply at the next model step. A failed or disconnected
server retains its last known tools so fixed actor selections still resolve; a call reports
the cause and starts reconnection. Stop, deletion, and executor shutdown close connections and
managed processes on their owning machine.
Streamable HTTP session termination uses DELETE with a two-second absolute deadline; local
clients, transports, and observations always close, and cleanup reports redacted failures.

Tool names follow `mcp__<server>__<tool>`, contain only `[A-Za-z0-9_-]`, and are at most 64
characters; deterministic suffixes resolve sanitization and shortening collisions. The input
schema comes from the MCP tool, the description names its server, and `readOnlyHint` permits
parallel calls. Turn cancellation cancels the request; progress resets its five-minute timeout.
The executor call uses `untilAborted` with a signal so workstation transport does not impose
a shorter fixed timeout. Workstations require the current executor version and the matching MCP contribution.
Calls use the normal journaled run-function path. Text content is joined, or structured content
is returned as JSON when no text exists. Error results fail with the server's text. An
`afterToolCall` hook presents images to the model, bound to the result by tool-call ID; audio and
resource content use short text summaries. Results use an 8000-character default limit and a
1000-character line limit with a truncation note.

A per-run prompt chapter includes bounded server instructions and connection failures. The
"MCP servers" tab shows server name, transport, negotiated protocol, state, error, and tool
count through the shared typed channel, without connection definitions or credentials.

Other host components call `setRunServers(runId, servers)` through `mcpRunServersToken` from the
plugin's declared export `server/service` before the first tool resolution. Run-scoped names
must differ from profile server names. These definitions stay in memory and in `servers.json`
in per-run plugin storage across a server restart (file mode 0600, directory mode 0700).
They never become journal payloads or model tool arguments and results; plain strings in their
environment and headers are accepted.

External clients replace these definitions through the guarded non-tool method
`ragents.mcp.servers.set`. It requires run read, write, and create permissions, checks workspace
access, and refuses a run with a running turn or pending actor inputs. The method calls
`replaceRunServers`: close existing connections, reset the tool cache, and atomically store
the replacement definitions before the next turn. The original service method retains its
before-first-resolution rule. The ACP editor adapter uses this boundary for `session/new` and
`session/load`; definitions never become a journaled tool call.

`ragents.mcp.connections.close` requires run read and write permissions and workspace access.
It closes connections idempotently while preserving the private server definitions. The ACP
adapter closes its remote runs' connections before unregistering their workstations, while
the owning executor is still reachable.

## External ACP actors

`ragents.acp` supplies one generic Agent Client Protocol client driver for all configured
adapters. `ACP_AGENTS` in its profile section uses the editor `agent_servers` entry shape:
`{ title?, command, args?, env? }`, with nested `env(...)` configuration references. Every entry
contributes a runtime named `acp.<name>` through `actorRuntimes`; an empty map contributes no runtimes.
The neutral profiles include the plugin with an empty map. Configuration and adapter setup are
in [operations.md](../operations.md#configure-external-acp-agents), user behavior in
[usage.md](../usage.md#run-external-acp-actors).

Each ACP actor requires `workspace.use` and uses the shared run workspace. External runtime
selection defaults to `isolateWorkspace: false`; the ACP driver rejects explicit isolation.
Every actor has exactly one adapter process and ACP session in the executor on the machine of
its run's workspace. The launch uses the process sandbox, `machine.processEnvironment(runId)`
plus configured environment, and the workspace as `cwd`. On the server the sandbox's own `HOME`
hides the server account's sign-in from the adapter; configure non-interactive credentials in
`ACP_AGENTS.<name>.env` as described in operations. A workstation has no process sandbox, so its
adapters use the developer's sign-in. The self-contained executor bundle
uses the stable `@agentclientprotocol/sdk` entry point and newline-delimited JSON-RPC over pipes.
`initialize` declares file read, file write, and terminal capabilities. The module serves these
callbacks through its local executor's confined file and process operations, checks all paths
against the run root, and keeps terminal handles internal. Missing commands, process errors,
and authentication that requires interaction fail with a clear cause naming the offered method.
ACP request errors retain their bounded, redacted `data` in the failure reason.
The driver starts no interactive sign-in flow.

The session receives the run's MCP definitions from `ragents.mcp`, including profile and
private run-scoped entries. Stdio is supported by ACP; HTTP and SSE are forwarded only when the
adapter advertises their capability, with a visible exclusion notice otherwise. An MCP entry
with its own `cwd` fails with its server name because ACP cannot represent it. Definitions and
credentials travel directly between the server and executor, never through model tools.

An ActorInput becomes `session/prompt`, with its lasting instructions prefixed to the text.
Images and embedded resources require the advertised prompt capabilities; unsupported content
fails explicitly. The executor resolves attached resources to local file URIs inside the run
workspace, so a workstation path is never interpreted on the server. Inputs received during a
prompt remain queued for later turns. Message and
thought chunks publish live deltas; changes of content kind, message, or tool flush completed
text blocks into the observation events described in [core.md](core.md#external-runtimes).
Pending tool calls collect title and raw input refinements without publishing a start. The
journal records the start and the live tool event publishes the same input when the call leaves
`pending`, a permission request refers to it, or the turn ends. Completion and failure close the
call once; calls still unfinished at a successful turn end receive a failure result, while
interrupted or failed turns close open calls through the core projection. The ordinary tool-call
lifecycle keeps bounded input and result text and locally generated call references; raw ACP
tool IDs stay internal. Plans become visible runtime output. Reported usage contributes to
the turn's usage; cumulative values stay in
actor-scoped plugin state so later turns do not count earlier usage again.

`session/request_permission` produces a blocking question through `ragents.ask` associated with
the running turn. The user sees the offered labels; the executor retains their option IDs and
returns the selected ID. Dismissal or abort answers `cancelled`. On a workstation, the question
travels as progress of the prompt operation and its answer returns through a separate executor
operation. Aborting a turn sends `session/cancel` and records unfinished text as interrupted.

The session ID and cumulative usage are kept in private actor-scoped plugin state. Its access
projection hides the state and its chat events even from inspection access; ordinary journal
queries and subscriptions also omit its state events. Persisted journals and archives retain
these values for restoration. No model or user is asked to copy the session ID. After a host
restart the driver uses advertised `session/load` and suppresses replayed updates while loading.
Without that capability, or when loading fails, the actor reports a blocking cause rather than
silently starting a replacement session. Stopping an actor or run closes its
connection, adapter process, and terminals on their owning machine; executor shutdown does the
same. The adapter's conversation remains its own persistent context, while the RAgents journal
restores the actor and its observable history without executing it.

## Browser checks

`ragents.browser` adds a real browser controlled through Playwright and requires
`ragents.documents`. Every run has its own browser process with one page, isolated
cookies, and no inherited sign-in. Opening, semantic reading, clicking, filling,
selecting, keyboard input, checks, and screenshots are typed run functions.
The binding schemas are in `plugins/ragents.browser/server/tools.ts`.
Their names and input fields follow Microsoft's Playwright MCP server, the de-facto standard of
agent harnesses: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`
(`text`, optional `submit` and `slowly`), `browser_select_option` (`values`),
`browser_press_key`, `browser_resize`, `browser_take_screenshot` (`filename`, `fullPage`), and
`browser_close`. `browser_check`, `browser_view_screenshot`, and `actor_view_snapshot` have no
counterpart there and keep their own names.
The ARIA snapshot contains accessible roles, names, and element references; actions resolve
role/name, label, text, test ID, or CSS in the run's browser. Unlike upstream, `target` is
therefore an object with these fields instead of a snapshot reference. Models copy no snapshot IDs,
and a screenshot goes where the model names it with `filename`. An optional target iframe is chosen by CSS.
For a pure text check, top-level `frame` chooses the iframe without inventing an element target;
with an element target, only `target.frame` is used.
`browser_type` replaces the field content, or with `slowly` types key by key without clearing it,
and with `submit` presses Enter afterwards. `browser_select_option` matches each value against an
option's value or visible label. `browser_press_key` presses on the focused element, or on
`target` after focusing it.

`actor_view_snapshot` checks a mini-app without the model driving a browser: given `package-name/view-key`
(or `@handle/view-key` or a unique title), it resolves the view from the caller's room through the
actor programs service (`resolveView`), rejects a hidden view, opens the app layout of the host in the run's browser at the address of
`hostAddressToken`, waits for the view's frame, and returns its accessible structure (cut at 8000 characters)
and the browser errors. It is only available where `ragents.actor-programs` exists, and it needs a server
without sign-in that the machine of the run's workspace can reach; otherwise it fails with the page it found.
The run's browser stays on the view for `browser_take_screenshot` and frame-targeted actions.

The browser runs where the run's workspace lies. Browser, page, and everything the
page touches are the browser module that `ragents.browser` brings along as a contribution to the executor
(`plugins/ragents.browser/executor/`, `modules` in the section Contributions to the executor), with the
operations `browser.navigate`, `browser.snapshot`, `browser.resize`, `browser.click`, `browser.type`, `browser.selectOption`, `browser.pressKey`, `browser.check`, `browser.takeScreenshot`,
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
`browser_navigate` fails with exactly this cause. It reports input errors with the machine's `operationError`
as `browser-input-invalid` (400); Chrome starts with the run's `WorkspaceProcessContext.env`,
the safe server environment or the workstation's own environment, with Chromium's sandbox
explicitly enabled.
Chrome is the browser from `BROWSER_EXECUTABLE_PATH` in the environment of this machine, otherwise the Chromium that
provisioning puts into Playwright's browser cache for the pinned playwright-core version;
if both are missing, the error names the expected path and the command. On the server, the
profile section `ragents.browser` sets the value in its environment. It does not travel to a workstation:
there its own environment applies or the Chromium from `pnpm provision --workspace`.

For a restricted run, `WorkspaceProcessContext.browserNetwork` carries the server's
allowed origins; an operation cannot replace it through model input. The browser uses
an authenticated loopback HTTP/CONNECT proxy that resolves each destination once,
rejects private, loopback, link-local, metadata, reserved, and local interface addresses, and connects to
that checked IP. Public HTTP(S) destinations on ports 80 and 443 are allowed by default.
The policy applies to redirects, subresources, frames, workers, and WebSockets. The
browser has no implicit loopback proxy bypass; direct DNS and QUIC are disabled.
An isolated temporary Chromium profile sets `webrtc.ip_handling_policy` to
`disable_non_proxied_udp`, and startup verifies the effective value before releasing
the run context. A failed verification refuses startup. Proxy authentication is installed
only for the proxy; an origin's HTTP authentication challenge cannot obtain its token.

`BROWSER_ALLOWED_ORIGINS` in the server's `ragents.browser` section is a list of exact
HTTP(S) origins such as `http://127.0.0.1:8080`. An entry allows that scheme, hostname,
and port, including internal addresses; paths, credentials, queries, and fragments are
invalid. This allowance travels to a workstation through executor protocol 14. It is
separate from `PROCESS_SANDBOX_NETWORK`. Administrators' unrestricted runs keep ordinary
HTTP(S) browser access. Every browser still uses Chromium's sandbox and a fresh run
context; no personal Chrome profile or sign-in is inherited.
Chrome thus starts with the safe environment of this machine, its `HOME`, and the run's marker,
and the process display therefore attributes it to the run.

What stays visible in the run is held by the server. Besides its result, every operation on the page returns
the page's state: address, captured errors, whether a check has passed since the last action or
navigation, and the IDs of the captures since then. From this the server keeps
the run's evidence. The server sets the time of a passed check with its own
clock, so that it can be compared with its other times, even if the browser runs on a
workstation with a different clock. If a call fails, the server queries the state with
`browser.state`; if the executor is not reachable, the page counts as closed. A
screenshot comes back from the executor as PNG in Base64, and the server writes it with `bytes.write`
where `filename` names it, exactly as `read` names a file: relative to the run's root on the machine
of the binding, where the browser runs, or under `@documents` on the server; without `filename` it goes
to `@documents/browser/<id>.png`.

A run's actions run in order and use Playwright wait conditions.
Before an action or a positive target check, zero current matches fail immediately with
`0 matches for <target>`. Text filters on an existing target can still wait for the expected text.
Ambiguous or non-operable targets, missing browsers, and failed navigations
report errors; ambiguity lists at most five candidates with their 0-based indexes and
advises `target.nth`, `first: true`, or a more specific text or role/name target. Timeout
errors give the actionable cause in one or two lines rather than Playwright's call log. A target
chooses one of several matches with `nth` (0-based) or `first: true`; `browser_check`
checks with `count` the number of visible matches of a target instead of its uniqueness
(`0` checks absence). With `text`, it counts only visible matches containing that
case-insensitive substring; `count` requires a target without `nth` or `first`.
For `count: 0`, an unfiltered target that has never matched during checks or actions since
navigation adds a result warning: absence can otherwise be a misspelled selector. Text filtering
and hidden CSS matches do not cause this warning; navigation clears the observed selector history.
Pure visibility and address checks in `browser_check` wait
at most 5 seconds, actions the full time limit of 15 seconds.
Console, JavaScript exceptions, and failed network responses feed into
the reported page errors; a failed request appears only once in the error list, even if
HTTP status, console ("Failed to load resource"), and network report it. Page errors are
informational by default (`noErrors: false`); only explicit `noErrors: true` fails a check
on errors collected since navigation. A check needs at least one target, text, address,
or explicit no-errors assertion. Results name passed assertions without repeating the
input and report at most five page errors, each limited to 300 characters, followed by
the number omitted. Successful explicit assertions create a timestamp; actions
and navigation discard it; new errors stay visible in the run's error list without
discarding the check. A screenshot alone is not a successful test.

With `target` and `measure: true`, `browser_check` also returns one visible element's bounding
box (`x`, `y`, `width`, `height`), `clientWidth`, `scrollWidth`, and `overflowX`
(`max(0, scrollWidth - clientWidth)`). All values are CSS pixels; box coordinates are relative
to the main viewport, including targets inside frames. Measurement cannot be combined with
`count`; several matches need `nth` or `first`. A target such as `{ css: "html" }` measures page
overflow; a container target reveals clipped content even when it uses `overflow: hidden`.
These are measurements, not a claim that every child or text is unclipped.

Clicking, typing, selecting, pressing keys, and resizing return a short accessible snapshot:
at most 2000 characters, 40 lines, and 300 characters per line, with `truncated` when shortened.
`browser_snapshot` and navigation retain the full structure up to the existing 40000-character
limit. Resizing discards the prior check and current captures, so evidence always follows a
check at the chosen size.

By default the page runs in a viewport of 1920 x 1080 pixels (16:9, scale 1),
so that screenshots are Full HD images without enlargement and wide interfaces such as
a ribbon are fully visible. `browser_resize` changes the size per run, for example for
narrow layouts; the chosen value applies until the next change, also after a restart
of the browser in the same run, because the server holds it and passes it to every new browser; a
server restart forgets it. The result of `browser_take_screenshot` names only what the model does not
have: the generated reference when it chose no `filename`, otherwise only that the screenshot is
saved. A report embeds the PNG with a path relative to itself, a chat answer with its reference
or a path relative to the run's root, which the chat resolves (`resolveRunUrl`). An atomically written, hidden capture
list (`@documents/browser/.captures.json`) keeps names, page IDs, and references across browser stop
and server restart; a list from before references named its files relative to the store, and its
entries are read as `@documents/browser/<id>.png`. The evidence names every capture by its address on
the content route of `ragents.documents`. Preparing a run
loads the list again; no browser is started in the process. The service `browserRuntimeToken` provides
the historical capture list separately from current captures and the valid check time.
Damaged capture metadata report an error for the affected run.
The native agent tool `browser_view_screenshot` returns the last image directly as
image content, without a path, read with `bytes.read` where it lies. A model without image support receives an explicit error.

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

A pending action that the target asked itself, such as an open `ask_user` question, holds back
its wakes like a running turn, although the question does not occupy a turn. A held-back check
does not count as an evaluation, so no change is lost: the next journal event after the target is
free again evaluates the accumulated changes without a further change of the source. Usually that
is the end of the turn that processes the answer, or the resolution itself if it brings the
target no input.

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
- The browser zoom is CSS `zoom` on the root element, not the browser's page zoom: media queries keep
  the window width, so breakpoints such as `max-md` switch by window width, container queries by the
  zoomed width.
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
- Read markers belong to a user, not to a person: without sign-in every access shares one read
  state, that of the configured anonymous user or otherwise of the null user, and an access token
  without users does too. Another host of the same user learns of a changed marker through the
  `ragents.runs` channel, at most once per second.


- The running time of a turn compares the server's `startedAt` with the browser's clock; an offset
  between the two shifts it. Rows wrap by the number of cards, not by width: children with wide
  subtrees or an open group make a row wider than the popout, and the canvas then scrolls sideways.
- The recipient graph groups siblings of the same kind only by kind and first handle word;
  actors with a similar task but a different handle start stay individual, and coincidentally
  equal starts fall into a group from four actors on. The creator sets the short description;
  without it the first task is shown there, which without `runs.inspect` only the owner's inputs carry.
- The run panel knows exactly one surface contribution with `RunPanel`; its state is stored per
  browser storage, in VS Code therefore per window. The rail sidebar opens one tool at a time;
  browser tools docked in separate areas can be visible together. A workspace tab with
  `placement: "window"` is a window only in the browser; VS Code keeps it in its rail.
  Start, Runs, run, and app frames load from their server; only connection management and the
  unavailable-server shell are packaged locally.
  A local profile of the extension names its templates only once its host is running; before the
  start nobody knows the templates, because they come into being only with the registered plugins.
  If the extension rebuilds the iframe during a start (for example when switching theme or
  access token), the local pending response is lost; an already created run remains available
  on its server's Start page. The run view
  loads independently of the chat; until it is there, a run whose only content is a mini-app
  can briefly show an empty chat after connecting. Only a surface contribution with `RunPanel`
  shows a loading state in the run; without it the empty chat is shown.
- Hidden `Activity` boundaries pause React effects and retain parent-fed panel props. They do not
  suspend scripts inside an iframe; independent context or state updates can still render a
  hidden React subtree at lower priority.
- The message layer knows no batch requests and no WebSocket; over HTTP every
  JSON-RPC response is an HTTP 200 with `result` or `error`; only transport errors (no JSON, too
  large, foreign connection) carry a different status. Stdio has no sign-in: whoever starts the
  process has all rights.
- The browser check's evidence is the state of the last call: what the page does between two
  calls, such as a late console message or a navigation by itself, the server sees only
  with the next one. A screenshot travels as Base64 in the executor's response and is stored with
  `bytes.write`, so a full-page capture over 16 MiB fails with that limit. The capture list lies in
  `@documents`, where a model can change or delete it; a damaged list is an error of the run.
- `copy` and the content route carry at most 16 MiB and 1000 files per call; bigger files move only
  within one machine through `bash`. A relative address in a document that climbs above its alias,
  such as `../../x` from `@documents/review/`, lands in the run's root, as plain URL semantics say.
- A grant lives ten minutes and covers one root. An HTML document keeps the grant it opened with: an
  image it loads later, such as a lazy one, fails after that until the document opens again, and an
  address that climbs from its root into another fails as well. A message in the chat keeps the
  addresses of its first render: a link clicked more than ten minutes later answers that the grant
  expired, and an address under an alias other than `@documents` stays empty in a message that
  rendered while its grant loaded, until the message renders again. A sign-out does not end a grant;
  a server restart forgets all of them. The server's access log names the grant with the path of
  every such request. Chrome's preload scanner may request an image once against the address of the
  page before the base applies, which answers with an error.
- With an access token, a run shows only once the grants of its root and of `@documents` have
  settled, one round trip more when it first opens, and the Documents view loads the images of an
  open document again with every renewal, every five minutes.
- The panel's own address still carries the long-lived access token in `?access=`, as do the
  addresses of mini-app frames, so access logs of the server and of every proxy before it name it
  with these requests; the referrer policy keeps it out of all others. Removing it from the panel's
  address needs a handshake over the webview's message channel and a page that the `ACCESS_TOKEN`
  gate serves without a token.
- While a run on the server has lost its root, language servers and processes on its server roots
  run at the second executor and stay there until the run stops, also after the root is back.
- With an account switch, a registered root of the server must lie inside the run storage;
  `DOCUMENTS_DIR` and an account switch exclude each other.
- A tunnel to a service of a run is one TCP stream per connection, always through the server:
  every byte crosses the server, and a new connection waits until its stream is open, one call over
  the message layer plus two WebSocket handshakes. A viewer with only a browser gets no tunnel: a
  port on a workstation stays without a link, and only the VS Code extension forwards
  (`docs/concepts/browser-service-tunnel.md`). The tunnel checks only when it opens whether a local
  service answers on the port: a local process that starts listening on `[::1]` with the same port
  number afterwards can answer instead, because the tunnel listens on `127.0.0.1` only. The check
  opens and closes one connection to such a service. Absolute addresses that the service builds from
  its port fit only while the local port keeps the service's number. One scan of the process table answers for two seconds, so a port
  that a foreign process takes over right after the run's process ended can still be reached within
  that time. Only the server notices a silent leg: an extension or workstation whose server vanished
  without closing the connection keeps its local connection until TCP gives up. A reverse proxy in
  front of the server must pass WebSocket upgrades on the tunnel's path, and the legs use no proxy
  setting of VS Code or the environment.
- Two runs on the same folder collide; that is the user's decision.
- `ask_user` ends the asker's turn only when every call of its model step ends the turn: a model
  that calls another tool in the same response, or calls `ask_user` through `typescript_eval`,
  keeps its turn and may go on working before the answer arrives.
- A registered stop for a workstation lives in the server's memory: if the server restarts
  before the workstation signs in again, whatever the run started there stays on the workstation
  until it is stopped again or the workstation signs out, unless the run no longer exists and the
  workstation names one of its background commands at its sign-in, which stops the run there. On
  signing out the executor ends and with it the background commands of `bash`, but processes a run
  detached itself do not; only a stop of this run ends them.
- A workstation tells servers apart only by their address: a server that starts at the address of an
  earlier one with another data folder has none of its runs and, at the next sign-in, stops every
  background command the workstation names, together with its output.
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
  process group of a bash call is ended by the call itself together with it. The bash of a background
  command is such a program: the rail shows the processes it starts, not the bash itself, and the
  stop of the run ends it through its process group.
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
  tools dictate: the browser parent is outside that filesystem sandbox (its renderer uses
  Chromium's sandbox and restricted runs get a separate network policy); on macOS a run reaches Unix sockets under `/tmp` and thus also
  build servers of other processes of the same account (a running `VBCSCompiler` or
  MSBuild nodes of an IDE), and `trustd` fetches revocation lists outside the sandbox, which is a
  side channel onto the network; on Linux all Unix sockets that are visible in the sandbox's
  file system are reachable. Tools that search up to the root for a file and do not treat `EPERM`
  like absence fail on macOS at a blocked ancestor of the workspace,
  such as corepack without `packageManager` in the `package.json`. Node 22 reports
  `EnvHttpProxyAgent is experimental` on stderr at every start. The library is a research preview
  (version 0.0.x). On Linux in a container, bubblewrap needs user namespaces, that is,
  relaxed container profiles (`docs/operations.md`). A service a run starts in the sandbox, also
  as a background command, cannot be opened: on Linux every process start has its own network and
  PID namespace, so the service ends with its command even when detached (a background command keeps
  its namespace as long as it runs), listens only on that command's loopback, shows no port
  in the rail, and is reached by neither a later command, the browser, nor the forwarding; on macOS
  the profile allows no local binding, and `listen` fails with `EPERM`
  (`docs/concepts/sandbox-services.md`).
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
- `bash` in the foreground runs at most 3600 seconds (3600000 ms) per call, and whatever a command
  starts in its process group ends with it. A command that takes longer, such as a cold build of a
  large solution, runs as a background command, whose output arrives through `task_output` only,
  or through a plugin's workflow with its own time limit (`commands.run` with `timeoutMs`).
- A background command has no time limit, unlike in the standard: one that nobody stops runs until
  the stop of its run, also while the run stays idle for days. `task_output` returns at most 20 KB of
  new output per call; what it leaves out of a command that writes faster cannot be read later, and
  no tool names the path of the output file. The ID is random per run and machine
  (24 bits); the server finds the machine of an ID in its memory, so two commands of one run with the
  same ID on two machines would be confused. A workstation counts an end as reported once an
  observation has returned it, even if the answer is lost with a connection that breaks at that
  moment; its actor then gets no notice. A background command on the server ends when the server
  shuts down; only those on workstations outlive a restart and are observed again.
