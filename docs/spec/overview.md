# RAgents: overview

The spec describes what is, valid for the current state of the code. It consists of six chapters
under `docs/spec/`:

- `overview.md`: guiding principle, terms, layers, course, and binding rules.
- `core.md`: run, actor, ActorInput, turn, event, subscription, journal, scheduler, stop paths.
- `typescript-platform.md`: the shared TypeScript execution platform, TypeScript actors, and run
  scripts.
- `actor-programs.md`: actor programs with functions, intrinsic state, and React views.
- `plugins.md`: plugin contract, plugin folder, web as plugin host, start page and templates,
  language server plugins, skill templates.
- `profiles.md`: profiles and configuration.

Every chapter ends with its open limits. What does not exist yet is in `docs/concepts/`. The why of
every change is a dated entry in `docs/decisions.md`, usage is in `docs/usage.md`, operations in
`docs/operations.md`. The binding event list exists only in the code
(`packages/ragents/src/domain/events.ts`), as do the plugin contract and actor program schemas
(`packages/ragents/src/plugin-types.ts`, `apps/server/src/plugin-support/actor-programs/app-project.ts`).

<!-- guide:ideas -->
## AI and TypeScript work together

RAgents is a workspace where AI agents, TypeScript programs, and small interfaces work on a
task together. You can describe a task in the chat or start a prepared sample. The AI can set
up the required participants and programs itself; a sample comes with that setup already in
place.

TypeScript is the AI's primary way of working. It writes small programs that call available
functions and combine their results. A function can read a file, create an agent, or deliver a
message. The workspace provides these functions, so the model does not have to reinvent their
implementation.

## Code controls the workflow, models provide the contributions

In the word game, four models provide words one after another. The TypeScript program decides
whose turn is next, passes along the latest result, and ends the round after twelve
contributions. The models choose the words. The workflow therefore remains deterministic even
though its content only emerges while it runs.

For an open-ended task, the AI can also perform several related steps in a short TypeScript
snippet. When the snippet returns its results, the model decides what to do next. Persistent
actor programs are available for workflows that need to react to later responses. The
[TypeScript guide](../homepage/guide-functions.html) explains both forms.

## Actors are the participants in a run

A run brings together a task, its participants, working files, and events. Its participants are
called actors. An LLM actor processes messages with a model; a TypeScript actor uses its
program. A coordinator is itself an LLM actor that can assign work to other participants. A
prepared sample can also operate without a coordinator.

The word game has four LLM actors for the words and one TypeScript actor for the workflow. In
the learning-afternoon sample, two LLM actors work in parallel while the program collects their
ideas. Actors retain their own state between tasks. An LLM actor's conversation history, its
programmed data, and the shared journal each serve a different purpose.

## Messages and events connect the work

A message assigns a task to an actor. The actor processes it in a turn and produces events,
such as a completed response. Other actors can subscribe to matching events. They then receive
a new message and can continue working. In the word game, every completed response invokes the
program again so it can assign the next actor.

The journal records what happens. This makes tasks, responses, and errors traceable. Restoring
the journal does not execute the recorded work again. The
[runtime guide](../homepage/guide-runtime.html) explains how the pieces fit together.

## Mini-apps make the work interactive

An actor can have a small interface: a mini-app on the surface. It displays the actor's data
and calls its functions. In the word game, this interface contains the start button, progress,
and word list. On the collection board, both an AI assistant and a person can add entries to
the same list.

Chat and interface are therefore two ways to access the same work. A mini-app can belong to an
LLM actor or a TypeScript actor. [Build mini-apps](../homepage/guide-programs.html) shows how
functions, state, and interface connect.

## Plugins provide capabilities and reusable setups

A plugin can add file functions, questions, or interface components, for example. A profile
selects the workspace's plugins and settings. A skill tells a model how to approach a
task. A run script, by contrast, provides the programs for a prepared setup.

