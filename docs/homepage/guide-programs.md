# Build mini-apps

Expose actor state and functions through interactive React views, start programs on times or file changes, and write programs that wait and continue.

## Programs and mini-apps

An executable actor can own a TypeScript program with functions, journaled state, and React
views. This applies to both TypeScript and LLM actors. Users see these views as mini-apps. A
mini-app displays its actor's state and calls that actor's functions directly; the call requires
no model turn. ActorInputs remain messages to the actor: an LLM actor processes them with its
model, while a TypeScript actor uses its optional `onInput` handler.

The `ragents.actor-programs` plugin owns packages, activation, function binding, and view
hosting. Shared native execution is described in `typescript-platform.md`; actor state and
ActorInputs are covered in `core.md`. Every callable function and view belongs to the same actor
model.

## Packages and actor binding

Programs are private packages in a prepared pnpm workspace for the run. File functions and
language servers access them through `@actors/<name>/`, and `bash` runs in a package with
`cwd: "@actors/<name>"`. A package belongs to a room like an actor: its folder is
`@actors/<room>.<name>/` in a room, and package names in the functions are relative to the
caller's room. `actor_program_create` returns the folder as `directory`, and authoring texts point
to it instead of building the path from the name. The packages stay on the server, and every call
that names the alias runs there, also when the run works in a folder on a workstation. The
workspace interface exposes the actor-program collection directly. Normal relative imports
include local modules, while fixed local dependencies come from the host installation.

```text
@actors/<name>/
  package.json
  tsconfig.json
  tsconfig.client.json
  tsconfig.server.json
  src/contract.ts       backend contract, if needed
  src/server.ts         backend, if needed
  src/client.tsx        view entry point, if needed
  src/styles.css        optional, only for externally generated markup
  tests/program.test.ts
```

`package.json` contains `name`, `private: true`, `type: "module"`, and `ragents` metadata with a
title, optional description, optional backend, optional named views, and optional triggers and
permissions (below, "Triggers" and "Permissions"). Each view has an ID and client entry point; its
title and stylesheet are optional. A view declares no size; the host sizes
its tab. At least one backend or view must exist. The host supplies HTML with a `root` element
for each view. The authoritative schemas are in
`apps/server/src/plugin-support/actor-programs/app-project.ts`; a violation names each path and
its reason, for example `views.0 has unknown field width`.

`actor_program_activate` binds a package to an existing actor with `actor: "self"` or
`actor: "@handle"`. Without an explicit actor, an existing program binding remains. A new
backend creates a TypeScript actor using the program name as its handle in the package's room,
while a new view-only package binds to the calling actor. A static view needs neither a dummy actor nor an artificial
backend function.

Activation rejects a program with an input handler on an LLM actor because that actor's normal
messages remain with the model driver. A package without an input handler can still add functions
and views to it. Functions can also exist without a view. Exactly one actor program is active
per actor; a different package is rejected. Add functions and views to the existing package
instead. Reactivating that package applies its changed state, including removed functions and
views.

## Backend and client

The backend entry point exports `defineActor(contract, implementation)` from `@ragents/server`
as its default export, or `defineProgram(contract, body)` for a program that waits and continues
(below, "State-aware programs"). The TypeBox contract of `defineActor` describes `state`, `functions`, and optional `input`.

State must accept the initial value `{}`. Each function declares its input and output, with
optional granted capabilities, confirmation, and publication as a tool. The implementation
contains the same functions and, when input is declared, an `onInput` handler; a run script can
add `onStart`, which receives its starts instead of `onInput`, `onResult` for the results of scripts
it starts itself, and ends a start with `context.finish` (details in
[TypeScript platform](../spec/typescript-platform.md), Run scripts). TypeScript derives input, result, and
state types from the contract.

Each function receives `(input, context)` and returns only its domain result.
`context.state.replace` stages state changes; a return value is never also interpreted as new
state. `context.actor` identifies the actor that owns the function and state.
`context.functions.<name>(input)` calls declared run functions under the caller's identity.
`onInput` acts as its actor. A function invoked externally retains its actor's state but not that
actor's calling identity: called from a view, it acts as the clicking human. To deliver a message
to another actor in the app actor's name, the function passes it as an ActorInput to its own
actor, whose `onInput` sends it under the actor's identity. Snippets use the same API. `context.std` supplies available standard
functions, including mediators.

