# Actor programs: functions, state, and views

<!-- guide:programs -->
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

<!-- /guide:programs -->

<!-- guide:programs -->
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
title, optional description, optional backend, and optional named views. Each view has an ID and
client entry point; its title and stylesheet are optional. A view declares no size; the host sizes
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
<!-- /guide:programs -->

### File permissions of actor programs

For runs with their own UID, the host reconciles the owner and write permissions of the private
source, SDK, and build files within the run's storage boundary. Library symlinks stay unchanged.
The model does not have to copy any printed storage paths. The reconciliation covers the whole
workspace of the actor programs including the staging of new packages (below, "Templates and
creation"); renaming preserves owner and permissions. Entries that disappear during the
reconciliation, such as a package that was just renamed, are skipped.

<!-- guide:programs -->
## Backend and client

The backend entry point exports `defineActor(contract, implementation)` from `@ragents/server`
as its default export. The TypeBox contract describes `state`, `functions`, and optional `input`.

State must accept the initial value `{}`. Each function declares its input and output, with
optional granted capabilities, confirmation, and publication as a tool. The implementation
contains the same functions and, when input is declared, an `onInput` handler; a run script can
add `onStart`, which receives its starts instead of `onInput`, `onResult` for the results of scripts
it starts itself, and ends a start with `context.finish` (details in
[TypeScript platform](typescript-platform.md), Run scripts). TypeScript derives input, result, and
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
<!-- /guide:programs -->

### Contract query of the backend adapter

For the contract query, the generated backend adapter explicitly returns JSON data without TypeBox
metadata. This description is separate from the strict JSON check of domain results and state
values before the transfer from the native process.

<!-- guide:programs -->
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

`actor_program_ensure` makes a package active only when it is not: it returns an active package
unchanged, restarts its stopped actor, activates an installed package, or installs a shared
package of the profile ([TypeScript platform](typescript-platform.md), Run scripts).

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
`actor_view_snapshot` from `ragents.browser`, which resolves the address itself ([Browser checks](plugins.md#browser-checks)).
The host manages hashes and technical bindings.
<!-- /guide:programs -->

### Templates and creation

The `ragents` metadata of each template is a value of type `AppPackage` (`Static` of
`appPackageSchema`), which the compiler checks against the authoritative schema; a template cannot
bring `package.json` as text. On creation, `templateFiles` generates the `package.json` with the
chosen name from it and supplies the same files for the generated reference.
`apps/server/tests/actor-program-create.test.ts` creates every template and activates it with type
check, build, and its tests, so that its source code does not silently become outdated against the
platform either.

Creation is all or nothing, for `actor_program_create` as for the package of a run script
(`importPackage`). The host builds the package in `actor-workspace/.staging/<name>-<uuid>`, on the
same file system as `actors/`, but outside the pnpm workspace and the `@actors` alias. All steps
run there (files, SDK, package check, backend contract, client SDK), and only then does it rename
the folder to `actors/<name>`. Check and rename follow each other without interruption because
`rename` would silently replace an empty target folder: an existing folder, even an empty one,
makes creation fail with "already exists" and stays untouched. Two simultaneous creations of the
same name exclude each other; the second waits and then fails with "already exists". On any error, the host
removes the staging folder. Leftovers of a crashed server process are cleaned up by the next
creation in the run, which leaves the running creations of this process alone; a run is served
only by the process that holds the journal. The host activates the package of a run script after
renaming; if activation fails, it removes it again.

No generated package knows its own folder. `@ragents/workflow/prompts` finds its package through
its own module address (`import.meta.url`, three levels above `node_modules/@ragents/workflow`),
all other absolute references point to libraries of the host. A package thus stays valid after
renaming and as a copy in the build folder of the activation.

### Diagnostics, type check, and domain tests

Before every model request, a runtime contribution checks changed actor programs including types
and build. The context receives only a short difference from the last error state; unchanged
projects and error lists are not repeated. The check reads a package in its own context, not in
the room of the agent that receives the diagnostics: an active package with its actor and the
room its targets were resolved from, a package nobody activated yet from its own room. A kept
result counts only for the same sources and the same context; an activation checks the package
again. `actor_program_diagnostics` returns the last complete state, optionally for one program
name. The normal language server tools can check the same
projects directly.

The type check always covers the backend entry point from `package.json.ragents.backend`, even with
a narrower file selection in the preserved author tsconfig. If the type check or client build fails
during activation, the message names the number of errors and the first ten as one line each
`file:line:column message`, at most 240 characters, plus "and N more"; `actor_program_diagnostics`
knows the complete list (`checkFailure` in `plugins/ragents.actor-programs/server/runtime.ts`).
There is no separate check, test, or installation contract for actor programs and no build
reference passed on by the model. Edited sources change a running installation only after another
successful activation.

Domain tests are normal `node:test` files under `tests/**/*.test.ts` and run with
`node --import tsx --test`. They import the program and call `program.functions` or
`program.onInput` with concrete inputs. `@ragents/server/testing` provides `createTestContext` with
state and explicit function mocks under `functions`; what `context.finish` received is in `finished`.
Result and stored state are checked separately. A pure view needs no invented server action. Activation runs the tests with its own
reporter (`server/test-report.ts`) and reports a failure concisely: number of passed and failed
tests, for each failed test its name, message, for assertions expected and actual, and the
location in the test file relative to the program; a test file that does not load names the error
line of its output. Durations, Node-internal stack lines, and absolute paths are left out.

## Tool cards and mini-app tabs

`card: true` generates a compact form above the selected actor's chat from its typed function
parameters. Required fields and invalid inputs are checked before calling the function. No model
turn is needed. Technical function inspection still requires `runs.inspect`.

Every activated, visible mini-app enters the shared catalog. The browser shows Chat and app tabs
with one visible view. Apps mount lazily and visited views stay mounted while hidden, retaining
local inputs. New apps never steal focus; an unavailable selection returns to Chat. VS Code
opens or focuses one editor per server, run, and app. Each app has one mounted client in its host.

The frame uses its actual dimensions at 100 percent. Host confirmations remain above the frame;
status and errors occupy a reserved row below it. The existing frame bridge and event hub carry
state and function results. Questions and news remain in chat, without app-tab notifications.

Visibility is journaled. Hiding preserves installation, functions, actions, and state. Showing
again, restart, and reactivation preserve this choice. Actor inspection stays independently
reachable through the addressee's inspection action.

## Capabilities and identity

Actor functions call run functions through `context.functions.<name>(input)`. Snippets use the same
registered functions. A snippet acts as the caller, `onInput` as its actor; a published function
uses owner state and caller identity. An `event_subscribe` applies to the acting identity. The
declared capability list and the bound identity determine the available set. Client calls, in
contrast, use only the function names declared in the actor contract. The browser cannot choose
another run, an identity, or a free host capability. The methods for mini-apps and direct actor
functions accept the same function names including capital letters, such as `addEntry`. The
browser queries running mini-app calls through their app route; `runs.read` is enough for that.
The technical query of direct actor functions stays protected by `runs.inspect`. Call displays use
action labels. Without a label, restricted access shows only the call status; technical action
identifiers are reserved for full access.

The plugin host registers domain operations with input and result schema and operator policy.
`direct` allows the operator action, `confirm` requires a confirmed journal question, and
`unavailable` excludes use as a view function call. The typed adapters check identity, contract,
and cancellation at the actual call boundary. Native Node execution is not an additional sandbox
against arbitrary backend code; file permissions and execution environment belong to the run
workspace.

## App host and functions tab

Views belong to their program actor through `actorId`; their persisted definitions and API listings
carry no host placement metadata. Journals with the removed placement field or layout capabilities
lock only the affected run before replay, without changing its files.

The shared app host renders the selected mini-app through `RunAppView`.

The functions tab shows programs, owner
actors, functions, and installed sources. It identifies a function by its package and function ID,
not by the tool name, which packages of separate rooms can share. The detail view of a function
contains a generic parameter form derived from its contract. It uses the same form building block as the tool cards:
texts, numbers, integers, checkboxes, and lists, plus JSON for structured values. Required fields
and invalid inputs are checked before the call. Functions without parameters can also be executed
directly. The call runs without a model turn through the same host as for mini-apps and tool
cards; declared confirmations remain required. Running call, return value, and errors appear
directly in the detail panel. Description, parameter contract, and source code stay reachable. The
actor detail view offers its own source tab for installed programs, including headless actors.
Only opening it loads the files of the activated build through the existing source code endpoint.
`src/server.ts`, otherwise a TypeScript file, is preselected. File selection and syntax
highlighting come from the shared source code viewer. A new program revision loads the current
sources; cancelled earlier responses do not overwrite them. The source code stays read-only and
requires `runs.inspect`. Running tool calls appear in the general activity display.

Browser tabs and VS Code editors use the same frame endpoint and build. A view's identifier is
`<package key>--<view key>`, in a room `<room>.<package>--<view>`, at most 195 characters
(`ACTOR_VIEW_ID_MAX_LENGTH` in the contract); the RPC contracts, the web listing, and the frame
route take exactly that length. The browser dock keeps a view's area under its identifier without
the start count of its room (`layoutKey`; `review-2.board--main` becomes `review.board--main`), so
the view of a later start of the same run script takes over the area of an earlier one; while
both are shown, the later one gets a numbered place of its own (`spec/plugins.md`, `run-apps.ts`). Each app has an iframe with
`sandbox="allow-scripts allow-forms allow-downloads"` and a content security policy;
`form-action 'none'` prevents any real form submission. The browser client is bundled including
its imports; React and UI building blocks come from the prepared local dependencies. The host
receives no later-loaded app code as a plugin.

The strip below an app reports only what needs attention: a failed or cancelled action, a pending
confirmation, a disconnected frame, or a bridge that is not connected yet. It takes its own row. A
running action ("Starting action", "Action running") never changes the size of the app: after
400 ms it appears as a chip floating over the lower right corner of the app, ignores the pointer,
and disappears when the action ends, so an app's own background calls stay invisible unless one
takes longer.

## Reusable UI building blocks

The host exports reusable controls under `@ragents/client/ui` (sources under
`apps/web/src/actor-programs/client-ui/`). Standard actions use these controls; text fields and
textareas are `Input` and `Textarea` of the same library. The author guide requires not rebuilding
control colors, borders, type, and states in app CSS. A program's utility classes are compiled once
per program at activation across the host sources, the building blocks, and all view sources and
stored as `frame.css` in the program's build folder (`stylesFile` of the program definition); the
stylesheets for externally generated markup (code highlighting, diff, flow diagram) are loaded by
the host on every frame call. A central change to tokens or building blocks reaches installed
programs only with another activation. Chat, Markdown, code highlighting, selection, and
`ListDetail` use existing interface building blocks; further controls belong directly in this
building block collection with implementation, styling, and type contracts. The client imports the
controls it needs from this package; the regular build bundles them with the app. The props are
type-checked during the TypeScript check of the mini-app. The building blocks work in the browser and
in the VS Code editor.

The UI contract collector produces the same component names and declaration files in a checkout
and in an installed npm package. Its TypeScript compiler host presents the package through a
virtual source root outside `node_modules`, resolving dependencies from the physical package. Local
references in the resulting declarations must stay inside the host's public sources and may not
enter its `node_modules`; external package imports remain package imports.
The mapping uses forward slashes and normalized drive letters on every platform, converting to
native paths only for filesystem access. Package roots are resolved through symlinks before
collecting or selecting declarations, including packages linked into a pnpm store.
Workflow SDK generation resolves its Node type definitions from the installed dependency instead
of assuming the checkout's server-local `node_modules` layout.

`SvgEdge` provides SVG connections with uniform arrows, lines, and semantic colors. Open arrowheads
with rounded ends follow the path tangent and end exactly at the connection point. The building
block manages unique arrow markers and respects reduced motion. Mini-apps import it through
`@ragents/client/ui`; the host uses the same implementation. Path geometry, nodes, and domain state
still belong to the respective display. The author guide shows a compact SVG template with labeled
nodes, a responsive drawing area, and shared color tokens. The controls template and the generated
building block reference contain a usable example. No automatic graph layout or general node model
comes with it.

<!-- guide:programs -->
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
<!-- /guide:programs -->

## Frame, layout, forms, and chat building blocks

For mini-app frames, the host supplies the shared base font, text color, line height, box sizing,
and a body without default margin. In real frames, it limits the page to the frame height. The
provided mount point `#root` scrolls and keeps the shared workspace padding of 18 pixels on all
sides, even without `AppLayout`. Its scrollbar sits at the right frame edge; the body creates no
additional scroll area. An `AppLayout` placed directly inside adds no second outer spacing. The
author guide requires rendering into `#root` and leaving page dimensions, scroll behavior, and
outer spacing to the host. Utility classes style the spacing within the content. Standalone
previews without the frame marker keep their document flow. Views that are already installed
receive the shared rules when reloaded; their own sources and content spacing additionally set
there are preserved.

`AppLayout` arranges title, description, content, and optional actions with shared spacing. By
default, it grows in the document flow. With `fill`, it fills a height-limited parent area; only
its content scrolls, header and actions stay visible. The content area reserves four pixels for
outer focus rings without changing the alignment with header and actions. `Stack` keeps vertical
spacing or forms a wrapping row. `Grid` arranges equal-width columns by the width of its container
and reduces them on narrow surfaces down to one column. The width of the mini-app is what counts,
not that of the whole browser window. The type contracts limit spacing, direction, and column
selection; arbitrary CSS parameters are not part of these building blocks. The text analysis and
shared list templates use the grid for input and result; the blank view and the controls demo also
use the shared layout basis.

`Dialog` is the same modal building block as in the host: `Dialog` with `open`/`onOpenChange`,
`DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogBody`, and
`DialogFooter`, with focus management and Escape. The dialog lies above the content of the frame
and does not change its dimensions; the SDK ships the required styles.

`ListDetail` connects a controlled, optionally grouped selection with a detail area. Search and
filter bar, detail header, content, and actions are slots. In a height-limited area, the detail
header and actions stay in place; the actions sit at the bottom edge. Only the middle detail
content scrolls, separately from the list, also in the narrow detail view. Icons, kind labels, and
semantic colors are the caller's data; the building block uses the shared tokens. Below 900
pixels, the list fills the area alone; a selection opens the details as a separate page with a
round back button, focus management, and without the search and filter bar. What counts is the
building block's own width, not that of the browser window; the same threshold controls display
and switching. When the area becomes wide again, list and details sit side by side. Mini-apps use
the same implementation from `apps/web/src/ui` as the host; the generated control catalog and its
demo contain the same type contract.

Mini-apps use the shadcn/ui components of the shared library (see plugins) and Tailwind. The
mini-app compiler compiles `apps/web/src/ui/frame.css` per view with `@tailwindcss/node` across
the host sources, the mini-app building blocks, and the sources of the mini-app and delivers the
result in the frame; the styling lives as utility classes in the app code, and the bundled
mini-apps no longer have a stylesheet of their own. The runtime sets
`data-ui-surface="mini-app"` on the root element of the frame for type and base dimensions; the
building block demo of the reference sets the same marker. `Form`, `DataTable`, `FilePicker`,
`TaskProgress`, `DocumentViewer`, `DiffViewer`, `AppLayout`, `Stack`, and `Grid` are built from
`Field`, `Input`, `Checkbox`, `Select`, `DataGrid`, `Progress`, and Tailwind classes and keep their
own props. The card frame remains; the app content appears at 100 percent in all modes.

The text analysis and shared list templates as well as the collection board use the shared
building blocks. Their type, surfaces, and lists follow the theme tokens; a separate style fixed to
light is no longer used. Actor programs that were already created keep their own sources until
explicitly edited and activated.

Status colors and diff markers keep using the host's semantic tokens. On the first connection and
on later theme changes, the host bridge sets the resolved appearance on the root element of the
frame document. Neither the frame nor the actor state is reloaded for this; local inputs are
preserved. An optional stylesheet of a mini-app's own stays loaded after the shared CSS. Hard-coded
app colors are not recolored automatically.

Forms use declared fields and controlled values, validate inputs, and wait for asynchronous send
actions. The author guide prefers `Form` also for single interview questions and wizard steps.
Questions and progress stay in the app's state; labels, field height, error messages, and
asynchronous submission are handled by the form. Inside `AppLayout`, its own outer spacing is
dropped. Text analysis and shared list use forms with multi-line inputs; the controls demos also
show textareas. The layout demo of the reference explicitly applies an entered answer locally and
creates no agent response. Short input hints belong as `placeholder` in empty text, number, and
multi-line fields; explicitly set `hint` values stay as permanent hints below the field. Field
names and required markers stay visible. Checkboxes sit on one line with their label. Editable
select fields show field name and required marker directly in the select button; in read-only
display, the field name sits above the value. Multi-line fields without their own `rows` value
start with two lines and can be enlarged. Forms, file and task lists, and tables use compact
padding and row spacing with unchanged font size. Data tables have typed columns, search, sorting,
controlled row selection, and asynchronous row actions. `DataTable` delegates its rows to the
shared `DataGrid`, so its list fills the available width, uses the page's scroll, and virtualizes
measured rows. A stable `id` retains resized widths across reloads; columns accept `width`,
`minWidth`, `resizable`, `wrap`, and `flex`, and cells truncate with full-text tooltips. Mini-apps can also use
`UI.DataGrid` directly for grouping or a bounded scrolling panel (see `plugins.md`, UI library).
Errors stay visible and inputs are preserved. The table search sits on one line with the
placeholder "Search table"; the same
accessible label is kept regardless of the entered search text. Host chat and mini-app file picker
share the intake of files through input, drop, and paste. Text insertion at the selection stays
with the chat; file filters, selection rules, and preview stay with the respective control. The
shared drag detection reacts only to files. The file picker supports selection, drop, and paste
with shared type, count, and size limits; files stay local until the app runs its send action.
Media previews use temporary object URLs, text previews are limited. Task progress shows predefined
status values; documents can be read as text, Markdown, or code. The diff view displays a supplied
unified diff and neither computes nor writes changes itself.

`actor_program_controls` with `topic: "controls"` reads the control catalog from the exported type
contracts of the building block collection; without `topic`, the same selection applies. Without
`component`, it returns only the names. With a control, the response contains only `files`,
without the name list, follows that control's TypeScript symbols, and contains exclusively the
chosen declaration and its transitively required types and imports; other controls and unused
types are left out. Renamed exports and local references stay resolvable. With `topic: "guide"`,
it instead returns the complete rendered actor program guide in the `guide` field. `component` is
allowed only for the `controls` topic; together with `guide`, the request is explicitly rejected.
The complete automatic file collector still supplies the client compiler and the generated HTML/LLM
reference. The reference derives props, variants, and descriptions from the TypeScript contract and
checks that it matches the runtime exports. There is no second manually maintained component or
props list. The `controls` template shows the building blocks as a local, interactive mini-app
without domain actions.

`UI.Chat` has two explicitly separate forms:

- `actor="primary"` binds the chat to the currently chosen primary actor of the run. It shares the
  live history of the main chat. `actor="@handle"` binds it to a named actor of the same run. Its
  history shows inputs, published responses, reasoning steps, and tool calls with arguments and
  results in journal order. These steps stay with the original conversation even after the primary
  actor changes. The view updates at message level; no token deltas are transferred for this actor
  view. Inputs go through the host's chat route as a user message to the actor. The app needs no
  action of its own, no handler, and no capability in the actor contract for this. Unknown or
  stopped actors are reported explicitly. Free run IDs, foreign journals, and custom fetch
  connections are not part of this binding.
- `messages={messages}` and an optional `onSend` result in a chat controlled by the app code. The
  app supplies its messages and processes inputs itself, for example through a declared action and
  the shared actor state. The building block adds neither messages nor responses automatically. It
  is also suitable for a history without an actor. This form cannot be combined with `actor`.

A `UI.Chat` bound to TypeScript receives the existing history read-only, an explanatory notice,
and no input. The host bridge keeps this restriction even with write permission on the run; direct
send attempts are rejected. A controlled chat with its own `onSend` remains an interface defined by
the program.

`showInput={false}` shows only the history in both forms. Title, input placeholder, timestamps, and
detail display can be set through props. `UI.ChatMessages` and `UI.ChatInput` offer history and
input separately. `UI.Markdown` renders its `text`; `UI.Select`, `UI.Button`, `UI.Toggle`,
`UI.ToggleGroup`, `UI.ChoiceSelect`, `UI.FilterSelect`, `UI.Tabs`, `UI.Dialog`, and the other
shadcn components are the same controls as in the main interface (see plugins); a mini-app
builds no buttons or tabs of its own, and icons
come from `lucide-react`. The binding props and message types are in the UI contracts in the code;
for the shadcn components, they are the ones documented by shadcn and Base UI. `UI.ChoiceSelect`
and `UI.FilterSelect` choose joined segments for one to five values and dropdowns for longer
lists, with the shared host sizes, colors, and keyboard behavior.

`UI.Chat` and `UI.ChatMessages` can use `owner` to name a sender whose messages appear without a
bubble. The value is compared with `sender`; roles and bubbles of the other senders are preserved.
Without its own value, an actor chat automatically takes the resolved actor as owner.
`owner={null}` turns this default off. For freely supplied messages without an owner, the
respective message defaults stay in effect. The owner affects only the display, not any identity
or permissions of the run.

`UI.MessageList` displays a plain, read-only sequence with freely named senders. The mini-app
passes the messages as props; a new array value updates the display. The order stays that of the
array, message keys stay stable. The building block uses the same message display as the side
chat, with Markdown, attachments, and optionally visible timestamps. Senders without their own
color receive a stable color; the side can be chosen explicitly per message. Here too, `owner`
shows the messages of the matching sender name without a bubble; without an owner or with `null`,
all senders stay in bubbles. The complete fields and props are in the automatically captured
control contract.

The list has no input, title bar, actor connection, or network request of its own. It adds no
messages itself and does not model tool or reasoning steps. The app can derive its data from local
React state or from the actor state already available. Shared state changes reach the display
through the host bridge. The local controls template and the UI demo of the reference show two
senders and a button that visibly appends another local message. The demo additionally lets you
choose which sender appears without a bubble.

The shared chat input clears text and attachments at the start of a valid send action. A draft
newly written in the meantime is preserved on success and on error. Without a text change, an
error automatically restores the original input including attachments; otherwise it stays
retrievable separately. "Insert unsent input" explicitly appends it to the current draft and checks
the attachment limits. Further send actions and new attachments stay locked until the request
ends. The complete rules including reset are in the plugins chapter.

These inputs also support file selection, drag-and-drop, and pasting from the clipboard. For
controlled chats, `onSend(text, attachments)` receives the file names, MIME types, and Base64
contents as the second argument; the app takes care of delivery. It can state the capabilities of
its target model through `attachmentCapabilities`. An actor chat receives this information from
the host. Attachment errors preserve the whole draft. The history uses the same media previews and
download links as the main chat.

The `chat` template connects these building blocks with the normal activation path. Because it
has no callable interfaces of its own, it needs no simulated chat response and no action test. If
an app adds its own actions or tools, the usual testing requirement applies to them.

The building blocks are included with `import * as UI from "@ragents/client/ui"`. `ui-field`
belongs directly on an input element, never on its wrapper. `FlowDiagram` with `layout="star"`
places the first node in the center.

## Host bridge

The host bridge runs as the first script in the document, creates a `MessageChannel`, and
registers with the host using its transferred port and a random fragment token. The host already
listens before the frame loads, checks the token, the opaque origin, and the current
`contentWindow`, and accepts exactly the first transferred port bound to this document.
The connection belongs to the loaded frame document. Hiding a retained panel preserves its port,
pending requests, document, and drafts; revealing it sends current host state without reloading.
Replacing a host callback also leaves the connection intact. A revision change or removal of the
frame closes its connection. The connection timeout starts after the document loads and pauses
while the panel is hidden.
Publicly, the client sees the imported, typed `context`:

- `context.ready` waits for the bridge.
- `context.capabilities.call(actionId, input)` calls a permanently installed action.
- `context.state.read()` reads the last received intrinsic actor state.
- `context.state.subscribe(listener)` reports later state changes.
- `context.chat.read(actor)` returns the current snapshot with `messages`, `running`, model
  capabilities for attachments, optional `owner` as the resolved actor, and optional errors;
  `undefined` before the first delivery.
- `context.chat.subscribe(actor, listener)` subscribes to changes of this actor view and returns an
  unsubscribe function; `actor` is `primary` or an actor address of the app's run, such as
  `"@" + context.actor.handle`. The host checks it with the engine's address grammar
  (`isActorAddress`: room-qualified addresses and dotted handles of older journals included) and
  resolves it as the main room writes it.
- `context.chat.send(actor, text, attachments?)` sends a user message with optional attachments
  through the host and returns a promise. This fixed UI connection is not an arbitrary module
  capability and does not allow switching to another run. An app sends only after an explicit
  operator action.

The host checks message type, request ID, JSON depth, and size. Clients generate unique request
IDs. The host remembers the last 512 IDs of a frame and rejects their repetition; the number of
consecutive valid calls is unlimited. The server additionally checks the reuse of action IDs.
Regularly updated mini-apps can therefore keep reading their status even in long runs. Action
calls carry the installed `compilationHash`. A later navigation visibly disconnects the port; the
target document receives no new bridge. App code is nevertheless trusted content of the run and
not a confidentiality boundary against a malicious app author: a sandboxed iframe may navigate its
own document, and the navigation request may have been sent before the host disconnects.

<!-- guide:programs -->
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
<!-- /guide:programs -->

## Open limits

- A successful type check and domain test is no proof that an interface renders.
  `actor_view_snapshot` shows what a visible view renders, but only on a server without sign-in that the
  browser's machine can reach; it does not prove that the interface behaves correctly.
- Progress within a backend function that is still running is not automatically published as
  shared state; the state is committed at successful completion.
- A view has no scheduler of its own; subscription events deliver normal ActorInputs to the actor.
- The background project check keeps a result while the package's sources and context stay the
  same; a target actor that appears later clears an "unknown actor" error only with the next
  change of either or with an activation, which always checks anew.
- Browser CSP and run file permissions do not replace a separate trust boundary for foreign code.
- Between the last check and the renaming of a new package, only a foreign process, such as a shell
  of the run, can still create an empty folder of the same name; `rename` then replaces it. Node
  offers no rename without replacement (`RENAME_NOREPLACE`).