Run scripts can provide a reusable setup and its interface while model responses remain
variable. Skills and prepared workflows appear as selectable templates when the active profile
provides them.
<!-- /guide:ideas -->

## Product

RAgents is a programmable AI harness with a web interface: chat, agents, and small operating
interfaces on a shared surface. Agents can work with different models; the shipped model
connection runs through OpenRouter. TypeScript actors control fixed workflows; TypeScript and LLM
actors can own their own functions, state, and React views. Plugins extend the working environment
with typed functions, prompts, services, and UI; a profile assembles them. An actor's interfaces
are called mini-apps in the user interface, on the homepage, and in the generated references.
Technically, they are React views of an actor. Skill templates are grouped by a mandatory, freely
named category. The neutral reference puts mini-apps first; tags complement search and filters.

Small TypeScript snippets perform one-off tasks and setup calls without needing an actor of their
own. Snippets and persistent actor programs use the same typed functions of the plugins through
`context.functions`. Equipped models automatically receive the available function names with short
descriptions, load the details through `typescript_api`, and run snippets with `typescript_eval`.
These two tools are part of the server's basic equipment, independent of the optional plugin for
actor programs. Domain tasks describe the desired result; the model works out the technical
implementation from the environment. A prepared setup can be built by a run script. Skills combine
working instructions for agents with optional editable start tasks and supplementary files;
TypeScript can define the setup and later handoffs while model responses stay variable. The product
homepage under `docs/homepage/index.html` is a handwritten static page; the generator does not check
its content and only takes over its header for the guide pages. The entry fills the first screen:
logo, the heading "Tailored AI Workspaces for your teams or your clients", two calls to action (VS
Code Marketplace and GitHub), and stickers that a script distributes evenly around the text; each
sticker jumps to its section. A submenu bar below the header always stays visible, names all
sections, marks the current one, and jumps without scroll animation.

A scroll sequence with six scenes follows: setups, messages between all participants, mini-apps,
tools as TypeScript functions, event-driven workflows, and the distribution across server and
laptop. From a width of 960 pixels, a fixed stage sits on the right; its scene is bound directly to
the scroll progress through GSAP ScrollTrigger (without smoothing and without overshoot) and runs
backwards when scrolling back. The bullet points of the scenes also fade in bound to scrolling. On
narrow views, each scene stays centered in the viewport during its animation. With reduced motion,
all scenes show their end state. The diagrams explain principles with general roles (agent,
script, mini-app, server, laptop) and no concrete example workflows; each scene has its own visual
language.

Static sections without animation follow: teams and clients (self-hosted, shared setups, models
without passing on keys; several people in one run marked as planned), plugins and profiles,
control from outside through CLI and JSON-RPC, web and VS Code with two real screenshots, a list
of the bundled plugins, a call to get started, an alpha notice, the limits, and a footer with a
license notice. The texts are short and direct; usage details are in the guide. Styles and scripts
of the page are in `homepage.css` and `homepage-*.js`; in addition, there are `site.css`,
`site.js`, and the locally bundled `scroll-vendor.js` (GSAP and ScrollTrigger), which
`scripts/homepage/homepage-motion.ts` generates. There are no external runtime resources.

The header with logo, main navigation, and GitHub link stays visible when scrolling. The generator
takes over its markup for the guide pages; `site.css` contains its styles. The internally generated
text versions `reference.md` and `developer.md` form the building block and developer reference;
they are not part of the public export and are not linked from the product page. Their page and
topic introductions explain the respective building block before the technical contracts and code
examples. The generator under `scripts/homepage/` reads neutral tools, schemas, UI contracts,
mini-app templates, and the templates of the start page from the code. Small development examples
explain the extension points; contract coverage and generated files are checked. Reference
generation composes the plugins in isolation with existing public catalog models; network calls
and model calls are blocked during that. Private profiles, configuration values, and runtime data
do not belong on these pages.

