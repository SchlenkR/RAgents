# TypeScript snippets, actor programs, and run scripts

Snippets and actor programs use one shared native Node execution and the same typed API of the
registered run functions. Actor programs use normal TypeScript modules. A program can provide
functions, an input handler, and React views. Whether an actor processes its normal inputs with a
model or with TypeScript is determined by its driver. Callable functions and the intrinsic actor
state are independent of that. The package and author contract is in `actor-programs.md`, the
actor model in `core.md`.

## Execution and context

The server binds `NativeTypeScriptExecutor` to the product-neutral engine. The compiler checks
TypeScript and builds the required modules; the executor loads them into a managed Node process. A
native IPC channel transports calls, results, state changes, and function requests between the
process and the host. Normal relative imports and Node libraries need no additional language
subset or interpreter rules.

The context of a call provides run, actor, call identity, state, declared capabilities, logging,
and an abort signal. `context.actor` is always present: for programs it identifies the owner, for
snippets the acting caller. `context.state.read()` reads the context state,
`context.state.replace(value)` stages the next value. Programs use their actor state; snippets
start with `{}` and discard that state at the end. The function returns its domain result; the
host does not interpret this return value as state. The native child process checks results and
state values as strict JSON before the IPC transfer. Non-finite numbers such as `Infinity` are
rejected as errors and not silently turned into `null` during serialization. For actor programs,
only successful completion commits state changes to the journal. Errors or cancellation discard
the staged changes.

`context.functions.<name>(input)` uses the registered input and result contracts. Snippets receive
the functions available to their caller; programs declare the functions they need under
`capabilities`. The declared selection and the bound identity limit the call. Call names use
underscores, such as `actor_input`; grants appear in the journal with a dot, such as
`actor.input`. A generated type contract grants no additional permissions.

`context.std` is available to snippets and actor programs alike. Clock and identifiers are bound to
the respective execution: for a snippet to its call, for input processing to the actor turn.
`context.std.mediators` provides the available mediators. Context and standard library are passed
as parameters, not as invisible code globals.

## Build and process lifecycle

Programs are private TypeScript packages with normal project files, locally resolved dependencies,
and importable SDK types. The TypeScript language server checks the same files that the build
uses. Before model requests, a runtime contribution checks changed packages and adds a short
difference from the last diagnostics state. The type check always includes the entry point
declared under `package.json.ragents.backend`, even if the author configuration does not cover it
in `tsconfig.include`. Existing tsconfig files are kept; the host explicitly adds the entry point
for the check.

An activated build binds sources, additional modules, generated types, capability contracts, and
the compiler environment. Changes to working files do not activate themselves; the host uses the
checked snapshot until the next successful activation. Hashes and technical bindings remain
server bookkeeping.

The one exception is contract drift. If the server, for example after a rebuild, delivers a
different input or result schema for a declared capability than the one bound at activation, the
host reactivates the package itself on the next call of a function or of the input handler and
only then executes the call; the call waits in the actor's queue until then. A package from a run
script first receives the current sources of the plugin, an own package is built from its working
files. Compatibility is decided solely by the type check against the new contracts, not by a
schema comparison. If the type check, build, domain tests, or state check fail, the call fails
with that cause and the old package stays active. If the sources change in the process, a new
revision is created and open views reload; identical sources keep their revision.

`actor_program_activate` runs the type check, the build, and the existing `node:test` files. This
applies to pure functions, programs with an input handler, and programs with views. There are no
separate actor or script tool contracts for check, test, installation, and mock JSON. The normal
SDK test helper `createTestContext` provides state and explicit typed function mocks under
`functions`; tests check results, state changes, and the calls actually made.

The executor assigns processes to run and instance and owns stops and shutdown. Cancellation also
ends running and waiting execution; a late process response may no longer commit any state.
Removing or replacing a program releases its execution resources. File permissions, UID per run,
and process environment come from the server context of the run
(`SandboxServices.serverProcessContextFor`): for a workspace on the server from its workspace, for
a workstation from a dedicated folder of the run on the server, never from the workstation's
folder. Native execution is not an additional language sandbox against arbitrary backend code.

