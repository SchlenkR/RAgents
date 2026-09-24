# Build mini-apps

Expose actor state and functions through interactive React views.

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
`cwd: "@actors/<name>"`. The packages stay on the server, and every call that names the alias runs
there, also when the run works in a folder on a workstation. The
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
title, optional description, optional backend, and optional named views. Each view has an ID and
client entry point; its title and stylesheet are optional. A view declares no size; the host sizes
its tile. At least one backend or view must exist. The host supplies HTML with a `root` element
for each view. The authoritative schemas are in
`apps/server/src/plugin-support/actor-programs/app-project.ts`; a violation names each path and
its reason, for example `views.0 has unknown field width`.

`actor_program_activate` binds a package to an existing actor with `actor: "self"` or
`actor: "@handle"`. Without an explicit actor, an existing program binding remains. A new
backend creates a TypeScript actor using the program name as its handle, while a new view-only
package binds to the calling actor. A static view needs neither a dummy actor nor an artificial
backend function.

Activation rejects a program with an input handler on an LLM actor because that actor's normal
messages remain with the model driver. A package without an input handler can still add functions
and views to it. Functions can also exist without a view. Exactly one actor program is active
per actor; a different package is rejected. Add functions and views to the existing package
instead. Reactivating that package applies its changed state, including removed functions and
views.

## Backend and client

The backend entry point exports `defineActor(contract, implementation)` from `@ragents/server`
as its default export. The TypeBox contract describes `state`, `functions`, and optional `input`.

State must accept the initial value `{}`. Each function declares its input and output, with
optional granted capabilities, confirmation, and publication as a tool. The implementation
contains the same functions and, when input is declared, an `onInput` handler. TypeScript derives
input, result, and state types from the contract.

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
`targets`, it is available to active executable actors; `self` refers to the program owner.
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
name, even an empty one, is rejected. The six templates in `server/templates.ts` and
`controls-template.ts` demonstrate different forms:

- `blank`: a static view on an existing actor.
- `chat`: a chat view for its actor without a custom server function.
- `controls`: a local demonstration of the available UI components.
- `headless-counter`: a TypeScript actor with input handler, functions, and state but no view.
- `text-analysis`: a TypeScript function with a shared counter and React view.
- `shared-list`: the same list function for the view and an agent tool.

`actor_program_activate` checks types, builds the backend and views, runs the package tests, and
only then activates the verified version. Errors identify the location to fix.

Published functions appear in the current TypeScript API even during an active LLM turn.
`typescript_api` returns their exact contracts, and snippets call them through
`context.functions`. Reactivation updates the schemas; removed functions disappear from the same
catalog. No additional call contract is needed.

`actor_program_list` shows installed programs. `actor_program_remove` removes the binding and its
views. It also stops a TypeScript actor, while an existing LLM actor remains. Activating a package
of the same name again restarts that stopped actor with its state instead of creating another. Sources stay
editable in the private workspace. `actor_view_set_visibility` addresses a view by
`package-name/view-name` or unique title. Visibility changes neither functions nor actor state.
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
values explicitly in its own reader. The assembled text is passed as a normal
`agent_spawn.prompt` and therefore appears in the started actor's journal.

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

## State and lifecycle

The backend context reads a snapshot of shared actor state. `context.state.replace` stages
changes. Only successful completion with a valid result and state commits them to the journal;
errors and cancellation discard staged state changes. File operations and calls to other
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

Functions on the same actor execute in order; different actors can work in parallel. Every call
receives an abort signal. The native execution platform owns processes and stop boundaries for
runs and instances. Stopping a run ends active work, while removing an actor program or
activating a new version terminates execution resources from the previous version. After a
server restart, previously pending or active mini-app function calls are marked `cancelled` and
are not retried automatically. Unclaimed ActorInputs behave differently: they remain queued for
an actor that is still executable. A mini-app click and a message to an actor use separate
execution paths. Deleting the run also removes its private app workspace.