`guide.html` opens up nine connected chapters: core ideas, runtime, getting started, the three
access points web, VS Code, and console, distributed work, TypeScript functions, actor programs
and mini-apps, plugins and skills, and access. The chapters exist as `guide-<id>.html` and as
Markdown. Their texts come directly from sections of the spec, `docs/usage.md`, and
`docs/operations.md` explicitly marked with `<!-- guide:<id> -->` and `<!-- /guide:<id> -->`;
several blocks of a chapter are joined in document order, with several source files in their
defined order. There is no second editorial copy. `scripts/homepage/homepage-guide.ts` holds the
chapter order, page introductions, and references and renders the Markdown with Marked at build
time. The browser needs neither a Markdown runtime nor a documentation server for this. Chapter
overview, table of contents, and next/previous links connect the guide and technical references.
The page navigation groups Understand, Try, Build your own, and Look up. On small views, it can be
expanded; compact titles let the content start immediately. The shared main navigation marks the
guide on every chapter page. The product page leads into this in-depth material for installation,
runtime, and development.

Only marked public sections are exported. Missing, empty, nested, or unclosed markers are build
errors, as are private content and invalid local page or anchor targets in the export. Internal
operating details, decisions, and open concepts are not published wholesale. The Markdown chapters
are in the LLM index; all guide files belong to the static export and the embedded help.

The bundled neutral reference templates are demos of RAgents concepts and possible high-level test
cases. They are tagged as use cases and concept demos. The example overview is generated from these
tags and the concept catalog of the reference plugin; the check requires at least two examples per
captured product concept. Customer-specific workflows do not belong in this catalog. Every skill
template contains a prompt and counts as one example. UI controls are not demo concepts of their
own and have no example quota. The demos combine the controls suitable for their use case; complete
control coverage is not a goal. The description of every demo template explains what it is meant
to show and how it differs from similar cases. New product concepts receive at least two different
neutral examples. Use cases and concept demos are two overlapping perspectives; pure operating
procedures are described as such in the reference and not provided as executable templates. The UI
catalog, its type dependencies, and props are generated from the exported contracts of the mini-app
plugin; the prop tables cover the own building blocks, the shadcn components are documented by
shadcn and Base UI. The interactive UI demos show the same components as the mini-apps. Compiler,
runtime lookup tool, and reference use the same file collector; a check reconciles the contracts
with the actual component exports. `llms.txt` opens up this reference for external models. The
same build generates the text versions `reference.md` and `developer.md`, the run setup guide
`run-setup.md`, and `run-api.d.ts` under `docs/homepage/`. Tool and result schemas, context
declarations, and complete example packages come from the code. The published API describes the
static set of showcase; a concrete run build still uses only the capabilities allowed and declared
for its identity.

## Development tools

`scripts/maintenance/concept-audit.fsx` compares the public guide with neutral code and tests. The
external F# developer tool uses Microsoft Agent Framework through OpenRouter. With `--duplicates`,
it instead examines duplicate implementations in interface/CSS, runtime, and plugin boundaries.
This mode also reads product-specific plugin sources; guide and documentation are not part of its
corpus. Findings name at least two source locations read, a concrete consequence, and a shared
replacement. `--reasoning-high` explicitly requests high reasoning intensity from the model. The
last allowed model round is reserved for the report and receives no further tool calls. Three
separate reader roles examine guide, implementation, and limits; a synthesis checks the findings
with read and search access. Only the last model response counts as the result. The synthesis uses
a JSON schema with a justified assessment even for empty findings and reads comparison sources
itself; required fields and evidence against sources actually read are checked. Up to two
corrections run in the same session and within the same call and time limits. Report, responses
per attempt, and actual read coverage are stored in a new output folder outside the repository.
Evidence may span several excerpts read without gaps. `--resume` continues only the synthesis with
stored reviewer reports if source state, focus, and mode are unchanged; the new pass receives its
own budget and a new output folder. The check changes no sources and does not claim complete
coverage. A dry run checks parameters and corpus without a model call. The console makes roles,
phases, source access, model calls, and waiting times visible with timestamps; the conclusion names
duration and result folder. The tool is not a plugin and runs no run snippets or actor programs.
Invocation and limits are in `docs/development.md`.