An optional `tool` declaration publishes the same function in the typed run API. Without
`targets`, it is available to the active executable actors of the package's room, for a main room
package to every actor; `self` refers to the program owner. Other targets are addresses as the
room of the activating actor writes them; the package keeps that room (`targetRoom` of its
definition), so a reactivation after a contract drift resolves them the same way, whoever triggers
it. A tool name is never one of the host's tools and is unique per receiving actor: two packages
publish the same name only when no actor can receive both, judged by their explicit targets and,
without targets, by their package's room. Equal names in separate rooms therefore stay possible.
Another caller does not receive a private copy of the function or state. Bindings use names and
handles, not IDs copied from output.

React, `createRoot`, and local modules use normal imports. `context` and `useAppState` come from
`@ragents/client`, while controls come from `@ragents/client/ui`. The hook reads shared actor
state; `context.capabilities.call(functionName, input)` invokes a declared function.
`context.actor` identifies the view's actor. Local drafts, selection, and focus stay in React
state. An actor chat can use this handle to show exactly that actor's conversation.

The view runs in a host iframe with restricted browser permissions. Its accessible name comes
from `aria-label`; an empty `title` prevents a browser tooltip over the content. Forms, including
`Form`, may use `onSubmit`; the handler prevents the default action, because a native submission
to a URL stays blocked. In a search interface, a form with a `type="submit"` button lets Enter and
the button share one handler. Test this interaction in the host frame, not only in a standalone
React render.

## Create, edit, and activate

`actor_program_create` creates a package from a template completely or not at all. The host
builds it outside `@actors/` and moves it to `@actors/<name>` only after every step has succeeded,
so a failed attempt leaves nothing behind and the name stays free. An existing folder of that
name, even an empty one, is rejected. The seven templates in `server/templates.ts` and
`controls-template.ts` demonstrate different forms:

- `blank`: a static view on an existing actor.
- `chat`: a chat view for its actor without a custom server function.
- `controls`: a local demonstration of the available UI components.
- `headless-counter`: a TypeScript actor with input handler, functions, and state but no view.
- `text-analysis`: a TypeScript function with a shared counter and React view.
- `shared-list`: the same list function for the view and an agent tool.
- `headless`: an input-only backend with empty state and no functions, views, or example tests.

`actor_program_activate` checks types, builds the backend and views, runs the package tests, and
only then activates the verified version. Errors identify the location to fix.

Published functions appear in the current TypeScript API even during an active LLM turn.
`typescript_api` returns their exact contracts, and snippets call them through
`context.functions`. Reactivation updates the schemas; removed functions disappear from the same
catalog. No additional call contract is needed.

`actor_program_ensure` makes a package active only when it is not: it returns an active package
unchanged, restarts its stopped actor, activates an installed package, or installs a shared
package of the profile ([TypeScript platform](../spec/typescript-platform.md), Run scripts).