## TypeScript actors

Actor packages can use `@ragents/workflow` for a shared workflow definition. It provides the same
steps for LLM instructions and mini-app diagrams. The server-side submodule
`@ragents/workflow/prompts` reads referenced prompt files relative to the package in whose
`node_modules` it lives, without a baked-in path. This requires that a backend does not bundle the
module; `compileAppBackend` keeps all packages external. Definition, state, and resolution are
described in
[Actor programs](actor-programs.md#connect-workflow-definition-instructions-and-presentation).
Execution stays with the actor; the workflow contract replaces neither the scheduler nor the
permission check.

A TypeScript actor processes one ActorInput per turn. Its program declares `input` for this and
implements `onInput`. The following simple counter needs no view:

```ts
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ received: Type.Optional(Type.Integer()) }),
  functions: {},
  input: { capabilities: [] },
}, {
  functions: {},
  onInput: (input, context) => {
    const state = context.state.read();
    context.log(input.content);
    context.state.replace({ received: (state.received ?? 0) + 1 });
  },
});
```

A direct task delivers normal text in `input.content`. For a subscription, `input.event`
additionally contains the structured source event; otherwise it is `null`. The source carries
identity, type, timestamp, and payload. A mediator decides by source and event type instead of
guessing technical information from the text.

The actor completes its task and ends the turn. Further inputs or subscriptions start later turns;
a turn does not wait for future model responses. Functions and input processing access the same
journaled actor state. In Inspection, the TypeScript actor remains a participant with its
identifier and its state. An LLM actor keeps using its model for ActorInputs; an additional
program with `onInput` is rejected on it.

<!-- guide:functions -->
## TypeScript as the AI's way of working

The model uses RAgents capabilities by writing TypeScript. The workspace provides callable
functions for tasks such as reading a file or creating an agent. The model combines them into a
program, keeping results in variables, checking conditions, and running independent steps in
parallel.

The same approach supports larger setups. In the word game, code creates the participants and
controls their handoffs while four models supply the words. A mini-app displays progress from
the same program. The AI therefore does not need to derive the workflow again from conversation
instructions after every response.

For one-off work, a snippet is enough: a short TypeScript program for one execution. Its result
returns to the model, which can then decide what to do next. When a program needs to retain state
or react to later messages, it becomes an [actor program](../homepage/guide-programs.html). Both
forms use the same functions.

## One-off snippets

The standard native interface provides `typescript_api` for available functions and
`typescript_eval` for TypeScript code. Workspace plugins can also expose `read`, `write`, `edit`,
and `bash` directly when the actor is allowed to use them. Individual file and shell actions do
not need a TypeScript wrapper. They use the same implementation, working-directory resolution,
permission checks, and journal recording as function calls. Both mechanisms are part of the
server foundation, even without the optional actor-program plugin. Agent creation and other
workflow functions are called from TypeScript through `context.functions`. File functions remain
available there for compound calls. Plugins register each implementation once; snippets and
persistent actor programs use the same API.

Every equipped LLM actor automatically receives the names and short descriptions of all
functions available to it. This applies to coordinators and subagents. Changes update the
overview even during a turn. Direct native tools are marked, and their native descriptions also
include detailed usage guidance. The overview grants neither additional functions nor
permissions; plain LLMs with `tools: []` do not receive it.

### Short descriptions and details

A function registered with `defineRunFunction` has a technical `name` for calls and a readable
`label` for people. `description` briefly explains its purpose and appears in the automatic
overview. An optional `longDescription` adds detailed rules, prerequisites, and examples. Input
and result types come from schemas; descriptions do not replace those contracts. Local recursive
schema references create named TypeScript aliases, keeping nested recursive contracts
fully typed in snippets, actor programs, and the public run API. Resolution includes local
`$defs` references; external references are not loaded.

Without selected names, `typescript_api` returns the compact catalog. `query` searches names and
short descriptions. With `names`, the result includes the entries of those functions in
`RAgentsCapabilityMap` as TypeScript declarations, available long descriptions, and guidance
attached to those exact functions. The declarations of `context` itself (`run`, `actor`, `state`,
`log`, `std` with its mediators) are the same for every function, so `context: true` returns them
once with the general guidance instead of every answer repeating them. A result type made of
journal events lists only the event types the function actually produces. Declarations include each
property's `description` as a comment. A schema shared by several functions appears once as a
named alias. JSON Schemas with validation rules such as lengths and patterns are added to a name
selection only with `schemas: true`. This input asks for the actor-list contract; it is a tool
input, not a snippet:

```json
{"names":["actor_list"]}
```

### Execute code

`typescript_eval` accepts exactly one of `code` or `path`. The source is the body of an async
function with `context`; `return` produces the result. For `path`, the executor of the machine that
holds the file reads it (`files.read`): a path relative to the run root from the machine the run is
bound to, a path under an alias such as `@actors` from the server, also for a connected workspace.
Execution always takes place on the server. Before execution, the shared compiler checks
the code against the current API contract. Native execution uses the same executor, function
resolver, and cancellation path as actor programs. A snippet requires no actor package,
activation, or separate actor. Its variables live for that execution.

Compilation uses a warm pool of up to eight long-lived worker threads; additional requests wait
for a free worker. Each worker loads TypeScript once and caches parsed library and declaration
files by name and content, up to 256 entries with oldest-first eviction. Snippet sources are
always parsed fresh, while the previous program enables structural reuse. Results, diagnostics,
hashes, and emitted code match a cold compilation. The default 60-second limit, configurable by
callers up to 180 seconds, includes queue time. A worker that times out, exits, or receives run
cancellation is terminated and replaced when next needed; its request fails with `TIMEOUT`,
`WORKER_FAILURE`, or `ABORTED`. A compiler error in submitted code does not terminate the worker.
Resource limits apply per worker.

A function with an empty or entirely optional input schema can be called without an argument;
`context.functions.status()` and `context.functions.status({})` are equivalent. An `undefined`
object property is treated like a missing key on both input and result. The compiler does not
enable `exactOptionalPropertyTypes`; the host accepts the value and omits the key from its JSON
result. `undefined` as an array element or the result itself remains an error.

This `typescript_eval` input reads the existing actors and returns the actual response to the
model:

```json
{"code":"const actors = await context.functions.actor_list({}); return actors;"}
```

In a file, the same function body can combine several independent queries. For this example,
load the `actor_list` and `model_list` contracts first:

```ts
const [actors, models] = await Promise.all([
  context.functions.actor_list({}),
  context.functions.model_list({}),
]);
return { actors, models };
```
<!-- /guide:functions -->

### Source record and execution history

Before the type check, `typescript_eval` records the source actually read as `tool.call.source` in
the journal. Through turn and tool call, the event belongs to the normal call flow and, for file
execution, also contains the requested path. For `path`, the state executed at the time is
therefore preserved, even after a later file change; a compile error also keeps its source. If
reading the file already fails, there is no invented source snapshot.

The `Executions` tab of the orchestration plugin shows this history together with status,
duration, result, logs, and error. Older inline calls can show their source from the journaled
input. For old file-based calls without a snapshot, the missing historical source stays visibly
named; the current file does not replace this record.

<!-- guide:functions -->
## State, continuation, and errors

Snippets can read data, combine results, and set up participants, programs, subscriptions, or
views. Actor programs handle later events, persistent state, and mini-apps. The choice follows
the task; a setup does not need a dedicated setup actor. Domain-specific skill templates describe
the desired result rather than prescribing a technical solution. Technical contracts and guides
belong in the discoverable environment.

A snippet acts as its caller. `onInput` acts as the receiving TypeScript actor. An actor function
uses its owner's state but calls run functions under the caller's identity. Accordingly,
`event_subscribe` creates the subscription for the acting caller. For a persistent actor to
subscribe on its own behalf, it makes the call from `onInput`. Calling another actor's function
does not transfer actor identity.

Completed function calls remain effective if a later step fails. A snippet is not a transaction
across its calls. Retries inspect the existing setup and continue missing steps. A snippet does
not wait for future responses; subscriptions deliver them as later ActorInputs.
<!-- /guide:functions -->

## Run scripts as prepared actor programs

A run script offers a prepared, reusable start of a run. A free user task needs no such package.
The global coordinator can start existing or self-created packages through the management methods.
Within an existing run, snippets or actor programs set up the environment through the same
functions API.

A run script is a complete actor program for starting a run. The host installs its setup actor and
delivers a start input to it. A template is created by a folder in the plugin's source
folder; `ragents plugin build` copies it into the bundle (`bundles/<id>/run-scripts/<name>/`), and
this copy is what gets loaded:

```text
plugins/<id>/run-scripts/<name>/
  RUN.md                  title, description, order, optional guide, coordinator, embeddable, shared-programs, fixed-start-options
  package.json            ragents.backend points to the setup entry point
  src/server.ts           defineActor with input, onInput, and optional onStart
  tests/program.test.ts    normal node:test domain tests
  actors/<program-name>/  optional further actor programs, private to this script

plugins/<id>/actors/<name>/  shared actor packages that run scripts of the profile name
```

The folder name is the handle of the setup actor, the template identifier is `<plugin>.<name>`.
`RUN.md` contains metadata and a description of the domain case. The capabilities actually needed
are in the TypeScript contract under `input.capabilities` or on a function. There is no second
capability list in the Markdown file.

The loader reads package files and optional subprograms without following foreign directories.
Missing or invalid package parts are hard errors. Registered run script contracts transport files;
they do not require already generated build IDs. Further TypeScript files are included through
normal relative imports.

`ragents.chat.start { runId, entry, input }` creates the run with the title and the start options.
The host prepares the workspace, takes the bundled programs from `actors/` into the private
collection, and imports the setup package through the same activation path as a program written
during the run. Type check, build, and domain tests run before activation. The start needs no
model call and no separate test evidence for this. The run remembers per package where the host
took it from (`ragents.actor-programs.script`): a template (`{ kind: "script", entryId }`) or a
plugin's shared packages (`{ kind: "shared", pluginId }`), together with the identity of the
sources it installed (`packageIdentity`: the sources without the tsconfig files the host generated
into the package). On contract drift, a package whose build still has that identity is reloaded
from its origin's current sources; a package changed in the run is rebuilt from its own workspace
files. A state of an older shape counts as no origin. The host records the origin before it copies
or imports anything, so no package it installs exists without it; a failed start removes the
record again, and a record left over without actor and folder, whichever template it names, counts
as not installed.

A run script names shared actor packages of the profile in `shared-programs: a, b`. A plugin
provides one as a folder `actors/<name>/` next to `run-scripts/`, a complete package like a bundled
program; the bundle carries the folder. The start copies a missing one into the run and keeps one
only if the host installed it from that plugin and nobody changed it since; any other package under
the name, even one with the same content but no host record, makes the start fail before anything
changes, and the host never takes such a package over or deletes it. Bundled programs under a script's own `actors/` stay private to that script. Script
handles, bundled programs, and shared packages share one namespace per run; the profile's startup
refuses a clash and a shared package no plugin provides.

`actor_program_ensure({ name })` makes a package active once, from a script or an agent with the
program functions: an active package comes back unchanged and is not rebuilt, a stopped actor is
restarted (under the engine's restart rule), an installed package is activated, and a shared
package that is not yet in the run is installed and activated. For a shared name it accepts only
the package the host installed from that plugin and nobody changed since, and otherwise fails
naming the package that occupies the name; for other names it works on whatever package is
installed. The result is `{ actorId, handle, status }` with `active`, `restarted`, `activated`, or
`installed`. Creating, activating, removing, installing a run script, ensuring, and reloading after
a drift take one exclusion per run and package name, so concurrent calls wait for each other instead of
failing; a failed start removes its ownership records only where nobody changed them since. `actor_program_activate` keeps rebuilding and
reactivating. Two scripts that share a package therefore both call ensure, and the run has one
actor for it.

The actor programs service answers `programOf(runId, actorId)`: the active package of the actor,
its revision, and its origin, shared (plugin), script (template), or `run` with the actor that
first activated it. A package whose build no longer has the recorded identity counts as `run`.
Plugins authorize by this identity, never by handle.

A script whose `RUN.md` sets `embeddable: true` also starts inside a run that is already running.
Four ways start one there, all through the same session path: `ragents.chat.start` returns once the
start is accepted and reports errors in the chat; `ragents.runs.startScript` waits and returns the
script actor and which start of its package in the run this was, or the error;
`ragents.runs.scripts` lists the templates the caller may start with `available` and otherwise a
`reason`. The run header's "Run script" button lists them as Start page items, `ragents script <run> [<entry>]` on the
command line, and the run functions `run_script_list` and `run_script_start` offer them to an actor
of the run (below). Without the line, such a start is refused with `run-started` (409). Everything that can
refuse the start is checked before the run changes: every start option the template fixes must
equal the run's stored value (`start-option-fixed`, 409, naming the option and both values); a
bundled program whose folder exists with other sources, and a setup handle held by an actor or
package the template did not install, are errors naming both. Bundled programs are copied only
when missing; an existing folder with the same sources, apart from the generated `tsconfig*.json`,
stays. If the setup package is already installed from the same template, the host neither copies
nor imports it again: it restarts a stopped setup actor, activates a removed package again, and
queues a new start input. A failed start removes the program folders it copied and leaves no actor
behind. Only the start of a new run selects the primary actor and calls the plugins'
`sessionStarted`; a start inside a running run changes neither, nor the transient start status of
the chat. A restart follows the engine's rule, so a former primary actor that is restarted gets its
role back. Starts inside a running run wait for each other and for a new run's start still in
progress, so an actor's start never fails only because another one runs; a second start while a new
run is still being set up is refused with `run-starting` (409).

An embedded start makes all activated visible views available in the shared app catalog without
changing the current selection. App discovery uses actor ownership. The chat
shows the runtime output (`context.log`) of every
TypeScript actor whose package a run script installed, attributed as `@handle: ...`; without
`runs.inspect` it becomes the general processing notice like every system entry.

`run_script_list` and `run_script_start({ entry, input? })` act on the caller's own run and need the
capability `script.start`. The owner holds it like every capability; whoever gets it from the owner
holds it without passing it on (`firstHandCapabilities` in the engine vocabulary). So the coordinator
and the TypeScript actors that the owner installs, such as a run script, can start scripts, while
an agent the coordinator or a script spawns cannot. The functions start as the run's owner: only
templates the owner may start count, and the fixed start options are checked against the run.
`run_script_start` returns `{ handle, count }`; the calling actor is `startedBy`.

During preparation, the run's chat reports a transient start status in the existing status
stream: preparing the run, the working directory, and the interface. New stream connections
receive the current state. After the first input is queued, this status ends; from then on, the
journaled inputs and turns provide the working state. A start error ends the loading indicator
with an error message. Parallel start requests do not overwrite a running preparation. A server
restart does not restore a transient start process.
A stop reports the cancelled start immediately and prevents further setup steps. Preparation that
is already running and cannot be cancelled stays tracked until it completes; during that time, the
start also stays locked. The package activation receives the abort signal.

The setup actor then receives the start value as JSON in `input.content`:
`{ "input": <guide result or null>, "options": { "<option-id>": <value> } }`. The shape of the
guide result belongs to the package; the handler checks it before setting up. A program that also
implements `onStart(start, context)` gets every start there instead of in `onInput`: `start` carries
`input`, `options`, `embedded` (started inside a running run), `startedBy` (the actor ID of the
starter), and `count` (which start of this package in the run it is). The host recognizes a start
by the command that queued its input: it records the start under that command before it queues the
input and consumes the record when the program receives the input. A record whose input is no
longer queued or being processed is dropped at the next write, so the state stays bounded; every
other input, even one with the same text, arrives in `onInput`.

`context.finish(result, { summary?, start? })` in `onStart`, `onInput`, or `onResult` ends a start
with a JSON result; in `onStart` it ends that start, elsewhere `start` names its `count`. The host
checks it before the actor state commits: a start that is not open, because it was finished
already, never reached the program, or is older than the last 50 open starts, fails the turn. It
delivers each result once to `startedBy`: the owner reads the summary in the chat as runtime output
of the script, an LLM gets a short input with summary and compact result, and a TypeScript actor
gets it in `onResult({ handle, count, result, summary? }, context)`, recognized the same way as a
start, otherwise as JSON in `onInput`. Both inputs are background inputs of the owner, so the chat
does not show them as user messages. A function cannot call `finish`; it passes the result to its
own actor as an input. With
`coordinator: true`, the host creates the normal coordinator. With `coordinator: false`, there is
none, and the setup must choose a primary actor through `run_configure`. Its task arrives through
an ActorInput. If the primary actor is an LLM, the user talks to it directly. A TypeScript primary
is operated through its mini-app or documented program functions; its history is not a free chat.

Subprograms are activated with `actor_program_activate` by their own name. The optional actor
reference binds, for example, a list together with its view to an LLM helper that was just
created. A prepared package needs no further create call. The setup actor records completed setup
in its state so that later inputs and repeated starts do not create anything twice. Afterwards it
remains a normal actor of the run.

The neutral references show a discussion round, a moderator as direct chat partner, a collection
board on the real LLM list helper, and a balcony advisor. `word-game` controls twelve
contributions from four LLMs; `learning-afternoon` collects two ideas generated in parallel. Both
bring the mini-app of their TypeScript actor and start the model work only after the start button
in the app. The homepage imports the same view components for its explicitly labeled local
previews. After setup, both programs reject unknown direct messages as errors without changing the
existing program state. Their start commands and subscribed events remain the intended inputs;
another pass needs a new run. Their package tests check configured starts, explicit default
starts, invalid inputs, and the order of setup. The server test `reference-run-scripts.test.ts`
activates the bundled packages against the tools of the `core` profile so that outdated examples
are noticed.

Local packages outside the repo can be started through the shared management methods with a server
file path. They use the same loader and activation path but are not permanently registered as
templates. A `RUN_SCRIPTS_DIR` does not exist.

## Generated developer reference

`docs/homepage/llms.txt` indexes the generated references; they are internal build outputs and
not part of the public homepage export. `run-setup.md` contains the complete sources of the
showcase templates including normal tests and bundled actor programs. `run-api.d.ts` is the actual
`@ragents/server` SDK with the static function contracts of showcase. The installed packages
receive the same declaration generator with their current set of contracts.

The SDK file is a normal TypeScript module with exports. It adds no globals or runtime
permissions. The homepage check compiles the packages it contains and checks both valid and
faulty function calls against these declarations. `rpc-api.md` and `openrpc.json` are generated
separately from the registered method and channel contracts and describe access outside the actor
runtime.

## Open limits

- Domain tests and type checks do not replace an actual check of a view in the browser.
- Intermediate states of a function that is still running are not journaled automatically.
- A failed reactivation after contract drift is retried on every further call; the host does not
  remember the failure.
- Native Node execution uses the permissions and environment of the run's server context and
  guarantees no additional isolation against intentionally malicious backend code.
- A run script keeps at most 50 open starts per package; a result for an older one can no longer be
  delivered. A result whose starter is stopped is reported as runtime output of the script instead.
- A server restart between recording a start and queueing its input leaves a record without input;
  it only costs that start's number, which the next start skips.