All UI drafts are under `docs/ui-drafts/`. The existing page `docs/ui-drafts/index.html` collects
the draft pages as separate tabs, including older drafts. Each variant has its own preview card in
the grid; only the top tab bar groups variants into collections. Preview cards and existing direct
links open the chosen variant directly in the associated collection. Missing older pages are added
later. Tabs and overview cards are sorted by original draft date descending, newest drafts first.
Variants take the date of their collection; adding them later does not change it. For the same
date, the order of the entries in the HTML file applies. The card grid fills the available width
without horizontal scrolling and arranges the collections row by row from the top left. When the
overview opens, the grid starts at the top and the tab bar at the left; the browser does not
restore an old scroll position. Every HTML draft has one or two PNG previews next to the file and
needs no build. The layered depth body draft combines stepped boxes with switchable soft contact
shadows from WebGL. The controls stay operable HTML elements; shadow strength, elevation, and
recess can be compared locally. Missing WebGL is reported visibly. Extent, offset, and opacity of
the contact shadows follow the shorter control edge: small checkboxes and narrow progress bars get
tighter, weaker shadows, larger fields keep the full effect. The global strength slider multiplies
this size grading; scaling the whole scene does not change its proportions. The box fronts use
fixed matte colors; there is no mouse-dependent lighting. The productive design of the surface
takes over the matte colors and straight outlines of this material direction, but no depth; the
details are described in `plugins.md`. The offline draft stays in the existing overview as a
separate comparison and is not a recording of a real run.


Under `build/` there are three executable scripts: `build.sh` builds the agent runtime, built-in
plugins, web, and homepage, `check.sh` runs the complete project check, `homepage.sh` generates the
homepage, guide, and the internal references. With `--open`, it opens the main page in the default
browser on macOS after a successful build; `--check` checks reference types, examples, freshness,
and export. The homepage build generates a standalone, statically hostable website with relative
page and asset links under `docs/homepage/dist/`. Links to repository files point to GitHub in the
export. Only public page files and screenshots actually used are taken over. Every web build
regenerates this export and ships it under `apps/web/dist/help/`. The homepage check runs in the
complete check before the web build, so that its regeneration does not hide outdated references;
the checks of the package run afterwards because the package carries the built web. The reference
composes the `showcase` profile from the built-in bundles and requires that they match their
sources. All scripts change to the repository root and abort at the first error.
`.vscode/tasks.json` offers three tasks for this: `RAgents: build` (default), `RAgents: check`, and
`RAgents: open homepage`. The tasks contain only script calls. Existing pnpm commands for partial
builds and single checks stay available without additional wrapper scripts. Usage is described in
`docs/development.md`.

## Guiding principle

> RAgents is an event-based multi-agent runtime of runs, actors, ActorInputs, turns, and subscriptions. The model runtime and product environment remain interchangeable contributions.

The agent runtime is the complete standard runtime of the current product. RAgents does not rebuild
the agent loop of the agent runtime, provider connection, and compaction; the agent driver sits
directly on the loop and keeps the model context in the journal. The core nevertheless binds model
runtimes only through a driver contract: the agent driver receives ActorInput and event boundaries
through this contract; a TypeScript actor uses the TypeScript driver instead. Further model
runtimes would be new drivers against the same contract.

RAgents owns the shared world of actors, inputs, turns, events, subscriptions, artifacts, and
journal. A model does not need to know this world. With an empty tool selection, it sees only its
normal system prompt and the text of its current input.

Domain logic and external integrations are not part of the neutral core. They are added through a
profile and its plugins. Another product should be able to use the same core without these plugins
and their tabs.