`actor_program_list` shows installed programs; each of their views carries a `ref`
(`package-name/view-key`), the reference that view functions accept. `actor_program_remove` removes the binding and its
views. It also stops a TypeScript actor, while an existing LLM actor remains. Activating a package
of the same name again restarts that stopped actor with its state instead of creating another. Sources stay
editable in the private workspace. `actor_view_set_visibility` addresses a view by
`package-name/view-name`, `@handle/view-name`, or unique title. A relative package name means a
package of the caller's room and a relative actor address an actor of the caller's room, wherever
that actor's package lives; with the room prefix both work from every room. Visibility changes
neither functions nor actor state.
A visible view is already open as a tab for the user. A model that has to see what it renders calls
`actor_view_snapshot` from `ragents.browser`, which resolves the address itself ([Browser checks](../spec/plugins.md#browser-checks)).
The host manages hashes and technical bindings.

## Connect workflow definition, instructions, and presentation

`@ragents/workflow` provides a shared TypeScript contract for descriptive workflows. A
`WorkflowDefinition` contains roles, steps, goals, completion sources, degrees of freedom,
prompt references, and transitions. `defineWorkflow` validates it. The canonical contract lives
in `apps/server/src/plugin-support/actor-programs/workflow/index.ts`, from which the installed SDK receives its
type declarations. The module needs neither React nor a server.

Long instructions live in separate Markdown files inside the actor package. A step references
one through `prompt`, and a role can also have a shared prompt. These are relative package paths,
not file contents the model must reproduce.

```ts
import { defineWorkflow, workflowInstructions } from "@ragents/workflow";
import { readPrompt } from "@ragents/workflow/prompts";

const definition = defineWorkflow({
  id: "draft",
  title: "Create draft",
  roles: { writer: { title: "Writer", prompt: "prompts/writer.md" } },
  steps: [{
    id: "write",
    title: "Develop draft",
    role: "writer",
    goal: "Deliver a complete draft for the task.",
    prompt: "prompts/write.md",
    completion: { source: "agent", description: "The writer reports the completed draft." },
    freedom: { mode: "extend", description: "Add relevant research.", allowSkip: true, maxItems: 12 },
  }],
  transitions: [],
});

const prompt = await workflowInstructions(definition, "writer", readPrompt);
```

`readPrompt` is server-only and bound to the installed actor package. It reads files within that
package; missing, empty, or escaping references are errors. `workflowInstructions` combines the
role prompt, instructions for relevant steps, and definition metadata. A `.hbs` file can also be
referenced, but the standard reader loads it as plain text. A plugin resolves required template
values explicitly in its own reader. The assembled text is passed as the normal
`agent_spawn.instructions` and therefore appears in the started actor's journal.

The current `WorkflowState` remains separate. The program derives it from actual data and
service results. `WorkflowDiagram` from `@ragents/client/ui` receives `definition`, `state`, and
`label`; `workflowGraph` returns the same projection as nodes and edges for custom displays. By
default, `WorkflowDiagram` fits its width automatically and lets outer content scroll
vertically. Prompt text is not loaded into diagram cards.

`freedom.mode: "extend"` permits custom items in that step; `allowSkip` applies only to custom
optional items, and a skipped item stores its reason in state. `fixed` marks mandatory steps. An
`expansion` specifies a dynamic source, role, and maximum concurrency. The program supplies the
current groups and items in `state.expansions`; new entries appear without changing the graph.
Normal transitions form an acyclic workflow, while `kind: "return"` marks return paths.
Transition conditions are descriptive text.

The definition neither starts actors nor evaluates conditions. Control programs must enforce
concurrency limits, allowed changes, and completion sources. A status set by a model does not
replace service verification or a user decision. Diagram, instructions, and execution read the
same definition, while the existing actor remains responsible for execution. The learning
afternoon sample in the showcase profile demonstrates this with two parallel LLM contributions followed by
collection. Its definition and prompt files are under
`plugins/ragents.reference/run-scripts/learning-afternoon/`.

## Display diagrams from data

`FlowDiagram` displays graph data with React Flow in the current app theme. ELK arranges nodes
and connections automatically. The mini-app supplies nodes with local IDs and edges between
those IDs; no coordinates or custom diagram language are required.

```tsx
import { FlowDiagram } from "@ragents/client/ui";

const nodes = [
  { id: "request", label: "Request", status: "done" as const },
  { id: "review", label: "Review", status: "active" as const },
  { id: "result", label: "Result", status: "pending" as const },
];
const edges = [
  { source: "request", target: "review" },
  { source: "review", target: "result" },
];

<FlowDiagram nodes={nodes} edges={edges} label="Request, review, and result" />
```

`label` describes the diagram for screen readers. Nodes can include `detail`, `status`, `kind`,
and `items`. Every item has a label, optional details, and its own status, and appears as a list
entry inside the card. By default, the diagram shows a compact overview with titles limited to
two lines and fully wrapping items. Status icons distinguish pending (circle), active, completed
(green check), blocked (exclamation mark), and skipped (minus), while the header also names the
status in text. Chips, headers, and outlines use green for completed, blue for active, and red
for blocked; pending and skipped remain neutral. Color supplements icons and labels without
changing card dimensions.

Cards clip their content at the outer rounded corners while shadows and connections remain
visible outside. Active cards and work indicators animate subtly only with `running=true`; a
missing or false value suppresses animation without changing the reported status. The system's
reduced-motion preference also disables animation. Hovering a title or item reveals complete
labels, status, and details. `detailLevel="full"` instead shows all text and status rows in the
cards. Edges can have labels, and `direction` chooses a rightward or downward layout. Automatic
layout reserves at least 52 layout pixels between adjacent cards and 94 between levels, with
labels allowed to require more. An edge with `kind: "return"` draws a return path outside the
main sequence without changing its temporal layout.

Diagrams start at 80 percent of design size, including type, cards, edges, and spacing; the
center control restores that scale. The diagram pane has no separate background, border, or dot grid,
so the diagram sits directly on the mini-app content. Zooming and panning change only the view.
With `viewport="fit-width"`, the graph fits the container automatically, shrinks further when
needed, and never grows beyond 80 percent. Remaining space is centered. Height follows complete
node and edge bounds and only the outer content scrolls; zoom, pan, and diagram controls are
hidden in this mode. Status changes that do not alter dimensions need no new graph layout.
Invalid IDs or connections appear as errors on the graph. All libraries are bundled locally,
with no external diagram service or mini-app installation. Domain actions remain normal controls
beside the diagram. The controls template and the building-block reference include a locally
switchable status example.

## Triggers

A program with an input handler can declare triggers in `package.json` under `ragents.triggers`.
The host turns each due trigger into an ordinary ActorInput for the program's actor, in a normal
run as in the global space, without a client that has the run open:

```json
"triggers": {
  "interval": { "everySeconds": 300 },
  "daily": { "at": "08:00", "timeZone": "Europe/Berlin" },
  "weekly": { "at": "08:00", "days": ["mon", "wed", "fri"] },
  "fileChange": { "folders": ["/srv/inbox"] },
  "timeoutSeconds": 30
}
```

- `interval.everySeconds` is 60 to 604800. The next occurrence uses fixed delay from the end of the
  previous trigger input.
- `daily.at` and `weekly.at` are local 24-hour `HH:MM` times; `weekly.days` is a nonempty, unique
  list of `mon` to `sun`. Activation resolves an omitted `timeZone` to the server's IANA zone and
  stores it, so moving the server does not change it. A local time skipped by the spring
  daylight-saving change has no occurrence; a repeated autumn time uses only its first occurrence.
- `fileChange.folders` names existing absolute server folders within the program's file
  permissions. The host reuses `watchDirectory` with its 150-millisecond debounce; changes
  coalesce into one pending occurrence while the program is busy.
- `timeoutSeconds`, 1 to 300 and by default 30, limits each trigger input; a running input past it
  is interrupted and ends as `timeout`, without committing its state.

All kinds combine; without automatic kinds a program runs only manually. `actor_program_trigger`
queues one manual occurrence, also while the triggers are paused. Activation plans the next
occurrence, and a reactivation with changed triggers plans anew.

`input.trigger` tells `onInput` why it runs: `reason` (`manual`, `interval`, `daily`, `weekly`, or
`file-change`), `scheduledAt`, `timeZone` (the stored zone for daily and weekly occurrences, the
server's zone otherwise), and `key`, the same for one occurrence, for external idempotency. The host
recognizes the occurrence by the command that queued the input, so other inputs have no `trigger`
and cannot claim one. A state-aware program's own wakes are occurrences of the same kind with the
reason `wake` (below, "State-aware programs").

A program has at most one accepted trigger occurrence, queued or running, so it never overlaps
itself; a run has at most four at once. Next due time, the accepted occurrence, last result,
failures, and pause are journaled per actor as plugin state `ragents.actor-programs.triggers`. A
restart continues without a client: an overdue trigger produces one occurrence and then the next
future time, without a catch-up backlog, and an occurrence that was accepted but not yet queued is
queued once. A failed, interrupted, or timed-out input backs off the next automatic occurrence by 60
seconds, doubling with every further failure up to one hour; a completed input ends the backoff.
`actor_program_pause` pauses the automatic triggers and lets accepted work finish; resuming plans
the next occurrence from now and clears the backoff and a problem, such as a failed folder watch,
that blocked the triggers. Pausing or stopping the run holds them, and removing the program ends
them.

`actor_program_status` returns the triggers, permissions, process protection, progress (status,
last and next run, last result, problem), the committed state, and a recent log of at most 100
lines of 1000 characters. The log comes from the ordinary output and failure events of the actor's
inputs; nothing is stored twice.

## Permissions

Backends and domain tests use the same allowlisted server process environment as snippets,
without server provider keys or profile environment references. With process protection they
cannot inspect the environment or memory of the server or other processes outside their sandbox.
Package isolation additionally narrows file and network access
([TypeScript platform](../spec/typescript-platform.md#build-and-process-lifecycle)).
Without process protection, native Node code runs with the server account's file, process, and
network access; the declared function permissions do not restrict direct Node access.

`ragents.permissions` grants a program bounded external access:

```json
"permissions": {
  "files": { "read": ["/srv/inbox"], "write": ["/srv/reports"] },
  "http": ["api.example.com", "localhost:8080"]
}
```

`files.read` and `files.write` name existing absolute server folders, `http` exact lowercase hosts
with an optional port. The program uses them through the snippet-only functions
`program_file_read`, `program_file_write`, and `program_http_request`, declared in its
capabilities like any function; declaring one without its permission fails activation.
Activation grants only what the activating actor and the run owner can give: a folder needs a
usable, delegable `workspace.use` grant of that actor covering it, the owner's `runs.read` or
`runs.write`, and, unless the owner has `*`, a place within the run's workspace folders. The
definition stores the canonical folders; `actor_program_list` and `actor_program_status` show them.
Folder grants and requested permissions are compared by their real paths, so a grant through a
symlink covers the same folder. File triggers and state-aware file watches observe the canonical
permitted folder while retaining the requested file reference in program state.

Every call checks the permissions of the caller's own active program and the owner's current
rights. File calls recheck the canonical allow list and protect the final path component with
`O_NOFOLLOW`; they reuse the [workspace path protection](../spec/plugins.md#workspace-sandbox-tools-and-processes).
Reads and writes are UTF-8 of at most 250000 bytes, and a write needs an existing parent. HTTP
accepts HTTP(S), rejects URL credentials, redirects, and Host header overrides, and checks the
exact host list: a host without a port permits only the default ports, an explicit port only that
effective port. Bodies have at most 250000 bytes and a request at most 30 seconds.

Run functions such as `overseer_notify` are granted the ordinary way, by declaring them within the
actor's grants.

## State-aware programs

A program that waits for a time, a message, or a file and then continues is one function:
`defineProgram(contract, async (ctx) => { ... })` from `@ragents/server`, the default export of the
backend. The host evaluates the body completely on every wake. Every state-bearing primitive gets
its own slot by its position in the code, so the state is a tree that mirrors the code. It is the
actor state and commits once at the end of an evaluation by the ordinary commit rules. A waiting
primitive ends the evaluation. A wake carries no value: it only causes the next evaluation, in
which the waiting primitive decides from its slot and the world whether it is done. An evaluation
that ends in the same wait writes nothing. `defineActor` programs work unchanged; a package is one
or the other.

The contract names `capabilities`, the run functions its steps call, and `messages`, each with a
`label`, an `input` schema, and optional `description`, `confirmation`, and `tool` as for functions.
The primitives:

- `ctx.useState(initial, name?)` and `ctx.useStateWith(create, name?)` return a cell with `value`
  and `set(value)`; `create` runs only when the cell is created. Values are JSON. A cell keeps its
  first value and every assignment. An evaluation replays them, and one that assigns another value
  than recorded stops (below, "Guards"). A named cell appears with its current value under `values`.
- `await ctx.step(effect)` runs the effect once and stores its JSON result, which later evaluations
  return. Run functions (`ctx.functions`) are called only inside steps. A failed step ends the
  evaluation as `failed` with its position; the progress before it commits, and the host tries the
  step again with the trigger backoff.
- `await ctx.waitUntil(wait)` with `{ at }` (an ISO time), `{ afterMs }` (counted from the evaluation
  that first reached it), `{ daily: "HH:MM", timeZone? }`, or `{ weekly: "HH:MM", days, timeZone? }`
  returns `{ at }`. A daily or weekly wait waits for the first occurrence after it was reached, then
  returns the latest occurrence and wakes the program at every next one; without `timeZone` it
  stores the server's zone. `ctx.forEach([today], (day) => day.at, ...)` thus gives every occurrence
  its own slots.
- `await ctx.receive(name, { timeoutMs? })` waits for the declared message and returns
  `{ kind: "message", value }`, or `{ kind: "timeout" }` once the timeout after its first evaluation
  has passed.
- `await ctx.watch(path)` waits until the SHA-256 of an absolute file within the program's
  `permissions.files.read` differs from its hash when the watch was first reached, and returns
  `{ hash }`, null for a missing file.
- `await ctx.when(condition, body, ctx.elsePreserve | ctx.elseForget)` runs `body` while the
  condition holds; the third argument decides whether the branch's slots survive a false condition
  (`elsePreserve`) or are dropped (`elseForget`).
- `await ctx.forEach(items, key, body)` runs `body` for each item in list order, with the slots of
  its string key; a key that disappears is forgotten.

Evaluation is sequential: every primitive is awaited before the next one starts, and the first
waiting primitive ends the evaluation. A program therefore waits for one thing at a time, while the
daily or weekly waits it passed also wake it. Assignments that a forgotten branch or key made to
cells outside it stay in effect: the dropping `when` or `forEach` keeps the latest one per cell and
applies it whenever an evaluation passes there.

This program prepares a draft every day at 08:00, waits up to 24 hours for an approval, counts the
approvals, and publishes an approved draft. The forEach over the latest day gives each day its own
slots; yesterday's are forgotten while `approvals` keeps counting. The package grants
`files.read` for `/srv/notes` and `files.write` for `/srv/published`:

```ts
import { defineProgram } from "@ragents/server";
import { Type } from "typebox";

export default defineProgram({
  capabilities: ["program_file_read", "program_file_write"],
  messages: {
    approval: { label: "Approve the draft", input: Type.Object({ approved: Type.Boolean() }), tool: { name: "approve_draft" } },
  },
}, async (ctx) => {
  const approvals = ctx.useState(0, "approvals");
  const today = await ctx.waitUntil({ daily: "08:00", timeZone: "Europe/Berlin" });
  await ctx.forEach([today], (day) => day.at, async (day) => {
    const draft = await ctx.step(() => ctx.functions.program_file_read({ path: "/srv/notes/today.md" }));
    const answer = await ctx.receive("approval", { timeoutMs: 24 * 60 * 60 * 1000 });
    await ctx.when(answer.kind === "message" && answer.value.approved, async () => {
      approvals.set(approvals.value + 1);
      await ctx.step(() => ctx.functions.program_file_write({ path: `/srv/published/${day.at.slice(0, 10)}.md`, content: draft }));
    }, ctx.elseForget);
  });
});
```

Every message is a function of the program with the result `{ queued: true }`: a view calls it with
`context.capabilities.call`, an agent through its `tool`. The host accepts it only while a receive of
that name waits and no other message to the program is on its way, and queues it as an ActorInput
to the program's own actor, recognized by the command that queued it as a start is. The evaluation
it causes hands it to the waiting receive; a message that finds no waiting receive by then is
dropped with a runtime line.

The host wakes the program through its triggers ([Triggers](#triggers)): at `wakeAt`, the earliest
of its waiting time, a receive's timeout, the next recurring occurrence, and a retry after a
failure; at once for a revision it has not evaluated yet; and when a watched file changes, which it
recognizes by the file's hash, so that a change elsewhere in the folder writes nothing. Such an
occurrence has the reason `wake` or `file-change`. `ragents.triggers.timeoutSeconds` limits each
evaluation, and pause, backoff, and the run's four occurrences apply as to every trigger. A new
revision plans anew and ends a backoff.

The actor state holds `status` (`waiting`, `done`, `failed`, or `blocked`), `waiting` (position,
kind, message, until, and file), `wakeAt`, `error`, the body's `result` once done, `values`, the slot
tree under `root`, and the revision it was evaluated with. Views and `actor_program_status` read it.

### Guards

At run time every slot records its kind, branch path, and key. An evaluation whose structure
differs from the recorded one stops with "This program cannot be continued", naming the position
and both kinds: another kind or key at a position, a missing or extra slot, or an assignment that
differs from the recorded history. The program is shown blocked with that cause in its state and
its trigger progress. Its recorded state stays as it was, and only a new revision evaluates it
again: the code that recorded the state continues it, a program under a new name starts over.

The type check of every activation, the project check before model requests, and
`actor_program_diagnostics` report these rules like TypeScript errors, as `file:line:column
RAG100x: message` (`apps/server/src/plugin-support/actor-programs/program-guards.ts`):

- RAG1001: a state-bearing primitive outside the top level of the program body or of a `when` or
  `forEach` callback: inside `if`, `switch`, conditional expressions, `&&`, `||`, `??`, loops, `try`,
  or another function or callback, or not awaited.
- RAG1002: `Date.now()`, `new Date()` without argument, `Math.random()`, `crypto.random*`,
  `performance.now()`, timers, `fetch`, values from `node:fs`, `node:net`, `node:http`,
  `node:child_process`, and related modules, or `ctx.functions` in the program body outside a
  `ctx.step` callback.
- RAG1003: a module-level `let` or `var`, or a change of a module-level object, in the files of a
  state-aware program; tests are exempt.
- RAG1004 and RAG1005: in the views of every actor program, the rules of hooks and missing effect
  dependencies (`react-hooks/rules-of-hooks` and `react-hooks/exhaustive-deps`), checked during the
  client build.

`createProgramTest(program, { functions, now, timeZone })` from `@ragents/server/testing` evaluates a
program in a domain test as the host does: `evaluate({ now, message, files })` runs one wake and
returns the outcome with the state.

## State and lifecycle

The backend context reads a snapshot of shared actor state. `context.state.replace` stages
changes. Only successful completion with a valid result and state commits them to the journal;
errors and cancellation discard staged state changes. A state-aware program's evaluation always
ends with a result, also when a step failed, so its slot tree commits with the completed steps;
only an interrupted, cancelled, or crashed evaluation discards it. File operations and calls to other
functions that already ran remain effective. An actor function is not a transaction across
those side effects, so a retry must account for the state already reached.

Changes are stored as compact field and array updates when that uses less space than the full
state. This also applies to mini-app call status changes, so unchanged results and request IDs do
not need to be stored again as a complete state. Browser and agent tool share the actor's same
intrinsic state, while local client input remains separate.

The provider observes changes to installed modules, data, and call state in the run event stream
and reloads the listing selectively, even while chat is idle. Text tokens do not trigger reloads,
and late responses cannot replace newer state. `useAppState()` moves this data through the bridge
into React without remounting the client, preserving local form drafts. Active browser calls also
poll their status until completion.

A failed listing read retries at most three times, after 500, 1500, and 4000 milliseconds.
Connection changes, browser online events, and the visible Retry action start a fresh attempt.
Run and API identities own pending reads and retries; disposal aborts reads, and obsolete
responses cannot change the current listing. Function calls are never automatically retried.

Functions on the same actor execute in order; different actors can work in parallel. Every call
receives an abort signal. The native execution platform owns processes and stop boundaries for
runs and instances. Stopping a run ends active work, while removing an actor program or
activating a new version terminates execution resources from the previous version. After a
server restart, previously pending or active mini-app function calls are marked `cancelled` and
are not retried automatically. Unclaimed ActorInputs behave differently: they remain queued for
an actor that is still executable. A mini-app click and a message to an actor use separate
execution paths. Deleting the run also removes its private app workspace.
Invocation status writes belong to the background task's error handling. A failed write reports
the run, actor, invocation, attempted status, and cause, releases active task tracking, and
preserves the last committed journal state. A journal write failure locks only that run;
unrelated runs and the server remain available. Failure to store an execution result is not
reported as a successfully stored failed execution.