## Terms

| Term                 | Meaning                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent runtime        | Runtime of a single agent: model, agent loop on the model context from the journal, tool calls, skills, compaction, providers, and hooks.                                                  |
| RAgents Core         | Product-neutral multi-agent core: runs, actors, ActorInputs, turns, events, subscriptions, journal, scheduler, artifacts, and plugin host.                                                 |
| Plugin               | A vertical product capability. It can deliver server services, hooks, tools, skills, prompt parts, methods, UI contributions, data, and lifecycle together.                                |
| Hook                 | An intervention in model and tool calls of ONE agent: before every model call (`beforeModelCall`) and after every tool call (`afterToolCall`). A hook registers no tools.                  |
| Skill                | Working instructions for the model with an optional start task and supplementary files. A skill is neither a plugin nor an executable actor.                                                |
| Actor                | A participant in the run: the human owner, an agent with a model, or a TypeScript actor from TypeScript. Only executable actors have inputs, turns, and a lifecycle.                       |
| ActorInput           | A task of text, optional artifacts, and optional event origin for exactly one actor. An input is claimed by at most one turn.                                                              |
| Turn                 | One execution of an actor, started with exactly one ActorInput. Inputs to an agent with a running turn are fed in by it before its next model request (steering).                          |
| Event                | Immutable fact in journal v4, for example model text, reasoning, tool call, turn completion, action, or artifact.                                                                           |
| Subscription         | Structured filter of an actor on new observable events. Every match creates a new ActorInput for the subscriber.                                                                           |
| Primary actor        | The explicitly chosen actor whose model text the product treats as the visible chat. This role is independent of the creator lineage.                                                      |
| TypeScript actor     | An actor whose turn runs deterministic TypeScript instead of a model. It has no model context but uses the same registered services and tools.                                              |
| Actor program        | A private TypeScript package that provides an actor with functions, input processing, and optional React views; a type-checked TypeScript build with native Node execution on the shared RAgents execution platform. |
| Actor state          | Intrinsic journaled data of an actor, shared by its functions, input processing, and views.                                                                                                |
| Mini-app             | A React interface of its actor. It shows the actor's state and calls functions without an additional model turn.                                                                           |
| Tool card            | An input generated by the host from the typed tool contract, directly on the target agent, without an additional window frame. It contains no app code of its own.                        |
| App host             | A tile of the surface with a local full view for the user. Both load the same complete mini-app.                                                                                           |
| Component            | A reusable building block without an installation or product lifecycle, for example the chat building blocks of the quassel library.                                                     |
| Profile              | The explicit, ordered composition of core and plugins into a product, for example `core`.                                                                                                  |

PLUGIN therefore means neither tool nor hook. Both are possible facets of a plugin. An integration
plugin, for example, bundles client, projection, methods, agent and logic tools, prompt rules, web
tab, and deletion lifecycle.

## Glossary

One term per thing, in docs, interface, guide, and code. The right column names what is no longer
used for it. Code terms appear in names, methods, and contracts.

| Thing | Docs, interface, and guide | Code | no longer used |
| --- | --- | --- | --- |
| a piece of work with exactly one journal | run | `runId`, `ragents.runs.*` | conversation, session (for the run) |
| freely arranged tiles of the actors and mini-apps of a run | surface | `surface` | canvas, work surface, tile surface |
| an element of the surface | tile | `tile` | tile for entries of the start page |
| the one mini-app shown large in the run panel | stage | `stage` | surface for this mini-app |
| entry of the start page, of kind skill or script | template | `StartEntry` | entry, start template, skill entry, start card, tile |
| copy of a run up to a point in time (concept) | run fork | `forkRun` | run template |
| files and executor of a run | workspace | `workspace` | working folder, workspace for panels |
| signed-in machine or VS Code window | workstation | `WorkspaceClient` | workspace for the machine |
| tab bar next to chat and stage | tab bar | `workspaceTabs` | right workspace, right panel |
| entry of the VS Code extension for a RAgents server | server | `Connection` | environment, target |
| chat of a user across all of their runs | global coordinator | plugin `ragents.overseer` | parent coordinator, overseer |
| file `ragents.config.<name>.ts` | profile | `PRODUCT_PROFILE` | application profile, product profile |
| model default `coordinator`, `standard`, `relay` | role | `profile` in `model_list` and journal | agent profile, coordinator profile, role profile |
| extension unit of RAgents | plugin | `plugin` | extension |
| add-on to VS Code | extension | `apps/vscode` | plugin |
| intervention in model and tool calls of an agent | hook | `agentRuntime` | agent extension |
| private TypeScript package of an actor | actor program | `actorProgram` | run program, run module, program package |

Two names stay in the code although the docs speak differently: the role is still called `profile`
in the journal, catalog, and `model_list`, because journals carry it that way and there are no
migrations; the plugin contract still calls a run `Session` in type names (`SessionContext`,
`sessionMetadata`, `storage.session`), the message layer no longer does.

## Architecture

```text
Profile, for example core
  |
  +-- ordered list of plugins (18 in core)
  |
  +-- RAgents Core
  |     +-- run, journal, actors, inputs, turns, events, subscriptions, and artifacts
  |     +-- scheduler and logic runtime
  |     +-- PluginHost and message layer (JSON-RPC)
  |
  +-- AgentLoopDriver
  |     +-- one AgentTurn per turn directly on the agent loop
  |     +-- model context as a projection of the journal
  |     +-- ragents-skill-preload per turn
  |     +-- hooks and skills of the plugins
  |
  +-- product and workspace contracts
  |     +-- ProductRuntime: coordinator, display, profile, and role contract
  |     +-- WorkspaceRuntime: static or run-bound workspace
  |
  +-- web plugin host
  |     +-- generic shell of chat and tab bar
  |     +-- slots for tabs, presenters, run metadata, providers, and surface
  |
  +-- installed plugins
        +-- orchestration         +-- workspace
        +-- product core          +-- documents
        +-- global coordinator    +-- browser
        +-- activity              +-- processes
        +-- questions             +-- to-do
        +-- watch                 +-- transcript
        +-- model relay           +-- actor programs and views
        +-- profile distribution
        +-- language servers: Roslyn, FSAC, TypeScript
```

The responsibilities are clearly separated:

- The agent runtime owns the provider dialog, the inner agent loop, tool calling, skills,
  compaction, and provider-level retries; it reads and writes the model context in the journal.
- RAgents owns the multi-agent state, ActorInputs, event delivery, orchestration, long-lived
  TypeScript actors, and the shared journal.
- Plugins own domain logic and integrations. The core knows no domain.
- The chat building blocks deliver UI. They do not decide which plugins are installed.

The journal is the canonical shared world of the run and at the same time the conversation of every
model: it holds losslessly what a model has seen, and the model context is a projection of it
(`core.md`, Model context and agent runtime). There is no second, private copy.

## Course

Three principles apply everywhere; their dated rationales are in `docs/decisions.md` (2026-08-27
and 2026-09-01):

- Consolidate instead of expanding. Removals are always carried through completely, no leftover
  legacy paths. No redundancy: the same logic exists exactly once. Generalizations only once there
  are at least two real users. The mini-app and TypeScript platform is in place; it will not be
  expanded further until the first real domain case runs on it.
- Security currently has low priority. Sandbox hardening and conceptual permissions (capabilities,
  grants, delegation) are not an investment goal as long as the product does not call for them.
  The hard boundaries remain file permissions and the operating system UID per run.
- No migrations, no legacy path compatibility. There is no migration extension point; the profile
  data under `~/.local/share/ragents/<profile>` counts as disposable development data. Old or
  corrupted journals are isolated with their cause; the server and other runs stay usable. Original
  files are preserved, and the affected run ID is not reused as a new run.

## Binding rules

1. REMOVAL TEST: Without a plugin, its routes, tools, skills, prompt parts, tabs, configuration,
   and background services disappear together.
2. EXTENSION TEST: A new plugin requires no new domain branch in chat, panel, engine, or server
   start. Only the implementation and profile are added.
3. ONE TRUTH: A domain operation has exactly one implementation. Different facets call the same
   service or command handler.
4. LIFECYCLE: Every background process belongs to a plugin and has start, run, stop, and shutdown
   boundaries.
5. NAMESPACE: Configuration, persisted data, routes, and contributions carry the plugin identifier.
6. ONE COMPOSITION: Prompt, skills, profiles, hooks, logic tools, server, and web follow the same
   plugin list.
7. NO HIDDEN ACTIVITY: Plugins that are not installed start nothing. Inactive views do not poll
   without an explicitly declared background function.
8. ONE EXECUTION PLATFORM: All run-local logic uses the same TypeScript compiler, `RunContext`,
   function contract, type check, and managed native execution. One-off snippets need no persistent
   actor program. Domain tests are normal TypeScript test files in the actor package.

Six rules apply to contracts and types, across all chapters:

- INPUT SCHEMAS FOR MODELS ARE FLAT: a model-facing input schema is ONE flat `Type.Object`, the
  discriminator is a string enum, correlated fields are optional, and the server checks the
  correlation directly after validation with a named error that names both valid forms; the rule
  is also in the description of the correlated field. `profile-composition.test.ts` checks all
  tools of all profiles for `type: "object"` without `anyOf` or `oneOf` at the root.
- ILLEGAL STATES ARE UNREPRESENTABLE: what belongs together is internally in a discriminated union,
  not in independent nullable fields with runtime guards. Validators are exactly as strict as the
  domain types; invalid journals lock only their own run when loading and report the cause. They
  must not terminate the server.
- MODELS DO NOT RETYPE ANYTHING: no tool contract requires a model to reproduce source code, hashes,
  tokens, IDs, paths, or evidence from earlier outputs. References use program names, view
  identifiers, and actor handles; the server keeps the hashes. Results do not repeat inputs.
- REJECTIONS NAME VALID NAMES: an error message to a model names the allowed values or names instead
  of merely failing.
- SCHEMA VIOLATIONS NAME PATH AND REASON: every check against a TypeBox schema reports every
  violated path with its reason (missing required field, unknown field, allowed values, otherwise
  the violated rule including the received value), never only the first message or a generic text.
  Engine, host, plugins, and the test SDK of the actor programs use `schemaComplaints` for this
  (`packages/ragents/src/domain/schema-errors.ts`); the prefix names what was checked, for example
  `package.json.ragents is invalid: views.0 has unknown field width`. Only the argument check of the
  agent runtime formats the same information itself (`core.md`).
- CONTRACTS CHANGE IN ONE DIRECTION: an activated actor package is bound to the schemas of its
  capabilities. Compatible is what does not break the old caller: an input may accept more (new
  fields only optional, no field removed or made required, no narrower type), a result may not
  promise less (no field removed or made optional, no wider type, no new enum variant; new fields
  are harmless). The measure is the set of values, not the number of fields: more fields are the
  narrower type for a result and the wider type for an input. For closed input objects, a removed
  field is also a break, and a package that passes a capability result through as its own result
  breaks at every new field if it closes its result schema. A break is allowed: the host
  reactivates bound packages on the next call and only code that does not satisfy the new contract
  fails (typescript-platform.md). It is to be avoided in capabilities used by packages written by
  agents, because nobody updates the sources there.

For every extension, the control question applies:

> Is this a general responsibility of the agent runtime or of RAgents, a reusable component, a
> run-local actor program, or an installable plugin capability?

Without a clear answer, the change does not belong in the core.

## Open limits

The open limits are at the end of the respective chapter per topic.
